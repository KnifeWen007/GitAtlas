import { spawn } from 'node:child_process';

export interface GitReaderOptions {
  /** git 可执行文件路径；默认取 PATH 中的 `git`，桌面端会注入内置 git 路径 */
  gitPath?: string;
  /** 工作目录（仓库根或任意子目录） */
  cwd: string;
}

export class GitError extends Error {
  readonly code: number | null;
  readonly stderr: string;

  constructor(message: string, code: number | null, stderr: string) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * git 子进程的薄封装。
 *
 * 设计约束（见 docs/architecture.md §4）：
 * - 从不硬编码 'git'，一律走 gitPath，便于切换到内置 git。
 * - 禁用交互式凭据提示（GIT_TERMINAL_PROMPT=0），否则 GUI 进程会永久挂起。
 * - 提供逐行流式读取，用于超大仓库的 `git log` 输出，避免一次性进内存。
 */
export class GitReader {
  readonly gitPath: string;
  readonly cwd: string;

  constructor(options: GitReaderOptions) {
    this.gitPath = options.gitPath ?? 'git';
    this.cwd = options.cwd;
  }

  private spawnGit(args: string[]) {
    return spawn(this.gitPath, args, {
      cwd: this.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        // 让错误信息与格式保持稳定，避免受用户 locale 影响
        LC_ALL: 'C.UTF-8',
      },
    });
  }

  /** 执行并收集全部 stdout；非零退出抛 GitError。传 timeoutMs 可防网络操作挂死窗口 */
  async run(args: string[], timeoutMs?: number): Promise<string> {
    const child = this.spawnGit(args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs)
      : undefined;

    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    if (timer) clearTimeout(timer);

    const stderr = Buffer.concat(err).toString('utf8');

    if (timedOut) {
      throw new GitError(
        `git ${args.slice(0, 2).join(' ')} 超时（${Math.round((timeoutMs ?? 0) / 1000)} 秒）`,
        null,
        `超时：${stderr}`,
      );
    }

    if (code !== 0) {
      throw new GitError(
        `git ${args.slice(0, 2).join(' ')} 失败（退出码 ${code}）：${stderr.trim() || '无错误输出'}`,
        code,
        stderr,
      );
    }
    return Buffer.concat(out).toString('utf8');
  }

  /** 执行成功返回 true，失败返回 false（不抛错） */
  async tryRun(args: string[]): Promise<string | null> {
    try {
      return await this.run(args);
    } catch {
      return null;
    }
  }

  /** 逐行流式读取 stdout */
  async *lines(args: string[]): AsyncGenerator<string> {
    const child = this.spawnGit(args);
    const err: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    const exit = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    try {
      let buffer = '';
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        buffer += chunk.toString('utf8');
        let index = buffer.indexOf('\n');
        while (index !== -1) {
          yield buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf('\n');
        }
      }
      if (buffer.length > 0) yield buffer;
    } finally {
      // 调用方提前 break 时不要留下孤儿进程
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }

    const code = await exit;
    if (code !== 0 && code !== null) {
      const stderr = Buffer.concat(err).toString('utf8');
      throw new GitError(
        `git ${args.slice(0, 2).join(' ')} 失败（退出码 ${code}）：${stderr.trim() || '无错误输出'}`,
        code,
        stderr,
      );
    }
  }
}

/** 探测 git 可用性与版本 */
export async function probeGit(gitPath?: string): Promise<{ available: boolean; version: string | null }> {
  const reader = new GitReader({ cwd: process.cwd(), ...(gitPath ? { gitPath } : {}) });
  const out = await reader.tryRun(['--version']);
  if (out === null) return { available: false, version: null };
  const match = /git version (\S+)/.exec(out);
  return { available: true, version: match?.[1] ?? null };
}
