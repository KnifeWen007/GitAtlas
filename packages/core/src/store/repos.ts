import type { Store } from './db.ts';
import type { RepoRecord } from '../types.ts';

interface RepoRow {
  id: number;
  name: string;
  path: string;
  remote_url: string | null;
  default_branch: string | null;
  head_sha: string | null;
  last_indexed_at: string | null;
  commit_count: number;
}

function toRepo(row: RepoRow): RepoRecord {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    remoteUrl: row.remote_url,
    defaultBranch: row.default_branch,
    headSha: row.head_sha,
    lastIndexedAt: row.last_indexed_at,
    commitCount: row.commit_count,
  };
}

const SELECT_REPO = 'SELECT id, name, path, remote_url, default_branch, head_sha, last_indexed_at, commit_count FROM repos';

export function listRepos(store: Store): RepoRecord[] {
  return store
    .all<RepoRow>(`${SELECT_REPO} ORDER BY last_indexed_at DESC NULLS LAST, id DESC`)
    .map(toRepo);
}

export function getRepo(store: Store, id: number): RepoRecord | undefined {
  const row = store.get<RepoRow>(`${SELECT_REPO} WHERE id = ?`, id);
  return row ? toRepo(row) : undefined;
}

export function findRepoByPath(store: Store, path: string): RepoRecord | undefined {
  const row = store.get<RepoRow>(`${SELECT_REPO} WHERE path = ?`, path);
  return row ? toRepo(row) : undefined;
}

export interface UpsertRepoInput {
  name: string;
  path: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  isShallow: boolean;
}

export function upsertRepo(store: Store, input: UpsertRepoInput): RepoRecord {
  const existing = findRepoByPath(store, input.path);
  if (existing) {
    store.db
      .prepare(
        `UPDATE repos SET name = ?, remote_url = ?, default_branch = ?, is_shallow = ? WHERE id = ?`,
      )
      .run(input.name, input.remoteUrl, input.defaultBranch, input.isShallow ? 1 : 0, existing.id);
    return { ...existing, name: input.name, remoteUrl: input.remoteUrl, defaultBranch: input.defaultBranch };
  }

  const row = store.db
    .prepare(
      `INSERT INTO repos (name, path, remote_url, default_branch, is_shallow)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(input.name, input.path, input.remoteUrl, input.defaultBranch, input.isShallow ? 1 : 0) as
    | { id: number }
    | undefined;

  if (!row) throw new Error('创建仓库记录失败');

  return {
    id: row.id,
    name: input.name,
    path: input.path,
    remoteUrl: input.remoteUrl,
    defaultBranch: input.defaultBranch,
    headSha: null,
    lastIndexedAt: null,
    commitCount: 0,
  };
}

export function clearRepoData(store: Store, repoId: number): void {
  store.db.exec(`DELETE FROM file_changes WHERE repo_id = ${repoId}`);
  store.db.exec(`DELETE FROM commits WHERE repo_id = ${repoId}`);
  store.db.exec(`DELETE FROM refs WHERE repo_id = ${repoId}`);
}

export function finishIndex(
  store: Store,
  repoId: number,
  data: { headSha: string | null; commitCount: number; indexedAt: string; defaultBranch: string },
): void {
  store.db
    .prepare(
      `UPDATE repos SET head_sha = ?, commit_count = ?, last_indexed_at = ?, default_branch = ? WHERE id = ?`,
    )
    .run(data.headSha, data.commitCount, data.indexedAt, data.defaultBranch, repoId);
}

export function deleteRepo(store: Store, repoId: number): void {
  clearRepoData(store, repoId);
  store.db.prepare('DELETE FROM repos WHERE id = ?').run(repoId);
}
