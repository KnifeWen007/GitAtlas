import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  Store,
  indexRepo,
  listRepos,
  getRepo,
  getSummary,
  getTimeline,
  getRefs,
  getAuthors,
  getRecentCommits,
  getGraph,
  probeGit,
  deleteRepo,
  getStatus,
  listSnapshots,
  fetchRepo,
  pullRepo,
  pushRepo,
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeBranch,
  abortMerge,
  resolveConflict,
  concludeMerge,
  createTag,
  resetHard,
  restoreSnapshot,
  stagePaths,
  unstagePaths,
  discardPaths,
  commitAll,
  GitReader,
  getWorkingDiff,
  getCommitFiles,
  getCommitFileDiff,
  readWorkingFile,
  writeWorkingFile,
  countConflictMarkers,
  listReachable,
  aheadBehind,
  type IndexProgress,
  type OpResult,
} from '@gitatlas/core';

/** 写操作参数缺失：区别于 git 自身的失败，前端要提示用户补输入 */
class InvalidInput extends Error {}

/** 把 git 的原始报错收拾成一句能直接显示的话 */
function explainGitFailure(error: unknown): string {
  if (error instanceof Error) {
    const stripped = error.message.replace(/^git \S+ 失败（退出码 \d+）：/, '').trim();
    return stripped.length > 0 ? stripped : error.message;
  }
  return String(error);
}

/** 这些操作会移动 HEAD，索引数据随之过期 */
const HEAD_MOVING = new Set(['pull', 'merge', 'reset', 'restore', 'checkout', 'commit', 'concludeMerge']);

function need(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new InvalidInput(`请填写${label}`);
  return trimmed;
}

export interface GitActionBody {
  action: string;
  branch?: string;
  name?: string;
  target?: string;
  path?: string;
  paths?: string[];
  side?: 'ours' | 'theirs';
  force?: boolean;
  message?: string;
  ref?: string;
}

export interface ServerOptions {
  /** SQLite 文件路径；':memory:' 用于测试 */
  dbPath: string;
  /** 0 表示由系统分配空端口（桌面端用） */
  port?: number;
  host?: string;
  /** 指定 git 可执行文件（桌面端会注入内置 git） */
  gitPath?: string;
  /** 前端构建产物目录；提供后由同一端口托管静态资源 */
  staticDir?: string;
  logLevel?: string;
  /** 跨域；桌面端同源，不需要 */
  enableCors?: boolean;
}

export interface ServerHandle {
  app: FastifyInstance;
  store: Store;
  port: number;
  url: string;
  close(): Promise<void>;
}

type TaskStatus = 'running' | 'done' | 'failed';

interface IndexTask {
  id: string;
  path: string;
  repoId: number | null;
  status: TaskStatus;
  progress: IndexProgress;
  error: string | null;
  createdAt: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function emptyProgress(): IndexProgress {
  return {
    phase: 'validating',
    message: '等待开始',
    processed: 0,
    total: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
}

/**
 * 创建并启动 GitAtlas 服务。
 *
 * 桌面端与 Web 端共用这一个入口：桌面端传 `port: 0` 取随机端口、
 * 并传 `staticDir` 让同一个端口托管前端，因此前端永远同源、无需配置 API 地址。
 */
export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  const store = new Store(options.dbPath);
  const tasks = new Map<string, IndexTask>();
  const gitPath = options.gitPath;

  const host = options.host ?? '127.0.0.1';
  const desiredPort = options.port ?? 4317;
  // 端口可能由系统分配（桌面端传 0），listen 之后再写回真实地址
  let selfUrl = `http://${host}:${desiredPort}`;

  const app = Fastify({
    logger: { level: options.logLevel ?? 'info' },
    // 桌面端窗口不需要暴露内部信息：日志级别压到 warn 时本来就不会打请求日志，
    // disableRequestLogging 这个旧参数在 fastify 6 里要移除，干脆不传
  });

  if (options.enableCors) {
    await app.register(cors, { origin: true });
  }

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : String(error);
    app.log.warn({ err: message }, 'request failed');
    void reply.code(400).send({ error: message });
  });

  const startIndex = (repoPath: string): IndexTask => {
    const task: IndexTask = {
      id: randomUUID(),
      path: repoPath,
      repoId: null,
      status: 'running',
      progress: emptyProgress(),
      error: null,
      createdAt: new Date().toISOString(),
    };
    tasks.set(task.id, task);

    void (async () => {
      try {
        const result = await indexRepo(store, {
          repoPath,
          ...(gitPath ? { gitPath } : {}),
          onProgress: (progress) => {
            task.progress = progress;
          },
        });
        task.repoId = result.repoId;
        task.status = 'done';
      } catch (error) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
        task.progress = {
          ...task.progress,
          phase: 'failed',
          error: task.error,
          finishedAt: new Date().toISOString(),
        };
      }
    })();

    return task;
  };

  /** git 写操作的统一分发：前端只需要一个 POST 端点 */
  const runAction = async (repoPath: string, body: GitActionBody): Promise<OpResult> => {
    switch (body.action) {
      case 'fetch':
        return fetchRepo(gitPath, repoPath);
      case 'pull':
        return pullRepo(gitPath, repoPath);
      case 'push':
        return pushRepo(gitPath, repoPath);
      case 'checkout':
        return checkoutBranch(gitPath, repoPath, need(body.branch, '分支名'));
      case 'createBranch':
        return createBranch(gitPath, repoPath, need(body.name, '分支名'), body.target?.trim() || undefined);
      case 'deleteBranch':
        return deleteBranch(gitPath, repoPath, need(body.name, '分支名'), body.force === true);
      case 'merge':
        return mergeBranch(gitPath, repoPath, need(body.branch, '要合并的分支'));
      case 'abortMerge':
        return abortMerge(gitPath, repoPath);
      case 'concludeMerge':
        return concludeMerge(gitPath, repoPath, body.message?.trim() || undefined);
      case 'resolveConflict':
        return resolveConflict(
          gitPath,
          repoPath,
          need(body.path, '冲突文件'),
          body.side === 'theirs' ? 'theirs' : 'ours',
        );
      case 'tag':
        return createTag(gitPath, repoPath, need(body.name, '标签名'), body.target?.trim() || undefined);
      case 'reset':
        return resetHard(gitPath, repoPath, need(body.target, '目标提交'));
      case 'restore':
        return restoreSnapshot(gitPath, repoPath, need(body.ref, '回滚点'));
      case 'stage':
        return stagePaths(gitPath, repoPath, body.paths ?? []);
      case 'unstage':
        return unstagePaths(gitPath, repoPath, body.paths ?? []);
      case 'discard':
        return discardPaths(gitPath, repoPath, body.paths ?? []);
      case 'commit':
        return commitAll(gitPath, repoPath, need(body.message, '提交说明'));
      default:
        throw new InvalidInput(`不支持的操作：${body.action}`);
    }
  };

  app.get('/api/health', async () => {
    const git = await probeGit(gitPath);
    return {
      ok: true,
      git,
      db: options.dbPath,
      repos: listRepos(store).length,
      version: '0.1.0',
      url: selfUrl,
      desktop: options.staticDir !== undefined,
    };
  });

  app.get('/api/repos', async () => listRepos(store));

  app.post<{ Body: { path?: string } }>('/api/repos', async (request, reply) => {
    const raw = request.body?.path;
    if (!raw || raw.trim().length === 0) {
      return reply.code(400).send({ error: '请提供仓库路径' });
    }

    const existing = listRepos(store).find((r) => r.path.toLowerCase() === resolve(raw).toLowerCase());
    const target = existing ? existing.path : raw;
    const task = startIndex(target);
    return reply.code(202).send({ taskId: task.id, repoId: existing?.id ?? null, path: target });
  });

  app.get<{ Params: { id: string } }>('/api/repos/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
    const summary = getSummary(store, id);
    if (!summary) return reply.code(404).send({ error: '仓库不存在或尚未索引' });
    return summary;
  });

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>(
    '/api/repos/:id/timeline',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const raw = request.query.days;
      const parsed = raw === undefined || raw === '' ? undefined : Number(raw);
      const days =
        parsed !== undefined && Number.isFinite(parsed) ? Math.min(Math.max(parsed, 7), 2000) : undefined;
      return getTimeline(store, id, days);
    },
  );

  app.get<{ Params: { id: string } }>('/api/repos/:id/refs', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
    return getRefs(store, id);
  });

  app.get<{ Params: { id: string } }>('/api/repos/:id/authors', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
    return getAuthors(store, id);
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/repos/:id/graph',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const limit = Number(request.query.limit ?? 240);
      return getGraph(store, id, Number.isFinite(limit) ? Math.min(Math.max(limit, 20), 600) : 240);
    },
  );

  /**
   * 某条分支在图上的范围。
   * 前端拿它把"别人分支"压暗、把自己分支点亮，并算出相对默认分支的领先/落后。
   */
  app.get<{ Params: { id: string }; Querystring: { ref?: string; base?: string; limit?: string } }>(
    '/api/repos/:id/scope',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const repo = getRepo(store, id);
      if (!repo) return reply.code(404).send({ error: '仓库不存在' });
      const ref = request.query.ref?.trim();
      if (!ref) return reply.code(400).send({ error: '请指定分支' });
      const limit = Number(request.query.limit ?? 300);
      const capped = Number.isFinite(limit) ? Math.min(Math.max(limit, 20), 2000) : 300;
      try {
        const reader = new GitReader({ cwd: repo.path, ...(gitPath ? { gitPath } : {}) });
        const shas = await listReachable(reader, ref, capped);
        const base = request.query.base?.trim();
        const counts = base && base !== ref ? await aheadBehind(reader, base, ref) : null;
        return { ref, shas, ahead: counts?.ahead ?? null, behind: counts?.behind ?? null };
      } catch (error) {
        return reply.code(400).send({ error: explainGitFailure(error) });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/repos/:id/commits',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const limit = Number(request.query.limit ?? 50);
      return getRecentCommits(store, id, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 50);
    },
  );

  /** 同一仓库同时只允许一个写操作：连点会让 git 的 index.lock 打架 */
  const busyRepos = new Set<number>();

  app.get<{ Params: { id: string } }>('/api/repos/:id/status', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
    const repo = getRepo(store, id);
    if (!repo) return reply.code(404).send({ error: '仓库不存在' });
    try {
      return await getStatus(gitPath, repo.path);
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { id: string } }>('/api/repos/:id/snapshots', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
    const repo = getRepo(store, id);
    if (!repo) return reply.code(404).send({ error: '仓库不存在' });
    return listSnapshots(gitPath, repo.path);
  });

  /** 工作区单文件差异；staged=1 看暂存区，否则看未暂存 */
  app.get<{ Params: { id: string }; Querystring: { path?: string; staged?: string } }>(
    '/api/repos/:id/diff',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const repo = getRepo(store, id);
      if (!repo) return reply.code(404).send({ error: '仓库不存在' });
      const filePath = request.query.path?.trim();
      if (!filePath) return reply.code(400).send({ error: '请指定文件路径' });
      try {
        const reader = new GitReader({ cwd: repo.path, ...(gitPath ? { gitPath } : {}) });
        return await getWorkingDiff(reader, repo.path, filePath, { staged: request.query.staged === '1' });
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  /** 某次提交改了哪些文件 */
  app.get<{ Params: { id: string; sha: string } }>(
    '/api/repos/:id/commits/:sha/files',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const repo = getRepo(store, id);
      if (!repo) return reply.code(404).send({ error: '仓库不存在' });
      const sha = request.params.sha.trim();
      if (!/^[0-9a-f]{4,40}$/i.test(sha)) return reply.code(400).send({ error: '提交号格式不对' });
      try {
        const reader = new GitReader({ cwd: repo.path, ...(gitPath ? { gitPath } : {}) });
        return await getCommitFiles(reader, sha);
      } catch (error) {
        return reply.code(400).send({ error: explainGitFailure(error) });
      }
    },
  );

  /** 工作区文件正文：冲突编辑器用它载入带冲突标记的内容 */
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/repos/:id/file',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const repo = getRepo(store, id);
      if (!repo) return reply.code(404).send({ error: '仓库不存在' });
      const filePath = request.query.path?.trim();
      if (!filePath) return reply.code(400).send({ error: '请指定文件路径' });
      try {
        const file = await readWorkingFile(repo.path, filePath);
        return { ...file, conflictMarkers: countConflictMarkers(file.text) };
      } catch (error) {
        return reply.code(400).send({ error: explainGitFailure(error) });
      }
    },
  );

  /** 保存编辑器里的内容；只写工作区，不碰 index */
  app.put<{ Params: { id: string }; Body: { path?: string; content?: string } }>(
    '/api/repos/:id/file',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const repo = getRepo(store, id);
      if (!repo) return reply.code(404).send({ error: '仓库不存在' });
      const filePath = request.body?.path?.trim();
      if (!filePath) return reply.code(400).send({ error: '请指定文件路径' });
      if (typeof request.body?.content !== 'string') return reply.code(400).send({ error: '缺少文件内容' });
      try {
        const saved = await writeWorkingFile(repo.path, filePath, request.body.content);
        return { ok: true, ...saved, conflictMarkers: countConflictMarkers(request.body.content) };
      } catch (error) {
        return reply.code(400).send({ error: explainGitFailure(error) });
      }
    },
  );
  /** 某次提交里单个文件的差异 */
  app.get<{ Params: { id: string; sha: string }; Querystring: { path?: string; oldPath?: string } }>(
    '/api/repos/:id/commits/:sha/diff',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const repo = getRepo(store, id);
      if (!repo) return reply.code(404).send({ error: '仓库不存在' });
      const sha = request.params.sha.trim();
      if (!/^[0-9a-f]{4,40}$/i.test(sha)) return reply.code(400).send({ error: '提交号格式不对' });
      const filePath = request.query.path?.trim();
      if (!filePath) return reply.code(400).send({ error: '请指定文件路径' });
      try {
        const reader = new GitReader({ cwd: repo.path, ...(gitPath ? { gitPath } : {}) });
        return await getCommitFileDiff(reader, sha, filePath, request.query.oldPath ?? null);
      } catch (error) {
        return reply.code(400).send({ error: explainGitFailure(error) });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: GitActionBody }>(
    '/api/repos/:id/git',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const repo = getRepo(store, id);
      if (!repo) return reply.code(404).send({ error: '仓库不存在' });

      const body = request.body ?? ({ action: '' } as GitActionBody);
      if (busyRepos.has(id)) return reply.code(409).send({ error: '上一个操作还没结束，稍等一下' });

      busyRepos.add(id);
      try {
        const result = await runAction(repo.path, body);
        if (result.ok && HEAD_MOVING.has(body.action)) {
          const task = startIndex(repo.path);
          return { ...result, taskId: task.id };
        }
        return result;
      } catch (error) {
        if (error instanceof InvalidInput) return reply.code(400).send({ error: error.message });
        return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        busyRepos.delete(id);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/repos/:id/reindex', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
    const repo = getRepo(store, id);
    if (!repo) return reply.code(404).send({ error: '仓库不存在' });
    const task = startIndex(repo.path);
    return reply.code(202).send({ taskId: task.id, repoId: id, path: repo.path });
  });

  app.delete<{ Params: { id: string } }>('/api/repos/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
    deleteRepo(store, id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const task = tasks.get(request.params.id);
    if (!task) return reply.code(404).send({ error: '任务不存在' });
    return {
      id: task.id,
      path: task.path,
      repoId: task.repoId,
      status: task.status,
      progress: task.progress,
      error: task.error,
    };
  });

  // 静态资源（桌面端：前端与 API 同端口同源）
  if (options.staticDir) {
    const root = resolve(options.staticDir);
    const indexFile = join(root, 'index.html');

    app.get('/*', async (request, reply) => {
      const url = (request.raw.url ?? '/').split('?')[0] ?? '/';
      if (url.startsWith('/api/')) {
        return reply.code(404).send({ error: '接口不存在' });
      }

      const rel = url === '/' ? 'index.html' : decodeURIComponent(url.replace(/^\/+/, ''));
      const filePath = join(root, rel);

      // 防目录穿越
      if (!filePath.startsWith(root)) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      if (existsSync(filePath) && statSync(filePath).isFile()) {
        return reply
          .type(MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream')
          .header('Cache-Control', rel === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
          .send(readFileSync(filePath));
      }

      // SPA 回退
      if (existsSync(indexFile)) {
        return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(readFileSync(indexFile));
      }

      return reply.code(404).send({ error: 'not found' });
    });
  }

  await app.listen({ port: desiredPort, host });

  const address = app.server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : desiredPort;
  selfUrl = `http://${host}:${actualPort}`;

  return {
    app,
    store,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    async close() {
      await app.close();
      store.close();
    },
  };
}
