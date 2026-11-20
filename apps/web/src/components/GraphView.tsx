import { useTranslation } from '../i18n.ts';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { BranchScope, GraphResponse } from '../api.ts';
import { parseConventional, typeHint } from '../commit-format.ts';
import { authorHue, authorInitial, formatDate, formatMonthDay } from '../format.ts';

const ROW_H = 26;
const LANE_W = 16;
const PAD_LEFT = 18;
const MAX_GUTTER = 520;
/** 引用列固定宽度：不管这行有没有分支标签，提交说明都从同一条竖线开始 */
const REFS_W = 176;

/**
 * 泳道配色：前十条用挑好的一组低饱和色（0 号泳道通常是当前分支，配主色），
 * 再多就按黄金角撒色相，并压低饱和度，避免整屏荧光色。
 */
const LANE_PALETTE = [
  'var(--lane-0)',
  'var(--lane-1)',
  'var(--lane-2)',
  'var(--lane-3)',
  'var(--lane-4)',
  'var(--lane-5)',
  'var(--lane-6)',
  'var(--lane-7)',
  'var(--lane-8)',
  'var(--lane-9)',
];

function laneColor(lane: number): string {
  if (lane < LANE_PALETTE.length) return LANE_PALETTE[lane]!;
  const hue = Math.round((lane * 137.5) % 360);
  return `hsl(${hue} 40% 55%)`;
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
  const { t } = useTranslation();
  const { commits, laneCount, total, truncated } = graph;
  const [hover, setHover] = useState<string | null>(null);
  /** 键盘光标：↑↓ 在提交之间走，Enter 打开，Esc 取消 */
  const [cursor, setCursor] = useState<number | null>(null);
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

  // 键盘移动时把光标行带进视野，和鼠标行为保持一致
  useEffect(() => {
    if (cursor === null) return;
    const container = scrollRef.current;
    if (!container) return;
    const top = container.scrollTop;
    const rowTop = cursor * ROW_H;
    const rowBottom = rowTop + ROW_H;
    if (rowTop < top) container.scrollTo({ top: Math.max(0, rowTop - 2 * ROW_H) });
    else if (rowBottom > top + container.clientHeight) {
      container.scrollTo({ top: rowBottom - container.clientHeight + 2 * ROW_H });
    }
  }, [cursor]);

  if (commits.length === 0) {
    return <div className="empty-desc">{t("没有提交")}</div>;
  }

  const open = (index: number) => {
    const commit = commits[index];
    if (!commit) return;
    onSelect?.({
      sha: commit.sha,
      subject: commit.subject,
      authorName: commit.authorName,
      authoredAt: commit.authoredAt,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((current) => {
        if (current === null) {
          // 从已选中的那行接着走，没有就从头
          const selected = commits.findIndex((commit) => commit.sha === selectedSha);
          return selected >= 0 ? selected : step > 0 ? 0 : commits.length - 1;
        }
        return Math.min(commits.length - 1, Math.max(0, current + step));
      });
      return;
    }
    if (event.key === 'Enter' && cursor !== null) {
      event.preventDefault();
      open(cursor);
      return;
    }
    if (event.key === 'Escape') setCursor(null);
  };

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
              {t("只看分支")} <b>{focusedShort}</b>
            </span>
            <span className="graph-focus-meta">
              {t("图中")} {mineCount} {t("个提交")}
              {focus && focus.ahead !== null ? t(" · 领先 {0} / 落后 {1}", focus.ahead, focus.behind) : ''}
            </span>
            <button className="btn btn-xs btn-ghost" onClick={() => onFocus?.(null)}>
              {t("回到总览")}
            </button>
          </>
        ) : (
          <>
            <span className="graph-focus-label">
              {t("你在")} <b>{currentShort ?? t("未知分支")}</b>
            </span>
            <span className="graph-focus-meta">
              {t("这条分支在图中")} {mineCount} {t("个提交，左侧亮线就是它")}
            </span>
            {currentBranch ? (
              <button className="btn btn-xs btn-ghost" onClick={() => onFocus?.(currentShort ?? currentBranch)}>
                {t("只看这条")}
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="graph-legend">
        <span>{commits.length} {t("个提交")}</span>
        <span>·</span>
        <span>{laneCount} {t("条泳道")}</span>
        {truncated ? (
          <>
            <span>·</span>
            <span>{t("共")} {total} {t("个，图中显示最近的一部分")}</span>
          </>
        ) : null}
        <span className="graph-legend-keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> {t("选行")} <kbd>Enter</kbd> {t("打开")}
        </span>
      </div>

      <div className="graph-frame">
        <div
          className="graph-scroll"
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setCursor(null)}
          aria-label={t("提交图谱，可用上下方向键选择提交")}
        >
          <div className="graph-canvas" style={{ height }}>
            <svg className="graph-svg" width={gutter} height={height} aria-hidden="true">
              {focusLane !== null ? (
                <rect
                  x={x(focusLane) - laneWidth / 2}
                  y={0}
                  width={laneWidth}
                  height={height}
                  rx={laneWidth / 2}
                  fill={focusMode ? 'rgb(var(--accent-rgb) / 0.13)' : 'rgb(var(--accent-rgb) / 0.07)'}
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
                    fill="var(--bg)"
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
              {commits.map((commit, row) => {
                const inScope = scopeSet?.has(commit.sha) ?? false;
                const isTip = Boolean(focusedShort) && commit.refs.some((ref) => ref.name === focusedShort);
                // 规范写法的提交：类型抽成角标，正文只留那半句人话
                const parsed = parseConventional(commit.subject);
                const named = commit.refs.filter((ref) => ref.kind !== 'remote');
                const shown = named.slice(0, 2);
                const rest = named.length - shown.length;
                return (
                  <div
                    key={commit.sha}
                    className={`graph-row${hover === commit.sha ? ' is-hover' : ''}${
                      selectedSha === commit.sha ? ' is-selected' : ''
                    }${cursor === row ? ' is-cursor' : ''}${
                      focusMode ? (inScope ? ' is-mine' : ' is-out') : inScope && scopeSet ? ' is-mine' : ''
                    }${isTip ? ' is-tip' : ''}`}
                    style={{ height: ROW_H, paddingLeft: gutter }}
                    onMouseEnter={() => setHover(commit.sha)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => open(row)}
                    title={t("{0} · {1} · {2}\n{3}\n点击看这次改了哪些文件", commit.shortSha, commit.authorName, formatDate(commit.authoredAt), commit.subject)}
                  >
                    <div className="graph-refs">
                      {shown.map((ref) => (
                        <button
                          key={ref.name}
                          className={`gref ${ref.kind}${ref.isHead ? ' head' : ''}`}
                          title={t("{0} {1}｜点一下只看这条分支", ref.kind === 'tag' ? t('标签') : t('分支'), ref.name)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (ref.kind === 'branch') onFocus?.(ref.name);
                          }}
                        >
                          {ref.name}
                        </button>
                      ))}
                      {rest > 0 ? (
                        <span className="gref-more" title={named.map((ref) => ref.name).join('\n')}>
                          +{rest}
                        </span>
                      ) : null}
                      {isTip ? <span className="graph-tip">{t("分支头")}</span> : null}
                    </div>

                    <div className={`graph-subject${commit.isMerge ? ' is-merge' : ''}`}>
                      {parsed ? (
                        <>
                          <span className={`ctype-chip ctype-${parsed.type}`} title={`${parsed.type} · ${t(typeHint(parsed.type))}`}>
                            {parsed.type}
                            {parsed.scope ? <em>({parsed.scope})</em> : null}
                            {parsed.breaking ? '!' : null}
                          </span>
                          {parsed.description}
                        </>
                      ) : (
                        commit.subject
                      )}
                    </div>

                    <div className="graph-meta">
                      <code>{commit.shortSha}</code>
                      <span className="avatar" style={{ ['--avatar-hue' as string]: authorHue(commit.authorName) }}>
                        {authorInitial(commit.authorName)}
                      </span>
                      <span className="graph-author" title={commit.authorName}>
                        {commit.authorName}
                      </span>
                      <span title={formatDate(commit.authoredAt)}>{formatMonthDay(commit.authoredAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
