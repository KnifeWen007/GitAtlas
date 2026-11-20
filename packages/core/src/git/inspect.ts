import fs from 'node:fs/promises';
import path from 'node:path';
import { GitReader } from './reader.ts';
import { checkIgnore, type IgnoreMatch } from './ignore.ts';
import { openRegularFileInsideRepo, resolveInsideRepo } from './safe-path.ts';

const HEAD_BYTES = 8_000;
const FULL_READ_LIMIT = 512 * 1024;
const HISTORY_LIMIT = 20;

export interface FileCommit {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  insertions: number;
  deletions: number;
  path: string | null;
}

export interface FileDetail {
  /** 相对仓库根的路径 */
  path: string;
  /** 文件名与所在目录分开给，界面上分两行显示 */
  name: string;
  dir: string;
  exists: boolean;
  isDirectory: boolean;
  size: number | null;
  mtime: string | null;
  binary: boolean;
  /** 文本文件的行数；太大或二进制时为 null */
  lines: number | null;
  tracked: boolean;
  ignored: boolean;
  /** 被哪条规则挡住的 */
  ignore: IgnoreMatch | null;
  /** 最近一次改动它的提交 */
  lastCommit: FileCommit | null;
  /** 至今一共被多少次提交改过 */
  commitCount: number | null;
  /** 最近 30 天被改过几次 */
  commits30d: number | null;
  /** 拿到的这段历史里的增删合计 */
  churn: { insertions: number; deletions: number };
  history: FileCommit[];
  note: string | null;
}

/** 把 `git log --numstat` 的混合输出拆成一条条提交 */
export function parseFileHistory(out: string): FileCommit[] {
  const commits: FileCommit[] = [];
  let current: FileCommit | null = null;

  const nulDelimited = out.includes('\0');
  const records = out.split(nulDelimited ? '\0' : '\n');
  for (let index = 0; index < records.length; index += 1) {
    const line = records[index]!.replace(/^\n/, '');
    if (line.startsWith('\x01')) {
      const fields = line.slice(1).split('\x1f');
      const [sha = '', shortSha = '', authorName = '', authoredAt = ''] = fields;
      const subject = fields.slice(4).join('\x1f');
      current = {
        sha,
        shortSha,
        authorName,
        authoredAt,
        subject,
        insertions: 0,
        deletions: 0,
        path: null,
      };
      commits.push(current);
      continue;
    }

    if (!current || line.trim().length === 0) continue;

    // numstat：`12\t3\tpath`，二进制是 `-\t-\tpath`
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    let changedPath = parts.slice(2).join('\t');
    if (nulDelimited && !changedPath) {
      // Renames have two additional NUL-delimited fields, old path then new path.
      changedPath = records[index + 2] ?? '';
      index += 2;
    }
    current.path ??= changedPath || null;
    const added = Number.parseInt(parts[0] ?? '', 10);
    const removed = Number.parseInt(parts[1] ?? '', 10);
    if (Number.isFinite(added)) current.insertions += added;
    if (Number.isFinite(removed)) current.deletions += removed;
  }

  return commits;
}

async function readHead(handle: fs.FileHandle, size: number): Promise<Buffer> {
  // Always bound bytes read, even if the file changes between stat and read.
  const limit = size <= FULL_READ_LIMIT ? FULL_READ_LIMIT : HEAD_BYTES;
  const buffer = Buffer.alloc(Math.min(limit, Math.max(0, size)));
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  return buffer.subarray(0, bytesRead);
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, HEAD_BYTES).includes(0);
}

/**
 * 单个文件的体检报告：多大、多少行、谁最后改的、一共改过几次、有没有被忽略。
 *
 * 这些数字分开看没什么，凑一起才能回答「这个文件还能不能动」。
 */
export async function getFileDetail(
  gitPath: string | undefined,
  repoPath: string,
  filePath: string,
  options: { historyLimit?: number; directory?: boolean } = {},
): Promise<FileDetail> {
  const reader = new GitReader({ cwd: repoPath, ...(gitPath ? { gitPath } : {}) });
  const safePath = process.platform === 'win32' ? filePath.replace(/\\/g, '/') : filePath;
  const absolute = await resolveInsideRepo(repoPath, safePath);
  const inputStat = await fs.lstat(absolute).catch((error) => {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  });
  if (inputStat?.isSymbolicLink()) throw new Error('为保护仓库边界，不支持查看符号链接目标');
  const isDirectory = inputStat?.isDirectory() || options.directory === true;
  const pathspec = isDirectory ? `${safePath}/` : safePath;

  const base: FileDetail = {
    path: safePath,
    name: path.basename(safePath),
    dir: path.dirname(safePath) === '.' ? '' : path.dirname(safePath),
    exists: isDirectory && (inputStat?.isDirectory() ?? false),
    isDirectory,
    size: null,
    mtime: isDirectory && inputStat?.isDirectory() ? inputStat.mtime.toISOString() : null,
    binary: false,
    lines: null,
    tracked: false,
    ignored: false,
    ignore: null,
    lastCommit: null,
    commitCount: null,
    commits30d: null,
    churn: { insertions: 0, deletions: 0 },
    history: [],
    note: null,
  };

  if (!isDirectory && inputStat?.isFile()) {
    const opened = await openRegularFileInsideRepo(repoPath, safePath);
    const { info } = opened;
    base.exists = true;
    base.mtime = info.mtime.toISOString();
    base.size = info.size;
    try {
      const buffer = await readHead(opened.handle, info.size);
      base.binary = looksBinary(buffer);
      if (!base.binary && info.size <= FULL_READ_LIMIT) {
        const newlines = buffer.filter((byte) => byte === 0x0a).length;
        base.lines = newlines + (buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a ? 1 : 0);
      }
    } finally {
      await opened.handle.close();
    }
  } else if (!isDirectory) {
    base.note = '工作区里没有这个文件（可能只存在于提交历史里）';
  }

  const tracked = await reader.tryRun(['--literal-pathspecs', 'ls-files', '-z', '--cached', '--', pathspec]);
  base.tracked = Boolean(tracked?.split('\0').some((item) => isDirectory ? item.startsWith(pathspec) : item === safePath));

  const match = await checkIgnore(gitPath, repoPath, safePath, isDirectory).catch(() => null);
  base.ignore = match;
  base.ignored = match !== null && !match.pattern.startsWith('!') && !base.tracked;

  const requestedLimit = options.historyLimit ?? HISTORY_LIMIT;
  const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : HISTORY_LIMIT;
  const log = (args: string[]) => reader.tryRun([
    '--literal-pathspecs', 'log', ...(isDirectory ? [] : ['--follow']), ...args, '--', pathspec,
  ]);
  const historyOut = await log([
    `-n${limit}`, '--no-color', '--numstat', '-z', '--format=%x01%H%x1f%h%x1f%an%x1f%aI%x1f%s',
  ]);
  const history = historyOut ? parseFileHistory(historyOut) : [];

  base.history = history;
  base.lastCommit = history[0] ?? null;
  for (const commit of history) {
    base.churn.insertions += commit.insertions;
    base.churn.deletions += commit.deletions;
  }

  if (history.length > 0) {
    // `rev-list --count` has no --follow support, so use log to include pre-rename history.
    const [countOut, recentOut] = await Promise.all([
      log(['--format=%H', 'HEAD']),
      log(['--since=30 days ago', '--format=%H', 'HEAD']),
    ]);
    base.commitCount = countOut === null ? null : countOut.split('\n').filter(Boolean).length;
    base.commits30d = recentOut === null ? null : recentOut.split('\n').filter(Boolean).length;
  } else if (!base.tracked) {
    base.note = base.note ?? '还没有提交过，git 这边没有任何历史';
  }

  return base;
}
