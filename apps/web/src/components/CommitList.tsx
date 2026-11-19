import type { CommitListItem } from '../api.ts';
import { formatDate, formatNumber, shortSha } from '../format.ts';

export function CommitList({ commits }: { commits: CommitListItem[] }) {
  if (commits.length === 0) {
    return <div className="empty-desc">没有提交记录</div>;
  }

  return (
    <div style={{ maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
      {commits.map((commit) => (
        <div className="commit-row" key={commit.sha}>
          <span className="commit-sha mono">{shortSha(commit.sha)}</span>
          <span className="commit-subject" title={commit.subject}>
            {commit.isMerge ? <span className="badge badge-violet" style={{ marginRight: 6 }}>merge</span> : null}
            {commit.subject}
          </span>
          <span className="commit-meta">
            {commit.authorName} · {formatDate(commit.authoredAt)} ·{' '}
            {commit.isMerge && commit.filesChanged === 0
              ? '合并提交'
              : `${formatNumber(commit.insertions)}+${formatNumber(commit.deletions)}−`}
          </span>
        </div>
      ))}
    </div>
  );
}
