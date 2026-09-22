import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import { localDb } from "../../db/localDb";
import { formatInr, toNum } from "../../lib/format";
import { purchasePayableTotal } from "../../lib/bank";
import { syncPurchasesIfNeeded, syncSuppliersIfNeeded } from "../../lib/hybridSync";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Card } from "../ui/Card";

function round2(n) {
  return Math.round((toNum(n) + Number.EPSILON) * 100) / 100;
}

/** Aggregate POSTED purchase invoices by supplier. */
export function buildSupplierBalances(invoices, suppliers) {
  const bySup = new Map();

  for (const inv of invoices) {
    if (inv.status !== "POSTED") continue;
    const sid = inv.supplier_id || "_none";
    if (!bySup.has(sid)) {
      bySup.set(sid, {
        supplierId: sid === "_none" ? null : sid,
        name: suppliers.get(sid)?.name || "Unknown supplier",
        invoiceCount: 0,
        unpaidCount: 0,
        total: 0,
        paid: 0,
      });
    }
    const row = bySup.get(sid);
    const payable = purchasePayableTotal(inv);
    const paid = toNum(inv.amount_paid);
    const rem = round2(Math.max(0, payable - paid));
    row.invoiceCount += 1;
    row.total = round2(row.total + payable);
    row.paid = round2(row.paid + paid);
    if (rem > 0.009) row.unpaidCount += 1;
  }

  return [...bySup.values()]
    .map((r) => ({
      ...r,
      remaining: round2(Math.max(0, r.total - r.paid)),
    }))
    .sort((a, b) => {
      if (b.remaining !== a.remaining) return b.remaining - a.remaining;
      return a.name.localeCompare(b.name);
    });
}

export function PurchaseSupplierBalances({ refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [showZero, setShowZero] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      await syncPurchasesIfNeeded(force);
      await syncSuppliersIfNeeded(force);
      const [invoices, suppliers] = await Promise.all([
        localDb.purchase_invoices.toArray(),
        localDb.suppliers.toArray(),
      ]);
      const map = new Map(suppliers.map((s) => [s.id, s]));
      setRows(buildSupplierBalances(invoices, map));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load, refreshKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showZero && r.remaining <= 0.009) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q);
    });
  }, [rows, query, showZero]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.total = round2(acc.total + r.total);
        acc.paid = round2(acc.paid + r.paid);
        acc.remaining = round2(acc.remaining + r.remaining);
        return acc;
      },
      { total: 0, paid: 0, remaining: 0 },
    );
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink sm:text-lg">
            Supplier balances
          </h2>
          <p className="text-sm text-fog">
            Posted invoices grouped by supplier — total, paid, remaining
          </p>
        </div>
        <Button
          variant="secondary"
          className="w-full shrink-0 text-xs sm:w-auto"
          onClick={() => load(true)}
        >
          <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-silver" />
          <Input
            className="pl-9"
            placeholder="Search supplier…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-fog">
          <input
            type="checkbox"
            checked={showZero}
            onChange={(e) => setShowZero(e.target.checked)}
            className="rounded border-ash"
          />
          Show fully paid
        </label>
      </div>

      <Card className="grid grid-cols-3 gap-2 sm:gap-4">
        <div>
          <p className="text-xs text-fog">Invoice total</p>
          <p className="text-sm font-bold tabular-nums text-ink sm:text-base">
            {formatInr(totals.total)}
          </p>
        </div>
        <div>
          <p className="text-xs text-fog">Paid</p>
          <p className="text-sm font-bold tabular-nums text-ink sm:text-base">
            {formatInr(totals.paid)}
          </p>
        </div>
        <div>
          <p className="text-xs text-fog">Remaining</p>
          <p className="text-sm font-bold tabular-nums text-ink sm:text-base">
            {formatInr(totals.remaining)}
          </p>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-fog">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-fog">
          {rows.length === 0
            ? "No posted purchase invoices yet."
            : "No suppliers with remaining balance."}
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div
              key={r.supplierId || "none"}
              className="rounded-xl border border-ash bg-paper px-3 py-3 sm:px-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{r.name}</p>
                  <p className="text-xs text-fog">
                    {r.invoiceCount} invoice{r.invoiceCount === 1 ? "" : "s"}
                    {r.unpaidCount > 0
                      ? ` · ${r.unpaidCount} unpaid/partial`
                      : " · all paid"}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-right sm:min-w-[280px]">
                  <div>
                    <p className="text-[10px] uppercase text-silver">Total</p>
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {formatInr(r.total)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-silver">Paid</p>
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {formatInr(r.paid)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-silver">Due</p>
                    <p
                      className={`text-sm font-bold tabular-nums ${
                        r.remaining > 0.009 ? "text-warning" : "text-success"
                      }`}
                    >
                      {formatInr(r.remaining)}
                    </p>
                  </div>
                </div>
              </div>
              {r.remaining > 0.009 ? (
                <p className="mt-2 text-xs text-fog">
                  Pay from{" "}
                  <Link to="/money" className="text-action underline">
                    Money → Pay supplier
                  </Link>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
