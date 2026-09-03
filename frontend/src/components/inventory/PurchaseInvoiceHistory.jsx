import { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw, FileSpreadsheet, PenLine } from "lucide-react";
import { localDb } from "../../db/localDb";
import { formatInr } from "../../lib/format";
import {
  loadPurchaseInvoiceDetails,
} from "../../lib/purchases";
import { syncPurchasesIfNeeded, syncSuppliersIfNeeded } from "../../lib/hybridSync";
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
    DRAFT: "bg-paper text-fog",
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

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      await syncPurchasesIfNeeded(force);
      await syncSuppliersIfNeeded(force);
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
    load(false);
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
          <h2 className="text-base font-semibold text-ink sm:text-lg">Purchase invoices</h2>
          <p className="text-sm text-fog">
            Open any bill to view, verify, and download as PDF or Excel
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

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-silver" />
        <Input
          className="py-2.5 pl-10 text-base sm:text-sm"
          placeholder="Search supplier, invoice no., or date…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-sm text-fog">Loading invoices…</p>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-fog">
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
                className="flex w-full flex-col gap-2 rounded-xl border border-ash bg-paper px-3 py-3 text-left transition-colors active:scale-[0.99] hover:border-smoke hover:bg-canvas sm:flex-row sm:items-center sm:gap-3 sm:px-4"
              >
                <div className="flex shrink-0 items-center gap-2 sm:contents">
                  <div className="shrink-0 rounded-lg bg-canvas p-2">
                    {inv.source === "EXCEL" ? (
                      <FileSpreadsheet className="h-5 w-5 text-fog" />
                    ) : (
                      <PenLine className="h-5 w-5 text-fog" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 sm:order-none">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-semibold text-ink">
                      {inv.invoice_number}
                    </p>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${statusBadge(inv.status)}`}
                    >
                      {inv.status.replace("_", " ")}
                    </span>
                    <span className="text-[10px] uppercase text-silver">
                      {inv.source === "EXCEL" ? "Excel" : "Manual"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-fog">
                    {formatDate(inv.invoice_date)}
                    {sup ? ` · ${sup.name}` : ""}
                    {lineCounts.get(inv.id)
                      ? ` · ${lineCounts.get(inv.id)} lines`
                      : ""}
                    {inv.invoice_type ? ` · ${inv.invoice_type}` : ""}
                  </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:block sm:text-right sm:shrink-0">
                  <p className="text-lg font-bold tabular-nums text-ink">
                    {formatInr(total)}
                  </p>
                  <p className="text-xs text-silver">
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
        size="xl"
        className="max-h-[92dvh] overflow-y-auto sm:max-h-[92vh]"
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
                  <p className="text-sm text-fog">{detail.invoice.notes}</p>
                ) : null}
              </div>
            }
          />
        ) : null}
      </Modal>
    </div>
  );
}
