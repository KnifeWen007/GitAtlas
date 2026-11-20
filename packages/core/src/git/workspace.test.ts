import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { addIgnoreRule, parseIgnore, readIgnoreFile, removeIgnoreRule, checkIgnore } from './ignore.ts';
import { resolveInsideRepo } from './safe-path.ts';
import { parseFileHistory, getFileDetail } from './inspect.ts';
import { listWorkingTree } from './tree.ts';
import { readWorkingFile, writeWorkingFile } from './file.ts';
import { discardPaths, unstagePaths } from './ops.ts';

async function withGitRepo(run: (root: string, git: (args: string[]) => string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitatlas-git-'));
  try {
    const git = (args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
      return result.stdout;
    };
    const probe = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
    if (probe.status !== 0) throw new Error('git is required for this test');
    git(['init', '-q']);
    git(['config', 'user.name', 'GitAtlas Test']);
    git(['config', 'user.email', 'test@example.invalid']);
    await run(root, git);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('parseIgnore 分清规则、注释和空行', () => {
  const rules = parseIgnore(['# 依赖', 'node_modules/', '', '!keep.txt', '  dist  '].join('\n'));

  assert.equal(rules.length, 5);
  assert.equal(rules[0]!.comment, true);
  assert.equal(rules[1]!.pattern, 'node_modules/');
  assert.equal(rules[2]!.blank, true);
  assert.equal(rules[3]!.negated, true);
  assert.equal(rules[3]!.pattern, 'keep.txt');
  assert.equal(rules[4]!.pattern, '  dist');
  assert.equal(rules[4]!.line, 5);
});

test('parseIgnore 去掉 Windows 换行留下的 \\r', () => {
  const rules = parseIgnore('*.log\r\nbuild/\r\n');
  assert.equal(rules[0]!.pattern, '*.log');
  assert.equal(rules[1]!.pattern, 'build/');
  // 末尾换行是分隔符，不会虚增一条规则
  assert.equal(rules.length, 2);
});

test('parseIgnore 保留有意义的前导空格与转义尾随空格', () => {
  const rules = parseIgnore(['foo\\ ', '  #literal', '  !not-negated', '# actual comment'].join('\n'));
  assert.equal(rules[0]!.pattern, 'foo\\ ');
  assert.equal(rules[1]!.comment, false);
  assert.equal(rules[1]!.pattern, '  #literal');
  assert.equal(rules[2]!.negated, false);
  assert.equal(rules[2]!.pattern, '  !not-negated');
  assert.equal(rules[3]!.comment, true);
});

test('parseIgnore 行号从 1 开始，删规则时要靠它', () => {
  const rules = parseIgnore('a\nb\nc');
  assert.deepEqual(
    rules.map((rule) => rule.line),
    [1, 2, 3],
  );
});

test('parseFileHistory 把每条提交的增删各自归拢', () => {
  const out = [
    '\x01abc123\x1fabc123\x1f张三\x1f2026-11-01T10:00:00+08:00\x1f修改入口',
    '10\t2\tsrc/main.ts',
    '3\t0\tsrc/util.ts',
    '',
    '\x01def456\x1fdef456\x1f李四\x1f2026-10-20T09:00:00+08:00\x1f重命名',
    '-\t-\told.bin',
  ].join('\n');

  const commits = parseFileHistory(out);
  assert.equal(commits.length, 2);
  assert.equal(commits[0]!.subject, '修改入口');
  assert.equal(commits[0]!.insertions, 13);
  assert.equal(commits[0]!.deletions, 2);
  // 二进制是 `-`，不能变成 NaN
  assert.equal(commits[1]!.insertions, 0);
  assert.equal(commits[1]!.deletions, 0);
});

test('parseFileHistory 遇到空输出给空数组', () => {
  assert.deepEqual(parseFileHistory(''), []);
});

test('addIgnoreRule 区分否定规则，不会把 !foo 当作 foo 的重复项', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitatlas-ignore-'));
  try {
    await fs.writeFile(path.join(root, '.gitignore'), 'foo\n', 'utf8');
    const result = await addIgnoreRule(root, '!foo');
    assert.equal(result.added, true);
    assert.equal(result.file.text, 'foo\n!foo\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('removeIgnoreRule 保留 CRLF 和原文件是否有末尾换行', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitatlas-remove-ignore-'));
  try {
    const target = path.join(root, '.gitignore');
    await fs.writeFile(target, 'first\r\nsecond\r\nthird', 'utf8');
    await removeIgnoreRule(root, 2);
    assert.equal(await fs.readFile(target, 'utf8'), 'first\r\nthird');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveInsideRepo 拒绝仓库外路径，但允许仓库内路径', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitatlas-path-'));
  try {
    // 函数返回的是 realpath 之后的绝对路径；Windows runner 的 TEMP 常是 8.3 短名
    // （RUNNER~1），直接和 mkdtemp 的返回值比较会假失败，所以期望值也先取 realpath。
    const canonicalRoot = await fs.realpath(root);
    const inside = await resolveInsideRepo(root, 'src/new.ts');
    assert.equal(inside, path.join(canonicalRoot, 'src', 'new.ts'));
    await assert.rejects(resolveInsideRepo(root, '../outside.txt'), /越过了仓库目录/);
    await assert.rejects(resolveInsideRepo(root, '.git/config'), /Git 元数据/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('checkIgnore 能解析含制表符的相对路径', async () => {
  await withGitRepo(async (root) => {
    const gitignore = spawnSync('git', ['config', 'core.excludesFile', ''], { cwd: root, encoding: 'utf8' });
    assert.equal(gitignore.status, 0);
    await fs.writeFile(path.join(root, '.gitignore'), '*.log\n', 'utf8');
    // Git can check an absent path too; Windows forbids control characters in real filenames,
    // but the NUL-delimited response must still preserve the tab in the path field.
    const filename = 'with\ttab.log';
    const match = await checkIgnore(undefined, root, filename);
    assert.equal(match?.source, '.gitignore');
    assert.equal(match?.line, 1);
    assert.equal(match?.pattern, '*.log');
    assert.equal(match?.path, filename);
  });
});

test('listWorkingTree 显示变更、暂存状态和忽略目录', async () => {
  await withGitRepo(async (root) => {
    const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'tracked.ts'), 'const value = 1;\n', 'utf8');
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored-dir/\n', 'utf8');
    const added = git(['add', '.']);
    assert.equal(added.status, 0, added.stderr);
    const committed = git(['commit', '-m', 'initial']);
    assert.equal(committed.status, 0, committed.stderr);

    await fs.writeFile(path.join(root, 'src', 'tracked.ts'), 'const value = 2;\n', 'utf8');
    await fs.writeFile(path.join(root, 'new.ts'), 'new file\n', 'utf8');
    await fs.mkdir(path.join(root, 'ignored-dir'), { recursive: true });
    await fs.writeFile(path.join(root, 'ignored-dir', 'hidden.txt'), 'ignored\n', 'utf8');
    const stage = git(['add', 'src/tracked.ts']);
    assert.equal(stage.status, 0, stage.stderr);

    const normal = await listWorkingTree(undefined, root, { withSize: true });
    assert.equal(normal.counts.tracked, 2); // .gitignore + src/tracked.ts
    assert.equal(normal.counts.untracked, 1);
    assert.equal(normal.counts.changed, 2);
    const tracked = normal.entries.find((entry) => entry.path === 'src/tracked.ts');
    assert.equal(tracked?.staged, true);
    assert.equal(tracked?.unstaged, false);
    assert.equal(normal.entries.some((entry) => entry.path.startsWith('ignored-dir')), false);

    const withIgnored = await listWorkingTree(undefined, root, { includeIgnored: true, withSize: false });
    assert.equal(withIgnored.entries.some((entry) => entry.path === 'ignored-dir' && entry.directory), true);

    const detail = await getFileDetail(undefined, root, 'src/tracked.ts');
    assert.equal(detail.tracked, true);
    assert.equal(detail.exists, true);
    assert.equal(detail.lines, 1);
    assert.equal(detail.history.length, 1);
    assert.equal(detail.lastCommit?.subject, 'initial');

    const directory = await getFileDetail(undefined, root, 'src');
    assert.equal(directory.isDirectory, true);
    assert.equal(directory.tracked, true);
    assert.equal(directory.commitCount, 1);
    const ignoredDirectory = await getFileDetail(undefined, root, 'ignored-dir');
    assert.equal(ignoredDirectory.isDirectory, true);
    assert.equal(ignoredDirectory.ignored, true);

    const firstPage = await listWorkingTree(undefined, root, { limit: 1, withSize: false });
    const nextPage = await listWorkingTree(undefined, root, { limit: 1, offset: firstPage.nextOffset!, withSize: false });
    assert.notEqual(firstPage.entries[0]?.path, nextPage.entries[0]?.path);
    const matches = await listWorkingTree(undefined, root, { limit: 1, query: 'TRACKED.TS', withSize: false });
    assert.deepEqual(matches.entries.map((entry) => entry.path), ['src/tracked.ts']);

    await addIgnoreRule(root, '*.log', 'src');
    assert.equal((await readIgnoreFile(root, 'src')).text, '*.log\n');
    assert.equal((await checkIgnore(undefined, root, 'src/report.log'))?.source, 'src/.gitignore');
  });
});

test('文件历史保留重命名前的路径，取消暂存重命名会同时恢复索引里的原路径', async () => {
  await withGitRepo(async (root, git) => {
    const names = ['原文件.txt', '阶段一.txt', '阶段二.txt'];
    await fs.writeFile(path.join(root, names[0]!), 'file contents\n');
    git(['add', names[0]!]);
    git(['commit', '-qm', 'initial']);
    git(['mv', names[0]!, names[1]!]);
    git(['commit', '-qm', 'rename']);
    const detail = await getFileDetail(undefined, root, names[1]!);
    assert.deepEqual(detail.history.map((item) => item.path), [names[1], names[0]]);

    git(['mv', names[1]!, names[2]!]);
    assert.equal((await unstagePaths(undefined, root, [names[2]!])).ok, true);
    assert.equal(git(['diff', '--cached', '--name-only']), '');
    assert.equal((await discardPaths(undefined, root, [names[2]!], true)).ok, true);
    await assert.rejects(fs.stat(path.join(root, names[2]!)), { code: 'ENOENT' });
  });
});

test('文本编辑器检测到磁盘内容变化时保留外部修改', async () => {
  await withGitRepo(async (root) => {
    const filePath = path.join(root, 'file.txt');
    await fs.writeFile(filePath, 'first\r\n');
    const initial = await readWorkingFile(root, 'file.txt');
    assert.ok(initial.revision);
    const saved = await writeWorkingFile(root, 'file.txt', 'next\r\n', initial.revision);
    assert.equal(await fs.readFile(filePath, 'utf8'), 'next\r\n');
    await fs.writeFile(filePath, 'external change\r\n');
    await assert.rejects(writeWorkingFile(root, 'file.txt', 'stale edit', saved.revision), /其他程序修改/);
    assert.equal(await fs.readFile(filePath, 'utf8'), 'external change\r\n');
  });
});

test('resolveInsideRepo 拒绝指向仓库外部的符号链接', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitatlas-symlink-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gitatlas-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');
    try {
      await fs.symlink(outside, path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES') {
        context.skip('当前系统不允许创建符号链接');
        return;
      }
      throw error;
    }
    await assert.rejects(resolveInsideRepo(root, 'external/secret.txt'), /符号链接/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
