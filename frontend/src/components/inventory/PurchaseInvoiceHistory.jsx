import { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw, FileSpreadsheet, PenLine } from "lucide-react";
import { localDb } from "../../db/localDb";
import { formatInr } from "../../lib/format";
import {
  loadPurchaseInvoiceDetails,
  syncPurchaseInvoicesFromServer,
} from "../../lib/purchases";
import { compareStoredInvoice } from "../../lib/purchaseCalculations";
import { PurchaseTotalsCheck } from "./PurchaseTotalsCheck";
import { PurchaseInvoiceDocument } from "../documents/PurchaseInvoiceDocument";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Card } from "../ui/Card";
import { Modal } from "../ui/Modal";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusBadge(status) {
  const styles = {
    POSTED: "bg-success/20 text-success",
    PENDING_APPROVAL: "bg-warning/20 text-warning",
    DRAFT: "bg-white/10 text-white-muted",
  };
  return styles[status] || styles.DRAFT;
}

export function PurchaseInvoiceHistory({ refreshKey = 0 }) {
  const [invoices, setInvoices] = useState([]);
  const [suppliers, setSuppliers] = useState(new Map());
  const [lineCounts, setLineCounts] = useState(new Map());
  const [shop, setShop] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await syncPurchaseInvoicesFromServer();
      const rows = await localDb.purchase_invoices
        .orderBy("invoice_date")
        .reverse()
        .toArray();
      const sups = await localDb.suppliers.toArray();
      setSuppliers(new Map(sups.map((s) => [s.id, s])));
      const lines = await localDb.purchase_lines.toArray();
      const counts = new Map();
      for (const l of lines) {
        counts.set(l.purchase_invoice_id, (counts.get(l.purchase_invoice_id) ?? 0) + 1);
      }
      setLineCounts(counts);
      setInvoices(rows);
      const s = await localDb.shop_settings.get("default");
      setShop(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filtered = invoices.filter((inv) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (inv.invoice_number?.toLowerCase().includes(q)) return true;
    const sup = suppliers.get(inv.supplier_id);
    if (sup?.name?.toLowerCase().includes(q)) return true;
    if (formatDate(inv.invoice_date).toLowerCase().includes(q)) return true;
    return false;
  });

  async function openDetail(id) {
    const data = await loadPurchaseInvoiceDetails(id);
    if (data) setDetail(data);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Purchase invoices</h2>
          <p className="text-sm text-white-muted">
            Open any bill to view, verify, and download as PDF or Excel
          </p>
        </div>
        <Button variant="secondary" className="shrink-0 text-xs" onClick={load}>
          <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-white-faint" />
        <Input
          className="pl-10"
          placeholder="Search supplier, invoice no., or date…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-sm text-white-muted">Loading invoices…</p>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-white-muted">
          No purchase invoices yet. Post a manual entry or import Excel.
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => {
            const sup = suppliers.get(inv.supplier_id);
            const total =
              inv.total_amount > 0
                ? inv.total_amount
                : inv.printed_grand_total;
            return (
              <button
                key={inv.id}
                type="button"
                onClick={() => openDetail(inv.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-charcoal-3 bg-charcoal px-4 py-3 text-left transition-colors hover:border-white/20 hover:bg-charcoal-2"
              >
                <div className="shrink-0 rounded-lg bg-charcoal-3 p-2">
                  {inv.source === "EXCEL" ? (
                    <FileSpreadsheet className="h-5 w-5 text-white-muted" />
                  ) : (
                    <PenLine className="h-5 w-5 text-white-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono font-semibold text-white">
                      {inv.invoice_number}
                    </p>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${statusBadge(inv.status)}`}
                    >
                      {inv.status.replace("_", " ")}
                    </span>
                    <span className="text-[10px] uppercase text-white-faint">
                      {inv.source === "EXCEL" ? "Excel" : "Manual"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-white-muted">
                    {formatDate(inv.invoice_date)}
                    {sup ? ` · ${sup.name}` : ""}
                    {lineCounts.get(inv.id)
                      ? ` · ${lineCounts.get(inv.id)} lines`
                      : ""}
                    {inv.invoice_type ? ` · ${inv.invoice_type}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold tabular-nums text-white">
                    {formatInr(total)}
                  </p>
                  <p className="text-xs text-white-faint">
                    {inv.printed_grand_total && inv.total_amount !== inv.printed_grand_total
                      ? `Printed ${formatInr(inv.printed_grand_total)}`
                      : "Total"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.invoice?.invoice_number ?? "Purchase invoice"}
        className="max-h-[92vh] max-w-5xl overflow-y-auto"
      >
        {detail ? (
          <PurchaseInvoiceDocument
            invoice={detail.invoice}
            supplier={detail.supplier}
            lines={detail.lines}
            shop={shop}
            footer={
              <div className="space-y-3">
                <PurchaseTotalsCheck
                  data={compareStoredInvoice(detail.invoice, detail.lines)}
                  title="Printed vs calculated verification"
                />
                {detail.invoice.notes ? (
                  <p className="text-sm text-white-muted">{detail.invoice.notes}</p>
                ) : null}
              </div>
            }
          />
        ) : null}
      </Modal>
    </div>
  );
}
