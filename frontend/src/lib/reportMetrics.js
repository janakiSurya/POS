/** IST calendar helpers and sales aggregation for reports. */

import { businessDateIST } from "./businessDay";
import { toNum } from "./format";

const TZ = "Asia/Kolkata";

export function invoiceDateIST(createdAt) {
  if (!createdAt) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(createdAt));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function istWeekday(date = new Date()) {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? 0;
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function formatYmd(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Add calendar days in IST (approx via UTC noon). */
export function addDaysYmd(ymd, delta) {
  const { y, m, d } = parseYmd(ymd);
  const utc = new Date(Date.UTC(y, m - 1, d + delta, 12, 0, 0));
  return formatYmd(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function lastDayOfMonthYmd(year, month) {
  const last = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
  return formatYmd(year, month, last);
}

export function thisWeekRangeIST() {
  const today = businessDateIST();
  const { y, m, d } = parseYmd(today);
  const wd = istWeekday(new Date());
  const daysFromMonday = wd === 0 ? 6 : wd - 1;
  const start = addDaysYmd(today, -daysFromMonday);
  return { start, end: today };
}

export function previousWeekRangeIST() {
  const { start: thisStart } = thisWeekRangeIST();
  const end = addDaysYmd(thisStart, -1);
  const start = addDaysYmd(thisStart, -7);
  return { start, end };
}

export function thisMonthRangeIST() {
  const today = businessDateIST();
  const { y, m } = parseYmd(today);
  return { start: formatYmd(y, m, 1), end: today };
}

export function previousMonthRangeIST() {
  const today = businessDateIST();
  const { y, m } = parseYmd(today);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const start = formatYmd(prevYear, prevMonth, 1);
  const end = lastDayOfMonthYmd(prevYear, prevMonth);
  return { start, end };
}

export function filterInvoicesByDateRange(invoices, startYmd, endYmd) {
  return filterRecordsByDateRange(invoices, startYmd, endYmd);
}

export function filterRecordsByDateRange(records, startYmd, endYmd) {
  return records.filter((row) => {
    const d = invoiceDateIST(row.created_at);
    return d >= startYmd && d <= endYmd;
  });
}

export function aggregateSales(invoices) {
  let revenue = 0;
  let cash = 0;
  let upi = 0;
  let credit = 0;
  for (const inv of invoices) {
    const amt = toNum(inv.total_amount);
    revenue += amt;
    if (inv.payment_method === "CASH") cash += amt;
    else if (inv.payment_method === "UPI") upi += amt;
    else if (inv.payment_method === "CREDIT") credit += amt;
  }
  return {
    revenue,
    count: invoices.length,
    cash,
    upi,
    credit,
    average: invoices.length ? revenue / invoices.length : 0,
  };
}

export function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function formatPctChange(value) {
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return "0%";
}

export function comparePeriods(currentInvoices, previousInvoices) {
  const current = aggregateSales(currentInvoices);
  const previous = aggregateSales(previousInvoices);
  return {
    current,
    previous,
    revenueChange: pctChange(current.revenue, previous.revenue),
    countChange: pctChange(current.count, previous.count),
  };
}

export function aggregateExpenses(expenses) {
  let total = 0;
  for (const e of expenses) {
    total += toNum(e.amount);
  }
  return {
    total,
    count: expenses.length,
    average: expenses.length ? total / expenses.length : 0,
  };
}

export function compareExpensePeriods(currentExpenses, previousExpenses) {
  const current = aggregateExpenses(currentExpenses);
  const previous = aggregateExpenses(previousExpenses);
  return {
    current,
    previous,
    totalChange: pctChange(current.total, previous.total),
    countChange: pctChange(current.count, previous.count),
  };
}

export function formatRangeLabel(start, end) {
  if (start === end) return start;
  return `${start} → ${end}`;
}

/** Daily sales totals for charting (fills every day in range). */
export function buildDailySalesSeries(invoices, startYmd, endYmd) {
  const filtered = filterInvoicesByDateRange(invoices, startYmd, endYmd);
  const byDay = new Map();
  for (const inv of filtered) {
    const d = invoiceDateIST(inv.created_at);
    byDay.set(d, (byDay.get(d) || 0) + toNum(inv.total_amount));
  }
  const series = [];
  let cursor = startYmd;
  while (cursor <= endYmd) {
    const [, m, day] = cursor.split("-");
    series.push({
      date: cursor,
      label: `${m}/${day}`,
      sales: byDay.get(cursor) || 0,
    });
    cursor = addDaysYmd(cursor, 1);
  }
  return series;
}

export function buildDailyExpenseSeries(expenses, startYmd, endYmd) {
  const filtered = filterRecordsByDateRange(expenses, startYmd, endYmd);
  const byDay = new Map();
  for (const e of filtered) {
    const d = invoiceDateIST(e.created_at);
    byDay.set(d, (byDay.get(d) || 0) + toNum(e.amount));
  }
  const series = [];
  let cursor = startYmd;
  while (cursor <= endYmd) {
    const [, m, day] = cursor.split("-");
    series.push({
      date: cursor,
      label: `${m}/${day}`,
      expenses: byDay.get(cursor) || 0,
    });
    cursor = addDaysYmd(cursor, 1);
  }
  return series;
}
