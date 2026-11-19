/**
 * API 契约类型。
 *
 * 这里刻意不直接 import @gitatlas/core 的领域类型：
 * core 依赖 Node 内置模块，前端只应依赖 HTTP 契约，避免打包时把服务端类型拖进来。
 */

/** 由 Electron preload 注入；网页版不存在 */
declare global {
  interface Window {
    gitatlas?: {
      desktop: boolean;
      platform: string;
      version: string;
      pickDirectory(): Promise<string | null>;
      /** 用系统默认程序打开文件 */
      openPath(filePath: string): Promise<{ ok: boolean; error?: string }>;
      /** 在文件管理器里定位文件 */
      revealPath(filePath: string): Promise<{ ok: boolean; error?: string }>;
      /** 读回配色设置（桌面端存在 userData 里） */
      readTheme(): Promise<{ mode: string; accent: string | null } | null>;
      /** 保存配色设置 */
      writeTheme(settings: { mode: string; accent: string | null }): Promise<{ ok: boolean; error?: string }>;
    };
  }
}

/** 工作区文件正文；冲突编辑器用它载入带冲突标记的内容 */
export interface WorkingFileContent {
  path: string;
  text: string;
  binary: boolean;
  truncated: boolean;
  size: number;
  exists: boolean;
  note: string | null;
  /** 还剩几段冲突标记（<<<<<<<） */
  conflictMarkers: number;
}

export interface HealthResponse {
  ok: boolean;
  git: { available: boolean; version: string | null };
  db: string;
  repos: number;
  version: string;
  /** 服务实际监听地址；桌面端是随机端口，不能硬编码 */
  url: string;
  desktop: boolean;
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

export interface GraphRef {
  name: string;
  kind: 'branch' | 'tag' | 'remote';
  isHead: boolean;
}

export interface GraphCommit {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  isMerge: boolean;
  lane: number;
  parents: string[];
  refs: GraphRef[];
}

export interface BranchScope {
  ref: string;
  /** 这条分支能到达的提交，新的在前 */
  shas: string[];
  /** 相对默认分支的领先/落后，未知时为 null */
  ahead: number | null;
  behind: number | null;
}

export interface GraphResponse {
  repoId: number;
  commits: GraphCommit[];
  laneCount: number;
  total: number;
  truncated: boolean;
}

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

export interface WorkingFile {
  path: string;
  kind: ChangeKind;
  code: string;
}

export interface RepoStatus {
  branch: string | null;
  detached: boolean;
  headSha: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  staged: WorkingFile[];
  unstaged: WorkingFile[];
  untracked: WorkingFile[];
  conflicts: WorkingFile[];
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;
  remoteUrl: string | null;
  stashCount: number;
}

export interface OpResult {
  ok: boolean;
  message: string;
  conflicts?: WorkingFile[];
  snapshot?: string;
  taskId?: string;
  stderr?: string;
}

export interface SnapshotEntry {
  ref: string;
  name: string;
  sha: string;
  createdAt: string;
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
  /** 远端名与地址 */
  remote?: string;
  url?: string;
  /** 提交时是否先把全部改动加入索引 */
  all?: boolean;
}

/** 一个远端：同名的 fetch / push 地址合成一条 */
export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
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

export interface DiffLine {
  kind: 'context' | 'add' | 'del' | 'hunk' | 'meta';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'binary';

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileChangeStatus;
  lines: DiffLine[];
  added: number;
  removed: number;
  binary: boolean;
  truncated: boolean;
  note: string | null;
}

export interface CommitFile {
  path: string;
  oldPath: string | null;
  status: FileChangeStatus;
  added: number;
  removed: number;
  binary: boolean;
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
  graph: (id: number, limit = 240) => request<GraphResponse>(`/api/repos/${id}/graph?limit=${limit}`),
  scope: (id: number, ref: string, base?: string | null, limit = 300) =>
    request<BranchScope>(
      `/api/repos/${id}/scope?ref=${encodeURIComponent(ref)}${
        base && base !== ref ? `&base=${encodeURIComponent(base)}` : ''
      }&limit=${limit}`,
    ),
  status: (id: number) => request<RepoStatus>(`/api/repos/${id}/status`),
  snapshots: (id: number) => request<SnapshotEntry[]>(`/api/repos/${id}/snapshots`),
  diff: (id: number, path: string, staged = false) =>
    request<FileDiff>(`/api/repos/${id}/diff?path=${encodeURIComponent(path)}${staged ? '&staged=1' : ''}`),
  commitFiles: (id: number, sha: string) => request<CommitFile[]>(`/api/repos/${id}/commits/${sha}/files`),
  commitDiff: (id: number, sha: string, path: string, oldPath?: string | null) =>
    request<FileDiff>(
      `/api/repos/${id}/commits/${sha}/diff?path=${encodeURIComponent(path)}${
        oldPath ? `&oldPath=${encodeURIComponent(oldPath)}` : ''
      }`,
    ),
  git: (id: number, body: GitActionBody) =>
    request<OpResult>(`/api/repos/${id}/git`, { method: 'POST', body: JSON.stringify(body) }),
  remotes: (id: number) => request<RemoteInfo[]>(`/api/repos/${id}/remotes`),
  file: (id: number, path: string) =>
    request<WorkingFileContent>(`/api/repos/${id}/file?path=${encodeURIComponent(path)}`),
  saveFile: (id: number, path: string, content: string) =>
    request<{ ok: boolean; path: string; bytes: number; conflictMarkers: number }>(`/api/repos/${id}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),
  reindex: (id: number) => request<{ taskId: string }>(`/api/repos/${id}/reindex`, { method: 'POST' }),
  remove: (id: number) => request<{ ok: boolean }>(`/api/repos/${id}`, { method: 'DELETE' }),
  task: (id: string) => request<TaskResponse>(`/api/tasks/${id}`),
};
