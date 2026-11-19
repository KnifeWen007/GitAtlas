import { useState } from 'react';
import type { GraphResponse } from '../api.ts';
import { formatDate } from '../format.ts';

const ROW_H = 26;
const LANE_W = 16;
const PAD_LEFT = 18;
const MAX_GUTTER = 520;

/** 泳道配色：黄金角 137.5° 撒色相，相邻泳道不会撞色 */
function laneColor(lane: number): string {
  return `hsl(${Math.round((lane * 137.5) % 360)} 72% 62%)`;
}

interface GraphViewProps {
  graph: GraphResponse;
  /** 点一行看这次提交改了哪些文件 */
  onSelect?: (commit: {
    sha: string;
    subject: string;
    authorName: string;
    authoredAt: string;
  }) => void;
  selectedSha?: string | null;
}

export function GraphView({ graph, onSelect, selectedSha }: GraphViewProps) {
  const { commits, laneCount, total, truncated } = graph;
  const [hover, setHover] = useState<string | null>(null);

  if (commits.length === 0) {
    return <div className="empty-desc">没有提交</div>;
  }

  // 泳道多时压缩间距，但保证最小 11px，否则弧线看不出走向
  const laneWidth = Math.min(LANE_W, Math.max(11, (MAX_GUTTER - PAD_LEFT - 12) / Math.max(laneCount, 1)));
  const gutter = Math.min(PAD_LEFT + laneCount * laneWidth + 12, MAX_GUTTER);
  const height = commits.length * ROW_H;

  const rowOf = new Map<string, number>();
  commits.forEach((commit, index) => rowOf.set(commit.sha, index));

  const x = (lane: number) => PAD_LEFT + lane * laneWidth + laneWidth / 2;
  const y = (row: number) => row * ROW_H + ROW_H / 2;

  const edges: { d: string; color: string; key: string }[] = [];

  commits.forEach((commit, row) => {
    const fromX = x(commit.lane);
    const fromY = y(row);

    commit.parents.forEach((parent, parentIndex) => {
      const parentRow = rowOf.get(parent);

      // 父提交不在本次返回范围：画一段向下的短线，表示"历史还在继续"
      if (parentRow === undefined) {
        if (row < commits.length - 1) {
          edges.push({
            d: `M ${fromX} ${fromY} L ${fromX} ${(row + 1) * ROW_H + ROW_H / 2}`,
            color: laneColor(commit.lane),
            key: `${commit.sha}-${parentIndex}`,
          });
        }
        return;
      }

      if (parentRow <= row) return; // 顺序异常，跳过，避免画出向上的逆线

      const toX = x(commits[parentRow]!.lane);
      const toY = y(parentRow);
      const midY = (fromY + toY) / 2;

      const d =
        commits[parentRow]!.lane === commit.lane
          ? `M ${fromX} ${fromY} L ${toX} ${toY}`
          : `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;

      edges.push({ d, color: laneColor(commit.lane), key: `${commit.sha}-${parentIndex}` });
    });
  });

  return (
    <div className="graph-view">
      <div className="graph-legend">
        <span>{commits.length} 个提交</span>
        <span>·</span>
        <span>{laneCount} 条泳道</span>
        {truncated ? (
          <>
            <span>·</span>
            <span>共 {total} 个，图中显示最近的一部分</span>
          </>
        ) : null}
      </div>

      <div className="graph-scroll">
        <div className="graph-canvas" style={{ height }}>
          <svg className="graph-svg" width={gutter} height={height} aria-hidden="true">
            {edges.map((edge) => (
              <path key={edge.key} d={edge.d} stroke={edge.color} strokeWidth={1.9} fill="none" opacity={0.7} />
            ))}

            {commits.map((commit, row) => {
              const cx = x(commit.lane);
              const cy = y(row);
              const color = laneColor(commit.lane);
              return commit.isMerge ? (
                <circle
                  key={commit.sha}
                  cx={cx}
                  cy={cy}
                  r={5.2}
                  fill="#0a0f18"
                  stroke={color}
                  strokeWidth={2.2}
                />
              ) : (
                <circle key={commit.sha} cx={cx} cy={cy} r={4} fill={color} />
              );
            })}
          </svg>

          <div className="graph-rows">
            {commits.map((commit) => (
              <div
                key={commit.sha}
                className={`graph-row${hover === commit.sha ? ' is-hover' : ''}${
                  selectedSha === commit.sha ? ' is-selected' : ''
                }`}
                style={{ height: ROW_H, paddingLeft: gutter }}
                onMouseEnter={() => setHover(commit.sha)}
                onMouseLeave={() => setHover(null)}
                onClick={() =>
                  onSelect?.({
                    sha: commit.sha,
                    subject: commit.subject,
                    authorName: commit.authorName,
                    authoredAt: commit.authoredAt,
                  })
                }
                title={`${commit.shortSha} · ${commit.authorName} · ${formatDate(commit.authoredAt)}\n${commit.subject}\n点击看这次改了哪些文件`}
              >
                <div className="graph-refs">
                  {commit.refs
                    .filter((ref) => ref.kind !== 'remote')
                    .slice(0, 3)
                    .map((ref) => (
                      <span
                        key={ref.name}
                        className={`gref ${ref.kind}${ref.isHead ? ' head' : ''}`}
                        title={`${ref.kind === 'tag' ? '标签' : '分支'} ${ref.name}`}
                      >
                        {ref.name}
                      </span>
                    ))}
                </div>

                <div className={`graph-subject${commit.isMerge ? ' is-merge' : ''}`}>{commit.subject}</div>

                <div className="graph-meta">
                  <code>{commit.shortSha}</code>
                  <span>{commit.authorName}</span>
                  <span>{formatDate(commit.authoredAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
