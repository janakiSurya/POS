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
import { PageHeader } from "../shared/PageHeader";

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

      <div className="w-full space-y-4 sm:space-y-6">

      <PageHeader
        title="Customer bills"
        description="View bills, download PDF or Excel, or reprint receipt"
      >
        <Button variant="secondary" onClick={load} className="w-full shrink-0 sm:w-auto">
          <RefreshCw className="mr-2 inline h-4 w-4" />
          Refresh
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver" />
          <Input
            className="py-2.5 pl-10 text-base sm:text-sm"
            placeholder="Search bill no. or customer phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: "today", label: "Today" },
            { id: "week", label: "7 days" },
            { id: "all", label: "All" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setDateFilter(f.id)}
              className={`min-h-[44px] rounded-lg px-3 py-2.5 text-sm font-medium transition-colors active:scale-[0.98] ${
                dateFilter === f.id
                  ? "bg-action text-canvas"
                  : "border border-ash text-fog hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-fog">Loading bills…</p>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-fog">
          <p>No bills match this filter.</p>
          {invoices.length > 0 ? (
            <p className="mt-2 text-sm text-silver">
              {invoices.length} bill{invoices.length === 1 ? "" : "s"} in total — try
              &quot;7 days&quot; or &quot;All&quot;.
            </p>
          ) : (
            <p className="mt-2 text-sm text-silver">
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
                className="flex w-full flex-col gap-2 rounded-xl border border-ash bg-canvas px-3 py-3 text-left transition-colors active:scale-[0.99] hover:border-smoke hover:bg-paper sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-ink">
                    {inv.invoice_number || "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-fog">
                    {formatBillTime(inv.created_at)}
                    {cust ? ` · ${cust.name}` : " · Walk-in"}
                  </p>
                  {cust?.phone ? (
                    <p className="mt-0.5 text-xs text-silver">{cust.phone}</p>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
                  <p className="text-lg font-bold tabular-nums text-ink">
                    {formatInr(inv.total_amount)}
                  </p>
                  <p className="text-xs text-silver">{inv.payment_method}</p>
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
        size="lg"
        className="max-h-[92dvh] overflow-y-auto sm:max-h-[92vh]"
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
