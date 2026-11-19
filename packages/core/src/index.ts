export * from './types.ts';
export { GitReader, GitError, probeGit } from './git/reader.ts';
export { LOG_ARGS, LOG_FORMAT, parseCommitStream, parseNumstatLine, normalisePath } from './git/log.ts';
export type { ParsedCommit, ParsedFileChange } from './git/log.ts';
export { probeRepo, listRefs, aheadBehind } from './git/repo.ts';
export type { RepoProbe, RawRef } from './git/repo.ts';
export { Store, SCHEMA_VERSION } from './store/db.ts';
export {
  listRepos,
  getRepo,
  findRepoByPath,
  upsertRepo,
  clearRepoData,
  finishIndex,
  deleteRepo,
} from './store/repos.ts';
export { RepoWriter } from './store/index-writer.ts';
export { indexRepo } from './index/indexer.ts';
export type { IndexOptions } from './index/indexer.ts';
export {
  getTimeline,
  getSummary,
  getRefs,
  getAuthors,
  getRecentCommits,
} from './analytics/queries.ts';
export type { CommitListItem } from './analytics/queries.ts';
export { getGraph } from './analytics/graph.ts';
export type { GraphCommit, GraphRef, GraphResponse } from './analytics/graph.ts';
