import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { openRegularFileInsideRepo, resolveInsideRepo } from './safe-path.ts';

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


function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

/** 读取工作区里的文件正文，供冲突编辑器使用 */
export async function readWorkingFile(root: string, filePath: string): Promise<WorkingFileContent> {
  const empty: WorkingFileContent = {
    path: filePath,
    text: '',
    binary: false,
    truncated: false,
    size: 0,
    exists: false,
    note: null,
  };

  let opened: Awaited<ReturnType<typeof openRegularFileInsideRepo>>;
  try {
    opened = await openRegularFileInsideRepo(root, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...empty, note: '文件不存在，可能已被删除' };
    if ((error as NodeJS.ErrnoException).code === 'EISDIR') return { ...empty, note: '这是一个目录' };
    throw error;
  }

  const { handle, info } = opened;
  try {
    const limit = Math.min(info.size, MAX_BYTES);
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    const content = buffer.subarray(0, bytesRead);
    const binary = looksBinary(content);
    const truncated = info.size > MAX_BYTES;
    return {
      path: filePath,
      text: binary ? '' : content.toString('utf8'),
      binary,
      truncated,
      size: info.size,
      exists: true,
      note: binary
        ? '二进制文件，不能用文本编辑器改'
        : truncated
          ? `文件较大（${Math.round(info.size / 1024)} KB），只载入前 ${Math.round(MAX_BYTES / 1024)} KB；保存会截断，别在大文件上用编辑器`
          : null,
    };
  } finally {
    await handle.close();
  }
}

/** 覆盖写回工作区文件；只允许写仓库内的路径 */
export async function writeWorkingFile(root: string, filePath: string, content: string): Promise<{ path: string; bytes: number }> {
  const absolute = await resolveInsideRepo(root, filePath);
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`内容超过 ${Math.round(MAX_BYTES / 1024)} KB，编辑器不处理这么大的文件`);
  }
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(absolute, fsConstants.O_WRONLY | fsConstants.O_CREAT | (fsConstants.O_NOFOLLOW ?? 0), 0o666);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new Error('为保护仓库边界，拒绝通过符号链接写文件');
    throw error;
  }
  try {
    const openedInfo = await handle.stat();
    const pathInfo = await fs.lstat(absolute);
    if (!openedInfo.isFile() || !pathInfo.isFile() || pathInfo.isSymbolicLink() || openedInfo.dev !== pathInfo.dev || openedInfo.ino !== pathInfo.ino) {
      throw new Error('文件路径在写入期间发生变化，已拒绝');
    }
    await handle.truncate(0);
    await handle.writeFile(buffer);
  } finally {
    await handle.close();
  }
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
