import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Receipt,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { localDb } from "../../db/localDb";
import { formatInr } from "../../lib/format";
import { businessDateIST, formatDateIST } from "../../lib/businessDay";
import { syncAllInvoicesFromServer } from "../../lib/sales";
import { syncAllExpensesFromServer } from "../../lib/register";
import { syncFixedCostsFromServer, sumDailyExpensesInRange, sumFixedExpensesInRange } from "../../lib/expenses";
import { isOnline } from "../../lib/network";
import {
  aggregateExpenses,
  aggregateSales,
  buildDailyExpenseSeries,
  buildDailySalesSeries,
  compareExpensePeriods,
  comparePeriods,
  filterInvoicesByDateRange,
  filterRecordsByDateRange,
  formatRangeLabel,
  previousMonthRangeIST,
  previousWeekRangeIST,
  thisMonthRangeIST,
  thisWeekRangeIST,
} from "../../lib/reportMetrics";
import {
  DailyBarChart,
  ExpenseCompareChart,
  NetCompareChart,
  PaymentMixChart,
  PeriodCompareChart,
  ProfitBreakdownChart,
} from "./ReportCharts";
import { KpiCard, Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { PageHeader } from "../shared/PageHeader";

function StatHighlight({ label, value, sub, accent = "success" }) {
  const border =
    accent === "warning"
      ? "border-l-warning"
      : accent === "neutral"
        ? "border-l-smoke"
        : "border-l-success";
  return (
    <div
      className={`rounded-xl border border-ash border-l-4 ${border} bg-canvas/80 px-3 py-3 sm:px-4`}
    >
      <p className="text-[11px] uppercase tracking-wide text-silver">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-fog">{sub}</p> : null}
    </div>
  );
}

export function SalesReports() {
  const today = businessDateIST();
  const monthRange = thisMonthRangeIST();

  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [fixedLogs, setFixedLogs] = useState([]);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rangeStart, setRangeStart] = useState(monthRange.start);
  const [rangeEnd, setRangeEnd] = useState(today);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await localDb.invoices.toArray();
      const exps = await localDb.cash_expenses.toArray();
      const items = await localDb.invoice_items.toArray();
      const prods = await localDb.products.toArray();
      const fLogs = await localDb.fixed_cost_logs.toArray();
      setInvoices(rows);
      setExpenses(exps);
      setInvoiceItems(items);
      setProducts(prods);
      setFixedLogs(fLogs);

      if (isOnline()) {
        await syncAllInvoicesFromServer();
        await syncAllExpensesFromServer();
        await syncFixedCostsFromServer();
        setInvoices(await localDb.invoices.toArray());
        setExpenses(await localDb.cash_expenses.toArray());
        setInvoiceItems(await localDb.invoice_items.toArray());
        setProducts(await localDb.products.toArray());
        setFixedLogs(await localDb.fixed_cost_logs.toArray());
      }
    } catch (err) {
      setError(
        isOnline()
          ? err.message || "Could not load report data."
          : "Offline — showing saved local data.",
      );
      const rows = await localDb.invoices.toArray();
      const exps = await localDb.cash_expenses.toArray();
      setInvoices(rows);
      setExpenses(exps);
      setInvoiceItems(await localDb.invoice_items.toArray());
      setProducts(await localDb.products.toArray());
      setFixedLogs(await localDb.fixed_cost_logs.toArray());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Cost of goods sold: for each invoice item, look up purchase_price * qty
  const cogsByInvoice = useMemo(() => {
    const productMap = new Map(products.map((p) => [p.id, p]));
    const map = new Map();
    for (const item of invoiceItems) {
      const p = productMap.get(item.product_id);
      const cost = (p?.purchase_price ?? 0) * (item.quantity ?? 0);
      map.set(item.invoice_id, (map.get(item.invoice_id) ?? 0) + cost);
    }
    return map;
  }, [invoiceItems, products]);

  const stats = useMemo(() => {
    const allTimeSales = aggregateSales(invoices);
    const allTimeExpenses = aggregateExpenses(expenses);

    const monthInv = filterInvoicesByDateRange(
      invoices,
      monthRange.start,
      monthRange.end,
    );
    const thisMonthSales = aggregateSales(monthInv);
    const monthExp = filterRecordsByDateRange(
      expenses,
      monthRange.start,
      monthRange.end,
    );
    const thisMonthExpenses = aggregateExpenses(monthExp);

    const weekRange = thisWeekRangeIST();
    const prevWeekRange = previousWeekRangeIST();
    const weekCompare = comparePeriods(
      filterInvoicesByDateRange(invoices, weekRange.start, weekRange.end),
      filterInvoicesByDateRange(
        invoices,
        prevWeekRange.start,
        prevWeekRange.end,
      ),
    );
    const weekExpenseCompare = compareExpensePeriods(
      filterRecordsByDateRange(expenses, weekRange.start, weekRange.end),
      filterRecordsByDateRange(
        expenses,
        prevWeekRange.start,
        prevWeekRange.end,
      ),
    );

    const prevMonthRange = previousMonthRangeIST();
    const monthCompare = comparePeriods(
      monthInv,
      filterInvoicesByDateRange(
        invoices,
        prevMonthRange.start,
        prevMonthRange.end,
      ),
    );
    const monthExpenseCompare = compareExpensePeriods(
      monthExp,
      filterRecordsByDateRange(
        expenses,
        prevMonthRange.start,
        prevMonthRange.end,
      ),
    );

    const customInv = filterInvoicesByDateRange(
      invoices,
      rangeStart,
      rangeEnd,
    );
    const customExp = filterRecordsByDateRange(expenses, rangeStart, rangeEnd);
    const customRangeSales = aggregateSales(customInv);
    const customRangeExpenses = aggregateExpenses(customExp);

    const prevMonthSales = aggregateSales(
      filterInvoicesByDateRange(
        invoices,
        prevMonthRange.start,
        prevMonthRange.end,
      ),
    );
    const prevMonthExpenses = aggregateExpenses(
      filterRecordsByDateRange(
        expenses,
        prevMonthRange.start,
        prevMonthRange.end,
      ),
    );

    const dailySales = buildDailySalesSeries(invoices, rangeStart, rangeEnd);
    const dailyExpenses = buildDailyExpenseSeries(expenses, rangeStart, rangeEnd);

    return {
      allTimeSales,
      allTimeExpenses,
      thisMonthSales,
      thisMonthExpenses,
      customRangeSales,
      customRangeExpenses,
      weekCompare,
      weekExpenseCompare,
      monthCompare,
      monthExpenseCompare,
      weekRange,
      prevWeekRange,
      prevMonthRange,
      netThisMonth: thisMonthSales.revenue - thisMonthExpenses.total,
      netPrevMonth: prevMonthSales.revenue - prevMonthExpenses.total,
      netCustomRange: customRangeSales.revenue - customRangeExpenses.total,
      dailySales,
      dailyExpenses,

      // P&L for the custom range
      plRevenue: customRangeSales.revenue,
      plCogs: (() => {
        const inv = filterInvoicesByDateRange(invoices, rangeStart, rangeEnd);
        let cogs = 0;
        for (const i of inv) cogs += cogsByInvoice.get(i.id) ?? 0;
        return cogs;
      })(),
      plDailyExpenses: sumDailyExpensesInRange(expenses, rangeStart, rangeEnd),
      plFixedExpenses: sumFixedExpensesInRange(fixedLogs, rangeStart, rangeEnd),
    };
  }, [
    invoices,
    expenses,
    fixedLogs,
    cogsByInvoice,
    monthRange.start,
    monthRange.end,
    rangeStart,
    rangeEnd,
  ]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Sales reports"
        description="Visual overview · sales, expenses, comparisons (IST)"
      >
        <Button variant="secondary" className="w-full text-xs sm:w-auto" onClick={load}>
          <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
          Refresh
        </Button>
      </PageHeader>

      {error ? (
        <p className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-fog">Loading reports…</p>
      ) : null}

      {/* Hero KPIs */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
        <StatHighlight
          label="Sales this month"
          value={formatInr(stats.thisMonthSales.revenue)}
          sub={`${stats.thisMonthSales.count} bills`}
        />
        <StatHighlight
          label="Expenses this month"
          value={formatInr(stats.thisMonthExpenses.total)}
          sub={`${stats.thisMonthExpenses.count} entries`}
          accent="warning"
        />
        <StatHighlight
          label="Net this month"
          value={formatInr(stats.netThisMonth)}
          sub="Sales minus expenses"
          accent={stats.netThisMonth >= 0 ? "success" : "warning"}
        />
        <StatHighlight
          label="All-time sales"
          value={formatInr(stats.allTimeSales.revenue)}
          sub={`${stats.allTimeSales.count} bills total`}
          accent="neutral"
        />
      </div>

      {/* P&L section */}
      {(() => {
        const grossProfit = stats.plRevenue - stats.plCogs;
        const netProfit = grossProfit - stats.plDailyExpenses - stats.plFixedExpenses;
        return (
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-fog" />
              <h2 className="font-semibold text-ink">Profit &amp; Loss — {formatRangeLabel(rangeStart, rangeEnd)}</h2>
            </div>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: "Revenue", value: stats.plRevenue, color: "text-electric" },
                { label: "Cost of goods", value: stats.plCogs, color: "text-warning" },
                { label: "Daily expenses", value: stats.plDailyExpenses, color: "text-fog" },
                { label: "Fixed expenses", value: stats.plFixedExpenses, color: "text-fog" },
                {
                  label: "Net profit",
                  value: netProfit,
                  color: netProfit >= 0 ? "text-success" : "text-danger",
                  big: true,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-xl border ${item.big ? (netProfit >= 0 ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5") : "border-ash bg-canvas"} px-3 py-3`}
                >
                  <p className="text-[11px] uppercase tracking-wide text-silver">{item.label}</p>
                  <p className={`mt-1 text-lg font-bold tabular-nums ${item.color} sm:text-xl`}>
                    {formatInr(item.value)}
                  </p>
                </div>
              ))}
            </div>
            <ProfitBreakdownChart
              revenue={stats.plRevenue}
              costOfGoods={stats.plCogs}
              dailyExpenses={stats.plDailyExpenses}
              fixedExpenses={stats.plFixedExpenses}
              netProfit={netProfit}
            />
          </Card>
        );
      })()}

      {/* Custom date range + charts */}
      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-fog" />
            <h2 className="font-semibold text-ink">Selected period</h2>
          </div>
          <p className="text-xs tabular-nums text-fog sm:text-sm">
            Net {formatInr(stats.netCustomRange)} · {stats.customRangeSales.count}{" "}
            bills · {stats.customRangeExpenses.count} expenses
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs text-silver">From</Label>
            <Input
              type="date"
              className="mt-1"
              value={rangeStart}
              max={rangeEnd}
              onChange={(e) => setRangeStart(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-silver">To</Label>
            <Input
              type="date"
              className="mt-1"
              value={rangeEnd}
              min={rangeStart}
              max={today}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <p className="text-sm text-fog">
              {formatRangeLabel(rangeStart, rangeEnd)} · Sales{" "}
              <span className="font-medium text-ink">
                {formatInr(stats.customRangeSales.revenue)}
              </span>
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
          <div className="min-w-0 lg:col-span-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-silver">
              Daily sales
            </p>
            <DailyBarChart
              data={stats.dailySales}
              dataKey="sales"
              label="Sales"
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-silver">
              Payment mix
            </p>
            <PaymentMixChart
              cash={stats.customRangeSales.cash}
              upi={stats.customRangeSales.upi}
              credit={stats.customRangeSales.credit}
            />
          </div>
        </div>

        {stats.dailyExpenses.some((d) => d.expenses > 0) ? (
          <div className="mt-6 border-t border-ash pt-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-silver">
              Daily expenses
            </p>
            <DailyBarChart
              data={stats.dailyExpenses}
              dataKey="expenses"
              label="Expenses"
              color="#f59e0b"
            />
          </div>
        ) : null}
      </Card>

      {/* Sales comparisons */}
      <div className="flex items-center gap-2 text-sm font-medium text-fog">
        <Receipt className="h-4 w-4" />
        Sales comparisons
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">This week vs last week</h2>
            <span className="text-xs text-silver">
              {formatRangeLabel(stats.weekRange.start, stats.weekRange.end)}
            </span>
          </div>
          <PeriodCompareChart
            currentLabel="This week"
            previousLabel="Last week"
            currentAmount={stats.weekCompare.current.revenue}
            previousAmount={stats.weekCompare.previous.revenue}
            currentCount={stats.weekCompare.current.count}
            previousCount={stats.weekCompare.previous.count}
            amountChange={stats.weekCompare.revenueChange}
          />
        </Card>

        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">This month vs last month</h2>
            <span className="text-xs text-silver">
              {formatRangeLabel(monthRange.start, monthRange.end)}
            </span>
          </div>
          <PeriodCompareChart
            currentLabel="This month"
            previousLabel="Last month"
            currentAmount={stats.monthCompare.current.revenue}
            previousAmount={stats.monthCompare.previous.revenue}
            currentCount={stats.monthCompare.current.count}
            previousCount={stats.monthCompare.previous.count}
            amountChange={stats.monthCompare.revenueChange}
          />
        </Card>
      </div>

      {/* Expenses */}
      <div className="flex items-center gap-2 text-sm font-medium text-fog">
        <Wallet className="h-4 w-4" />
        Expenses & net
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Expenses this month"
          value={formatInr(stats.thisMonthExpenses.total)}
          sub={`${stats.thisMonthExpenses.count} entries`}
        />
        <KpiCard
          label="Expenses in range"
          value={formatInr(stats.customRangeExpenses.total)}
          sub={formatRangeLabel(rangeStart, rangeEnd)}
        />
        <KpiCard
          label="All-time expenses"
          value={formatInr(stats.allTimeExpenses.total)}
          sub={`${stats.allTimeExpenses.count} entries`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">Expenses — week</h2>
            <span className="text-xs text-silver">vs previous week</span>
          </div>
          <ExpenseCompareChart
            currentLabel="This week"
            previousLabel="Last week"
            currentTotal={stats.weekExpenseCompare.current.total}
            previousTotal={stats.weekExpenseCompare.previous.total}
            currentCount={stats.weekExpenseCompare.current.count}
            previousCount={stats.weekExpenseCompare.previous.count}
            totalChange={stats.weekExpenseCompare.totalChange}
          />
        </Card>

        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">Expenses — month</h2>
            <span className="text-xs text-silver">vs previous month</span>
          </div>
          <ExpenseCompareChart
            currentLabel="This month"
            previousLabel="Last month"
            currentTotal={stats.monthExpenseCompare.current.total}
            previousTotal={stats.monthExpenseCompare.previous.total}
            currentCount={stats.monthExpenseCompare.current.count}
            previousCount={stats.monthExpenseCompare.previous.count}
            totalChange={stats.monthExpenseCompare.totalChange}
          />
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-fog" />
          <h2 className="font-semibold text-ink">Net profit — month over month</h2>
        </div>
        <p className="mb-4 text-sm text-fog">
          This month {formatInr(stats.netThisMonth)} · Last month{" "}
          {formatInr(stats.netPrevMonth)}
        </p>
        <NetCompareChart
          thisMonth={stats.netThisMonth}
          prevMonth={stats.netPrevMonth}
          thisLabel="This month"
          prevLabel="Last month"
        />
      </Card>

      <p className="text-xs text-silver">
        {invoices.length} bills and {expenses.length} expenses synced. Today{" "}
        {formatDateIST(new Date())} (IST).
      </p>
    </div>
  );
}
