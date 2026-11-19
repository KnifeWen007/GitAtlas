/**
 * API 契约类型。
 *
 * 这里刻意不直接 import @gitatlas/core 的领域类型：
 * core 依赖 Node 内置模块，前端只应依赖 HTTP 契约，避免打包时把服务端类型拖进来。
 */

export interface HealthResponse {
  ok: boolean;
  git: { available: boolean; version: string | null };
  db: string;
  repos: number;
  version: string;
}

export interface RepoRecord {
  id: number;
  name: string;
  path: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  headSha: string | null;
  lastIndexedAt: string | null;
  commitCount: number;
}

export interface RepoSummary {
  repoId: number;
  name: string;
  path: string;
  defaultBranch: string | null;
  lastIndexedAt: string | null;
  commitCount: number;
  authorCount: number;
  branchCount: number;
  tagCount: number;
  mergeCount: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  insertions: number;
  deletions: number;
  activeAuthors30d: number;
  commits30d: number;
  staleBranches: number;
}

export interface TimelineDay {
  date: string;
  commits: number;
  merges: number;
  insertions: number;
  deletions: number;
}

export interface TimelineResponse {
  repoId: number;
  from: string;
  to: string;
  days: TimelineDay[];
  totals: {
    commits: number;
    merges: number;
    insertions: number;
    deletions: number;
    activeDays: number;
  };
  hourly: Array<{ weekday: number; hour: number; commits: number }>;
}

export interface RefRecord {
  repoId: number;
  name: string;
  shortName: string;
  kind: 'branch' | 'remote' | 'tag';
  targetSha: string;
  lastCommitAt: string | null;
  isHead: boolean;
  ahead: number | null;
  behind: number | null;
}

export interface CommitListItem {
  sha: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  isMerge: boolean;
}

export type IndexPhase = 'validating' | 'refs' | 'commits' | 'aggregating' | 'done' | 'failed';

export interface IndexProgress {
  phase: IndexPhase;
  message: string;
  processed: number;
  total: number | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface TaskResponse {
  id: string;
  path: string;
  repoId: number | null;
  status: 'running' | 'done' | 'failed';
  progress: IndexProgress;
  error: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 只有真正带 body 时才声明 JSON，否则 Fastify 会以「空的 JSON 体」拒绝
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body !== undefined && init.body !== null) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // 忽略非 JSON 错误体
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  repos: () => request<RepoRecord[]>('/api/repos'),
  addRepo: (path: string) =>
    request<{ taskId: string; repoId: number | null; path: string }>('/api/repos', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  summary: (id: number) => request<RepoSummary>(`/api/repos/${id}`),
  timeline: (id: number, days?: number) =>
    request<TimelineResponse>(`/api/repos/${id}/timeline${days ? `?days=${days}` : ''}`),
  refs: (id: number) => request<RefRecord[]>(`/api/repos/${id}/refs`),
  commits: (id: number, limit = 40) => request<CommitListItem[]>(`/api/repos/${id}/commits?limit=${limit}`),
  reindex: (id: number) => request<{ taskId: string }>(`/api/repos/${id}/reindex`, { method: 'POST' }),
  remove: (id: number) => request<{ ok: boolean }>(`/api/repos/${id}`, { method: 'DELETE' }),
  task: (id: string) => request<TaskResponse>(`/api/tasks/${id}`),
};
