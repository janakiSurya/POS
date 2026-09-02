import { formatInr, formatQty } from "../../lib/format";
import {
  downloadPurchaseInvoiceExcel,
  downloadPurchaseInvoicePdf,
} from "../../lib/exportDownload";
import { DownloadActions } from "../shared/DownloadActions";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = dateStr.includes("T")
    ? new Date(dateStr)
    : new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function PurchaseInvoiceDocument({
  invoice,
  supplier,
  lines,
  shop,
  footer,
}) {
  const shopName =
    shop?.name || "Sri Sri Satya Sai Automobile Agency";
  const totalQty = lines.reduce(
    (s, l) => s + (Number(l.quantity) || 0),
    0,
  );

  function handleExcel() {
    downloadPurchaseInvoiceExcel({ invoice, supplier, lines, shop });
  }

  function handlePdf() {
    downloadPurchaseInvoicePdf({ invoice, supplier, lines, shop });
  }

  return (
    <div className="space-y-4">
      <DownloadActions onExcel={handleExcel} onPdf={handlePdf} />

      <div
        className="overflow-hidden rounded-xl border border-ash bg-canvas text-ink shadow-xl"
        id="purchase-invoice-document"
      >
        <div className="border-b border-ash bg-paper/[0.03] px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-silver">
                Purchase invoice
              </p>
              <h3 className="mt-1 text-2xl font-bold tracking-tight">
                {invoice.invoice_number}
              </h3>
              <p className="mt-1 text-sm text-fog">
                {formatDate(invoice.invoice_date)}
                {invoice.invoice_type ? ` · ${invoice.invoice_type}` : ""}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold">{shopName}</p>
              {shop?.gstin ? (
                <p className="text-fog">GSTIN {shop.gstin}</p>
              ) : null}
              {shop?.phone ? (
                <p className="text-fog">{shop.phone}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-b border-ash px-5 py-4 sm:grid-cols-2 sm:px-6">
          <div className="rounded-lg border border-ash bg-paper/[0.02] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-silver">
              Buyer (you)
            </p>
            <p className="mt-1 font-semibold">{shopName}</p>
            {shop?.address ? (
              <p className="mt-1 text-xs text-fog">{shop.address}</p>
            ) : null}
            {shop?.gstin ? (
              <p className="mt-1 text-xs font-mono text-fog">
                GSTIN {shop.gstin}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border border-ash bg-paper/[0.02] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-silver">
              Supplier
            </p>
            <p className="mt-1 font-semibold">{supplier?.name ?? "—"}</p>
            {supplier?.address ? (
              <p className="mt-1 text-xs text-fog">{supplier.address}</p>
            ) : null}
            {supplier?.gstin ? (
              <p className="mt-1 text-xs font-mono text-fog">
                GSTIN {supplier.gstin}
              </p>
            ) : null}
            {supplier?.phone ? (
              <p className="text-xs text-fog">{supplier.phone}</p>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-paper/[0.06] text-[11px] font-semibold uppercase tracking-wide text-silver">
              <tr>
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Part no.</th>
                <th className="px-3 py-2.5">Description</th>
                <th className="px-3 py-2.5">Brand</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">UOM</th>
                <th className="px-3 py-2.5 text-right">MRP</th>
                <th className="px-3 py-2.5 text-right">Rate</th>
                <th className="px-3 py-2.5 text-right">Disc</th>
                <th className="px-3 py-2.5 text-right">Taxable</th>
                <th className="px-3 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr
                  key={l.id ?? `${l.line_no}-${l.part_number}`}
                  className="border-t border-ash"
                >
                  <td className="px-3 py-2 text-silver">{l.line_no}</td>
                  <td className="px-3 py-2 font-mono text-xs font-medium">
                    {l.part_number}
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    <div className="truncate">{l.description}</div>
                    {l.hsn ? (
                      <div className="text-[10px] text-silver">
                        HSN {l.hsn}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-fog">
                    {l.brand || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQty(l.quantity)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-fog">
                    {l.uom || "PCS"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.mrp ? formatInr(l.mrp) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatInr(l.unit_cost)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {l.disc_percent > 0 ? `${l.disc_percent}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.taxable != null ? formatInr(l.taxable) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatInr(l.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 border-t border-ash px-5 py-4 sm:grid-cols-2 sm:px-6">
          <div className="text-sm text-fog">
            <p>
              <span className="font-medium text-ink">{lines.length}</span>{" "}
              line items ·{" "}
              <span className="font-medium text-ink">{totalQty}</span> units
            </p>
            <p className="mt-1 text-xs">
              Source: {invoice.source === "EXCEL" ? "Excel import" : "Manual entry"}
              · Status: {invoice.status?.replace("_", " ")}
            </p>
          </div>
          <div className="space-y-1 text-sm">
            {invoice.printed_subtotal != null ? (
              <div className="flex justify-between">
                <span className="text-fog">Printed subtotal</span>
                <span className="tabular-nums">
                  {formatInr(invoice.printed_subtotal)}
                </span>
              </div>
            ) : null}
            {invoice.printed_discount != null ? (
              <div className="flex justify-between">
                <span className="text-fog">Printed discount</span>
                <span className="tabular-nums">
                  {formatInr(invoice.printed_discount)}
                </span>
              </div>
            ) : null}
            {invoice.printed_taxable != null ? (
              <div className="flex justify-between">
                <span className="text-fog">Printed taxable</span>
                <span className="tabular-nums">
                  {formatInr(invoice.printed_taxable)}
                </span>
              </div>
            ) : null}
            {invoice.printed_cgst != null ? (
              <div className="flex justify-between">
                <span className="text-fog">CGST</span>
                <span className="tabular-nums">
                  {formatInr(invoice.printed_cgst)}
                </span>
              </div>
            ) : null}
            {invoice.printed_sgst != null ? (
              <div className="flex justify-between">
                <span className="text-fog">SGST</span>
                <span className="tabular-nums">
                  {formatInr(invoice.printed_sgst)}
                </span>
              </div>
            ) : null}
            {invoice.printed_grand_total != null ? (
              <div className="flex justify-between font-medium">
                <span>Printed grand total</span>
                <span className="tabular-nums">
                  {formatInr(invoice.printed_grand_total)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-ash pt-2 text-base font-bold">
              <span>Computed total</span>
              <span className="tabular-nums">
                {formatInr(invoice.total_amount)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {footer}
    </div>
  );
}
