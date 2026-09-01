import { cn } from "../../lib/format";

export function Card({ children, className }) {
  return (
    <div className={cn("rounded-xl border border-charcoal-3 bg-charcoal-2 p-4", className)}>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, sub }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-white-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p>
      {sub ? <p className="mt-1 text-xs text-white-faint">{sub}</p> : null}
    </Card>
  );
}
