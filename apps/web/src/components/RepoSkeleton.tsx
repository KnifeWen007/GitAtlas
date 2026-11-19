/**
 * 首屏骨架：形状照着真实布局走（页头 → 统计卡 → 操作台 → 图谱），
 * 数据回来时只是把灰块换成内容，不会整页跳一下。
 */
export function RepoSkeleton({ label = '正在加载仓库数据…' }: { label?: string }) {
  return (
    <div className="skel-page" aria-busy="true">
      <div className="skel-header">
        <div>
          <div className="skeleton skel-title" />
          <div className="skeleton skel-path" />
        </div>
        <div className="skel-header-actions">
          <div className="skeleton skel-chip" />
          <div className="skeleton skel-chip" />
        </div>
      </div>

      <div className="stat-grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton skel-stat" key={index} />
        ))}
      </div>

      <div className="card skel-panel-card">
        <div className="skeleton skel-line" style={{ width: '22%' }} />
        <div className="skel-panel-row">
          <div className="skeleton skel-block" />
          <div className="skeleton skel-block" />
        </div>
      </div>

      <div className="card skel-graph-card">
        <div className="skel-graph-head">
          <div className="skeleton skel-line" style={{ width: '18%' }} />
          <div className="skeleton skel-line" style={{ width: '12%' }} />
        </div>
        <div className="skel-graph">
          {Array.from({ length: 9 }).map((_, index) => (
            <div className="skel-row" key={index}>
              <div className="skeleton skel-lane" />
              <div className="skeleton skel-row-text" style={{ width: `${52 + ((index * 13) % 34)}%` }} />
              <div className="skeleton skel-row-meta" />
            </div>
          ))}
        </div>
      </div>

      <div className="skel-caption">{label}</div>
    </div>
  );
}
