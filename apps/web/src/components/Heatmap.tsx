import { useMemo, useState } from 'react';
import type { TimelineDay } from '../api.ts';
import { formatNumber } from '../format.ts';

const CELL = 11;
const GAP = 2.5;
const ROW_H = CELL + GAP;

/** 五级色阶：空 → 极少 → 少 → 多 → 很多（青色系，与主题一致） */
const LEVEL_COLORS = ['#1a2130', '#22304a', '#2f4a78', '#4a72b8', '#7aa2f7'];

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

    const monthMarks: Array<{ col: number; label: string }> = [];
    let lastMonth = -1;
    for (const cell of cells) {
      const date = new Date(`${cell.day.date}T00:00:00Z`);
      const month = date.getUTCMonth();
      if (month !== lastMonth) {
        monthMarks.push({ col: cell.col, label: `${month + 1}月` });
        lastMonth = month;
      }
    }
    // 太密的月份标签会重叠，只保留间隔 ≥ 4 周的
    const months = monthMarks.filter((mark, index) => {
      if (index === 0) return true;
      const prev = monthMarks[index - 1];
      return prev ? mark.col - prev.col >= 4 : true;
    });

    return { cells, weeks, months };
  }, [days]);

  if (!layout) return null;

  const width = layout.weeks * (CELL + GAP);
  const height = 7 * ROW_H;

  return (
    <div className="heatmap-wrap">
      <svg
        width={width}
        height={height + 16}
        viewBox={`0 0 ${width} ${height + 16}`}
        role="img"
        aria-label="提交活动热力图"
      >
        <g transform="translate(0, 14)">
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
              onMouseEnter={(event) =>
                setTip({ x: event.clientX, y: event.clientY, day: cell.day })
              }
              onMouseLeave={() => setTip(null)}
            >
              <title>{`${cell.day.date} · ${cell.day.commits} 个提交`}</title>
            </rect>
          ))}
          {layout.months.map((mark) => (
            <text
              key={`${mark.label}-${mark.col}`}
              className="heatmap-month"
              x={mark.col * (CELL + GAP)}
              y={-4}
            >
              {mark.label}
            </text>
          ))}
        </g>
      </svg>

      {tip && (
        <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 12 }}>
          <div>{tip.day.date}</div>
          <div className="muted">
            {tip.day.commits} 个提交
            {tip.day.merges > 0 ? ` · ${tip.day.merges} 次合并` : ''}
            {tip.day.commits > 0
              ? ` · +${formatNumber(tip.day.insertions)} −${formatNumber(tip.day.deletions)}`
              : ''}
          </div>
        </div>
      )}
    </div>
  );
}

export function HeatmapLegend() {
  return (
    <div className="heat-legend">
      <span>少</span>
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
      <span>多</span>
    </div>
  );
}
