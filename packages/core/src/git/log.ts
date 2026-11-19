/**
 * `git log --numstat` 输出解析。
 *
 * 输出形态（--pretty=format 的 header 与 numstat 混排）：
 *
 *   \x01<sha>\x02<parents>\x02<author>\x02<email>\x02<authorDate>\x02<commitDate>\x02<subject>
 *   (空行)
 *   12\t3\tsrc/a.ts
 *   -\t-\tassets/logo.png
 *   \x01<next sha>...
 *
 * 用 \x01 / \x02 作分隔符，避免提交信息里出现普通字符导致误切分。
 */

export const LOG_FORMAT = '%x01%H%x02%P%x02%an%x02%ae%x02%aI%x02%cI%x02%s';
export const LOG_ARGS = [
  'log',
  '--all',
  '--numstat',
  '--no-color',
  '--no-decorate',
  '--find-renames',
  `--pretty=format:${LOG_FORMAT}`,
];

export interface ParsedFileChange {
  path: string;
  insertions: number | null;
  deletions: number | null;
}

export interface ParsedCommit {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  changes: ParsedFileChange[];
}

/**
 * 处理重命名路径：
 *   `src/old.ts => src/new.ts`        → src/new.ts
 *   `src/{old => new}/file.ts`        → src/new/file.ts
 */
export function normalisePath(raw: string): string {
  const arrow = raw.indexOf(' => ');
  if (arrow === -1) return raw.trim();

  const left = raw.slice(0, arrow);
  const right = raw.slice(arrow + 4);

  // 花括号形式：prefix{old => new}suffix
  const braceStart = left.lastIndexOf('{');
  const braceEnd = right.indexOf('}');
  if (braceStart !== -1 && braceEnd !== -1) {
    const prefix = left.slice(0, braceStart);
    const middle = right.slice(0, braceEnd);
    const suffix = right.slice(braceEnd + 1);
    return `${prefix}${middle}${suffix}`.trim();
  }
  return right.trim();
}

function parseHeader(line: string): ParsedCommit {
  const parts = line.split('\x02');
  const [sha = '', parentsRaw = '', authorName = '', authorEmail = '', authoredAt = '', committedAt = ''] = parts;
  // subject 可能包含分隔符，剩余部分拼回
  const subject = parts.slice(6).join('\x02');

  const parents = parentsRaw.trim().length > 0 ? parentsRaw.trim().split(' ') : [];
  return {
    sha: sha.trim(),
    parents,
    authorName,
    authorEmail,
    authoredAt,
    committedAt,
    subject,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    changes: [],
  };
}

const NUMSTAT_RE = /^(-|\d+)\t(-|\d+)\t(.+)$/;

export function parseNumstatLine(line: string): ParsedFileChange | null {
  const match = NUMSTAT_RE.exec(line);
  if (!match) return null;
  const [, ins, del, path] = match;
  return {
    path: normalisePath(path ?? ''),
    insertions: ins === '-' ? null : Number(ins),
    deletions: del === '-' ? null : Number(del),
  };
}

/** 把 git log 的行流解析为提交流 */
export async function* parseCommitStream(lines: AsyncIterable<string>): AsyncGenerator<ParsedCommit> {
  let current: ParsedCommit | null = null;

  for await (const line of lines) {
    if (line.length > 0 && line.charCodeAt(0) === 1) {
      if (current) yield current;
      current = parseHeader(line.slice(1));
      continue;
    }
    if (!current) continue;
    if (line.length === 0) continue;

    const change = parseNumstatLine(line);
    if (!change) continue;

    current.changes.push(change);
    current.filesChanged += 1;
    current.insertions += change.insertions ?? 0;
    current.deletions += change.deletions ?? 0;
  }

  if (current) yield current;
}
