import { useMemo, useState } from "react";
import { createLocalPurchase } from "../../lib/purchases";
import { businessDateIST } from "../../lib/businessDay";
import { formatInr, toNum } from "../../lib/format";
import { FreshKeys, invalidateFresh } from "../../lib/freshSync";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Card } from "../ui/Card";
import { SupplierSelect } from "./SupplierSelect";

/**
 * Local / unregistered supplier buy — kept in books, excluded from GST reports.
 * Example: Suresh · 10 MRF tires · cost ₹200 · sell ₹300.
 */
export function LocalBuyForm({ profile, onSaved }) {
  const [supplierId, setSupplierId] = useState("");
  const [itemName, setItemName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(businessDateIST());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  const qty = Math.round(toNum(quantity));
  const cost = toNum(costPerUnit);
  const sell = toNum(sellingPrice);
  const totalCost = useMemo(() => {
    if (qty <= 0 || cost < 0) return 0;
    return Math.round((qty * cost + Number.EPSILON) * 100) / 100;
  }, [qty, cost]);
  const totalSell = useMemo(() => {
    if (qty <= 0 || sell <= 0) return 0;
    return Math.round((qty * sell + Number.EPSILON) * 100) / 100;
  }, [qty, sell]);

  async function submit(e) {
    e.preventDefault();
    if (!profile?.id) {
      setError("Not signed in.");
      return;
    }
    setPending(true);
    setError("");
    setLastSaved(null);
    try {
      const result = await createLocalPurchase({
        supplierId,
        itemName,
        partNumber,
        quantity: qty,
        costPerUnit: cost,
        sellingPrice: sell,
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
      setItemName("");
      setPartNumber("");
      setQuantity("1");
      setCostPerUnit("");
      setSellingPrice("");
      setInvoiceNumber("");
      setNotes("");
      onSaved?.();
    } catch (err) {
      setError(err.message || "Could not save local buy.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-ink">Local buy (no GST)</h2>
      <p className="mt-1 text-sm text-fog">
        For local suppliers without a GST bill. Saved in your records (stock,
        cost, supplier due, sales) —{" "}
        <span className="font-medium text-ink">excluded from GST reports</span>.
      </p>

      {error ? (
        <p className="mt-3 text-sm text-danger">{error}</p>
      ) : null}
      {lastSaved ? (
        <p className="mt-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-ink">
          Saved {lastSaved.product?.name}: +
          {lastSaved.invoice ? "stock updated" : ""} · cost{" "}
          {formatInr(lastSaved.total)} due on supplier. Sell at POS as{" "}
          <span className="font-mono text-xs">
            {lastSaved.product?.part_number}
          </span>{" "}
          @ sell price. Pay from Supplier balances when ready.
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <Label>Supplier</Label>
          <div className="mt-1">
            <SupplierSelect value={supplierId} onChange={setSupplierId} />
          </div>
        </div>
        <div>
          <Label>Item name</Label>
          <Input
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="e.g. MRF tires"
            required
          />
        </div>
        <div>
          <Label>Part code (optional)</Label>
          <Input
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            placeholder="Auto LOCAL-… if blank"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Quantity</Label>
            <Input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Cost / piece (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={costPerUnit}
              onChange={(e) => setCostPerUnit(e.target.value)}
              placeholder="200"
              required
            />
          </div>
          <div>
            <Label>Selling / piece (₹)</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
              placeholder="300"
              required
            />
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
              {formatInr(totalCost)}
            </span>
          </p>
          <p className="mt-0.5">
            If all sold at sell price:{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatInr(totalSell)}
            </span>
            {totalCost > 0 && totalSell > 0 ? (
              <>
                {" "}
                · rough margin{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {formatInr(totalSell - totalCost)}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <Button type="submit" disabled={pending || !supplierId} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Save local buy"}
        </Button>
      </form>
    </Card>
  );
}
