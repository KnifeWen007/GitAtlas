import type { RefRecord } from '../api.ts';
import { formatRelative } from '../format.ts';

export function RefList({ refs }: { refs: RefRecord[] }) {
  const branches = refs.filter((r) => r.kind === 'branch');
  const tags = refs.filter((r) => r.kind === 'tag');

  if (refs.length === 0) {
    return <div className="empty-desc">没有分支或标签</div>;
  }

  return (
    <div style={{ maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
      {branches.map((ref) => (
        <div className="ref-row" key={ref.name}>
          <div className="ref-name">
            <span className={`ref-icon ${ref.kind}`} />
            <code>{ref.shortName}</code>
            {ref.isHead ? <span className="badge badge-accent">HEAD</span> : null}
          </div>
          <div className="ref-meta">
            {ref.ahead !== null && (ref.ahead > 0 || (ref.behind ?? 0) > 0) ? (
              <span className="ab">
                <span className="up">↑{ref.ahead}</span> <span className="down">↓{ref.behind}</span>
              </span>
            ) : null}
            <span>{formatRelative(ref.lastCommitAt)}</span>
          </div>
        </div>
      ))}

      {tags.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div className="sidebar-label" style={{ padding: '6px 4px' }}>
            标签 · {tags.length}
          </div>
          {tags.slice(0, 30).map((ref) => (
            <div className="ref-row" key={ref.name}>
              <div className="ref-name">
                <span className="ref-icon tag" />
                <code>{ref.shortName}</code>
              </div>
              <div className="ref-meta">
                <span>{formatRelative(ref.lastCommitAt)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
