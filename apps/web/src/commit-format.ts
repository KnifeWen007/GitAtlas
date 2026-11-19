/**
 * 提交信息规范（Conventional Commits）。
 *
 * 类型固定成一小撮，写提交时点一下就行；读历史时同一个解析器
 * 把类型取出来做角标，写和看用的是同一套口径。
 */

export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore'
  | 'revert';

export interface CommitTypeMeta {
  type: CommitType;
  hint: string;
}

/** 顺序按日常使用频率排，不是字母序 */
export const COMMIT_TYPES: CommitTypeMeta[] = [
  { type: 'feat', hint: '新增功能' },
  { type: 'fix', hint: '修 bug' },
  { type: 'docs', hint: '只改文档' },
  { type: 'refactor', hint: '重构，不加功能也不修 bug' },
  { type: 'perf', hint: '性能优化' },
  { type: 'style', hint: '格式、空白、分号，不动逻辑' },
  { type: 'test', hint: '补测试或改测试' },
  { type: 'build', hint: '构建系统与依赖' },
  { type: 'ci', hint: '持续集成配置' },
  { type: 'chore', hint: '杂项，以上都不是' },
  { type: 'revert', hint: '回滚更早的提交' },
];

const TYPE_SET = new Set<string>(COMMIT_TYPES.map((item) => item.type));

export interface ParsedCommit {
  type: CommitType;
  scope: string | null;
  breaking: boolean;
  description: string;
}

/** `feat(graph)!: 支持拖动节点` —— 解析不出类型就返回 null */
export function parseConventional(subject: string): ParsedCommit | null {
  const matched = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i.exec(
    subject.trim(),
  );
  if (!matched) return null;
  const type = (matched[1] ?? '').toLowerCase();
  if (!TYPE_SET.has(type)) return null;
  return {
    type: type as CommitType,
    scope: matched[2]?.trim() || null,
    breaking: matched[3] === '!',
    description: (matched[4] ?? '').trim(),
  };
}

export function typeHint(type: CommitType): string {
  return COMMIT_TYPES.find((item) => item.type === type)?.hint ?? '';
}

export interface CommitDraft {
  type: CommitType;
  scope: string;
  subject: string;
  body: string;
  breaking: boolean;
}

/** 拼成最终的提交信息；正文用空行隔开，git 才会当成标题 + 正文 */
export function buildCommitMessage(draft: CommitDraft): string {
  const scope = draft.scope.trim().replace(/[()]/g, '');
  const subject = draft.subject.trim();
  const head = `${draft.type}${scope ? `(${scope})` : ''}${draft.breaking ? '!' : ''}: ${subject}`;
  const body = draft.body.trim();
  return body ? `${head}\n\n${body}` : head;
}
