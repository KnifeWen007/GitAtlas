import { useTranslation } from '../i18n.ts';
import { useMemo, useState } from 'react';
import type { TimelineDay } from '../api.ts';
import { formatNumber, longestStreak } from '../format.ts';

const CELL = 11;
const GAP = 2.5;
const ROW_H = CELL + GAP;
/** 左侧星期标签占的宽度 */
const LABEL_W = 26;
const monthFormatter = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const monthNames = Array.from({ length: 12 }, (_, index) => monthFormatter.format(new Date(Date.UTC(2020, index))));

/** 五级色阶：空 → 极少 → 少 → 多 → 很多（青色系，与主题一致） */
const LEVEL_COLORS = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'];

/** 只在周一、三、五标字，七行全标会挤成一片 */
const WEEKDAY_LABELS: Array<{ row: number; text: string }> = [
  { row: 0, text: '一' },
  { row: 2, text: '三' },
  { row: 4, text: '五' },
];

function levelOf(commits: number): number {
  if (commits <= 0) return 0;
  if (commits === 1) return 1;
  if (commits <= 3) return 2;
  if (commits <= 6) return 3;
  return 4;
}

interface Cell {
  day: TimelineDay;
  col: number;
  row: number;
}

export function Heatmap({ days }: { days: TimelineDay[] }) {
  const { t, language } = useTranslation();
  const [tip, setTip] = useState<{ x: number; y: number; day: TimelineDay } | null>(null);

  const layout = useMemo(() => {
    const first = days[0];
    if (!first) return null;

    const start = new Date(`${first.date}T00:00:00Z`);
    // 周一为第 0 行，符合中文阅读习惯
    const offset = (start.getUTCDay() + 6) % 7;
    const cells: Cell[] = days.map((day, index) => {
      const slot = index + offset;
      return { day, col: Math.floor(slot / 7), row: slot % 7 };
    });

    const weeks = Math.ceil((offset + days.length) / 7);

    const monthMarks: Array<{ col: number; month: number }> = [];
    let lastMonth = -1;
    for (const cell of cells) {
      const date = new Date(`${cell.day.date}T00:00:00Z`);
      const month = date.getUTCMonth();
      if (month !== lastMonth) {
        monthMarks.push({ col: cell.col, month });
        lastMonth = month;
      }
    }
    // 太密的月份标签会重叠，只保留间隔 ≥ 4 周的
    const months = monthMarks.filter((mark, index) => {
      if (index === 0) return true;
      const prev = monthMarks[index - 1];
      return prev ? mark.col - prev.col >= 4 : true;
    });

    const commits = days.reduce((sum, day) => sum + day.commits, 0);
    const activeDays = days.filter((day) => day.commits > 0).length;
    return { cells, weeks, months, commits, activeDays, streak: longestStreak(days) };
  }, [days]);

  if (!layout) return null;

  const gridWidth = layout.weeks * (CELL + GAP) - GAP;
  const width = LABEL_W + gridWidth;
  const height = 7 * ROW_H;

  // 提示浮层贴着光标，但别越过窗口右边缘
  const tipStyle = tip
    ? {
        left: Math.min(tip.x + 14, window.innerWidth - 210),
        top: Math.min(tip.y + 12, window.innerHeight - 64),
      }
    : undefined;

  return (
    <div className="heatmap-block">
      <div className="heatmap-wrap">
        <svg width={width} height={height + 16} viewBox={`0 0 ${width} ${height + 16}`} role="img" aria-label={t("提交活动热力图")}>
          <g transform={`translate(${LABEL_W}, 14)`}>
            {layout.cells.map((cell) => (
              <rect
                key={cell.day.date}
                className="heat-cell"
                x={cell.col * (CELL + GAP)}
                y={cell.row * ROW_H}
                width={CELL}
                height={CELL}
                rx={2.5}
                fill={LEVEL_COLORS[levelOf(cell.day.commits)]}
                onMouseEnter={(event) => setTip({ x: event.clientX, y: event.clientY, day: cell.day })}
                onMouseLeave={() => setTip(null)}
              >
                <title>{t("{0} · {1} 个提交", cell.day.date, cell.day.commits)}</title>
              </rect>
            ))}
            {layout.months.map((mark) => (
              <text key={mark.col} className="heatmap-month" x={mark.col * (CELL + GAP)} y={-4}>
                {language === 'en' ? monthNames[mark.month] : t("{0}月", mark.month + 1)}
              </text>
            ))}
          </g>
          {WEEKDAY_LABELS.map((label) => (
            <text
              key={t(label.text)}
              className="heatmap-weekday"
              x={0}
              y={14 + label.row * ROW_H + CELL - 2.5}
            >
              {t(label.text)}
            </text>
          ))}
        </svg>

        {tip ? (
          <div className="tooltip" style={tipStyle}>
            <div>{tip.day.date}</div>
            <div className="muted">
              {tip.day.commits} {t("个提交")}
              {tip.day.merges > 0 ? t(" · {0} 次合并", tip.day.merges) : ''}
              {tip.day.commits > 0
                ? ` · +${formatNumber(tip.day.insertions)} −${formatNumber(tip.day.deletions)}`
                : ''}
            </div>
          </div>
        ) : null}
      </div>

      <div className="heat-foot">
        <span>
          {t("区间内")} <b>{formatNumber(layout.commits)}</b> {t("个提交")}
        </span>
        <span className="heat-dot" aria-hidden="true" />
        <span>
          <b>{layout.activeDays}</b> {t("天有提交")}
        </span>
        <span className="heat-dot" aria-hidden="true" />
        <span>
          {t("最长连续")} <b>{layout.streak}</b> {t("天")}
        </span>
      </div>
    </div>
  );
}

export function HeatmapLegend() {
  const { t } = useTranslation();
  return (
    <div className="heat-legend">
      <span>{t("少")}</span>
      {LEVEL_COLORS.map((color) => (
        <span
          key={color}
          style={{
            width: 10,
            height: 10,
            borderRadius: 2.5,
            background: color,
            display: 'inline-block',
          }}
        />
      ))}
      <span>{t("多")}</span>
    </div>
  );
}
