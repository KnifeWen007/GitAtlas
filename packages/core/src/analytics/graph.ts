import type { Store } from '../store/db.ts';

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
  /** 该提交所在的泳道，前端按此算 x 坐标 */
  lane: number;
  parents: string[];
  refs: GraphRef[];
}

export interface GraphResponse {
  repoId: number;
  commits: GraphCommit[];
  laneCount: number;
  total: number;
  /** true 表示仓库提交数超过本次返回条数，图底部还要接"继续" */
  truncated: boolean;
}

interface CommitRow {
  sha: string;
  parents: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  isMerge: number;
}

interface RefRow {
  short_name: string;
  kind: string;
  target_sha: string;
  is_head: number;
}

/**
 * 提交图谱布局（自研，不引第三方图库）。
 *
 * 泳道算法：按提交从新到旧扫一遍，维护「每条泳道正在等待哪个提交」。
 * - 当前提交若被某条泳道等待，就落在该泳道（保持分支走直线）；
 * - 否则开一条新泳道（新分支的起点）；
 * - 画完把泳道让给第一父提交（主线连续），其余父提交各占一条右侧泳道（合并分叉）。
 *
 * 排序用 committer 时间而不是 author 时间：rebase / cherry-pick 之后
 * author 时间会乱序，committer 时间才接近拓扑序，泳道才不会画成毛线。
 */
export function getGraph(store: Store, repoId: number, limit = 260): GraphResponse {
  const total =
    store.get<{ n: number }>('SELECT COUNT(*) AS n FROM commits WHERE repo_id = ?', repoId)?.n ?? 0;

  const rows = store.all<CommitRow>(
    `SELECT sha, parents, subject, author_name AS authorName, authored_at AS authoredAt, is_merge AS isMerge
     FROM commits
     WHERE repo_id = ?
     ORDER BY committed_at DESC, authored_at DESC
     LIMIT ?`,
    repoId,
    limit,
  );

  const refRows = store.all<RefRow>(
    `SELECT short_name, kind, target_sha, is_head
     FROM refs
     WHERE repo_id = ? AND kind IN ('branch', 'tag', 'remote')
     ORDER BY CASE kind WHEN 'branch' THEN 0 WHEN 'tag' THEN 1 ELSE 2 END, short_name`,
    repoId,
  );

  const refsBySha = new Map<string, GraphRef[]>();
  for (const row of refRows) {
    const list = refsBySha.get(row.target_sha) ?? [];
    list.push({
      name: row.short_name,
      kind: row.kind as GraphRef['kind'],
      isHead: row.is_head === 1,
    });
    refsBySha.set(row.target_sha, list);
  }

  /** 每条泳道当前等待的提交 sha；null 表示空闲可复用 */
  const lanes: (string | null)[] = [];
  const commits: GraphCommit[] = [];

  for (const row of rows) {
    const parents = row.parents.trim().length > 0 ? row.parents.trim().split(/\s+/) : [];

    let lane = lanes.indexOf(row.sha);
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    }

    // 主线交给第一父提交
    lanes[lane] = parents[0] ?? null;

    // 合并提交的其余父各占一条泳道
    for (let i = 1; i < parents.length; i++) {
      const parent = parents[i]!;
      if (lanes.includes(parent)) continue;
      let free = lanes.indexOf(null, lane + 1);
      if (free === -1) free = lanes.indexOf(null);
      if (free === -1) {
        free = lanes.length;
        lanes.push(null);
      }
      lanes[free] = parent;
    }

    commits.push({
      sha: row.sha,
      shortSha: row.sha.slice(0, 7),
      subject: row.subject,
      authorName: row.authorName,
      authoredAt: row.authoredAt,
      isMerge: row.isMerge === 1 || parents.length > 1,
      lane,
      parents,
      refs: refsBySha.get(row.sha) ?? [],
    });

    // 尾部空泳道回收，避免泳道数无限增长
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
  }

  const laneCount = commits.reduce((max, commit) => Math.max(max, commit.lane + 1), 1);

  return {
    repoId,
    commits,
    laneCount,
    total,
    truncated: total > rows.length,
  };
}
