import { formatInr } from "../../lib/format";
import { computePurchaseLine } from "../../lib/purchaseCalculations";

export function ManualLineCalcHint({ line }) {
  const qty = Number(line.quantity) || 0;
  const cost = Number(line.unit_cost) || 0;
  if (!qty || !cost) return null;

  const expected = computePurchaseLine({
    qty,
    unit_cost: cost,
    discPercent: line.disc_percent,
    mrp: line.mrp,
    gstPercent: line.gst_percent,
    calcMode: "simple",
  });

  const enteredTaxable = Number(line.taxable);
  const taxableDiff =
    enteredTaxable > 0
      ? Math.abs(enteredTaxable - expected.taxable)
      : 0;

  return (
    <div className="col-span-full rounded-md bg-charcoal-3/80 px-3 py-2 text-xs text-white-muted">
      <span className="text-white-faint">Expected: </span>
      taxable {formatInr(expected.taxable)}
      <span className="text-white-faint"> · </span>
      CGST {formatInr(expected.cgstAmount)}
      <span className="text-white-faint"> · </span>
      SGST {formatInr(expected.sgstAmount)}
      <span className="text-white-faint"> · </span>
      total {formatInr(expected.lineTotal)}
      {enteredTaxable > 0 && taxableDiff > 1 ? (
        <span className="ml-2 text-warning">
          (entered taxable {formatInr(enteredTaxable)} differs)
        </span>
      ) : null}
    </div>
  );
}
