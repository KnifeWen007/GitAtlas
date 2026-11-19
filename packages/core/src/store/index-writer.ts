import type { Store } from './db.ts';
import type { ParsedCommit } from '../git/log.ts';
import type { RawRef } from '../git/repo.ts';

const BATCH_SIZE = 1000;

type Statement = ReturnType<Store['db']['prepare']>;

/**
 * 批量写入器。
 *
 * 为什么分批提交事务：单个巨型事务会让 WAL 膨胀到 GB 级并拖慢写入；
 * 每 1000 个提交提交一次，兼顾吞吐与内存。
 */
export class RepoWriter {
  private readonly store: Store;
  private readonly repoId: number;
  private readonly commitStmt: Statement;
  private readonly changeStmt: Statement;
  private readonly refStmt: Statement;
  private pending = 0;
  private open = false;

  constructor(store: Store, repoId: number) {
    this.store = store;
    this.repoId = repoId;
    this.commitStmt = store.db.prepare(
      `INSERT OR REPLACE INTO commits
       (repo_id, sha, parents, author_name, author_email, authored_at, authored_date,
        committed_at, subject, is_merge, parent_count, files_changed, insertions, deletions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.changeStmt = store.db.prepare(
      `INSERT INTO file_changes (repo_id, sha, path, insertions, deletions) VALUES (?, ?, ?, ?, ?)`,
    );
    this.refStmt = store.db.prepare(
      `INSERT OR REPLACE INTO refs
       (repo_id, name, short_name, kind, target_sha, last_commit_at, is_head, ahead, behind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  begin(): void {
    if (this.open) return;
    this.store.db.exec('BEGIN');
    this.open = true;
  }

  private checkpoint(): void {
    if (this.pending < BATCH_SIZE) return;
    this.store.db.exec('COMMIT');
    this.store.db.exec('BEGIN');
    this.pending = 0;
  }

  addCommit(commit: ParsedCommit): void {
    this.commitStmt.run(
      this.repoId,
      commit.sha,
      commit.parents.join(' '),
      commit.authorName,
      commit.authorEmail,
      commit.authoredAt,
      commit.authoredAt.slice(0, 10),
      commit.committedAt,
      commit.subject,
      commit.parents.length > 1 ? 1 : 0,
      commit.parents.length,
      commit.filesChanged,
      commit.insertions,
      commit.deletions,
    );

    for (const change of commit.changes) {
      this.changeStmt.run(this.repoId, commit.sha, change.path, change.insertions, change.deletions);
    }

    this.pending += 1;
    this.checkpoint();
  }

  addRefs(refs: RawRef[], aheadBehind: Map<string, { ahead: number; behind: number }>): void {
    for (const ref of refs) {
      const ab = aheadBehind.get(ref.name);
      this.refStmt.run(
        this.repoId,
        ref.name,
        ref.shortName,
        ref.kind,
        ref.targetSha,
        ref.lastCommitAt,
        ref.isHead ? 1 : 0,
        ab?.ahead ?? null,
        ab?.behind ?? null,
      );
    }
  }

  finish(): void {
    if (!this.open) return;
    this.store.db.exec('COMMIT');
    this.open = false;
    this.pending = 0;
  }

  rollback(): void {
    if (!this.open) return;
    try {
      this.store.db.exec('ROLLBACK');
    } catch {
      // 事务可能已被 SQLite 自行回滚
    }
    this.open = false;
    this.pending = 0;
  }
}
