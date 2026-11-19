import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import Fastify from 'fastify';
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
  probeGit,
  deleteRepo,
  type IndexProgress,
} from '@gitatlas/core';

const PORT = Number(process.env.PORT ?? 4317);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.ATLAS_DB ?? resolve(process.cwd(), 'data', 'atlas.db');
const GIT_PATH = process.env.ATLAS_GIT;

const store = new Store(DB_PATH);

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

const tasks = new Map<string, IndexTask>();

const emptyProgress: IndexProgress = {
  phase: 'validating',
  message: '等待开始',
  processed: 0,
  total: null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  error: null,
};

function startIndex(repoPath: string): IndexTask {
  const task: IndexTask = {
    id: randomUUID(),
    path: repoPath,
    repoId: null,
    status: 'running',
    progress: { ...emptyProgress },
    error: null,
    createdAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);

  void (async () => {
    try {
      const result = await indexRepo(store, {
        repoPath,
        ...(GIT_PATH ? { gitPath: GIT_PATH } : {}),
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
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: undefined,
  },
});

await app.register(cors, { origin: true });

app.setErrorHandler((error, _request, reply) => {
  const message = error instanceof Error ? error.message : String(error);
  app.log.warn({ err: message }, 'request failed');
  void reply.code(400).send({ error: message });
});

app.get('/api/health', async () => {
  const git = await probeGit(GIT_PATH);
  return {
    ok: true,
    git,
    db: DB_PATH,
    repos: listRepos(store).length,
    version: '0.1.0',
  };
});

app.get('/api/repos', async () => listRepos(store));

app.post<{ Body: { path?: string } }>('/api/repos', async (request, reply) => {
  const raw = request.body?.path;
  if (!raw || raw.trim().length === 0) {
    return reply.code(400).send({ error: '请提供仓库路径' });
  }

  const existing = listRepos(store).find(
    (r) => r.path.toLowerCase() === resolve(raw).toLowerCase(),
  );
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

const shutdown = async (signal: string) => {
  app.log.info(`收到 ${signal}，正在关闭`);
  await app.close();
  store.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: PORT, host: HOST });
app.log.info(`GitAtlas API → http://${HOST}:${PORT}  (db: ${DB_PATH})`);
