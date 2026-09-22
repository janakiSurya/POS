import { businessDateIST } from "./businessDay";
import { localDb, queueMutation } from "../db/localDb";
import { supabase } from "./supabaseClient";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { toNum } from "./format";
import { isOnline } from "./network";
import { saveDayCloseReport } from "./dayCloseReport";
import { FreshKeys, invalidateFresh } from "./freshSync";
import { normalizeExpensePaymentMode } from "./expenses";
import { getBankBalance, getCashOnHandBalance, recordBankExpenseOut } from "./bank";

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Close OPEN sessions from previous IST days (EOD auto-close). */
export async function autoCloseStaleSessions() {
  if (supabase && isOnline()) {
    try {
      await supabase.rpc("auto_close_stale_register_sessions");
    } catch (err) {
      console.warn("auto_close_stale_register_sessions", err);
    }
  }

  const today = businessDateIST();
  const openLocal = await localDb.register_sessions
    .filter((s) => s.status === "OPEN" && s.business_date < today)
    .toArray();

  for (const session of openLocal) {
    const totals = await computeExpectedTotals(session.id);
    const patch = {
      status: "CLOSED",
      closed_at: new Date().toISOString(),
      expected_cash: totals.cash,
      expected_upi: totals.upi,
      closing_cash: totals.cash,
      closing_upi: totals.upi,
      cash_variance: 0,
      upi_variance: 0,
      close_reason: "AUTO_EOD",
    };
    await localDb.register_sessions.update(session.id, patch);
    try {
      await saveDayCloseReport(session.id);
    } catch (err) {
      console.warn("auto close report", err);
    }
  }
}

export async function getTodayOpenSession() {
  await autoCloseStaleSessions();

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

async function getTodaySessionAnyStatus() {
  const date = businessDateIST();
  const locals = await localDb.register_sessions
    .where("business_date")
    .equals(date)
    .toArray();
  if (locals.length) {
    locals.sort((a, b) => String(b.opened_at || "").localeCompare(String(a.opened_at || "")));
    return locals[0];
  }

  if (!supabase || !isOnline()) return null;
  const { data } = await supabase
    .from("register_sessions")
    .select("*")
    .eq("business_date", date)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) await localDb.register_sessions.put(data);
  return data;
}

/**
 * Open today's session (no opening balances).
 * If a session was already closed earlier today, reopen that same row.
 */
export async function openShift({ userId }) {
  const existingOpen = await getTodayOpenSession();
  if (existingOpen) return existingOpen;

  const business_date = businessDateIST();
  const sameDay = await getTodaySessionAnyStatus();

  if (sameDay) {
    const patch = {
      status: "OPEN",
      closed_at: null,
      closed_by: null,
      close_reason: null,
      // keep prior expected/closing until next end; clear variance noise
      cash_variance: null,
      upi_variance: null,
    };

    if (supabase && isOnline()) {
      const { data, error } = await supabase
        .from("register_sessions")
        .update(patch)
        .eq("id", sameDay.id)
        .select()
        .single();
      if (error) throw error;
      await localDb.register_sessions.put(data);
      return data;
    }

    await localDb.register_sessions.update(sameDay.id, patch);
    return { ...sameDay, ...patch };
  }

  const row = {
    id: crypto.randomUUID(),
    business_date,
    user_id: userId,
    opening_cash: 0,
    opening_upi: 0,
    status: "OPEN",
    opened_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const { data, error } = await supabase
      .from("register_sessions")
      .insert({
        business_date,
        user_id: userId,
        opening_cash: 0,
        opening_upi: 0,
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

/**
 * End session — no counted cash/UPI. Stores expected balances and updates day-close PDF/report.
 */
export async function closeShift({ sessionId, userId, auto = false }) {
  const totals = await computeExpectedTotals(sessionId);

  const patch = {
    status: "CLOSED",
    closed_at: new Date().toISOString(),
    closing_cash: totals.cash,
    closing_upi: totals.upi,
    expected_cash: totals.cash,
    expected_upi: totals.upi,
    cash_variance: 0,
    upi_variance: 0,
    closed_by: userId || null,
    close_reason: auto ? "AUTO_EOD" : "MANUAL",
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

  // Upsert day-close report so reopen/close same day updates the PDF data
  const report = await saveDayCloseReport(sessionId);
  return { session, report, totals };
}

export async function computeExpectedTotals(sessionId) {
  const session = await localDb.register_sessions.get(sessionId);
  if (!session) {
    return {
      cash: 0,
      upi: 0,
      cashSales: 0,
      upiSales: 0,
      creditSales: 0,
      cashExpenses: 0,
      upiExpenses: 0,
    };
  }

  const invoices = await localDb.invoices
    .where("session_id")
    .equals(sessionId)
    .toArray();
  let cashSales = 0;
  let upiSales = 0;
  let creditSales = 0;
  for (const inv of invoices) {
    if (inv.payment_method === "CASH") cashSales += toNum(inv.total_amount);
    else if (inv.payment_method === "UPI") upiSales += toNum(inv.total_amount);
    else if (inv.payment_method === "CREDIT") creditSales += toNum(inv.total_amount);
  }

  const expenses = await localDb.cash_expenses
    .where("session_id")
    .equals(sessionId)
    .toArray();
  let cashExpenses = 0;
  let upiExpenses = 0;
  for (const e of expenses) {
    const mode = normalizeExpensePaymentMode(e.payment_mode);
    if (mode === "UPI") upiExpenses += toNum(e.amount);
    else if (mode === "CASH") cashExpenses += toNum(e.amount);
    // BANK / HAND ignored for till expected
  }

  // No opening float — expected = sales − expenses by mode
  const expectedCash = round(cashSales - cashExpenses);
  const expectedUpi = round(upiSales - upiExpenses);

  return {
    cash: expectedCash,
    upi: expectedUpi,
    cashSales: round(cashSales),
    upiSales: round(upiSales),
    creditSales: round(creditSales),
    cashExpenses: round(cashExpenses),
    upiExpenses: round(upiExpenses),
  };
}

export async function addExpense({
  sessionId,
  userId,
  amount,
  note,
  category = "MISC",
  paymentMode = "CASH",
}) {
  const mode = normalizeExpensePaymentMode(paymentMode);
  const amt = toNum(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");

  if (mode === "BANK") {
    const bank = await getBankBalance();
    if (amt > bank + 0.009) {
      throw new Error(`Not enough bank balance (₹${bank}).`);
    }
  } else if (mode === "HAND") {
    const cash = await getCashOnHandBalance();
    if (amt > cash + 0.009) {
      throw new Error(`Not enough cash in hand (₹${cash}).`);
    }
  }

  const row = {
    id: crypto.randomUUID(),
    session_id: sessionId,
    user_id: userId,
    amount: amt,
    note: note || "",
    category,
    payment_mode: mode,
    created_at: new Date().toISOString(),
  };

  let saved = row;
  if (supabase && navigator.onLine) {
    const { data, error } = await supabase
      .from("cash_expenses")
      .insert({
        session_id: sessionId,
        user_id: userId,
        amount: row.amount,
        note: row.note,
        category: row.category,
        payment_mode: mode,
      })
      .select()
      .single();
    if (error) throw error;
    await localDb.cash_expenses.put(data);
    saved = data;
  } else {
    await localDb.cash_expenses.put(row);
  }

  if (mode === "BANK" || mode === "HAND") {
    const ledger = await recordBankExpenseOut({
      amount: amt,
      entryDate: businessDateIST(),
      note: note?.trim() || `Expense · ${category}`,
      userId,
      cashExpenseId: saved.id,
      paymentMode: mode === "HAND" ? "CASH" : "BANK",
    });
    if (!(supabase && navigator.onLine)) {
      await queueMutation({
        type: "expense",
        payload: { ...row, bank_ledger: ledger },
      });
    }
  } else if (!(supabase && navigator.onLine)) {
    await queueMutation({ type: "expense", payload: row });
  }

  await invalidateFresh(FreshKeys.EXPENSES, FreshKeys.DASHBOARD);
  return saved;
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
