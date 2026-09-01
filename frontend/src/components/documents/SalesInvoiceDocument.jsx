import { formatInr, formatQty } from "../../lib/format";
import {
  downloadSalesInvoiceExcel,
  downloadSalesInvoicePdf,
} from "../../lib/exportDownload";
import { DownloadActions } from "../shared/DownloadActions";

function formatBillTime(createdAt) {
  return new Date(createdAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SalesInvoiceDocument({
  invoice,
  lines,
  customer,
  shop,
  footer,
}) {
  const shopName = shop?.name || "Sri Sri Satya Sai Automobile Agency";

  function handleExcel() {
    downloadSalesInvoiceExcel({ invoice, lines, customer, shop });
  }

  function handlePdf() {
    downloadSalesInvoicePdf({ invoice, lines, customer, shop });
  }

  return (
    <div className="space-y-4">
      <DownloadActions onExcel={handleExcel} onPdf={handlePdf} />

      <div
        className="overflow-hidden rounded-xl border border-charcoal-3 bg-white text-charcoal shadow-xl"
        id="sales-invoice-document"
      >
        <div className="border-b border-charcoal/10 bg-charcoal/[0.03] px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <img
                src="/logo.png"
                alt=""
                className="h-12 w-12 shrink-0 object-contain"
              />
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-charcoal/50">
                  Tax invoice / bill
                </p>
                <h3 className="mt-1 text-xl font-bold">{shopName}</h3>
                {shop?.phone ? (
                  <p className="text-sm text-charcoal/70">{shop.phone}</p>
                ) : null}
                {shop?.gstin ? (
                  <p className="text-xs font-mono text-charcoal/70">
                    GSTIN {shop.gstin}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono text-lg font-bold">
                {invoice.invoice_number}
              </p>
              <p className="text-sm text-charcoal/70">
                {formatBillTime(invoice.created_at)}
              </p>
              <p className="mt-1 text-xs text-charcoal/60">
                Payment: {invoice.payment_method}
              </p>
            </div>
          </div>
        </div>

        <div className="border-b border-charcoal/10 px-5 py-3 sm:px-6">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-charcoal/50">
            Customer
          </p>
          {customer ? (
            <p className="mt-1 font-medium">
              {customer.name} · {customer.phone}
            </p>
          ) : (
            <p className="mt-1 font-medium">Walk-in customer</p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-charcoal/[0.06] text-[11px] font-semibold uppercase tracking-wide text-charcoal/60">
              <tr>
                <th className="px-4 py-2.5">Part no.</th>
                <th className="px-4 py-2.5">Item</th>
                <th className="px-4 py-2.5 text-right">Qty</th>
                <th className="px-4 py-2.5 text-right">Price</th>
                <th className="px-4 py-2.5 text-right">Disc</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-charcoal/8">
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {l.part_number}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{l.name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatQty(l.quantity)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatInr(l.unit_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    {l.discount_percent > 0 ? `${l.discount_percent}%` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                    {formatInr(l.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-charcoal/10 px-5 py-4 sm:px-6">
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            {invoice.bill_discount_percent > 0 ? (
              <>
                <div className="flex justify-between text-charcoal/70">
                  <span>Subtotal</span>
                  <span className="tabular-nums">
                    {formatInr(invoice.subtotal_amount)}
                  </span>
                </div>
                <div className="flex justify-between text-charcoal/70">
                  <span>Bill discount</span>
                  <span>-{invoice.bill_discount_percent}%</span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between text-lg font-bold border-t border-charcoal/10 pt-2">
              <span>Total</span>
              <span className="tabular-nums">
                {formatInr(invoice.total_amount)}
              </span>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-charcoal/50">
            {shop?.thank_you_line || "Thank you — visit again"}
          </p>
        </div>
      </div>

      {footer}
    </div>
  );
}
