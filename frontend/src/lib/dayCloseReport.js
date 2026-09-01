import { localDb } from "../db/localDb";
import { formatDateIST } from "./businessDay";
import { toNum } from "./format";
import { computeExpectedTotals } from "./register";
import { supabase } from "./supabaseClient";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { isOnline } from "./network";

export async function buildSessionCloseReport(sessionId) {
  const session = await localDb.register_sessions.get(sessionId);
  if (!session) throw new Error("Session not found.");

  const invoices = await localDb.invoices
    .where("session_id")
    .equals(sessionId)
    .toArray();
  const expenses = await localDb.cash_expenses
    .where("session_id")
    .equals(sessionId)
    .toArray();
  const shop = await localDb.shop_settings.get("default");
  const totals = await computeExpectedTotals(sessionId);

  let cashSales = 0;
  let upiSales = 0;
  let creditSales = 0;
  for (const inv of invoices) {
    const amt = toNum(inv.total_amount);
    if (inv.payment_method === "CASH") cashSales += amt;
    if (inv.payment_method === "UPI") upiSales += amt;
    if (inv.payment_method === "CREDIT") creditSales += amt;
  }

  const bills = invoices
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((inv) => ({
      invoice_number: inv.invoice_number || "—",
      payment_method: inv.payment_method,
      total_amount: toNum(inv.total_amount),
      created_at: inv.created_at,
    }));

  return {
    id: crypto.randomUUID(),
    session_id: sessionId,
    business_date: session.business_date,
    shop_name: shop?.name || "Sri Sri Satya Sai Automobile Agency",
    shop_address: shop?.address || "",
    shop_phone: shop?.phone || "",
    opened_at: session.opened_at,
    closed_at: session.closed_at,
    opening_cash: toNum(session.opening_cash),
    opening_upi: toNum(session.opening_upi),
    closing_cash: toNum(session.closing_cash),
    closing_upi: toNum(session.closing_upi),
    expected_cash: toNum(session.expected_cash),
    expected_upi: toNum(session.expected_upi),
    cash_variance: toNum(session.cash_variance),
    upi_variance: toNum(session.upi_variance),
    cash_sales: totals.cashSales ?? cashSales,
    upi_sales: totals.upiSales ?? upiSales,
    credit_sales: creditSales,
    total_sales: cashSales + upiSales + creditSales,
    bill_count: invoices.length,
    cash_expenses: totals.cashExpenses ?? 0,
    expense_entries: expenses.map((e) => ({
      amount: toNum(e.amount),
      note: e.note || "",
      created_at: e.created_at,
    })),
    bills,
    generated_at: new Date().toISOString(),
    generated_label: formatDateIST(new Date()),
  };
}

export async function saveDayCloseReport(sessionId) {
  const report = await buildSessionCloseReport(sessionId);
  const row = {
    id: report.id,
    session_id: sessionId,
    business_date: report.business_date,
    report_json: report,
    created_at: report.generated_at,
  };
  await localDb.day_close_reports.put(row);

  if (supabase && isOnline()) {
    const { error } = await supabase.from("day_close_reports").upsert(
      {
        id: report.id,
        session_id: sessionId,
        business_date: report.business_date,
        report_json: report,
      },
      { onConflict: "session_id" },
    );
    if (error) console.error("saveDayCloseReport", error);
  }

  return report;
}

export async function listDayCloseReports(limit = 60) {
  return localDb.day_close_reports
    .orderBy("business_date")
    .reverse()
    .limit(limit)
    .toArray();
}

export async function getDayCloseReport(sessionId) {
  return localDb.day_close_reports.where("session_id").equals(sessionId).first();
}

export async function syncDayCloseReportsFromServer() {
  if (!supabase || !isOnline()) return;
  const rows = await fetchAllFromSupabase("day_close_reports", {
    order: (q) => q.order("business_date", { ascending: false }),
  });
  if (!rows.length) return;
  await localDb.day_close_reports.bulkPut(
    rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      business_date: r.business_date,
      report_json: r.report_json,
      created_at: r.created_at,
    })),
  );
}

/** Push locally saved reports after offline shift close. */
export async function syncPendingDayCloseReports() {
  if (!supabase || !isOnline()) return;
  const rows = await localDb.day_close_reports.toArray();
  for (const row of rows) {
    const { error } = await supabase.from("day_close_reports").upsert(
      {
        id: row.id,
        session_id: row.session_id,
        business_date: row.business_date,
        report_json: row.report_json,
        created_at: row.created_at,
      },
      { onConflict: "session_id" },
    );
    if (error) console.error("syncPendingDayCloseReports", error);
  }
}
