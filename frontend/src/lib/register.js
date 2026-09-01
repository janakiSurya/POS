import { businessDateIST } from "./businessDay";
import { localDb, queueMutation } from "../db/localDb";
import { supabase } from "./supabaseClient";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { toNum } from "./format";
import { isOnline } from "./network";
import { saveDayCloseReport } from "./dayCloseReport";

export async function getTodayOpenSession() {
  const date = businessDateIST();
  const local = await localDb.register_sessions
    .where("business_date")
    .equals(date)
    .and((s) => s.status === "OPEN")
    .first();
  if (local) return local;

  if (!supabase || !isOnline()) return null;
  const { data } = await supabase
    .from("register_sessions")
    .select("*")
    .eq("business_date", date)
    .eq("status", "OPEN")
    .maybeSingle();
  if (data) await localDb.register_sessions.put(data);
  return data;
}

export async function openShift({ userId, openingCash, openingUpi }) {
  const business_date = businessDateIST();
  const existing = await getTodayOpenSession();
  if (existing) throw new Error("Shift already open for today.");

  const row = {
    id: crypto.randomUUID(),
    business_date,
    user_id: userId,
    opening_cash: toNum(openingCash),
    opening_upi: toNum(openingUpi),
    status: "OPEN",
    opened_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const { data, error } = await supabase
      .from("register_sessions")
      .insert({
        business_date,
        user_id: userId,
        opening_cash: row.opening_cash,
        opening_upi: row.opening_upi,
        status: "OPEN",
      })
      .select()
      .single();
    if (error) throw error;
    await localDb.register_sessions.put(data);
    return data;
  }

  await localDb.register_sessions.put(row);
  return row;
}

export async function closeShift({
  sessionId,
  userId,
  closingCash,
  closingUpi,
  expectedCash,
  expectedUpi,
}) {
  const countedCash = toNum(closingCash);
  const countedUpi = toNum(closingUpi);
  const cashVariance = round(countedCash - toNum(expectedCash));
  const upiVariance = round(countedUpi - toNum(expectedUpi));

  const patch = {
    status: "CLOSED",
    closed_at: new Date().toISOString(),
    closing_cash: countedCash,
    closing_upi: countedUpi,
    expected_cash: toNum(expectedCash),
    expected_upi: toNum(expectedUpi),
    cash_variance: cashVariance,
    upi_variance: upiVariance,
    closed_by: userId,
  };

  let session;
  if (supabase && isOnline()) {
    const { data, error } = await supabase
      .from("register_sessions")
      .update(patch)
      .eq("id", sessionId)
      .select()
      .single();
    if (error) throw error;
    await localDb.register_sessions.put(data);
    session = data;
  } else {
    await localDb.register_sessions.update(sessionId, patch);
    session = { ...(await localDb.register_sessions.get(sessionId)), ...patch };
  }

  const report = await saveDayCloseReport(sessionId);
  return { session, report };
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function computeExpectedTotals(sessionId) {
  const session = await localDb.register_sessions.get(sessionId);
  if (!session) return { cash: 0, upi: 0 };

  const invoices = await localDb.invoices.where("session_id").equals(sessionId).toArray();
  let cashSales = 0;
  let upiSales = 0;
  for (const inv of invoices) {
    if (inv.payment_method === "CASH") cashSales += toNum(inv.total_amount);
    if (inv.payment_method === "UPI") upiSales += toNum(inv.total_amount);
  }

  const expenses = await localDb.cash_expenses.where("session_id").equals(sessionId).toArray();
  const cashExpenses = expenses.reduce((s, e) => s + toNum(e.amount), 0);

  const expectedCash = toNum(session.opening_cash) + cashSales - cashExpenses;
  const expectedUpi = toNum(session.opening_upi) + upiSales;

  return { cash: round(expectedCash), upi: round(expectedUpi), cashSales, upiSales, cashExpenses };
}

export async function addExpense({ sessionId, userId, amount, note }) {
  const row = {
    id: crypto.randomUUID(),
    session_id: sessionId,
    user_id: userId,
    amount: toNum(amount),
    note: note || "",
    created_at: new Date().toISOString(),
  };

  if (supabase && navigator.onLine) {
    const { data, error } = await supabase
      .from("cash_expenses")
      .insert({
        session_id: sessionId,
        user_id: userId,
        amount: row.amount,
        note: row.note,
      })
      .select()
      .single();
    if (error) throw error;
    await localDb.cash_expenses.put(data);
    return data;
  }

  await localDb.cash_expenses.put(row);
  await queueMutation({ type: "expense", payload: row });
  return row;
}

export async function syncAllExpensesFromServer() {
  if (!supabase || !isOnline()) return;
  const expenses = await fetchAllFromSupabase("cash_expenses", {
    order: (q) => q.order("created_at", { ascending: false }),
  });
  if (!expenses.length) return;
  await localDb.cash_expenses.clear();
  await localDb.cash_expenses.bulkPut(expenses);
}
