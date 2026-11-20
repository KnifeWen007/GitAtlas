import fs from 'node:fs/promises';
import path from 'node:path';
import { GitReader } from './reader.ts';
import { writeWorkingFile } from './file.ts';
import { resolveInsideRepo } from './safe-path.ts';

/** .gitignore 里的一行 */
export interface IgnoreRule {
  /** 1 起算的行号，删改都按它定位 */
  line: number;
  /** 原样保留，写回去不能丢格式 */
  raw: string;
  /** 去掉注释符号与首尾空白后的模式；注释行与空行为空串 */
  pattern: string;
  negated: boolean;
  comment: boolean;
  blank: boolean;
}

export interface IgnoreFile {
  /** 固定是仓库根的 .gitignore */
  path: string;
  exists: boolean;
  text: string;
  rules: IgnoreRule[];
  /** 生效的规则条数（不含注释与空行） */
  activeCount: number;
}

/** 某条路径最终被哪一条规则命中 */
export interface IgnoreMatch {
  /** 规则所在文件，通常是 .gitignore，也可能来自 .git/info/exclude 或全局配置 */
  source: string;
  line: number;
  pattern: string;
  path: string;
}

const IGNORE_FILE = '.gitignore';

interface IgnoreLine {
  raw: string;
  ending: string;
}

function splitLines(text: string): IgnoreLine[] {
  const lines: IgnoreLine[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\n' && text[i] !== '\r') continue;
    const ending = text[i] === '\r' && text[i + 1] === '\n' ? '\r\n' : text[i]!;
    lines.push({ raw: text.slice(start, i), ending });
    i += ending.length - 1;
    start = i + 1;
  }
  if (start < text.length) lines.push({ raw: text.slice(start), ending: '' });
  return lines;
}

function joinLines(lines: IgnoreLine[]): string {
  return lines.map((line) => line.raw + line.ending).join('');
}

function stripUnescapedTrailingSpaces(pattern: string): string {
  let result = pattern;
  while (result.endsWith(' ')) {
    let slashes = 0;
    for (let i = result.length - 2; i >= 0 && result.charCodeAt(i) === 92; i -= 1) slashes += 1;
    if (slashes % 2 === 1) break;
    result = result.slice(0, -1);
  }
  return result;
}

export function parseIgnore(text: string): IgnoreRule[] {
  return splitLines(text).map(({ raw }, index) => {
    if (raw.startsWith('#')) {
      return { line: index + 1, raw, pattern: '', negated: false, comment: true, blank: false };
    }
    const negated = raw.startsWith('!');
    const sourcePattern = negated ? raw.slice(1) : raw;
    const pattern = stripUnescapedTrailingSpaces(sourcePattern);
    return {
      line: index + 1,
      raw,
      pattern,
      negated,
      comment: false,
      blank: pattern.length === 0,
    };
  });
}

function toIgnoreFile(text: string, exists: boolean): IgnoreFile {
  const rules = parseIgnore(text);
  return {
    path: IGNORE_FILE,
    exists,
    text,
    rules,
    activeCount: rules.filter((rule) => !rule.comment && !rule.blank).length,
  };
}

/** 读仓库根的 .gitignore；不存在时给一个空文件而不是报错 */
export async function readIgnoreFile(root: string): Promise<IgnoreFile> {
  try {
    const filePath = await resolveInsideRepo(root, IGNORE_FILE);
    const text = await fs.readFile(filePath, 'utf8');
    return toIgnoreFile(text, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return toIgnoreFile('', false);
    throw error;
  }
}

/** 整份覆盖写回；沿用写文件那条路径校验，顺便挡住超长内容 */
export async function writeIgnoreFile(
  root: string,
  text: string,
): Promise<{ ok: boolean; path: string; bytes: number; lineCount: number }> {
  if (text.includes('\0')) throw new Error('.gitignore 里不能有二进制内容');
  const saved = await writeWorkingFile(root, IGNORE_FILE, text);
  return { ok: true, path: saved.path, bytes: saved.bytes, lineCount: text.split('\n').length };
}

/**
 * 追加一条忽略规则。
 *
 * 已经在里面的就不重复写：用户连着点两次「忽略」，文件不该多出两行一样的。
 */
export async function addIgnoreRule(
  root: string,
  pattern: string,
): Promise<{ file: IgnoreFile; added: boolean }> {
  const rawRule = pattern.replace(/[\r\n]+$/, '');
  if (rawRule.length === 0) throw new Error('忽略规则不能为空');
  if (/[\r\n]/.test(rawRule)) throw new Error('一条规则只能占一行');
  if (rawRule.startsWith('#')) throw new Error('以 # 开头是注释，不是忽略规则');

  const current = await readIgnoreFile(root);
  const negated = rawRule.startsWith('!');
  const normalizedPattern = stripUnescapedTrailingSpaces(negated ? rawRule.slice(1) : rawRule);
  if (!normalizedPattern) throw new Error('忽略规则不能为空');
  const duplicated = current.rules.some(
    (rule) => !rule.comment && !rule.blank && rule.negated === negated && rule.pattern === normalizedPattern,
  );
  if (duplicated) return { file: current, added: false };

  // Follow the file's existing newline convention and terminate the appended rule.
  const lineEnding = splitLines(current.text).find((line) => line.ending)?.ending ?? '\n';
  const base = current.text.length === 0 || /[\r\n]$/.test(current.text) ? current.text : `${current.text}${lineEnding}`;
  await writeIgnoreFile(root, `${base}${rawRule}${lineEnding}`);
  return { file: await readIgnoreFile(root), added: true };
}

/** 按行号删掉一条规则；注释和空行也允许删 */
export async function removeIgnoreRule(root: string, line: number): Promise<IgnoreFile> {
  const current = await readIgnoreFile(root);
  if (!current.exists) throw new Error('这个仓库还没有 .gitignore');
  if (!Number.isInteger(line) || line < 1 || line > current.rules.length) {
    throw new Error(`行号 ${line} 超出了 .gitignore 的范围`);
  }
  const lines = splitLines(current.text);
  const removed = lines[line - 1]!;
  if (line === lines.length && line > 1 && removed.ending === '') {
    // When deleting an unterminated final line, also remove the separator before it.
    lines[line - 2]!.ending = '';
  }
  lines.splice(line - 1, 1);
  await writeIgnoreFile(root, joinLines(lines));
  return readIgnoreFile(root);
}

/**
 * 问 git：这条路径被哪条规则忽略了。
 *
 * 用 `check-ignore -v --no-index`：带 -v 才会说出「哪个文件的第几行、哪条模式」，
 * 带 --no-index 则连已跟踪的文件也照答，界面上解释「为什么它没进仓库」时正需要这个。
 */
export async function checkIgnore(
  gitPath: string | undefined,
  repoPath: string,
  filePath: string,
): Promise<IgnoreMatch | null> {
  if (!filePath || filePath.endsWith('/') || (process.platform === 'win32' && filePath.endsWith('\\'))) {
    throw new Error('请指定单个文件路径');
  }
  const reader = new GitReader({ cwd: repoPath, ...(gitPath ? { gitPath } : {}) });
  const safePath = await resolveInsideRepo(repoPath, filePath);
  const info = await fs.lstat(safePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (info?.isDirectory()) throw new Error('请指定单个文件，而不是目录');
  if (info?.isSymbolicLink()) throw new Error('不支持检查符号链接目标');
  const relative = path.relative(await fs.realpath(repoPath), safePath).split(path.sep).join('/');
  const out = await reader.tryRun(
    ['check-ignore', '-v', '-z', '--no-index', '--stdin'],
    `${relative}\0`,
  );
  if (!out) return null;

  const fields = out.split('\0');
  if (fields.length < 4) return null;
  const source = fields[0] ?? '';
  const line = Number.parseInt(fields[1] ?? '', 10);
  if (!Number.isFinite(line)) return null;

  // 形如 `.gitignore:12:node_modules/	node_modules/`


  return {
    source,
    line,
    pattern: fields[2] ?? '',
    path: fields[3] ?? relative,
  };
}
