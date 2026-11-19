import fs from 'node:fs/promises';
import path from 'node:path';

export interface WorkingFileContent {
  path: string;
  text: string;
  binary: boolean;
  truncated: boolean;
  size: number;
  exists: boolean;
  note: string | null;
}

const MAX_BYTES = 512 * 1024;

/**
 * 把用户传来的相对路径钉死在仓库目录内。
 *
 * 界面能写文件，就必须挡住 `..\..\Windows\...` 这类路径；
 * 只做字符串前缀比较会被 `F:\repo-evil` 骗过，所以先 resolve 再加分隔符。
 */
function resolveInside(root: string, filePath: string): string {
  const base = path.resolve(root);
  const absolute = path.resolve(base, filePath);
  if (absolute !== base && !absolute.startsWith(base + path.sep)) {
    throw new Error('路径越过了仓库目录，已拒绝');
  }
  return absolute;
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

/** 读取工作区里的文件正文，供冲突编辑器使用 */
export async function readWorkingFile(root: string, filePath: string): Promise<WorkingFileContent> {
  const absolute = resolveInside(root, filePath);
  const empty: WorkingFileContent = {
    path: filePath,
    text: '',
    binary: false,
    truncated: false,
    size: 0,
    exists: false,
    note: null,
  };

  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    return { ...empty, note: '文件不存在，可能已被删除' };
  }

  if (stat.isDirectory()) return { ...empty, note: '这是一个目录' };
  if (stat.size > MAX_BYTES) {
    const buffer = await fs.readFile(absolute);
    const head = buffer.subarray(0, MAX_BYTES);
    return {
      path: filePath,
      text: looksBinary(head) ? '' : head.toString('utf8'),
      binary: looksBinary(head),
      truncated: true,
      size: stat.size,
      exists: true,
      note: `文件较大（${Math.round(stat.size / 1024)} KB），只载入前 ${Math.round(MAX_BYTES / 1024)} KB；保存会截断，别在大文件上用编辑器`,
    };
  }

  const buffer = await fs.readFile(absolute);
  if (looksBinary(buffer)) {
    return {
      path: filePath,
      text: '',
      binary: true,
      truncated: false,
      size: stat.size,
      exists: true,
      note: '二进制文件，不能用文本编辑器改',
    };
  }

  return {
    path: filePath,
    text: buffer.toString('utf8'),
    binary: false,
    truncated: false,
    size: stat.size,
    exists: true,
    note: null,
  };
}

/** 覆盖写回工作区文件；只允许写仓库内的路径 */
export async function writeWorkingFile(root: string, filePath: string, content: string): Promise<{ path: string; bytes: number }> {
  const absolute = resolveInside(root, filePath);
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`内容超过 ${Math.round(MAX_BYTES / 1024)} KB，编辑器不处理这么大的文件`);
  }
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, buffer);
  return { path: filePath, bytes: buffer.byteLength };
}

/**
 * 从带冲突标记的文件里数出还剩几段冲突。
 * 返回 0 表示标记已清干净，可以提交。
 */
export function countConflictMarkers(text: string): number {
  const opens = text.match(/^<{7}(\s|$)/gm)?.length ?? 0;
  return opens;
}
