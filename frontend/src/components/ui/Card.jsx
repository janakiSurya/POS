import { cn } from "../../lib/format";

export function Card({ children, className }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-ash bg-canvas p-3 sm:p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function KpiCard({ label, value, sub }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-fog">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-ink sm:text-2xl">{value}</p>
      {sub ? <p className="mt-1 text-xs text-silver">{sub}</p> : null}
    </Card>
  );
}
