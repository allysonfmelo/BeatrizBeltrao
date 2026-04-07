interface KpiCardProps {
  label: string;
  value: string;
  previousValue?: number;
  currentValue?: number;
  suffix?: string;
}

function getTrend(current: number, previous: number) {
  if (previous === 0) return current > 0 ? { direction: "up" as const, pct: 100 } : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { direction: pct > 0 ? ("up" as const) : ("down" as const), pct: Math.abs(pct) };
}

export function KpiCard({
  label,
  value,
  previousValue,
  currentValue,
}: KpiCardProps) {
  const trend =
    previousValue !== undefined && currentValue !== undefined
      ? getTrend(currentValue, previousValue)
      : null;

  return (
    <div className="card kpi-card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {trend && (
        <span className={`kpi-trend kpi-trend-${trend.direction}`}>
          {trend.direction === "up" ? "\u2191" : "\u2193"} {trend.pct}%
        </span>
      )}
    </div>
  );
}
