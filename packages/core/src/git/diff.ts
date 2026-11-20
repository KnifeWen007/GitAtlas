import fs from 'node:fs/promises';
import path from 'node:path';
import { GitReader } from './reader.ts';

export type DiffLineKind = 'context' | 'add' | 'del' | 'hunk' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  /** 去掉前缀符号后的正文 */
  text: string;
  /** 旧文件行号，新增行为 null */
  oldLine: number | null;
  /** 新文件行号，删除行为 null */
  newLine: number | null;
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'binary';

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileChangeStatus;
  lines: DiffLine[];
  added: number;
  removed: number;
  binary: boolean;
  /** 行数超过上限被截断，界面上要提示"只显示前 N 行" */
  truncated: boolean;
  /** diff 为空时的原因，避免界面显示一片空白 */
  note: string | null;
}

export interface CommitFile {
  path: string;
  oldPath: string | null;
  status: FileChangeStatus;
  added: number;
  removed: number;
  binary: boolean;
}

const MAX_LINES = 3000;
const MAX_BYTES = 2 * 1024 * 1024;

/** 单条 diff 的解析结果，供工作区与历史复用 */
function emptyDiff(filePath: string, status: FileChangeStatus): FileDiff {
  return {
    path: filePath,
    oldPath: null,
    status,
    lines: [],
    added: 0,
    removed: 0,
    binary: false,
    truncated: false,
    note: null,
  };
}

/**
 * 把 `git diff` 的统一格式拆成带行号的数组。
 *
 * 只解析到"每个文件一段"这个粒度：调用方每次只查一个文件的差异，
 * 多文件混在一段里会让行号错乱。
 */
export function parseUnifiedDiff(text: string): { lines: DiffLine[]; added: number; removed: number; binary: boolean; truncated: boolean } {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let binary = false;
  let truncated = false;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of text.split('\n')) {
    if (lines.length >= MAX_LINES) {
      truncated = true;
      break;
    }
    if (raw.startsWith('\\')) {
      lines.push({ kind: 'meta', text: raw.slice(1).trim(), oldLine: null, newLine: null });
      continue;
    }
    if (raw.startsWith('diff --git') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      // ---/+++ 只是文件头，不计入正文行号
      if (raw.startsWith('diff --git') || raw.startsWith('index ')) {
        lines.push({ kind: 'meta', text: raw, oldLine: null, newLine: null });
      }
      if (raw.includes('Binary files') || raw.includes('GIT binary patch')) binary = true;
      continue;
    }
    if (raw.startsWith('new file mode') || raw.startsWith('deleted file mode') || raw.startsWith('old mode') || raw.startsWith('new mode') || raw.startsWith('similarity index') || raw.startsWith('rename from') || raw.startsWith('rename to')) {
      lines.push({ kind: 'meta', text: raw, oldLine: null, newLine: null });
      continue;
    }
    if (raw.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      lines.push({ kind: 'hunk', text: raw, oldLine: null, newLine: null });
      continue;
    }
    if (raw.startsWith('+')) {
      added += 1;
      lines.push({ kind: 'add', text: raw.slice(1), oldLine: null, newLine });
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      removed += 1;
      lines.push({ kind: 'del', text: raw.slice(1), oldLine, newLine: null });
      oldLine += 1;
      continue;
    }
    if (raw.startsWith(' ') || raw.length === 0) {
      // 空行是文件末尾换行造成，跳过以免尾部多出一行
      if (raw.length === 0) continue;
      lines.push({ kind: 'context', text: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return { lines, added, removed, binary, truncated };
}

function clampText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_BYTES) return { text, truncated: false };
  return { text: text.slice(0, MAX_BYTES), truncated: true };
}

/** 未跟踪文件没有 diff，按"整份都是新增"合成 */
async function untrackedDiff(root: string, filePath: string): Promise<FileDiff> {
  const diff = emptyDiff(filePath, 'added');
  const absolute = path.join(root, filePath);
  let content: string;
  try {
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      diff.note = '这是一个目录，展开到具体文件才能看差异';
      return diff;
    }
    if (stat.size > MAX_BYTES) {
      diff.note = `文件太大（${Math.round(stat.size / 1024)} KB），只显示前 ${MAX_LINES} 行`;
      content = (await fs.readFile(absolute, 'utf8')).slice(0, MAX_BYTES);
      diff.truncated = true;
    } else {
      content = await fs.readFile(absolute, 'utf8');
    }
  } catch {
    diff.note = '这个文件读不出来，可能已被删除或没有权限';
    return diff;
  }

  if (content.includes('\u0000')) {
    diff.binary = true;
    diff.status = 'binary';
    diff.note = '二进制文件，不显示逐行差异';
    return diff;
  }

  const rows = content.split('\n');
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  diff.lines.push({ kind: 'hunk', text: `@@ -0,0 +1,${rows.length} @@ 新文件`, oldLine: null, newLine: null });
  rows.forEach((row, index) => {
    if (index >= MAX_LINES) {
      diff.truncated = true;
      return;
    }
    diff.lines.push({ kind: 'add', text: row, oldLine: null, newLine: index + 1 });
    diff.added += 1;
  });
  return diff;
}

/** 工作区单文件差异：staged=true 看暂存区，false 看未暂存 */
export async function getWorkingDiff(
  reader: GitReader,
  root: string,
  filePath: string,
  options: { staged?: boolean } = {},
): Promise<FileDiff> {
  const staged = options.staged === true;
  const args = ['diff', '--no-color', '--unified=3'];
  if (staged) args.push('--cached');
  args.push('--', filePath);

  const output = await reader.run(['--literal-pathspecs', ...args]);
  if (output.trim().length === 0) {
    // 未暂存的空 diff 通常是未跟踪文件
    if (!staged) {
      const tracked = await reader.tryRun(['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', filePath]);
      if (tracked === null) return untrackedDiff(root, filePath);
    }
    const empty = emptyDiff(filePath, 'modified');
    empty.note = staged ? '暂存区里这个文件没有变化' : '这个文件没有未暂存的变化';
    return empty;
  }

  const clamped = clampText(output);
  const parsed = parseUnifiedDiff(clamped.text);
  const diff = emptyDiff(filePath, parsed.binary ? 'binary' : 'modified');
  diff.lines = parsed.lines;
  diff.added = parsed.added;
  diff.removed = parsed.removed;
  diff.binary = parsed.binary;
  diff.truncated = parsed.truncated || clamped.truncated;
  if (diff.truncated) diff.note = `差异太大，只显示前 ${MAX_LINES} 行`;
  if (parsed.binary) diff.note = '二进制文件，不显示逐行差异';
  return diff;
}

function mapStatus(letter: string): FileChangeStatus {
  switch (letter[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'modified';
  }
}

/** 合并提交的父提交列表；普通提交只有一个 */
async function parentsOf(reader: GitReader, sha: string): Promise<string[]> {
  const out = await reader.tryRun(['rev-list', '--parents', '-n', '1', sha]);
  const parts = (out ?? '').trim().split(/\s+/).filter((part) => part.length > 0);
  return parts.slice(1);
}

/**
 * `git show` 对合并提交默认不输出文件清单，界面上会显示"没有改动"，
 * 所以合并提交一律改成和第一父提交比。
 */
function compareTarget(sha: string, parents: string[]): { diffArgs: string[] } {
  if (parents.length > 1) return { diffArgs: [`${sha}^1`, sha] };
  return { diffArgs: [sha] };
}

/** 一次提交改了哪些文件（状态 + 增删行数） */
export async function getCommitFiles(reader: GitReader, sha: string): Promise<CommitFile[]> {
  const parents = await parentsOf(reader, sha);
  const isMerge = parents.length > 1;
  const range = compareTarget(sha, parents).diffArgs;

  const nameStatus = isMerge
    ? await reader.run(['diff', '--name-status', '-z', '--find-renames', ...range])
    : await reader.run(['show', '--format=', '--name-status', '-z', '--find-renames', sha]);
  const tokens = nameStatus.split('\x00').filter((token) => token.length > 0);
  const files: CommitFile[] = [];

  let index = 0;
  while (index < tokens.length) {
    const code = tokens[index] ?? '';
    const status = mapStatus(code);
    if (status === 'renamed' || status === 'copied') {
      const oldPath = tokens[index + 1] ?? '';
      const newPath = tokens[index + 2] ?? '';
      files.push({ path: newPath, oldPath, status, added: 0, removed: 0, binary: false });
      index += 3;
    } else {
      const filePath = tokens[index + 1] ?? '';
      if (filePath.length > 0) files.push({ path: filePath, oldPath: null, status, added: 0, removed: 0, binary: false });
      index += 2;
    }
  }

  // 行数统计单独查一次，name-status 不带增删数
  const numstat = isMerge
    ? await reader.tryRun(['diff', '--numstat', '-z', '--find-renames', ...range])
    : await reader.tryRun(['show', '--format=', '--numstat', '-z', '--find-renames', sha]);
  if (numstat) {
    const stats = new Map<string, { added: number; removed: number; binary: boolean }>();
    for (const chunk of numstat.split('\x00')) {
      if (chunk.trim().length === 0) continue;
      const [addedText = '', removedText = '', ...pathParts] = chunk.split('\t');
      const target = pathParts.join('\t').replace(/^\n/, '');
      if (target.length === 0) continue;
      const binary = addedText === '-' || removedText === '-';
      stats.set(target, {
        added: binary ? 0 : Number(addedText) || 0,
        removed: binary ? 0 : Number(removedText) || 0,
        binary,
      });
    }
    for (const file of files) {
      const hit = stats.get(file.path);
      if (hit) {
        file.added = hit.added;
        file.removed = hit.removed;
        file.binary = hit.binary;
      }
    }
  }

  return files;
}

/** 某次提交里单个文件的差异 */
export async function getCommitFileDiff(
  reader: GitReader,
  sha: string,
  filePath: string,
  oldPath?: string | null,
): Promise<FileDiff> {
  const parents = await parentsOf(reader, sha);
  const isMerge = parents.length > 1;
  const args = isMerge
    ? ['diff', '--no-color', '--unified=3', '--find-renames', `${sha}^1`, sha, '--', filePath]
    : ['show', '--format=', '--no-color', '--unified=3', '--find-renames', sha, '--', filePath];
  if (oldPath && oldPath !== filePath) args.push(oldPath);

  const output = await reader.run(['--literal-pathspecs', ...args]);
  if (output.trim().length === 0) {
    const empty = emptyDiff(filePath, 'modified');
    empty.note = isMerge
      ? '这次合并对这个文件没有引入相对第一父提交的变化'
      : '这次提交没有改动这个文件，或改动只有模式变化';
    return empty;
  }

  const clamped = clampText(output);
  const parsed = parseUnifiedDiff(clamped.text);
  const diff = emptyDiff(filePath, parsed.binary ? 'binary' : 'modified');
  diff.oldPath = oldPath ?? null;
  diff.status = parsed.binary ? 'binary' : diff.status;
  diff.lines = parsed.lines;
  diff.added = parsed.added;
  diff.removed = parsed.removed;
  diff.binary = parsed.binary;
  diff.truncated = parsed.truncated || clamped.truncated;
  if (diff.truncated) diff.note = `差异太大，只显示前 ${MAX_LINES} 行`;
  if (parsed.binary) diff.note = '二进制文件，不显示逐行差异';
  if (isMerge && diff.note === null) diff.note = '这是合并提交，差异是相对第一父提交算的';

  const firstHunk = parsed.lines.find((line) => line.kind === 'hunk');
  if (!parsed.binary && firstHunk?.text.includes(',0 ')) diff.status = 'added';
  if (!parsed.binary && firstHunk?.text.includes(' +0,0 ')) diff.status = 'deleted';
  return diff;
}

/** 把提交的文件状态修正为 added/deleted 的边界情况（由调用方传入 diff 判定） */
export function statusLabel(status: FileChangeStatus): string {
  switch (status) {
    case 'added':
      return '新增';
    case 'deleted':
      return '删除';
    case 'renamed':
      return '改名';
    case 'copied':
      return '复制';
    case 'binary':
      return '二进制';
    default:
      return '修改';
  }
}
