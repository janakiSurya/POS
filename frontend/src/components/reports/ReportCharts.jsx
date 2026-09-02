import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatInr, toNum } from "../../lib/format";

const CHART_GRID = "#e5e5e5";
const CHART_TICK = "#737373";

const CHART_COLORS = {
  current: "#16a34a",
  previous: "#a3a3a3",
  cash: "#2563eb",
  upi: "#7c3aed",
  credit: "#ea580c",
  expense: "#ea580c",
  net: "#16a34a",
};

function ChartTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  const fmt = valueFormatter || ((v) => formatInr(v));
  return (
    <div className="rounded-lg border border-ash bg-canvas px-3 py-2 text-sm shadow-lg">
      <p className="font-medium text-ink">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-fog tabular-nums">
          <span style={{ color: entry.color }}>{entry.name}: </span>
          {fmt(entry.value, entry.name)}
        </p>
      ))}
    </div>
  );
}

function formatShortInr(value) {
  const n = toNum(value);
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return formatInr(n);
}

export function DailyBarChart({ data, dataKey, label, color = CHART_COLORS.current }) {
  if (!data.length) {
    return (
      <p className="py-12 text-center text-sm text-silver">No data for this range</p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={window.innerWidth < 640 ? 180 : 220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: CHART_TICK, fontSize: 11 }}
          axisLine={{ stroke: CHART_GRID }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: CHART_TICK, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatShortInr}
          width={52}
        />
        <Tooltip
          content={
            <ChartTooltip valueFormatter={(v) => formatInr(v)} />
          }
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
        />
        <Bar dataKey={dataKey} name={label} fill={color} radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PaymentMixChart({ cash, upi, credit }) {
  const total = cash + upi + credit;
  const data = [
    { name: "Cash", value: cash, color: CHART_COLORS.cash },
    { name: "UPI", value: upi, color: CHART_COLORS.upi },
    { name: "Credit", value: credit, color: CHART_COLORS.credit },
  ].filter((d) => d.value > 0);

  if (!total || !data.length) {
    return (
      <p className="py-8 text-center text-sm text-silver">No payments in range</p>
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart layout="vertical" data={data} margin={{ left: 4, right: 16 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={56}
            tick={{ fill: CHART_TICK, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={
              <ChartTooltip
                valueFormatter={(v) => `${formatInr(v)} (${Math.round((v / total) * 100)}%)`}
              />
            }
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 text-xs">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-fog">{d.name}</span>
            <span className="font-medium tabular-nums text-ink">
              {formatInr(d.value)}
            </span>
            <span className="text-silver">
              ({Math.round((d.value / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PeriodCompareChart({
  currentLabel,
  previousLabel,
  currentAmount,
  previousAmount,
  currentCount,
  previousCount,
  amountChange,
  invertColors = false,
}) {
  const data = [
    {
      period: currentLabel,
      amount: currentAmount,
      bills: currentCount,
    },
    {
      period: previousLabel,
      amount: previousAmount,
      bills: previousCount,
    },
  ];

  const up = amountChange > 0;
  const changeClass = invertColors
    ? up
      ? "text-danger"
      : "text-success"
    : up
      ? "text-success"
      : amountChange < 0
        ? "text-danger"
        : "text-fog";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-bold tabular-nums text-ink">
            {formatInr(currentAmount)}
          </p>
          <p className="text-xs text-fog">
            {currentCount} bills · prev {formatInr(previousAmount)}
          </p>
        </div>
        <p className={`text-sm font-semibold tabular-nums ${changeClass}`}>
          {amountChange > 0 ? "+" : ""}
          {Math.round(amountChange * 10) / 10}% vs {previousLabel.toLowerCase()}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fill: CHART_TICK, fontSize: 11 }}
            axisLine={{ stroke: "#3a3a3e" }}
            tickLine={false}
          />
          <YAxis
            yAxisId="amount"
            tick={{ fill: CHART_TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatShortInr}
            width={52}
          />
          <YAxis
            yAxisId="bills"
            orientation="right"
            tick={{ fill: CHART_TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            content={
              <ChartTooltip
                valueFormatter={(v, name) =>
                  name === "Bills" ? String(v) : formatInr(v)
                }
              />
            }
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: CHART_TICK }}
            iconType="circle"
            iconSize={8}
          />
          <Bar
            yAxisId="amount"
            dataKey="amount"
            name="Sales"
            fill={CHART_COLORS.current}
            radius={[6, 6, 0, 0]}
            maxBarSize={56}
          />
          <Bar
            yAxisId="bills"
            dataKey="bills"
            name="Bills"
            fill={CHART_COLORS.previous}
            radius={[6, 6, 0, 0]}
            maxBarSize={56}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExpenseCompareChart({
  currentLabel,
  previousLabel,
  currentTotal,
  previousTotal,
  currentCount,
  previousCount,
  totalChange,
}) {
  const data = [
    { period: currentLabel, total: currentTotal, entries: currentCount },
    { period: previousLabel, total: previousTotal, entries: previousCount },
  ];

  const up = totalChange > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-bold tabular-nums text-warning">
            {formatInr(currentTotal)}
          </p>
          <p className="text-xs text-fog">
            {currentCount} entries · prev {formatInr(previousTotal)}
          </p>
        </div>
        <p
          className={`text-sm font-semibold tabular-nums ${
            up ? "text-danger" : totalChange < 0 ? "text-success" : "text-fog"
          }`}
        >
          {totalChange > 0 ? "+" : ""}
          {Math.round(totalChange * 10) / 10}% vs {previousLabel.toLowerCase()}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fill: CHART_TICK, fontSize: 11 }}
            axisLine={{ stroke: "#3a3a3e" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART_TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatShortInr}
            width={52}
          />
          <Tooltip
            content={<ChartTooltip valueFormatter={(v) => formatInr(v)} />}
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
          />
          <Bar
            dataKey="total"
            name="Expenses"
            fill={CHART_COLORS.expense}
            radius={[6, 6, 0, 0]}
            maxBarSize={64}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NetCompareChart({ thisMonth, prevMonth, thisLabel, prevLabel }) {
  const data = [
    { period: thisLabel, net: thisMonth },
    { period: prevLabel, net: prevMonth },
  ];
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: CHART_TICK, fontSize: 11 }}
          axisLine={{ stroke: "#3a3a3e" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: CHART_TICK, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatShortInr}
          width={52}
        />
        <Tooltip
          content={<ChartTooltip valueFormatter={(v) => formatInr(v)} />}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
        />
        <Bar dataKey="net" name="Net (sales − expenses)" radius={[6, 6, 0, 0]} maxBarSize={72}>
          {data.map((entry) => (
            <Cell
              key={entry.period}
              fill={entry.net >= 0 ? CHART_COLORS.net : "#ef4444"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
