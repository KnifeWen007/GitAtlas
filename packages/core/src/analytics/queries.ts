import type { Store } from '../store/db.ts';
import type {
  AuthorStat,
  RefRecord,
  RepoSummary,
  TimelineDay,
  TimelineResponse,
} from '../types.ts';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function shiftDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * 决定时间窗右端。
 *
 * 停更仓库如果按"今天"对齐，整个热力图全是空白色块，用户会误判成加载失败。
 * 所以右端取「今天」与「最后一次提交日」的较晚者…… 但若最后提交远在过去，
 * 就用最后提交日，让窗口覆盖仓库真实的活跃期。
 */
function resolveWindowEnd(store: Store, repoId: number): string {
  const today = todayISO();
  const last = store.get<{ d: string | null }>(
    'SELECT MAX(authored_date) AS d FROM commits WHERE repo_id = ?',
    repoId,
  )?.d;
  if (!last) return today;
  return last < today ? last : today;
}

const MIN_WINDOW_DAYS = 371;
const MAX_WINDOW_DAYS = 2000;
/** 窗口中希望至少容纳的提交数，用来决定是否需要拉长窗口 */
const SAMPLE_COMMITS = 40;

/**
 * 自适应窗口跨度。
 *
 * 固定一年窗口对"活跃期在很久以前"或"末期提交稀疏"的仓库会显示大片空白，
 * 看上去像坏了。这里保证窗口至少覆盖最近 40 个提交（不足 40 个则取全历史），
 * 上限 2000 天（约 5.5 年），再长就让用户显式指定 days。
 */
function adaptiveSpan(store: Store, repoId: number, windowEnd: string): number {
  const anchor = store.get<{ d: string | null }>(
    'SELECT authored_date AS d FROM commits WHERE repo_id = ? ORDER BY authored_date DESC LIMIT 1 OFFSET ?',
    repoId,
    SAMPLE_COMMITS - 1,
  )?.d;

  if (!anchor) return MIN_WINDOW_DAYS;

  const diff = Math.round((Date.parse(windowEnd) - Date.parse(anchor)) / 86_400_000) + 1;
  if (!Number.isFinite(diff)) return MIN_WINDOW_DAYS;
  return Math.min(Math.max(diff, MIN_WINDOW_DAYS), MAX_WINDOW_DAYS);
}

interface DayRow {
  date: string;
  commits: number;
  merges: number;
  insertions: number;
  deletions: number;
}

/** 时间轴：按日聚合 + 星期×小时分布 */
export function getTimeline(store: Store, repoId: number, days?: number): TimelineResponse {
  const to = resolveWindowEnd(store, repoId);
  const span = days ?? adaptiveSpan(store, repoId, to);
  const from = shiftDays(to, -span);

  const rows = store.all<DayRow>(
    `SELECT authored_date AS date,
            COUNT(*) AS commits,
            COALESCE(SUM(is_merge), 0) AS merges,
            COALESCE(SUM(insertions), 0) AS insertions,
            COALESCE(SUM(deletions), 0) AS deletions
     FROM commits
     WHERE repo_id = ? AND authored_date >= ? AND authored_date <= ?
     GROUP BY authored_date
     ORDER BY authored_date ASC`,
    repoId,
    from,
    to,
  );

  const dayMap = new Map(rows.map((r) => [r.date, r]));
  const filled: TimelineDay[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const row = dayMap.get(key);
    filled.push({
      date: key,
      commits: row?.commits ?? 0,
      merges: row?.merges ?? 0,
      insertions: row?.insertions ?? 0,
      deletions: row?.deletions ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const hourly = store.all<{ weekday: number; hour: number; commits: number }>(
    `SELECT CAST(strftime('%w', authored_at) AS INTEGER) AS weekday,
            CAST(strftime('%H', authored_at) AS INTEGER) AS hour,
            COUNT(*) AS commits
     FROM commits
     WHERE repo_id = ? AND authored_date >= ? AND authored_date <= ?
     GROUP BY weekday, hour
     ORDER BY weekday, hour`,
    repoId,
    from,
    to,
  );

  return {
    repoId,
    from,
    to,
    days: filled,
    totals: {
      commits: rows.reduce((sum, r) => sum + r.commits, 0),
      merges: rows.reduce((sum, r) => sum + r.merges, 0),
      insertions: rows.reduce((sum, r) => sum + r.insertions, 0),
      deletions: rows.reduce((sum, r) => sum + r.deletions, 0),
      activeDays: rows.length,
    },
    hourly,
  };
}

interface SummaryRow {
  commitCount: number;
  authorCount: number;
  mergeCount: number;
  insertions: number;
  deletions: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
}

export function getSummary(store: Store, repoId: number): RepoSummary | null {
  const repo = store.get<{
    name: string;
    path: string;
    default_branch: string | null;
    last_indexed_at: string | null;
  }>('SELECT name, path, default_branch, last_indexed_at FROM repos WHERE id = ?', repoId);
  if (!repo) return null;

  const agg = store.get<SummaryRow>(
    `SELECT COUNT(*) AS commitCount,
            COUNT(DISTINCT author_email) AS authorCount,
            COALESCE(SUM(is_merge), 0) AS mergeCount,
            COALESCE(SUM(insertions), 0) AS insertions,
            COALESCE(SUM(deletions), 0) AS deletions,
            MIN(authored_at) AS firstCommitAt,
            MAX(authored_at) AS lastCommitAt
     FROM commits WHERE repo_id = ?`,
    repoId,
  );

  const refCounts = store.all<{ kind: string; n: number }>(
    'SELECT kind, COUNT(*) AS n FROM refs WHERE repo_id = ? GROUP BY kind',
    repoId,
  );
  const countOf = (kind: string) => refCounts.find((r) => r.kind === kind)?.n ?? 0;

  const since30 = dateMinusDays(30);
  const recent = store.get<{ c: number; a: number }>(
    `SELECT COUNT(*) AS c, COUNT(DISTINCT author_email) AS a
     FROM commits WHERE repo_id = ? AND authored_date >= ?`,
    repoId,
    since30,
  );

  const staleCutoff = dateMinusDays(30);
  const stale = store.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM refs
     WHERE repo_id = ? AND kind = 'branch' AND is_head = 0
       AND short_name != ? AND (last_commit_at IS NULL OR last_commit_at < ?)`,
    repoId,
    repo.default_branch ?? 'main',
    staleCutoff,
  );

  return {
    repoId,
    name: repo.name,
    path: repo.path,
    defaultBranch: repo.default_branch,
    lastIndexedAt: repo.last_indexed_at,
    commitCount: agg?.commitCount ?? 0,
    authorCount: agg?.authorCount ?? 0,
    branchCount: countOf('branch'),
    tagCount: countOf('tag'),
    mergeCount: agg?.mergeCount ?? 0,
    firstCommitAt: agg?.firstCommitAt ?? null,
    lastCommitAt: agg?.lastCommitAt ?? null,
    insertions: agg?.insertions ?? 0,
    deletions: agg?.deletions ?? 0,
    activeAuthors30d: recent?.a ?? 0,
    commits30d: recent?.c ?? 0,
    staleBranches: stale?.n ?? 0,
  };
}

interface RefRow {
  name: string;
  short_name: string;
  kind: string;
  target_sha: string;
  last_commit_at: string | null;
  is_head: number;
  ahead: number | null;
  behind: number | null;
}

export function getRefs(store: Store, repoId: number): RefRecord[] {
  return store
    .all<RefRow>(
      `SELECT name, short_name, kind, target_sha, last_commit_at, is_head, ahead, behind
       FROM refs WHERE repo_id = ?
       ORDER BY CASE kind WHEN 'branch' THEN 0 WHEN 'remote' THEN 1 ELSE 2 END,
                last_commit_at DESC NULLS LAST`,
      repoId,
    )
    .map((row) => ({
      repoId,
      name: row.name,
      shortName: row.short_name,
      kind: row.kind as RefRecord['kind'],
      targetSha: row.target_sha,
      lastCommitAt: row.last_commit_at,
      isHead: row.is_head === 1,
      ahead: row.ahead,
      behind: row.behind,
    }));
}

export function getAuthors(store: Store, repoId: number, limit = 50): AuthorStat[] {
  return store.all<AuthorStat>(
    `SELECT author_name AS name,
            author_email AS email,
            COUNT(*) AS commits,
            COALESCE(SUM(insertions), 0) AS insertions,
            COALESCE(SUM(deletions), 0) AS deletions,
            MIN(authored_at) AS firstCommitAt,
            MAX(authored_at) AS lastCommitAt
     FROM commits WHERE repo_id = ?
     GROUP BY author_email
     ORDER BY commits DESC
     LIMIT ?`,
    repoId,
    limit,
  );
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

export function getRecentCommits(store: Store, repoId: number, limit = 50): CommitListItem[] {
  return store.all<CommitListItem>(
    `SELECT sha, subject, author_name AS authorName, authored_at AS authoredAt,
            files_changed AS filesChanged, insertions, deletions, is_merge AS isMerge
     FROM commits WHERE repo_id = ?
     ORDER BY authored_at DESC
     LIMIT ?`,
    repoId,
    limit,
  );
}
