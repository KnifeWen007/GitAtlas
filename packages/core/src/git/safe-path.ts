import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

/** Resolve a user-supplied repository-relative path and reject lexical escapes. */
export async function openRegularFileInsideRepo(root: string, filePath: string, flags = fsConstants.O_RDONLY) {
  const absolute = await resolveInsideRepo(root, filePath);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(absolute, flags | noFollow);
  try {
    const info = await handle.stat();
    const pathInfo = await fs.lstat(absolute);
    if (!info.isFile() || pathInfo.isSymbolicLink() || !pathInfo.isFile() || info.dev !== pathInfo.dev || info.ino !== pathInfo.ino) {
      throw new Error('文件路径在操作期间发生变化，已拒绝');
    }
    return { absolute, handle, info };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function resolveInsideRepo(root: string, filePath: string): Promise<string> {
  if (filePath.includes('\0')) throw new Error('路径中含有无效字符');
  if (path.isAbsolute(filePath) || path.posix.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) {
    throw new Error('请使用仓库内的相对路径');
  }

  const base = await fs.realpath(root);
  const normalized = process.platform === 'win32' ? filePath.replace(/\\/g, path.sep) : filePath;
  const components = normalized.split(process.platform === 'win32' ? /[\\/]/ : /\//);
  if (components.includes('..')) throw new Error('路径越过了仓库目录，已拒绝');
  const absolute = path.resolve(base, normalized);
  const relative = path.relative(base, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('路径越过了仓库目录，已拒绝');
  }

  const resolvedComponents = relative.split(path.sep).filter(Boolean);
  if (resolvedComponents.some((component) => component.toLowerCase() === '.git')) {
    throw new Error('不允许通过文件接口访问 Git 元数据');
  }

  // File APIs read and write user-selected paths. Reject symlinks rather than
  // following them: even an in-repository link may point into .git/config.
  let current = base;
  for (let i = 0; i < resolvedComponents.length; i += 1) {
    current = path.join(current, resolvedComponents[i]!);
    let info;
    try {
      info = await fs.lstat(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        current = path.join(current, ...resolvedComponents.slice(i + 1));
        break;
      }
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error('为保护仓库边界，暂不支持通过符号链接访问文件');
  }

  return current;
}
