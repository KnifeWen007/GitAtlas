interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'accent' | 'violet' | 'green' | 'amber' | 'red';
}

export function StatCard({ label, value, sub, tone }: StatCardProps) {
  return (
    <div className={`stat ${tone && tone !== 'accent' ? tone : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}
