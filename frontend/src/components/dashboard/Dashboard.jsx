import { useEffect, useState } from "react";
import { RefreshCw, FileDown } from "lucide-react";
import { localDb } from "../../db/localDb";
import { supabase } from "../../lib/supabaseClient";
import { formatInr, formatQty, toNum } from "../../lib/format";
import { businessDateIST } from "../../lib/businessDay";
import { syncDashboardData } from "../../lib/dashboardSync";
import {
  listDayCloseReports,
  syncDayCloseReportsFromServer,
} from "../../lib/dayCloseReport";
import { downloadDayCloseReportPdf } from "../../lib/exportDownload";
import { isOnline } from "../../lib/network";
import { KpiCard, Card } from "../ui/Card";
import { Button } from "../ui/Button";

export function Dashboard() {
  const [kpis, setKpis] = useState({
    stockCost: 0,
    retailValue: 0,
    todayRevenue: 0,
    todayCash: 0,
    todayUpi: 0,
    todayCredit: 0,
    grossProfit: 0,
    productCount: 0,
  });
  const [lowStock, setLowStock] = useState([]);
  const [deadStock, setDeadStock] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [dayReports, setDayReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");

  async function load() {
    setSyncError("");
    try {
      if (supabase && isOnline()) {
        try {
          await syncDashboardData();
          await syncDayCloseReportsFromServer();
        } catch (syncErr) {
          setSyncError(syncErr.message || "Could not sync — showing local data.");
        }
      }

      const products = await localDb.products.toArray();
      let stockCost = 0;
      let retailValue = 0;
      const low = [];
      for (const p of products) {
        stockCost += toNum(p.purchase_price) * toNum(p.stock_quantity);
        retailValue += toNum(p.selling_price) * toNum(p.stock_quantity);
        if (p.stock_quantity <= p.min_stock_alert) low.push(p);
      }
      setLowStock(low.slice(0, 10));

      const today = businessDateIST();
      const invoices = await localDb.invoices.toArray();
      const todayInv = invoices.filter((i) => i.created_at?.startsWith(today));
      let todayCash = 0;
      let todayUpi = 0;
      let todayCredit = 0;
      let grossProfit = 0;

      for (const inv of todayInv) {
        if (inv.payment_method === "CASH") todayCash += toNum(inv.total_amount);
        if (inv.payment_method === "UPI") todayUpi += toNum(inv.total_amount);
        if (inv.payment_method === "CREDIT") todayCredit += toNum(inv.total_amount);
      }

      const allItems = await localDb.invoice_items.toArray();
      const invMap = new Map(invoices.map((i) => [i.id, i]));
      const soldProductIds = new Set();

      for (const item of allItems) {
        const inv = invMap.get(item.invoice_id);
        if (!inv) continue;
        soldProductIds.add(item.product_id);
        if (inv.created_at?.slice(0, 10) === today) {
          grossProfit +=
            toNum(item.line_total) - toNum(item.unit_cost) * toNum(item.quantity);
        }
      }

      const dead = products.filter(
        (p) => !soldProductIds.has(p.id) && p.stock_quantity > 0,
      );
      setDeadStock(dead.slice(0, 10));

      const sess = await localDb.register_sessions
        .orderBy("opened_at")
        .reverse()
        .limit(14)
        .toArray();
      setSessions(sess);

      const reports = await listDayCloseReports(30);
      setDayReports(reports);

      setKpis({
        stockCost,
        retailValue,
        todayRevenue: todayCash + todayUpi + todayCredit,
        todayCash,
        todayUpi,
        todayCredit,
        grossProfit,
        productCount: products.length,
      });
    } catch (err) {
      setSyncError(err.message || "Could not sync dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Owner dashboard</h1>
          <p className="text-sm text-white-muted">
            Live from Supabase · {kpis.productCount} parts in stock
          </p>
        </div>
        <Button variant="secondary" className="text-xs" onClick={load}>
          <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {syncError ? (
        <p className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          {syncError}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-white-muted">Syncing live data…</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Stock cost value" value={formatInr(kpis.stockCost)} />
        <KpiCard label="Retail value" value={formatInr(kpis.retailValue)} />
        <KpiCard label="Today revenue" value={formatInr(kpis.todayRevenue)} />
        <KpiCard label="Today gross profit" value={formatInr(kpis.grossProfit)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Cash today" value={formatInr(kpis.todayCash)} />
        <KpiCard label="UPI today" value={formatInr(kpis.todayUpi)} />
        <KpiCard label="Credit today" value={formatInr(kpis.todayCredit)} />
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-white">Low stock</h2>
        {lowStock.length ? (
          <ul className="space-y-2 text-sm">
            {lowStock.map((p) => (
              <li key={p.id} className="flex justify-between text-white-muted">
                <span>{p.name}</span>
                <span className="text-warning">{formatQty(p.stock_quantity)} left</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-white-faint">All stocked OK</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-white">Dead stock (no sales yet)</h2>
        {deadStock.length ? (
          <ul className="space-y-2 text-sm text-white-muted">
            {deadStock.map((p) => (
              <li key={p.id}>
                {p.name}{" "}
                <span className="font-mono text-xs">({p.part_number})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-white-faint">None flagged</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-white">Saved end-of-day reports</h2>
        <p className="mb-4 text-sm text-white-muted">
          PDF summaries saved when the shift is closed each day.
        </p>
        {dayReports.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-white-muted">
                <tr>
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3 text-right">Sales</th>
                  <th className="pb-2 pr-3 text-right">Bills</th>
                  <th className="pb-2 pr-3 text-right">Cash var.</th>
                  <th className="pb-2 text-right">PDF</th>
                </tr>
              </thead>
              <tbody>
                {dayReports.map((row) => {
                  const r = row.report_json;
                  return (
                    <tr key={row.id} className="border-t border-charcoal-3">
                      <td className="py-2 pr-3">{row.business_date}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatInr(r?.total_sales)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r?.bill_count ?? "—"}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right tabular-nums ${
                          toNum(r?.cash_variance) !== 0 ? "text-warning" : ""
                        }`}
                      >
                        {r?.cash_variance != null ? formatInr(r.cash_variance) : "—"}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="secondary"
                          className="text-xs"
                          onClick={() => downloadDayCloseReportPdf(r)}
                        >
                          <FileDown className="mr-1 inline h-3.5 w-3.5" />
                          Download
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-white-faint">
            No saved reports yet. Close the shift to generate the first PDF.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-white">Register audit</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-white-muted">
              <tr>
                <th className="pb-2 pr-3">Date</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3 text-right">Open cash</th>
                <th className="pb-2 pr-3 text-right">Cash var.</th>
                <th className="pb-2 text-right">UPI var.</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-charcoal-3">
                  <td className="py-2 pr-3">{s.business_date}</td>
                  <td className="py-2 pr-3">{s.status}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatInr(s.opening_cash)}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right tabular-nums ${
                      toNum(s.cash_variance) !== 0 ? "text-warning" : ""
                    }`}
                  >
                    {s.cash_variance != null ? formatInr(s.cash_variance) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {s.upi_variance != null ? formatInr(s.upi_variance) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
