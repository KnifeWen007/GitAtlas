import type { RefRecord } from '../api.ts';
import { formatRelative } from '../format.ts';

interface RefListProps {
  refs: RefRecord[];
  /** 点分支就把图谱切到这条分支 */
  onFocus?: (ref: string) => void;
}

function RefRow({ item, onFocus }: { item: RefRecord; onFocus?: (ref: string) => void }) {
  const clickable = item.kind === 'branch' && Boolean(onFocus);
  return (
    <div
      className={`ref-row${clickable ? ' is-clickable' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => {
        if (clickable) onFocus?.(item.shortName);
      }}
      onKeyDown={(event) => {
        if (!clickable) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onFocus?.(item.shortName);
        }
      }}
      title={clickable ? `在提交图谱里只看 ${item.shortName}` : item.name}
    >
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
        {clickable ? <span className="ref-go">看图 →</span> : null}
      </div>
    </div>
  );
}

export function RefList({ refs, onFocus }: RefListProps) {
  const branches = refs
    .filter((r) => r.kind === 'branch')
    // 当前分支永远排第一，其余按名字
    .sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.shortName.localeCompare(b.shortName));
  const tags = refs.filter((r) => r.kind === 'tag').sort((a, b) => a.shortName.localeCompare(b.shortName));
  const remotes = refs.filter((r) => r.kind === 'remote');

  if (refs.length === 0) {
    return <div className="empty-desc">没有分支或标签</div>;
  }

  return (
    <div className="ref-scroll">
      {branches.map((record) => (
        <RefRow key={record.name} item={record} onFocus={onFocus} />
      ))}

      {remotes.length > 0 ? (
        <details className="ref-group">
          <summary className="ref-group-head">
            远端分支<span className="ref-group-count">{remotes.length}</span>
          </summary>
          {remotes.slice(0, 40).map((record) => (
            <RefRow key={record.name} item={record} />
          ))}
          {remotes.length > 40 ? <div className="ref-more">还有 {remotes.length - 40} 个未显示</div> : null}
        </details>
      ) : null}

      {/*
       * 标签本质上就是"某个提交的别名"，用胶囊挤成两三行比一人一行省一半高度，
       * 也不会和分支那种"一条会动的线"混在一起。日期放进 tooltip。
       */}
      {tags.length > 0 ? (
        <div className="ref-group">
          <div className="ref-group-head is-static">
            标签<span className="ref-group-count">{tags.length}</span>
          </div>
          <div className="ref-chips">
            {tags.map((record) => (
              <span
                className="ref-chip"
                key={record.name}
                title={`${record.name} · ${formatRelative(record.lastCommitAt)}`}
              >
                <span className="ref-icon tag" />
                {record.shortName}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}