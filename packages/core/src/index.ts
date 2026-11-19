export * from './types.ts';
export { GitReader, GitError, probeGit } from './git/reader.ts';
export { LOG_ARGS, LOG_FORMAT, parseCommitStream, parseNumstatLine, normalisePath } from './git/log.ts';
export type { ParsedCommit, ParsedFileChange } from './git/log.ts';
export { probeRepo, listRefs, aheadBehind } from './git/repo.ts';
export type { RepoProbe, RawRef } from './git/repo.ts';
export {
  parseUnifiedDiff,
  getWorkingDiff,
  getCommitFiles,
  getCommitFileDiff,
  statusLabel,
} from './git/diff.ts';
export type { DiffLine, DiffLineKind, FileDiff, FileChangeStatus, CommitFile } from './git/diff.ts';
export { readWorkingFile, writeWorkingFile, countConflictMarkers } from './git/file.ts';
export { listReachable } from './git/repo.ts';
export type { WorkingFileContent } from './git/file.ts';
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
export {
  getStatus,
  createSnapshot,
  listSnapshots,
  fetchRepo,
  pullRepo,
  pushRepo,
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeBranch,
  abortMerge,
  resolveConflict,
  concludeMerge,
  createTag,
  resetHard,
  restoreSnapshot,
  stagePaths,
  unstagePaths,
  discardPaths,
  commitAll,
  commitPaths,
  listRemotes,
  addRemote,
  setRemoteUrl,
  removeRemote,
  stashSave,
  stashPop,
  deleteTag,
  renameBranch,
} from './git/ops.ts';
export type {
  RepoStatus,
  RepoOperation,
  WorkingFile,
  ChangeKind,
  OpResult,
  SnapshotEntry,
  RemoteInfo,
} from './git/ops.ts';
