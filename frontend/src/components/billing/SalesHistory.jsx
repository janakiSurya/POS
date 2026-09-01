import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Printer, RefreshCw } from "lucide-react";
import { localDb } from "../../db/localDb";
import { formatInr } from "../../lib/format";
import { businessDateIST } from "../../lib/businessDay";
import { addDaysYmd, invoiceDateIST } from "../../lib/reportMetrics";
import {
  cleanupDuplicateInvoices,
  dedupeInvoiceList,
  loadInvoiceDetails,
  syncInvoicesFromServer,
} from "../../lib/sales";
import { SalesInvoiceDocument } from "../documents/SalesInvoiceDocument";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Card } from "../ui/Card";
import { Modal } from "../ui/Modal";
import { ReceiptPrint } from "./ReceiptPrint";

function formatBillTime(createdAt) {
  return new Date(createdAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SalesHistory() {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState(new Map());
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("today");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [shop, setShop] = useState(null);
  const [reprint, setReprint] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = dedupeInvoiceList(
        await localDb.invoices.orderBy("created_at").reverse().toArray(),
      );
      const custs = await localDb.customers.toArray();
      setCustomers(new Map(custs.map((c) => [c.id, c])));
      setInvoices(rows);
      const s = await localDb.shop_settings.get("default");
      setShop(s);
      await syncInvoicesFromServer();
      await cleanupDuplicateInvoices();
      const refreshed = dedupeInvoiceList(
        await localDb.invoices.orderBy("created_at").reverse().toArray(),
      );
      setInvoices(refreshed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = businessDateIST();

  const filtered = invoices.filter((inv) => {
    const billDate = invoiceDateIST(inv.created_at);
    if (dateFilter === "today" && billDate !== today) return false;
    if (dateFilter === "week") {
      const weekStart = addDaysYmd(today, -6);
      if (billDate < weekStart || billDate > today) return false;
    }
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (inv.invoice_number?.toLowerCase().includes(q)) return true;
    const cust = inv.customer_id ? customers.get(inv.customer_id) : null;
    if (cust?.phone?.includes(q.replace(/\D/g, ""))) return true;
    if (cust?.name?.toLowerCase().includes(q)) return true;
    return false;
  });

  async function openDetail(id) {
    const data = await loadInvoiceDetails(id);
    if (data) setDetail(data);
  }

  function handleReprint() {
    if (!detail) return;
    setReprint(detail);
    setTimeout(() => {
      window.print();
      setReprint(null);
    }, 300);
  }

  return (
    <>
      {reprint
        ? createPortal(
            <ReceiptPrint
              shop={shop}
              invoice={reprint.invoice}
              lines={reprint.lines}
              customer={reprint.customer}
            />,
            document.body,
          )
        : null}

      <div className="mx-auto max-w-5xl p-4 md:p-6">

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Customer bills</h1>
          <p className="mt-1 text-sm text-white-muted">
            View bills, download PDF or Excel, or reprint receipt
          </p>
        </div>
        <Button variant="secondary" onClick={load} className="shrink-0">
          <RefreshCw className="mr-2 inline h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-white-faint" />
          <Input
            className="pl-10"
            placeholder="Search bill no. or customer phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {[
            { id: "today", label: "Today" },
            { id: "week", label: "7 days" },
            { id: "all", label: "All" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setDateFilter(f.id)}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                dateFilter === f.id
                  ? "bg-white text-charcoal"
                  : "border border-charcoal-3 text-white-muted hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-white-muted">Loading bills…</p>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-white-muted">
          <p>No bills match this filter.</p>
          {invoices.length > 0 ? (
            <p className="mt-2 text-sm text-white-faint">
              {invoices.length} bill{invoices.length === 1 ? "" : "s"} in total — try
              &quot;7 days&quot; or &quot;All&quot;.
            </p>
          ) : (
            <p className="mt-2 text-sm text-white-faint">
              No bills in local storage yet. Complete a sale on POS or tap Refresh.
            </p>
          )}
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => {
            const cust = inv.customer_id ? customers.get(inv.customer_id) : null;
            return (
              <button
                key={inv.id}
                type="button"
                onClick={() => openDetail(inv.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 px-4 py-3 text-left transition-colors hover:border-white/20 hover:bg-charcoal-3"
              >
                <div className="min-w-0">
                  <p className="font-mono font-semibold text-white">
                    {inv.invoice_number || "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-white-muted">
                    {formatBillTime(inv.created_at)}
                    {cust ? ` · ${cust.name} · ${cust.phone}` : " · Walk-in"}
                    {inv.bill_discount_percent > 0
                      ? ` · Bill disc ${inv.bill_discount_percent}%`
                      : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold tabular-nums text-white">
                    {formatInr(inv.total_amount)}
                  </p>
                  <p className="text-xs text-white-faint">{inv.payment_method}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.invoice?.invoice_number ?? "Bill"}
        className="max-h-[92vh] max-w-3xl overflow-y-auto"
      >
        {detail ? (
          <SalesInvoiceDocument
            invoice={detail.invoice}
            lines={detail.lines}
            customer={detail.customer}
            shop={shop}
            footer={
              <Button className="w-full" onClick={handleReprint}>
                <Printer className="mr-2 inline h-4 w-4" />
                Reprint bill
              </Button>
            }
          />
        ) : null}
      </Modal>
      </div>
    </>
  );
}
