/**
 * GitAtlas 领域类型。
 *
 * 约定：
 * - 所有时间戳为 ISO 8601 字符串（UTC），展示层负责转本地时区。
 * - 所有 id 为 SQLite 自增整数。
 */

export type RefKind = 'branch' | 'remote' | 'tag';

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

export interface CommitRecord {
  repoId: number;
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  subject: string;
  isMerge: boolean;
  parentCount: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface RefRecord {
  repoId: number;
  name: string;
  shortName: string;
  kind: RefKind;
  targetSha: string;
  lastCommitAt: string | null;
  isHead: boolean;
  /** 领先默认分支的提交数；无法计算时为 null */
  ahead: number | null;
  /** 落后默认分支的提交数；无法计算时为 null */
  behind: number | null;
}

export interface FileChangeRecord {
  repoId: number;
  sha: string;
  path: string;
  insertions: number | null;
  deletions: number | null;
}

/** 时间轴单日聚合 */
export interface TimelineDay {
  /** YYYY-MM-DD（本地时区由查询参数决定，默认按仓库记录的时区偏移处理） */
  date: string;
  commits: number;
  merges: number;
  insertions: number;
  deletions: number;
}

export interface TimelineResponse {
  repoId: number;
  /** 查询窗口起止（含端点），YYYY-MM-DD */
  from: string;
  to: string;
  days: TimelineDay[];
  /** 全窗口统计 */
  totals: {
    commits: number;
    merges: number;
    insertions: number;
    deletions: number;
    activeDays: number;
  };
  /** 按星期 × 小时聚合的提交分布（0=周日） */
  hourly: Array<{ weekday: number; hour: number; commits: number }>;
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
  /** 近 30 天提交数 */
  commits30d: number;
  /** 僵化分支数（未合并且 30 天无活动） */
  staleBranches: number;
}

export type IndexPhase =
  | 'validating'
  | 'refs'
  | 'commits'
  | 'aggregating'
  | 'done'
  | 'failed';

export interface IndexProgress {
  phase: IndexPhase;
  message: string;
  processed: number;
  total: number | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface IndexResult {
  repoId: number;
  commitsIndexed: number;
  refsIndexed: number;
  durationMs: number;
  full: boolean;
}

export interface AuthorStat {
  name: string;
  email: string;
  commits: number;
  insertions: number;
  deletions: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
}
