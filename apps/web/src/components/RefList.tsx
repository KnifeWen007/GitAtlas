import type { RefRecord } from '../api.ts';
import { formatRelative } from '../format.ts';

function RefRow({ item }: { item: RefRecord }) {
  return (
    <div className="ref-row">
      <div className="ref-name">
        <span className={`ref-icon ${item.kind}`} />
        <code>{item.shortName}</code>
        {item.isHead ? <span className="badge badge-accent">HEAD</span> : null}
      </div>
      <div className="ref-meta">
        {item.ahead !== null && (item.ahead > 0 || (item.behind ?? 0) > 0) ? (
          <span className="ab">
            <span className="up">↑{item.ahead}</span> <span className="down">↓{item.behind}</span>
          </span>
        ) : null}
        <span>{formatRelative(item.lastCommitAt)}</span>
      </div>
    </div>
  );
}

export function RefList({ refs }: { refs: RefRecord[] }) {
  const branches = refs.filter((r) => r.kind === 'branch');
  const tags = refs.filter((r) => r.kind === 'tag');
  const remotes = refs.filter((r) => r.kind === 'remote');

  if (refs.length === 0) {
    return <div className="empty-desc">没有分支或标签</div>;
  }

  return (
    <div style={{ maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
      {branches.map((record) => (
        <RefRow key={record.name} item={record} />
      ))}

      {remotes.length > 0 ? (
        <details style={{ marginTop: 8 }}>
          <summary
            className="sidebar-label"
            style={{ cursor: 'pointer', padding: '6px 4px', listStyle: 'revert' }}
          >
            远端分支 · {remotes.length}
          </summary>
          <div style={{ marginTop: 4 }}>
            {remotes.slice(0, 40).map((record) => (
              <RefRow key={record.name} item={record} />
            ))}
            {remotes.length > 40 ? (
              <div className="ref-meta" style={{ padding: '6px 4px' }}>
                还有 {remotes.length - 40} 个未显示
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {tags.length > 0 ? (
        <details open style={{ marginTop: 8 }}>
          <summary
            className="sidebar-label"
            style={{ cursor: 'pointer', padding: '6px 4px', listStyle: 'revert' }}
          >
            标签 · {tags.length}
          </summary>
          <div style={{ marginTop: 4 }}>
            {tags.slice(0, 40).map((record) => (
              <RefRow key={record.name} item={record} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
