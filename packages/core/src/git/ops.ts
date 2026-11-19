import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GitReader, GitError } from './reader.ts';

/** 网络操作（fetch/pull/push）的默认超时：宁可失败也不能挂死窗口 */
const NETWORK_TIMEOUT_MS = 120_000;

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

export interface WorkingFile {
  path: string;
  kind: ChangeKind;
  /** porcelain 的 XY 原始标记，便于前端显示 M/A/D */
  code: string;
}

export type RepoOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;

export interface RepoStatus {
  branch: string | null;
  detached: boolean;
  headSha: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** 工作区 + 暂存区都干净（未跟踪文件不算脏） */
  clean: boolean;
  staged: WorkingFile[];
  unstaged: WorkingFile[];
  untracked: WorkingFile[];
  conflicts: WorkingFile[];
  operation: RepoOperation;
  remoteUrl: string | null;
  stashCount: number;
}

export interface OpResult {
  ok: boolean;
  message: string;
  /** 结构化补充信息，例如冲突文件列表、快照 ref */
  conflicts?: WorkingFile[];
  snapshot?: string;
  stderr?: string;
}

function makeReader(gitPath: string | undefined, repoPath: string): GitReader {
  return new GitReader({ cwd: repoPath, ...(gitPath ? { gitPath } : {}) });
}

function classify(code: string): ChangeKind {
  if (code === 'A') return 'added';
  if (code === 'D') return 'deleted';
  if (code === 'R' || code === 'C') return 'renamed';
  return 'modified';
}

/** XY 里 X 是暂存区、Y 是工作区，'.' 表示没有变化 */
function splitXY(xy: string): { index: string; worktree: string } {
  return { index: xy[0] ?? '.', worktree: xy[1] ?? '.' };
}

/**
 * 仓库状态。
 *
 * 用 porcelain=v2 -z：机器可读、路径不受空格/中文影响，
 * 比解析人类可读的 `git status` 稳定得多。
 *
 * `-uall` 必须加：默认会把未跟踪目录折叠成 `notes/` 一条，
 * 界面上点它看差异时根本读不出文件内容。
 */
export async function getStatus(gitPath: string | undefined, repoPath: string): Promise<RepoStatus> {
  const reader = makeReader(gitPath, repoPath);
  const out = await reader.run(['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z']);
  const entries = out.split('\0');

  let branch: string | null = null;
  let detached = false;
  let headSha: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  const staged: WorkingFile[] = [];
  const unstaged: WorkingFile[] = [];
  const untracked: WorkingFile[] = [];
  const conflicts: WorkingFile[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (entry.length === 0) continue;

    if (entry.startsWith('# branch.oid ')) {
      const value = entry.slice('# branch.oid '.length);
      headSha = value === '(initial)' ? null : value;
      continue;
    }
    if (entry.startsWith('# branch.head ')) {
      const value = entry.slice('# branch.head '.length);
      if (value === '(detached)') detached = true;
      else branch = value;
      continue;
    }
    if (entry.startsWith('# branch.upstream ')) {
      upstream = entry.slice('# branch.upstream '.length);
      continue;
    }
    if (entry.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(entry);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (entry.startsWith('? ')) {
      untracked.push({ path: entry.slice(2), kind: 'untracked', code: '?' });
      continue;
    }

    // u XY sub m1 m2 m3 mW h1 h2 h3 <path>
    const unmerged = /^u (..) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(entry);
    if (unmerged) {
      conflicts.push({ path: unmerged[2]!, kind: 'conflict', code: unmerged[1]! });
      continue;
    }

    // 1 XY sub mH mI mW hH hI <path>
    const changed = /^1 (..) \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(entry);
    if (changed) {
      collectChanged(staged, unstaged, changed[1]!, changed[2]!);
      continue;
    }

    // 2 XY sub mH mI mW hH hI Xscore <path>  —— 下一项是原路径，跳过
    const renamed = /^2 (..) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(entry);
    if (renamed) {
      collectChanged(staged, unstaged, renamed[1]!, renamed[2]!);
      i += 1;
    }
  }

  const gitDir = (await reader.tryRun(['rev-parse', '--absolute-git-dir']))?.trim() ?? null;
  let operation: RepoOperation = null;
  if (gitDir) {
    if (existsSync(join(gitDir, 'MERGE_HEAD'))) operation = 'merge';
    else if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply')))
      operation = 'rebase';
    else if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) operation = 'cherry-pick';
    else if (existsSync(join(gitDir, 'REVERT_HEAD'))) operation = 'revert';
  }

  const remoteUrl = (await reader.tryRun(['remote', 'get-url', 'origin']))?.trim() ?? null;
  const stashOut = await reader.tryRun(['stash', 'list']);
  const stashCount = stashOut ? stashOut.split('\n').filter((line) => line.trim().length > 0).length : 0;

  return {
    branch,
    detached,
    headSha,
    upstream,
    ahead,
    behind,
    clean: staged.length === 0 && unstaged.length === 0 && conflicts.length === 0,
    staged,
    unstaged,
    untracked,
    conflicts,
    operation,
    remoteUrl,
    stashCount,
  };
}

function collectChanged(staged: WorkingFile[], unstaged: WorkingFile[], xy: string, path: string): void {
  const { index, worktree } = splitXY(xy);
  if (index !== '.') {
    staged.push({ path, kind: classify(index), code: index });
  }
  if (worktree !== '.') {
    unstaged.push({ path, kind: classify(worktree), code: worktree });
  }
}

/**
 * 在改历史之前留一个回滚点。
 *
 * 存成 refs/atlas/backup/<时间戳>：不进分支、不被 gc 清掉、也不会出现在
 * `git branch` 里污染用户仓库，只有 GitAtlas 自己知道怎么用。
 */
export async function createSnapshot(
  gitPath: string | undefined,
  repoPath: string,
): Promise<string | null> {
  const reader = makeReader(gitPath, repoPath);
  const head = (await reader.tryRun(['rev-parse', 'HEAD']))?.trim();
  if (!head) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ref = `refs/atlas/backup/${stamp}`;
  await reader.run(['update-ref', ref, head]);
  return ref;
}

export interface SnapshotEntry {
  ref: string;
  name: string;
  sha: string;
  createdAt: string;
}

export async function listSnapshots(
  gitPath: string | undefined,
  repoPath: string,
): Promise<SnapshotEntry[]> {
  const reader = makeReader(gitPath, repoPath);
  const out = await reader.tryRun([
    'for-each-ref',
    '--format=%(refname)|%(objectname)|%(creatordate:iso-strict)',
    'refs/atlas/backup',
  ]);
  if (!out) return [];

  return out
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [ref = '', sha = '', createdAt = ''] = line.split('|');
      return { ref, name: ref.replace('refs/atlas/backup/', ''), sha, createdAt };
    })
    .reverse(); // 新的在前
}

/** fetch / pull / push 超时统一处理 */
async function runNetwork(reader: GitReader, args: string[]): Promise<OpResult> {
  try {
    const out = await reader.run(args, NETWORK_TIMEOUT_MS);
    const lines = out.trim().split('\n').filter(Boolean);
    return { ok: true, message: lines.slice(-6).join('\n') || '完成' };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

function stderrOf(error: unknown): string {
  return error instanceof GitError ? error.stderr : '';
}

/**
 * 把 git 的英文报错翻成能看懂的一句中文。
 *
 * GUI 用户不该被迫读 "fatal: Not possible to fast-forward, aborting."。
 */
function explainGitError(error: unknown): string {
  const raw = stderrOf(error).trim() || (error instanceof Error ? error.message : String(error));
  const lower = raw.toLowerCase();

  if (lower.includes('could not read username') || lower.includes('authentication failed'))
    return '需要仓库账号密码：这个远端要求登录，当前还没有配置凭据。';
  if (lower.includes('permission denied (publickey)'))
    return 'SSH 密钥不被远端接受：请确认这台机器上的公钥已加到代码托管平台。';
  if (lower.includes('not possible to fast-forward') || lower.includes('diverged'))
    return '本地和远端已经分叉，需要先合并：可以先「拉取」再处理冲突。';
  if (lower.includes('would be overwritten') || lower.includes('local changes'))
    return '有未提交的改动会与远端冲突，请先提交或暂存。';
  if (lower.includes('no such remote') || lower.includes('does not appear to be a git repository'))
    return '远端地址无效或无法访问。';
  if (lower.includes('not fully merged'))
    return '这个分支还有未合并的提交，删掉会丢历史；确认要用强制删除。';
  if (lower.includes('pathspec') && lower.includes('did not match'))
    return '找不到这个分支或路径：可能名字打错了，或者它只在远端、本地还没有。';
  if (lower.includes('already exists'))
    return '同名分支或标签已存在。';
  if (lower.includes('timed out') || lower.includes('超时'))
    return '操作超时：网络可能不通，或远端响应太慢。';
  if (lower.includes('conflict'))
    return '存在冲突，需要逐个文件选择保留哪一边。';
  if (lower.includes('nothing to commit'))
    return '没有可提交的改动。';
  if (lower.includes('merge conflict') || lower.includes('automatic merge failed'))
    return '自动合并失败：有文件同时被两边改动，需要手动决定保留哪边。';

  return raw.split('\n').filter(Boolean).slice(-3).join(' ') || '操作失败';
}

export async function fetchRepo(gitPath: string | undefined, repoPath: string): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  return runNetwork(reader, ['fetch', '--all', '--prune']);
}

export async function pullRepo(gitPath: string | undefined, repoPath: string): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  // --no-rebase：GUI 无法处理 rebase 的交互式暂停，统一走 merge
  return runNetwork(reader, ['pull', '--no-rebase', '--no-edit']);
}

export async function pushRepo(gitPath: string | undefined, repoPath: string): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  return runNetwork(reader, ['push']);
}

export async function checkoutBranch(
  gitPath: string | undefined,
  repoPath: string,
  branch: string,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    await reader.run(['checkout', branch]);
    return { ok: true, message: `已切换到 ${branch}` };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

export async function createBranch(
  gitPath: string | undefined,
  repoPath: string,
  name: string,
  startPoint?: string,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    const args = ['branch', '--', name];
    if (startPoint) args.push(startPoint);
    await reader.run(args);
    return { ok: true, message: `已创建分支 ${name}` };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

export async function deleteBranch(
  gitPath: string | undefined,
  repoPath: string,
  name: string,
  force: boolean,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    await reader.run(['branch', force ? '-D' : '-d', '--', name]);
    return { ok: true, message: `已删除分支 ${name}` };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

/** 合并：冲突不抛错，转成结构化结果交给前端处理 */
export async function mergeBranch(
  gitPath: string | undefined,
  repoPath: string,
  branch: string,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  const snapshot = await createSnapshot(gitPath, repoPath).catch(() => null);

  try {
    await reader.run(['merge', '--no-edit', branch]);
    const result: OpResult = { ok: true, message: `已合并 ${branch}` };
    if (snapshot) result.snapshot = snapshot;
    return result;
  } catch (error) {
    const status = await getStatus(gitPath, repoPath).catch(() => null);
    if (status && status.operation === 'merge') {
      const result: OpResult = {
        ok: false,
        message: `合并 ${branch} 时出现 ${status.conflicts.length} 个冲突文件，需要逐个选择保留哪边。`,
        conflicts: status.conflicts,
      };
      if (snapshot) result.snapshot = snapshot;
      return result;
    }
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

export async function abortMerge(gitPath: string | undefined, repoPath: string): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    await reader.run(['merge', '--abort']);
    return { ok: true, message: '已放弃这次合并，回到合并前的状态' };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

/** 冲突文件选边：保留本地 / 保留对方 */
export async function resolveConflict(
  gitPath: string | undefined,
  repoPath: string,
  path: string,
  side: 'ours' | 'theirs',
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    await reader.run(['checkout', `--${side}`, '--', path]);
    await reader.run(['add', '--', path]);
    return { ok: true, message: `已保留${side === 'ours' ? '本地' : '对方'}版本：${path}` };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

/** 冲突全部处理完后收尾提交 */
export async function concludeMerge(
  gitPath: string | undefined,
  repoPath: string,
  message?: string,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    const status = await getStatus(gitPath, repoPath);
    if (status.conflicts.length > 0) {
      return { ok: false, message: `还有 ${status.conflicts.length} 个冲突文件没处理` };
    }
    await reader.run(message ? ['commit', '--no-edit', '-m', message] : ['commit', '--no-edit']);
    return { ok: true, message: '合并已提交' };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

export async function createTag(
  gitPath: string | undefined,
  repoPath: string,
  name: string,
  target?: string,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    const args = ['tag', '--', name];
    if (target) args.push(target);
    await reader.run(args);
    return { ok: true, message: `已创建标签 ${name}` };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

/** 回滚：先给当前 HEAD 留快照，再硬重置 */
export async function resetHard(
  gitPath: string | undefined,
  repoPath: string,
  target: string,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  const snapshot = await createSnapshot(gitPath, repoPath).catch(() => null);
  try {
    await reader.run(['reset', '--hard', target]);
    const result: OpResult = { ok: true, message: `已回滚到 ${target.slice(0, 7)}` };
    if (snapshot) result.snapshot = snapshot;
    return result;
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

export async function restoreSnapshot(
  gitPath: string | undefined,
  repoPath: string,
  ref: string,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  const snapshot = await createSnapshot(gitPath, repoPath).catch(() => null);
  try {
    await reader.run(['reset', '--hard', ref]);
    const result: OpResult = { ok: true, message: `已恢复到回滚点 ${ref.replace('refs/atlas/backup/', '')}` };
    if (snapshot) result.snapshot = snapshot;
    return result;
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

export async function stagePaths(
  gitPath: string | undefined,
  repoPath: string,
  paths: string[],
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    await reader.run(['add', '--', ...paths]);
    return { ok: true, message: `已暂存 ${paths.length} 个文件` };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

export async function unstagePaths(
  gitPath: string | undefined,
  repoPath: string,
  paths: string[],
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    await reader.run(['restore', '--staged', '--', ...paths]);
    return { ok: true, message: `已取消暂存 ${paths.length} 个文件` };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

/** 丢弃工作区改动（危险，调用方需二次确认） */
export async function discardPaths(
  gitPath: string | undefined,
  repoPath: string,
  paths: string[],
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    await reader.run(['restore', '--', ...paths]);
    return { ok: true, message: `已丢弃 ${paths.length} 个文件的改动` };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}

export async function commitAll(
  gitPath: string | undefined,
  repoPath: string,
  message: string,
): Promise<OpResult> {
  const reader = makeReader(gitPath, repoPath);
  try {
    await reader.run(['add', '-A']);
    const out = await reader.run(['commit', '-m', message]);
    const first = out.split('\n').find((line) => line.trim().length > 0) ?? '已提交';
    return { ok: true, message: first.replace(/^\[[^\]]+\]\s*/, '') };
  } catch (error) {
    return { ok: false, message: explainGitError(error), stderr: stderrOf(error) };
  }
}
