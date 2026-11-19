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
  type IndexProgress,
} from '@gitatlas/core';

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
    // 桌面端窗口不需要暴露内部信息
    disableRequestLogging: options.logLevel === 'warn' || options.logLevel === 'error',
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

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/repos/:id/commits',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id 无效' });
      const limit = Number(request.query.limit ?? 50);
      return getRecentCommits(store, id, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 50);
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
