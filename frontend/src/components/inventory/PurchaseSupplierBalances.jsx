import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { localDb } from "../../db/localDb";
import { businessDateIST, formatDateIST } from "../../lib/businessDay";
import { formatInr, toNum } from "../../lib/format";
import {
  getBankBalance,
  getCashOnHandBalance,
  listSupplierPaymentsForSupplier,
  paySupplier,
  purchasePayableTotal,
  syncMoneyFromServer,
} from "../../lib/bank";
import { syncPurchasesIfNeeded, syncSuppliersIfNeeded } from "../../lib/hybridSync";
import { isOnline } from "../../lib/network";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Card } from "../ui/Card";
import { Modal } from "../ui/Modal";

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

export function PurchaseSupplierBalances({ refreshKey = 0, userId }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [showZero, setShowZero] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(null);
  const [history, setHistory] = useState([]);
  const [payOpen, setPayOpen] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(businessDateIST());
  const [payNote, setPayNote] = useState("");
  const [payMode, setPayMode] = useState("BANK");
  const [bankBalance, setBankBalance] = useState(0);
  const [cashInHand, setCashInHand] = useState(0);
  const [payError, setPayError] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      await syncPurchasesIfNeeded(force);
      await syncSuppliersIfNeeded(force);
      if (isOnline()) await syncMoneyFromServer();
      const [invoices, suppliers, bank, cash] = await Promise.all([
        localDb.purchase_invoices.toArray(),
        localDb.suppliers.toArray(),
        getBankBalance(),
        getCashOnHandBalance(),
      ]);
      const map = new Map(suppliers.map((s) => [s.id, s]));
      setRows(buildSupplierBalances(invoices, map));
      setBankBalance(bank);
      setCashInHand(cash);
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

  async function openHistory(row) {
    if (!row.supplierId) return;
    setHistoryOpen(row);
    setHistory(await listSupplierPaymentsForSupplier(row.supplierId));
  }

  function openPay(row) {
    if (!row.supplierId) return;
    setPayOpen(row);
    setPayAmount(String(row.remaining));
    setPayDate(businessDateIST());
    setPayNote("");
    setPayMode("BANK");
    setPayError("");
  }

  async function submitPay(e) {
    e.preventDefault();
    if (!payOpen?.supplierId || !userId) return;
    setPending(true);
    setPayError("");
    try {
      await paySupplier({
        supplierId: payOpen.supplierId,
        amount: payAmount,
        entryDate: payDate,
        note: payNote,
        userId,
        paymentMode: payMode,
      });
      setPayOpen(null);
      await load(true);
      if (historyOpen?.supplierId === payOpen.supplierId) {
        setHistory(
          await listSupplierPaymentsForSupplier(payOpen.supplierId),
        );
        const refreshed = (await localDb.purchase_invoices.toArray()).filter(
          (i) => i.supplier_id === payOpen.supplierId && i.status === "POSTED",
        );
        let total = 0;
        let paid = 0;
        for (const inv of refreshed) {
          const payable = purchasePayableTotal(inv);
          total += payable;
          paid += toNum(inv.amount_paid);
        }
        setHistoryOpen({
          ...historyOpen,
          total: round2(total),
          paid: round2(paid),
          remaining: round2(Math.max(0, total - paid)),
        });
      }
    } catch (err) {
      setPayError(err.message || "Payment failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink sm:text-lg">
            Supplier balances
          </h2>
          <p className="text-sm text-fog">
            Pay any amount against total due · history per supplier
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
              {r.supplierId ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-xs"
                    onClick={() => openHistory(r)}
                  >
                    History
                  </Button>
                  {r.remaining > 0.009 && userId ? (
                    <Button
                      type="button"
                      className="text-xs"
                      onClick={() => openPay(r)}
                    >
                      Pay
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(historyOpen)}
        onClose={() => setHistoryOpen(null)}
        title={`Payment history — ${historyOpen?.name || ""}`}
      >
        <p className="mb-3 text-sm text-fog">
          Due{" "}
          <span className="font-semibold tabular-nums text-ink">
            {formatInr(historyOpen?.remaining)}
          </span>
          {" · "}
          Paid{" "}
          <span className="font-semibold tabular-nums text-ink">
            {formatInr(historyOpen?.paid)}
          </span>
          {" of "}
          {formatInr(historyOpen?.total)}
        </p>
        {historyOpen?.remaining > 0.009 && userId ? (
          <Button
            type="button"
            className="mb-3 w-full text-sm"
            onClick={() => {
              openPay(historyOpen);
            }}
          >
            Pay this supplier
          </Button>
        ) : null}
        {history.length === 0 ? (
          <p className="py-6 text-center text-sm text-silver">
            No payments recorded for this supplier yet.
          </p>
        ) : (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {history.map((p) => {
              const mode = p.payment_mode === "CASH" ? "Cash in hand" : "Bank";
              return (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-ash bg-canvas px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{mode}</p>
                    <p className="mt-0.5 text-xs text-fog">
                      {formatDateIST(p.entry_date + "T12:00:00")}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                    −{formatInr(p.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(payOpen)}
        onClose={() => setPayOpen(null)}
        title={`Pay supplier — ${payOpen?.name || ""}`}
      >
        {payError ? <p className="mb-2 text-sm text-danger">{payError}</p> : null}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-ash bg-canvas px-3 py-2">
            <p className="text-xs text-fog">Bank</p>
            <p className="text-sm font-semibold tabular-nums text-ink">
              {formatInr(bankBalance)}
            </p>
          </div>
          <div className="rounded-lg border border-ash bg-canvas px-3 py-2">
            <p className="text-xs text-fog">Cash in hand</p>
            <p className="text-sm font-semibold tabular-nums text-ink">
              {formatInr(cashInHand)}
            </p>
          </div>
        </div>
        <p className="mb-3 text-xs text-fog">
          Total due {formatInr(payOpen?.remaining)}. Payment reduces this
          balance (applied to oldest invoices automatically).
        </p>
        <form onSubmit={submitPay} className="space-y-3">
          <div>
            <Label>Pay from</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {[
                { id: "CASH", label: "Cash in hand" },
                { id: "BANK", label: "Bank" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPayMode(opt.id)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    payMode === opt.id
                      ? "border-action bg-action text-canvas"
                      : "border-ash bg-paper text-fog hover:bg-canvas hover:text-ink"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Amount (₹)</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Note</Label>
            <Input
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setPayOpen(null)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={pending}>
              {pending ? "Paying…" : "Confirm pay"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
