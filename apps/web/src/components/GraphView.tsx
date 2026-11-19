import { useEffect, useMemo, useRef, useState } from 'react';
import type { BranchScope, GraphResponse } from '../api.ts';
import { formatDate } from '../format.ts';

const ROW_H = 26;
const LANE_W = 16;
const PAD_LEFT = 18;
const MAX_GUTTER = 520;

/** 泳道配色：黄金角 137.5° 撒色相，相邻泳道不会撞色 */
function laneColor(lane: number): string {
  return `hsl(${Math.round((lane * 137.5) % 360)} 72% 62%)`;
}

/** 引用名可能带 refs/heads/ 前缀，图上标签用的是短名，比较前先统一 */
function shortRef(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes)\//, '');
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
  /** 范围内能到达的提交；null 表示还没算出来 */
  focus?: BranchScope | null;
  /** 用户明确选中的分支，null 表示总览 */
  focused?: string | null;
  /** 当前所在分支（HEAD），总览时用它标注"你在哪" */
  currentBranch?: string | null;
  onFocus?: (ref: string | null) => void;
}

export function GraphView({
  graph,
  onSelect,
  selectedSha,
  focus,
  focused,
  currentBranch,
  onFocus,
}: GraphViewProps) {
  const { commits, laneCount, total, truncated } = graph;
  const [hover, setHover] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scopeSet = useMemo(() => (focus ? new Set(focus.shas) : null), [focus]);
  const focusMode = Boolean(focused) && scopeSet !== null;
  const focusedShort = focused ? shortRef(focused) : null;
  const currentShort = currentBranch ? shortRef(currentBranch) : null;

  // 分支头所在行：聚焦后滚到这里，省得自己在几百行里找
  const tipRow = useMemo(() => {
    if (!focusedShort) return -1;
    return commits.findIndex((commit) => commit.refs.some((ref) => ref.name === focusedShort));
  }, [commits, focusedShort]);

  useEffect(() => {
    if (!focused || tipRow < 0) return;
    const container = scrollRef.current;
    if (!container) return;
    // 留两行上下文，让人看得到分支头上面接的是什么
    const top = Math.max(0, (tipRow - 2) * ROW_H);
    container.scrollTo({ top, behavior: 'smooth' });
  }, [focused, tipRow]);

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

  const edges: { d: string; color: string; key: string; inScope: boolean }[] = [];

  commits.forEach((commit, row) => {
    const fromX = x(commit.lane);
    const fromY = y(row);
    const fromInScope = scopeSet?.has(commit.sha) ?? false;

    commit.parents.forEach((parent, parentIndex) => {
      const parentRow = rowOf.get(parent);
      const inScope = fromInScope && (parentRow === undefined ? true : (scopeSet?.has(parent) ?? false));

      // 父提交不在本次返回范围：画一段向下的短线，表示"历史还在继续"
      if (parentRow === undefined) {
        if (row < commits.length - 1) {
          edges.push({
            d: `M ${fromX} ${fromY} L ${fromX} ${(row + 1) * ROW_H + ROW_H / 2}`,
            color: laneColor(commit.lane),
            key: `${commit.sha}-${parentIndex}`,
            inScope,
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

      edges.push({ d, color: laneColor(commit.lane), key: `${commit.sha}-${parentIndex}`, inScope });
    });
  });

  const mineCount = scopeSet ? commits.filter((commit) => scopeSet.has(commit.sha)).length : 0;
  /** 聚焦分支所在泳道：整列铺一条淡色带，一眼看出"我的线"在哪 */
  const focusLane = tipRow >= 0 ? commits[tipRow]!.lane : null;

  return (
    <div className="graph-view">
      <div className={`graph-focus-bar${focusMode ? ' is-focus' : ''}`}>
        {focusMode ? (
          <>
            <span className="graph-focus-label">
              只看分支 <b>{focusedShort}</b>
            </span>
            <span className="graph-focus-meta">
              图中 {mineCount} 个提交
              {focus && focus.ahead !== null ? ` · 领先 ${focus.ahead} / 落后 ${focus.behind}` : ''}
            </span>
            <button className="btn btn-xs btn-ghost" onClick={() => onFocus?.(null)}>
              回到总览
            </button>
          </>
        ) : (
          <>
            <span className="graph-focus-label">
              你在 <b>{currentShort ?? '未知分支'}</b>
            </span>
            <span className="graph-focus-meta">
              这条分支在图中 {mineCount} 个提交，左侧亮线就是它
            </span>
            {currentBranch ? (
              <button className="btn btn-xs btn-ghost" onClick={() => onFocus?.(currentShort ?? currentBranch)}>
                只看这条
              </button>
            ) : null}
          </>
        )}
      </div>

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

      <div className="graph-scroll" ref={scrollRef}>
        <div className="graph-canvas" style={{ height }}>
          <svg className="graph-svg" width={gutter} height={height} aria-hidden="true">
            {focusLane !== null ? (
              <rect
                x={x(focusLane) - laneWidth / 2}
                y={0}
                width={laneWidth}
                height={height}
                rx={laneWidth / 2}
                fill={focusMode ? 'rgba(34, 211, 238, 0.12)' : 'rgba(34, 211, 238, 0.06)'}
              />
            ) : null}

            {edges.map((edge) => (
              <path
                key={edge.key}
                d={edge.d}
                stroke={edge.color}
                strokeWidth={focusMode && edge.inScope ? 2.4 : 1.9}
                fill="none"
                opacity={focusMode ? (edge.inScope ? 0.95 : 0.12) : 0.7}
              />
            ))}

            {commits.map((commit, row) => {
              const cx = x(commit.lane);
              const cy = y(row);
              const color = laneColor(commit.lane);
              const inScope = scopeSet?.has(commit.sha) ?? false;
              const opacity = focusMode ? (inScope ? 1 : 0.18) : 1;
              const radius = commit.isMerge ? 5.2 : inScope && scopeSet ? 4.6 : 4;
              return commit.isMerge ? (
                <circle
                  key={commit.sha}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="#0a0f18"
                  stroke={color}
                  strokeWidth={2.2}
                  opacity={opacity}
                />
              ) : (
                <circle key={commit.sha} cx={cx} cy={cy} r={radius} fill={color} opacity={opacity} />
              );
            })}
          </svg>

          <div className="graph-rows">
            {commits.map((commit) => {
              const inScope = scopeSet?.has(commit.sha) ?? false;
              const isTip = Boolean(focusedShort) && commit.refs.some((ref) => ref.name === focusedShort);
              return (
                <div
                  key={commit.sha}
                  className={`graph-row${hover === commit.sha ? ' is-hover' : ''}${
                    selectedSha === commit.sha ? ' is-selected' : ''
                  }${focusMode ? (inScope ? ' is-mine' : ' is-out') : inScope && scopeSet ? ' is-mine' : ''}${
                    isTip ? ' is-tip' : ''
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
                        <button
                          key={ref.name}
                          className={`gref ${ref.kind}${ref.isHead ? ' head' : ''}`}
                          title={`${ref.kind === 'tag' ? '标签' : '分支'} ${ref.name}｜点一下只看这条分支`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (ref.kind === 'branch') onFocus?.(ref.name);
                          }}
                        >
                          {ref.name}
                        </button>
                      ))}
                    {isTip ? <span className="graph-tip">分支头</span> : null}
                  </div>

                  <div className={`graph-subject${commit.isMerge ? ' is-merge' : ''}`}>{commit.subject}</div>

                  <div className="graph-meta">
                    <code>{commit.shortSha}</code>
                    <span>{commit.authorName}</span>
                    <span>{formatDate(commit.authoredAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
