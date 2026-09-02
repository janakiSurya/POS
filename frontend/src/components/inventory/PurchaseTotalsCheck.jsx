import { formatInr } from "../../lib/format";
import { compareInvoiceCalculation } from "../../lib/purchaseCalculations";

function VarianceCell({ printed, computed, variance, tolerance }) {
  if (!printed && printed !== 0) return <span className="text-silver">—</span>;
  const abs = Math.abs(variance);
  const match = abs <= tolerance;
  return (
    <span
      className={
        match
          ? "text-success"
          : abs <= tolerance * 3
            ? "text-warning"
            : "text-danger"
      }
    >
      {formatInr(variance)}
    </span>
  );
}

export function PurchaseTotalsCheck({ data, title = "Printed vs calculated" }) {
  const check = data instanceof Object && data.ok !== undefined ? data : compareInvoiceCalculation(data);

  if (!check.hasPrintedTotals && check.computed.grandTotal <= 0) return null;

  const rows = [
    {
      label: "Taxable",
      printed: check.printed.taxable,
      computed: check.computed.taxable,
      variance: check.variance.taxable,
    },
    {
      label: "CGST",
      printed: check.printed.cgst,
      computed: check.computed.cgst,
      variance: check.variance.cgst,
    },
    {
      label: "SGST",
      printed: check.printed.sgst,
      computed: check.computed.sgst,
      variance: check.variance.sgst,
    },
    {
      label: "Grand total",
      printed: check.printed.grandTotal,
      computed: check.computed.grandTotal,
      variance: check.variance.grandTotal,
    },
  ];

  return (
    <div className="rounded-lg border border-ash p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">{title}</p>
        {check.hasPrintedTotals ? (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
              check.ok
                ? "bg-success/20 text-success"
                : "bg-warning/20 text-warning"
            }`}
          >
            {check.ok ? "Match" : "Variance"}
          </span>
        ) : (
          <span className="text-[10px] uppercase text-silver">
            Expected (no printed totals entered)
          </span>
        )}
        <span className="text-[10px] text-silver">
          Tolerance ±{formatInr(check.tolerance)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-xs">
          <thead className="text-fog">
            <tr>
              <th className="py-1 pr-2" />
              <th className="py-1 pr-2 text-right">Printed / entered</th>
              <th className="py-1 pr-2 text-right">Calculated</th>
              <th className="py-1 text-right">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-ash/60">
                <td className="py-1.5 pr-2 text-fog">{row.label}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-ink">
                  {row.printed > 0 ? formatInr(row.printed) : "—"}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-ink">
                  {formatInr(row.computed)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  <VarianceCell
                    printed={row.printed}
                    computed={row.computed}
                    variance={row.variance}
                    tolerance={check.tolerance}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {check.mismatchLines?.length > 0 ? (
        <div className="rounded-md bg-warning/10 p-2 text-xs text-warning">
          <p className="font-medium">
            {check.mismatchLines.length} line(s) differ from expected formula
          </p>
          <ul className="mt-1 space-y-0.5 text-fog">
            {check.mismatchLines.slice(0, 5).map((l) => (
              <li key={l.lineNo}>
                <span className="font-mono text-ink">{l.code}</span>
                — taxable diff {formatInr(l.variances.taxable)}, total diff{" "}
                {formatInr(l.variances.lineTotal)}
              </li>
            ))}
            {check.mismatchLines.length > 5 ? (
              <li>…and {check.mismatchLines.length - 5} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {!check.ok && check.hasPrintedTotals ? (
        <p className="text-xs text-fog">
          Small differences are normal from per-line rounding on supplier invoices.
          Lines sum taxable {formatInr(check.summedFromLines.taxable)} vs formula{" "}
          {formatInr(check.computed.taxable)}.
        </p>
      ) : null}
    </div>
  );
}
