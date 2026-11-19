import type { Store } from '../store/db.ts';
import { GitReader } from '../git/reader.ts';
import { LOG_ARGS, parseCommitStream } from '../git/log.ts';
import { probeRepo, listRefs, aheadBehind } from '../git/repo.ts';
import { upsertRepo, clearRepoData, finishIndex } from '../store/repos.ts';
import { RepoWriter } from '../store/index-writer.ts';
import type { IndexProgress, IndexResult } from '../types.ts';

export interface IndexOptions {
  repoPath: string;
  gitPath?: string;
  /** P0 一律全量重建：先清空再写入，保证幂等 */
  onProgress?: (progress: IndexProgress) => void;
  /** 分支数过多时限制 ahead/behind 计算量（每次计算是一次 git 调用） */
  maxRefsForAheadBehind?: number;
}

/**
 * 索引一个仓库：探测 → 清空 → 写入 refs 与 commits → 计算领先/落后 → 收尾。
 *
 * 增量刷新（比对 HEAD 只写入新提交）留到 P1；全量重建在 5 万提交量级约 10–30 秒，
 * 配合进度回调已足够可用，先把正确性做对。
 */
export async function indexRepo(store: Store, options: IndexOptions): Promise<IndexResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const report = (phase: IndexProgress['phase'], message: string, processed = 0, total: number | null = null) => {
    options.onProgress?.({
      phase,
      message,
      processed,
      total,
      startedAt,
      finishedAt: phase === 'done' || phase === 'failed' ? new Date().toISOString() : null,
      error: null,
    });
  };

  report('validating', '检查 Git 仓库');
  const probe = await probeRepo(options.repoPath, options.gitPath);

  const reader = new GitReader({
    cwd: probe.root,
    ...(options.gitPath ? { gitPath: options.gitPath } : {}),
  });

  const repo = upsertRepo(store, {
    name: probe.name,
    path: probe.root,
    remoteUrl: probe.remoteUrl,
    defaultBranch: probe.defaultBranch,
    isShallow: probe.isShallow,
  });

  report('refs', '扫描分支与标签');
  const refs = await listRefs(reader);

  // 计算领先/落后（只对本地分支，且限量）
  const limit = options.maxRefsForAheadBehind ?? 40;
  const branches = refs.filter((r) => r.kind === 'branch' && r.shortName !== probe.defaultBranch).slice(0, limit);
  const abMap = new Map<string, { ahead: number; behind: number }>();
  for (const branch of branches) {
    const ab = await aheadBehind(reader, probe.defaultBranch, branch.shortName);
    if (ab) abMap.set(branch.name, ab);
  }

  clearRepoData(store, repo.id);

  report('commits', '解析提交历史');
  const writer = new RepoWriter(store, repo.id);
  writer.begin();

  let commitsIndexed = 0;
  try {
    for await (const commit of parseCommitStream(reader.lines(LOG_ARGS))) {
      writer.addCommit(commit);
      commitsIndexed += 1;
      if (commitsIndexed % 500 === 0) {
        report('commits', `已解析 ${commitsIndexed} 个提交`, commitsIndexed, null);
      }
    }
    writer.finish();
  } catch (error) {
    writer.rollback();
    throw error;
  }

  report('aggregating', '写入分支信息', commitsIndexed, commitsIndexed);
  writer.begin();
  writer.addRefs(refs, abMap);
  writer.finish();

  finishIndex(store, repo.id, {
    headSha: probe.headSha,
    commitCount: commitsIndexed,
    indexedAt: new Date().toISOString(),
    defaultBranch: probe.defaultBranch,
  });

  const durationMs = Date.now() - t0;
  options.onProgress?.({
    phase: 'done',
    message: `索引完成：${commitsIndexed} 个提交，${refs.length} 个引用，用时 ${(durationMs / 1000).toFixed(1)}s`,
    processed: commitsIndexed,
    total: commitsIndexed,
    startedAt,
    finishedAt: new Date().toISOString(),
    error: null,
  });

  return {
    repoId: repo.id,
    commitsIndexed,
    refsIndexed: refs.length,
    durationMs,
    full: true,
  };
}
