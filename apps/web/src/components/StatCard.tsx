import type { CSSProperties } from 'react';

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'accent' | 'violet' | 'green' | 'amber' | 'red';
  /** 最近若干周的提交数，画成一根小火花线；没有就不画 */
  spark?: number[];
  /** 增删比例条：一眼看出这次是"加代码"还是"删代码" */
  ratio?: { up: number; down: number };
}

/** 12 根小柱子的火花线，纯装饰，不带交互 */
function Spark({ values, color }: { values: number[]; color: string }) {
  const peak = Math.max(...values, 1);
  const width = 54;
  const height = 16;
  const gap = 2;
  const barWidth = Math.max(1.5, (width - gap * (values.length - 1)) / values.length);

  return (
    <svg className="stat-spark" width={width} height={height} aria-hidden="true">
      {values.map((value, index) => {
        const barHeight = value === 0 ? 1.5 : Math.max(2.5, (value / peak) * height);
        return (
          <rect
            key={index}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={1}
            fill={color}
            opacity={value === 0 ? 0.22 : 0.35 + (value / peak) * 0.55}
          />
        );
      })}
    </svg>
  );
}

/** 增删比例：绿色占比就是新增行所占的份量 */
function Ratio({ up, down }: { up: number; down: number }) {
  const total = up + down;
  const share = total === 0 ? 0 : Math.round((up / total) * 100);
  const style = { '--ratio-up': `${share}%` } as CSSProperties;
  return (
    <span className="stat-ratio" style={style} title={`新增 ${up.toLocaleString('zh-CN')} 行 · 删除 ${down.toLocaleString('zh-CN')} 行`}>
      <span className="stat-ratio-bar" />
      <span className="stat-ratio-text">{total === 0 ? '—' : `${share}%`}</span>
    </span>
  );
}

const TONE_COLOR: Record<string, string> = {
  accent: 'var(--accent)',
  violet: 'var(--violet)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
};

export function StatCard({ label, value, sub, tone = 'accent', spark, ratio }: StatCardProps) {
  const color = TONE_COLOR[tone] ?? 'var(--accent)';
  return (
    <div className={`stat ${tone !== 'accent' ? tone : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        {sub ? <span className="stat-sub">{sub}</span> : <span />}
        {ratio ? <Ratio up={ratio.up} down={ratio.down} /> : null}
        {spark ? <Spark values={spark} color={color} /> : null}
      </div>
    </div>
  );
}
