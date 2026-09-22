import { useMemo, useState } from "react";
import { createLocalPurchase } from "../../lib/purchases";
import { businessDateIST } from "../../lib/businessDay";
import { formatInr, toNum } from "../../lib/format";
import { FreshKeys, invalidateFresh } from "../../lib/freshSync";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Card } from "../ui/Card";
import { SupplierSelect } from "./SupplierSelect";

function emptyLine() {
  return {
    itemName: "",
    partNumber: "",
    quantity: "1",
    costPerUnit: "",
    sellingPrice: "",
  };
}

/**
 * Local / unregistered supplier buy — kept in books, excluded from GST reports.
 * Supports multiple items on one invoice.
 */
export function LocalBuyForm({ profile, onSaved }) {
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [invoiceDate, setInvoiceDate] = useState(businessDateIST());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalSell = 0;
    for (const l of lines) {
      const qty = Math.round(toNum(l.quantity));
      const cost = toNum(l.costPerUnit);
      const sell = toNum(l.sellingPrice);
      if (qty > 0 && cost >= 0) totalCost += qty * cost;
      if (qty > 0 && sell > 0) totalSell += qty * sell;
    }
    return {
      totalCost: Math.round((totalCost + Number.EPSILON) * 100) / 100,
      totalSell: Math.round((totalSell + Number.EPSILON) * 100) / 100,
    };
  }, [lines]);

  async function submit(e) {
    e.preventDefault();
    if (!profile?.id) {
      setError("Not signed in.");
      return;
    }
    const filled = lines.filter((l) => String(l.itemName || "").trim());
    if (!filled.length) {
      setError("Add at least one item.");
      return;
    }
    setPending(true);
    setError("");
    setLastSaved(null);
    try {
      const result = await createLocalPurchase({
        supplierId,
        lines: filled.map((l) => ({
          itemName: l.itemName,
          partNumber: l.partNumber,
          quantity: Math.round(toNum(l.quantity)),
          costPerUnit: toNum(l.costPerUnit),
          sellingPrice: toNum(l.sellingPrice),
        })),
        invoiceDate,
        invoiceNumber,
        notes,
        createdBy: profile.id,
      });
      await invalidateFresh(
        FreshKeys.PURCHASES,
        FreshKeys.PRODUCTS,
        FreshKeys.DASHBOARD,
      );
      setLastSaved(result);
      setLines([emptyLine()]);
      setInvoiceNumber("");
      setNotes("");
      onSaved?.();
    } catch (err) {
      setError(err.message || "Could not save local buy.");
    } finally {
      setPending(false);
    }
  }

  const savedNames =
    lastSaved?.products?.map((p) => p?.name).filter(Boolean).join(", ") ||
    lastSaved?.product?.name ||
    "";

  return (
    <Card>
      <h2 className="text-base font-semibold text-ink">Local buy (no GST)</h2>
      <p className="mt-1 text-sm text-fog">
        For local suppliers without a GST bill. Saved in your records (stock,
        cost, supplier due, sales) —{" "}
        <span className="font-medium text-ink">excluded from GST reports</span>.
        Add multiple items on one bill with Add line.
      </p>

      {error ? (
        <p className="mt-3 text-sm text-danger">{error}</p>
      ) : null}
      {lastSaved ? (
        <p className="mt-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-ink">
          Saved {lastSaved.lineCount || 1} item
          {(lastSaved.lineCount || 1) === 1 ? "" : "s"}
          {savedNames ? ` (${savedNames})` : ""} · cost{" "}
          {formatInr(lastSaved.total)} due on supplier. Sell at POS. Pay from
          Supplier balances when ready.
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <Label>Supplier</Label>
          <div className="mt-1">
            <SupplierSelect value={supplierId} onChange={setSupplierId} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Ref / bill no. (optional)</Label>
            <Input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Auto if blank"
            />
          </div>
        </div>

        {lines.map((l, idx) => (
          <div
            key={idx}
            className="space-y-2 rounded-lg border border-ash bg-canvas/50 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-fog">
                Item {idx + 1}
              </p>
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  className="text-xs text-danger hover:underline"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <div>
              <Label className="text-xs">Item name</Label>
              <Input
                value={l.itemName}
                onChange={(e) => updateLine(idx, { itemName: e.target.value })}
                placeholder="e.g. MRF tires"
                required={idx === 0}
              />
            </div>
            <div>
              <Label className="text-xs">Part code (optional)</Label>
              <Input
                value={l.partNumber}
                onChange={(e) => updateLine(idx, { partNumber: e.target.value })}
                placeholder="Auto LOCAL-… if blank"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={l.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  required={Boolean(String(l.itemName || "").trim())}
                />
              </div>
              <div>
                <Label className="text-xs">Cost / piece (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.costPerUnit}
                  onChange={(e) =>
                    updateLine(idx, { costPerUnit: e.target.value })
                  }
                  placeholder="200"
                  required={Boolean(String(l.itemName || "").trim())}
                />
              </div>
              <div>
                <Label className="text-xs">Selling / piece (₹)</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={l.sellingPrice}
                  onChange={(e) =>
                    updateLine(idx, { sellingPrice: e.target.value })
                  }
                  placeholder="300"
                  required={Boolean(String(l.itemName || "").trim())}
                />
              </div>
            </div>
            {(() => {
              const qty = Math.round(toNum(l.quantity));
              const cost = toNum(l.costPerUnit);
              const lineCost =
                qty > 0 && cost >= 0
                  ? Math.round((qty * cost + Number.EPSILON) * 100) / 100
                  : 0;
              return lineCost > 0 ? (
                <p className="text-xs text-fog">
                  Line total:{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {formatInr(lineCost)}
                  </span>
                </p>
              ) : null;
            })()}
          </div>
        ))}

        <Button
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={addLine}
        >
          Add line
        </Button>

        <div>
          <Label>Note</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="rounded-lg border border-ash bg-canvas px-3 py-2 text-sm text-fog">
          <p>
            Total cost (supplier due):{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatInr(totals.totalCost)}
            </span>
            {lines.filter((l) => String(l.itemName || "").trim()).length > 1
              ? ` · ${lines.filter((l) => String(l.itemName || "").trim()).length} items`
              : ""}
          </p>
          <p className="mt-0.5">
            If all sold at sell price:{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatInr(totals.totalSell)}
            </span>
            {totals.totalCost > 0 && totals.totalSell > 0 ? (
              <>
                {" "}
                · rough margin{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {formatInr(totals.totalSell - totals.totalCost)}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <Button
          type="submit"
          disabled={pending || !supplierId}
          className="w-full sm:w-auto"
        >
          {pending ? "Saving…" : "Save local buy"}
        </Button>
      </form>
    </Card>
  );
}
