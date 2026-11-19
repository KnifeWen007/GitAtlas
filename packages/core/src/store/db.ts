import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * SQLite 存储（基于 Node 内置 node:sqlite）。
 *
 * 选型说明：用 node:sqlite 而非 better-sqlite3，是为了**零原生模块依赖**——
 * Electron 打包时不需要 electron-rebuild，便携版也不带 .node 二进制。
 *
 * 迁移策略：PRAGMA user_version 递增，逐版本执行；失败即抛错，由调用方回滚。
 */
export const SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  remote_url TEXT,
  default_branch TEXT,
  head_sha TEXT,
  last_indexed_at TEXT,
  commit_count INTEGER NOT NULL DEFAULT 0,
  is_shallow INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE commits (
  repo_id INTEGER NOT NULL,
  sha TEXT NOT NULL,
  parents TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  authored_at TEXT NOT NULL,
  -- 作者本地日期 YYYY-MM-DD，写入时算好并建索引：时间轴查询直接命中索引
  authored_date TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  subject TEXT NOT NULL,
  is_merge INTEGER NOT NULL DEFAULT 0,
  parent_count INTEGER NOT NULL DEFAULT 0,
  files_changed INTEGER NOT NULL DEFAULT 0,
  insertions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, sha)
);
CREATE INDEX idx_commits_date ON commits (repo_id, authored_date);
CREATE INDEX idx_commits_author ON commits (repo_id, author_email);

CREATE TABLE refs (
  repo_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_sha TEXT NOT NULL,
  last_commit_at TEXT,
  is_head INTEGER NOT NULL DEFAULT 0,
  ahead INTEGER,
  behind INTEGER,
  PRIMARY KEY (repo_id, name)
);

CREATE TABLE file_changes (
  repo_id INTEGER NOT NULL,
  sha TEXT NOT NULL,
  path TEXT NOT NULL,
  insertions INTEGER,
  deletions INTEGER
);
CREATE INDEX idx_fc_path ON file_changes (repo_id, path);
CREATE INDEX idx_fc_sha ON file_changes (repo_id, sha);

CREATE TABLE index_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  phase TEXT NOT NULL,
  commits_indexed INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
`;

export class Store {
  readonly db: DatabaseSync;
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    const current = Number(row?.user_version ?? 0);

    if (current >= SCHEMA_VERSION) return;

    if (current < 1) {
      this.db.exec(SCHEMA_V1);
    }
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  /** 便捷：取第一行或 undefined */
  get<T>(sql: string, ...params: Array<string | number | null>): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: Array<string | number | null>): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
}
