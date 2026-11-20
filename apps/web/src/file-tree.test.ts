import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TreeEntry } from './api.ts';
import { buildFileTree, collectDirPaths, filterFileTree } from './file-tree.ts';

function entry(path: string, overrides: Partial<TreeEntry> = {}): TreeEntry {
  return { path, state: 'tracked', change: null, staged: false, unstaged: false, size: null, directory: false, ...overrides };
}

test('buildFileTree 把扁平路径拼成目录，目录排在文件前面', () => {
  const tree = buildFileTree([
    entry('README.md'),
    entry('src/app.ts'),
    entry('src/util/format.ts'),
  ]);

  assert.deepEqual(
    tree.map((node) => `${node.kind}:${node.name}`),
    ['dir:src', 'file:README.md'],
  );

  const src = tree[0]!;
  assert.deepEqual(
    src.children.map((node) => `${node.kind}:${node.name}`),
    ['dir:util', 'file:app.ts'],
  );
  assert.equal(src.fileCount, 2);
});

test('buildFileTree 统计每个目录里有多少文件、多少有改动', () => {
  const tree = buildFileTree([
    entry('src/app.ts', { change: 'modified' }),
    entry('src/util/format.ts'),
    entry('src/util/new.ts', { state: 'untracked', change: 'untracked' }),
  ]);

  const src = tree[0]!;
  assert.equal(src.fileCount, 3);
  assert.equal(src.changeCount, 2);

  const util = src.children.find((node) => node.name === 'util')!;
  assert.equal(util.fileCount, 2);
  assert.equal(util.changeCount, 1);
});

test('buildFileTree 被忽略的目录当成一个节点，不再往下展开', () => {
  const tree = buildFileTree([entry('node_modules', { state: 'ignored', directory: true })]);
  const node = tree[0]!;
  assert.equal(node.kind, 'dir');
  assert.equal(node.entry?.state, 'ignored');
  assert.deepEqual(node.children, []);
});

test('filterFileTree 命中文件时把它的父目录一起留下', () => {
  const tree = buildFileTree([
    entry('src/app.ts'),
    entry('src/util/format.ts'),
    entry('docs/readme.md'),
  ]);

  const filtered = filterFileTree(tree, 'format');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.name, 'src');
  assert.deepEqual(
    filtered[0]!.children.map((node) => node.name),
    ['util'],
  );
  assert.deepEqual(
    filtered[0]!.children[0]!.children.map((node) => node.name),
    ['format.ts'],
  );
});

test('filterFileTree 目录名命中就整枝留下', () => {
  const tree = buildFileTree([entry('src/app.ts'), entry('src/util/format.ts'), entry('docs/a.md')]);
  const filtered = filterFileTree(tree, 'src');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.children.length, 2);
});

test('filterFileTree 关键字为空时原样返回', () => {
  const tree = buildFileTree([entry('a.ts')]);
  assert.equal(filterFileTree(tree, '   '), tree);
});

test('collectDirPaths 收齐目录，折叠的忽略目录不算', () => {
  const tree = buildFileTree([
    entry('src/util/a.ts'),
    entry('node_modules', { state: 'ignored', directory: true }),
  ]);
  assert.deepEqual(collectDirPaths(tree).sort(), ['node_modules', 'src', 'src/util'].sort());
});
