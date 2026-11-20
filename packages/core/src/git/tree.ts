import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { GitReader } from './reader.ts';
import { getStatus, type ChangeKind } from './ops.ts';

/** 一次最多返回多少条：十万文件的仓库不能把整个列表塞进浏览器 */
const MAX_ENTRIES = 20_000;
/** 低于这个数量才逐个 stat 取大小；再往上就是白等 */
const STAT_BUDGET = 500;

export type TreeState = 'tracked' | 'untracked' | 'ignored';

export interface TreeEntry {
  /** 相对仓库根的路径，永远用 / 分隔 */
  path: string;
  state: TreeState;
  /** 工作区里的改动；没改动就是 null */
  change: ChangeKind | null;
  /** 是否在暂存区有改动 */
  staged: boolean;
  /** 是否有未暂存的改动（未跟踪文件也算） */
  unstaged: boolean;
  /** A working copy can be untracked while its deletion is staged. */
  untracked?: boolean;
  /** 文件字节数；超出预算或读不到时为 null */
  size: number | null;
  /** 被忽略的是整个目录时，这条是目录而不是文件 */
  directory: boolean;
}

export interface TreeListing {
  entries: TreeEntry[];
  truncated: boolean;
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  counts: { tracked: number; untracked: number; ignored: number; changed: number };
  hasGitignore: boolean;
}

function splitNul(text: string): string[] {
  return text.split('\0').filter((item) => item.length > 0);
}

/** ls-files 给的是绝对相对路径，Windows 上偶尔出现反斜杠，统一成 / */
function normalise(p: string): string {
  // Git uses slash separators on Windows; on POSIX backslashes may be filename characters.
  return process.platform === 'win32' ? p.replace(/\\/g, '/') : p;
}

function readerFor(gitPath: string | undefined, repoPath: string): GitReader {
  return new GitReader({ cwd: repoPath, ...(gitPath ? { gitPath } : {}) });
}

/**
 * 工作目录清单：已跟踪 + 未跟踪（受 .gitignore 约束），可选把被忽略的也列出来。
 *
 * 被忽略的部分用 `--directory` 折叠：`node_modules/` 一条就够，
 * 真按文件铺开能一次返回一万两千条，界面和网络都吃不消。
 */
export async function listWorkingTree(
  gitPath: string | undefined,
  repoPath: string,
  options: { includeIgnored?: boolean; withSize?: boolean; query?: string; offset?: number; limit?: number } = {},
): Promise<TreeListing> {
  const reader = readerFor(gitPath, repoPath);
  const needle = options.query?.trim().toLowerCase() ?? '';
  const requestedLimit = options.limit ?? MAX_ENTRIES;
  const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(MAX_ENTRIES, requestedLimit)) : MAX_ENTRIES;
  const requestedOffset = options.offset ?? 0;
  const offset = Number.isSafeInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;

  const [trackedOut, status, ignoredOut] = await Promise.all([
    reader.run(['ls-files', '-z', '--cached']),
    getStatus(gitPath, repoPath, false),
    options.includeIgnored ? reader.run([
      'ls-files', '-z', '--others', '--ignored', '--exclude-standard', ...(needle ? [] : ['--directory']),
    ]) : '',
  ]);

  const tracked = new Set(splitNul(trackedOut).map(normalise));
  const untracked = new Map(status.untracked.map((file) => [normalise(file.path).replace(/\/+$/, ''), file.path.endsWith('/')]));
  const ignored = splitNul(ignoredOut).map((raw) => ({ path: normalise(raw).replace(/\/+$/, ''), directory: raw.endsWith('/') }));

  // 改动标记复用 status：一次 porcelain=v2 解析，比逐文件 diff 便宜得多
  const changeOf = new Map<string, ChangeKind>();
  const stagedPaths = new Set<string>();
  const unstagedPaths = new Set<string>();
  for (const file of status.staged) {
    const filePath = normalise(file.path);
    changeOf.set(filePath, file.kind);
    stagedPaths.add(filePath);
    // A staged deletion is absent from the index but still belongs in the tree.
    if (file.kind === 'deleted') tracked.add(filePath);
  }
  for (const file of status.unstaged) {
    const filePath = normalise(file.path);
    changeOf.set(filePath, file.kind);
    unstagedPaths.add(filePath);
    if (file.kind === 'deleted') tracked.add(filePath);
  }
  // Conflicts take precedence over the staged and unstaged status.
  for (const file of status.conflicts) {
    const filePath = normalise(file.path);
    changeOf.set(filePath, 'conflict');
    stagedPaths.add(filePath);
    unstagedPaths.add(filePath);
    tracked.add(filePath);
  }

  const changed = new Set([...stagedPaths, ...unstagedPaths, ...untracked.keys()]).size;
  const matches: Array<{ path: string; state: TreeState; directory: boolean }> = [];
  const push = (path: string, state: TreeState, directory = false) => {
    if (!needle || path.toLowerCase().includes(needle)) matches.push({ path, state, directory });
  };
  for (const p of tracked) push(p, 'tracked');
  for (const [filePath, directory] of untracked) {
    if (!tracked.has(filePath)) push(filePath, 'untracked', directory);
  }
  for (const entry of ignored) {
    if (!tracked.has(entry.path)) push(entry.path, 'ignored', entry.directory);
  }

  matches.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const entries: TreeEntry[] = matches.slice(offset, offset + limit).map((entry) => ({
    ...entry,
    change: entry.state === 'untracked' ? 'untracked' : entry.state === 'tracked' ? changeOf.get(entry.path) ?? null : null,
    staged: entry.state !== 'ignored' && stagedPaths.has(entry.path),
    unstaged: entry.state !== 'ignored' && (untracked.has(entry.path) || unstagedPaths.has(entry.path)),
    untracked: entry.state !== 'ignored' && untracked.has(entry.path),
    size: null,
  }));

  // 文件不多时顺手把大小带上，详情面板就不用再单独点一次
  if (options.withSize !== false && entries.length <= STAT_BUDGET) {
    await fillSizes(repoPath, entries);
  }

  const hasGitignore = await lstat(join(repoPath, '.gitignore'))
    .then((info) => info.isFile() && !info.isSymbolicLink())
    .catch(() => false);

  const total = matches.length;
  return {
    entries,
    truncated: total > limit,
    total,
    offset,
    limit,
    nextOffset: offset + entries.length < total ? offset + entries.length : null,
    counts: {
      tracked: tracked.size,
      untracked: untracked.size,
      ignored: ignored.length,
      changed,
    },
    hasGitignore,
  };
}

/** 并发不要太高：一万次 open 一起打出去，Windows 上句柄先耗尽 */
async function fillSizes(root: string, entries: TreeEntry[]): Promise<void> {
  const CHUNK = 64;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (entry) => {
        if (entry.directory) return;
        try {
          const filePath = join(root, entry.path);
          const info = await lstat(filePath);
          if (info.isFile() && !info.isSymbolicLink()) entry.size = info.size;
        } catch {
          // 文件可能刚好被删掉，忽略即可
        }
      }),
    );
  }
}
