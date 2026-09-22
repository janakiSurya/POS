import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import { formatInr, toNum } from "../../lib/format";
import { formatDateIST } from "../../lib/businessDay";
import { isOnline } from "../../lib/network";
import {
  syncInvoicesIfNeeded,
  syncProductsIfNeeded,
  syncCustomersIfNeeded,
} from "../../lib/hybridSync";
import {
  buildGstSalesReport,
  last90DaysRangeIST,
  GST_FLAT_RATE,
} from "../../lib/gstReport";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Card } from "../ui/Card";

function downloadGstExcel(report) {
  const rateLabel = `${report.gstRatePercent}%`;
  const rows = [
    [
      "Invoice no.",
      "Date",
      "Customer",
      "Phone",
      "Payment",
      "GST sales (₹)",
      `GST @ ${rateLabel} (₹)`,
      "Local excluded (₹)",
      "Full bill total (₹)",
    ],
    ...report.bills.map((b) => [
      b.invoice_number,
      b.entry_date,
      b.customer_name || "Walk-in",
      b.customer_phone || "",
      b.payment_method,
      toNum(b.sales_amount),
      toNum(b.gst_payable),
      toNum(b.local_excluded),
      toNum(b.bill_total),
    ]),
    [],
    [
      "TOTALS",
      "",
      "",
      "",
      "",
      toNum(report.totals.sales_amount),
      toNum(report.totals.gst_payable),
      toNum(report.excludedLineTotal),
      "",
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "GST sales");
  const name = `GST_sales_${report.startDate}_to_${report.endDate}.xlsx`;
  XLSX.writeFile(wb, name);
}

export function GstReportPanel() {
  const defaults = last90DaysRangeIST();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      if (isOnline()) {
        await Promise.all([
          syncInvoicesIfNeeded(force, { all: true }),
          syncProductsIfNeeded(force),
          syncCustomersIfNeeded(force),
        ]);
      }
      const data = await buildGstSalesReport({
        startDate,
        endDate,
      });
      setReport(data);
    } catch (err) {
      setError(err.message || "Could not build GST report.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    load(false);
  }, [load]);

  function apply90Days() {
    const r = last90DaysRangeIST();
    setStartDate(r.start);
    setEndDate(r.end);
  }

  const pct = Math.round(GST_FLAT_RATE * 100);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink sm:text-lg">
            90-day GST report
          </h2>
          <p className="text-sm text-fog">
            Sales bills in the date range. GST payable ={" "}
            <span className="font-medium text-ink">{pct}% of sales</span>{" "}
            (e.g. ₹1 lakh sales → ₹{pct === 1 ? "1,000" : `${pct},000`} GST).
            Local / no-GST items excluded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="text-xs"
            onClick={apply90Days}
          >
            Last 90 days
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="text-xs"
            onClick={() => load(true)}
          >
            <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            type="button"
            className="text-xs"
            disabled={!report?.bills?.length}
            onClick={() => report && downloadGstExcel(report)}
          >
            <Download className="mr-1.5 inline h-3.5 w-3.5" />
            Excel
          </Button>
        </div>
      </div>

      <Card className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>From</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <Label>To</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </Card>

      {error ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-fog">Building GST report…</p>
      ) : report ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-fog">Bills (GST)</p>
              <p className="text-lg font-bold tabular-nums text-ink">
                {report.billCount}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-fog">GST sales</p>
              <p className="text-lg font-bold tabular-nums text-ink">
                {formatInr(report.totals.sales_amount)}
              </p>
            </Card>
            <Card className="col-span-2 sm:col-span-1">
              <p className="text-xs text-fog">GST to pay ({pct}%)</p>
              <p className="text-lg font-bold tabular-nums text-ink">
                {formatInr(report.totals.gst_payable)}
              </p>
            </Card>
          </div>
          {(report.excludedBillCount > 0 || report.excludedLineTotal > 0.009) && (
            <p className="text-xs text-fog">
              Excluded from GST: {report.excludedBillCount} fully-local bill
              {report.excludedBillCount === 1 ? "" : "s"}
              {report.excludedLineTotal > 0.009
                ? ` · ${formatInr(report.excludedLineTotal)} of local line sales`
                : ""}
              .
            </p>
          )}

          {report.bills.length === 0 ? (
            <Card className="py-8 text-center text-sm text-silver">
              No GST sales bills between {formatDateIST(startDate + "T12:00:00")}{" "}
              and {formatDateIST(endDate + "T12:00:00")}.
            </Card>
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-ash bg-canvas text-[11px] font-semibold uppercase tracking-wide text-silver">
                  <tr>
                    <th className="px-3 py-2.5">Invoice</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Customer</th>
                    <th className="px-3 py-2.5">Pay</th>
                    <th className="px-3 py-2.5 text-right">Sales</th>
                    <th className="px-3 py-2.5 text-right">GST {pct}%</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bills.map((b) => (
                    <tr
                      key={b.id}
                      className="border-b border-ash last:border-0 hover:bg-canvas/60"
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-ink">
                        {b.invoice_number}
                      </td>
                      <td className="px-3 py-2 text-fog">
                        {formatDateIST(b.entry_date + "T12:00:00")}
                      </td>
                      <td className="px-3 py-2 text-ink">
                        {b.customer_name || "Walk-in"}
                        {b.local_excluded > 0.009 ? (
                          <span className="mt-0.5 block text-[10px] text-silver">
                            local part {formatInr(b.local_excluded)} excluded
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-fog">{b.payment_method}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatInr(b.sales_amount)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                        {formatInr(b.gst_payable)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-ash bg-canvas font-semibold">
                    <td className="px-3 py-2.5" colSpan={4}>
                      Total · {report.billCount} bills
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatInr(report.totals.sales_amount)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                      {formatInr(report.totals.gst_payable)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
