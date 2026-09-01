import { formatInr, formatQty } from "../../lib/format";

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

export function ReceiptPrint({ shop, invoice, lines, customer }) {
  const shopName =
    shop?.name || "Sri Sri Satya Sai Automobile Agency";

  return (
    <div className="print-receipt-root print-only bg-white text-black">
      <div className="receipt-sheet mx-auto box-border w-full max-w-[210mm] px-10 py-8">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-5">
          <div className="flex items-start gap-4 min-w-0">
            <img
              src="/logo.png"
              alt=""
              className="h-16 w-16 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight">{shopName}</h1>
              {shop?.address ? (
                <p className="mt-1 text-sm leading-snug text-gray-700">
                  {shop.address}
                </p>
              ) : null}
              {shop?.phone ? (
                <p className="mt-1 text-sm text-gray-700">Tel: {shop.phone}</p>
              ) : null}
              {shop?.gstin ? (
                <p className="mt-1 text-xs font-mono text-gray-700">
                  GSTIN: {shop.gstin}
                </p>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-600">
              Tax invoice / bill
            </p>
            <p className="mt-2 font-mono text-2xl font-bold">
              {invoice.invoice_number}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {formatBillTime(invoice.created_at)}
            </p>
          </div>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Bill to
            </p>
            <p className="mt-1 font-semibold">
              {customer?.name || "Walk-in customer"}
            </p>
            {customer?.phone ? (
              <p className="text-gray-700">{customer.phone}</p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Payment
            </p>
            <p className="mt-1 font-semibold">{invoice.payment_method}</p>
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="py-2.5 pr-2 text-left font-bold">Part no.</th>
              <th className="py-2.5 pr-2 text-left font-bold">Description</th>
              <th className="py-2.5 px-2 text-right font-bold">Qty</th>
              <th className="py-2.5 px-2 text-right font-bold">Rate</th>
              <th className="py-2.5 px-2 text-right font-bold">Disc</th>
              <th className="py-2.5 pl-2 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id ?? l.product_id} className="border-b border-gray-300">
                <td className="py-2 pr-2 font-mono text-xs align-top">
                  {l.part_number}
                </td>
                <td className="py-2 pr-2 align-top">{l.name}</td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  {formatQty(l.quantity)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  {formatInr(l.unit_price)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  {l.discount_percent > 0 ? `${l.discount_percent}%` : "—"}
                </td>
                <td className="py-2 pl-2 text-right tabular-nums font-semibold align-top">
                  {formatInr(l.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            {invoice.bill_discount_percent > 0 ? (
              <>
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal</span>
                  <span className="tabular-nums">
                    {formatInr(invoice.subtotal_amount ?? invoice.total_amount)}
                  </span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>Bill discount</span>
                  <span className="tabular-nums">
                    -{invoice.bill_discount_percent}%
                  </span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between border-t-2 border-black pt-2 text-lg font-bold">
              <span>Total</span>
              <span className="tabular-nums">{formatInr(invoice.total_amount)}</span>
            </div>
          </div>
        </div>

        <footer className="mt-10 border-t border-gray-300 pt-4 text-center text-sm text-gray-600">
          <p>{shop?.thank_you_line || "Thank you — visit again"}</p>
          <p className="mt-1 text-xs text-gray-500">
            Computer-generated bill — no signature required
          </p>
        </footer>
      </div>
    </div>
  );
}
