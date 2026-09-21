import { localDb } from "../db/localDb";
import { supabase } from "./supabaseClient";
import { isOnline } from "./network";
import { toNum } from "./format";
import { businessDateIST, formatDateIST } from "./businessDay";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { FreshKeys, invalidateFresh } from "./freshSync";

function round2(n) {
  return Math.round((toNum(n) + Number.EPSILON) * 100) / 100;
}

function ymdFromIso(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

export async function syncMoneyFromServer() {
  if (!supabase || !isOnline()) return;
  const [
    lenders,
    loanEntries,
    ledger,
    cashDeposits,
    cashDays,
    upiDeposits,
    purchases,
  ] = await Promise.all([
    fetchAllFromSupabase("lenders", { order: (q) => q.order("name") }),
    fetchAllFromSupabase("loan_entries", {
      order: (q) => q.order("entry_date", { ascending: false }),
    }),
    fetchAllFromSupabase("bank_ledger", {
      order: (q) => q.order("entry_date", { ascending: false }),
    }),
    fetchAllFromSupabase("cash_deposits", {
      order: (q) => q.order("deposited_on", { ascending: false }),
    }),
    fetchAllFromSupabase("cash_deposit_days"),
    fetchAllFromSupabase("upi_deposits", {
      order: (q) => q.order("business_date", { ascending: false }),
    }),
    fetchAllFromSupabase("purchase_invoices", {
      order: (q) => q.order("invoice_date", { ascending: false }),
    }),
  ]);

  await localDb.lenders.clear();
  await localDb.loan_entries.clear();
  await localDb.bank_ledger.clear();
  await localDb.cash_deposits.clear();
  await localDb.cash_deposit_days.clear();
  await localDb.upi_deposits.clear();

  if (lenders.length) await localDb.lenders.bulkPut(lenders);
  if (loanEntries.length) await localDb.loan_entries.bulkPut(loanEntries);
  if (ledger.length) await localDb.bank_ledger.bulkPut(ledger);
  if (cashDeposits.length) await localDb.cash_deposits.bulkPut(cashDeposits);
  if (cashDays.length) await localDb.cash_deposit_days.bulkPut(cashDays);
  if (upiDeposits.length) await localDb.upi_deposits.bulkPut(upiDeposits);
  if (purchases.length) await localDb.purchase_invoices.bulkPut(purchases);
}

/** Bank balance from ledger (IN − OUT). */
export async function getBankBalance() {
  const rows = await localDb.bank_ledger.toArray();
  let bal = 0;
  for (const r of rows) {
    const amt = toNum(r.amount);
    if (r.direction === "IN") bal += amt;
    else bal -= amt;
  }
  return round2(bal);
}

/** Write a bank OUT for an expense paid via bank. */
export async function recordBankExpenseOut({
  amount,
  entryDate,
  note,
  userId,
  cashExpenseId = null,
  fixedCostLogId = null,
}) {
  const amt = round2(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");
  const bank = await getBankBalance();
  if (amt > bank + 0.009) {
    throw new Error(`Not enough bank balance (₹${bank}).`);
  }
  const ledger = {
    id: crypto.randomUUID(),
    entry_date: entryDate || businessDateIST(),
    entry_type: "EXPENSE",
    amount: amt,
    direction: "OUT",
    note: note?.trim() || "Expense",
    cash_expense_id: cashExpenseId,
    fixed_cost_log_id: fixedCostLogId,
    created_by: userId,
    created_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const { data, error } = await supabase
      .from("bank_ledger")
      .insert(ledger)
      .select()
      .single();
    if (error) throw error;
    await localDb.bank_ledger.put(data);
    return data;
  }

  await localDb.bank_ledger.put(ledger);
  return ledger;
}

/** Per-day cash sales − cash expenses (IST). */
export async function buildDailyCashBuckets() {
  const invoices = await localDb.invoices.toArray();
  const expenses = await localDb.cash_expenses.toArray();
  const deposited = await localDb.cash_deposit_days.toArray();
  const depositedByDate = new Map(
    deposited.map((d) => [d.business_date, toNum(d.amount)]),
  );

  const byDate = new Map();

  function bump(date, field, amt) {
    if (!date) return;
    if (!byDate.has(date)) {
      byDate.set(date, {
        business_date: date,
        cashSales: 0,
        cashExpenses: 0,
        deposited: 0,
      });
    }
    byDate.get(date)[field] += amt;
  }

  for (const inv of invoices) {
    if (inv.payment_method !== "CASH") continue;
    bump(ymdFromIso(inv.created_at), "cashSales", toNum(inv.total_amount));
  }
  for (const e of expenses) {
    // BANK expenses do not reduce till cash
    if (e.payment_mode === "UPI" || e.payment_mode === "BANK") continue;
    bump(ymdFromIso(e.created_at), "cashExpenses", toNum(e.amount));
  }
  for (const [date, amt] of depositedByDate) {
    bump(date, "deposited", amt);
  }

  const rows = [...byDate.values()]
    .map((r) => {
      const net = round2(r.cashSales - r.cashExpenses);
      const remaining = round2(Math.max(0, net - r.deposited));
      return {
        business_date: r.business_date,
        cashSales: round2(r.cashSales),
        cashExpenses: round2(r.cashExpenses),
        net,
        deposited: round2(r.deposited),
        remaining,
        label: formatDateIST(r.business_date + "T12:00:00"),
      };
    })
    .filter((r) => r.net > 0 || r.deposited > 0 || r.remaining > 0)
    .sort((a, b) => a.business_date.localeCompare(b.business_date));

  return rows;
}

export async function getUndepositedCashDays() {
  const rows = await buildDailyCashBuckets();
  return rows.filter((r) => r.remaining > 0.009);
}

export async function getUndepositedCashTotal() {
  const days = await getUndepositedCashDays();
  return round2(days.reduce((s, d) => s + d.remaining, 0));
}

/** Per-day UPI sales − UPI expenses. */
export async function buildDailyUpiBuckets() {
  const invoices = await localDb.invoices.toArray();
  const expenses = await localDb.cash_expenses.toArray();
  const confirmed = await localDb.upi_deposits.toArray();
  const confirmedSet = new Set(confirmed.map((u) => u.business_date));

  const byDate = new Map();
  function bump(date, field, amt) {
    if (!date) return;
    if (!byDate.has(date)) {
      byDate.set(date, { business_date: date, upiSales: 0, upiExpenses: 0 });
    }
    byDate.get(date)[field] += amt;
  }

  for (const inv of invoices) {
    if (inv.payment_method !== "UPI") continue;
    bump(ymdFromIso(inv.created_at), "upiSales", toNum(inv.total_amount));
  }
  for (const e of expenses) {
    if (e.payment_mode !== "UPI") continue;
    bump(ymdFromIso(e.created_at), "upiExpenses", toNum(e.amount));
  }

  return [...byDate.values()]
    .map((r) => {
      const net = round2(r.upiSales - r.upiExpenses);
      return {
        business_date: r.business_date,
        upiSales: round2(r.upiSales),
        upiExpenses: round2(r.upiExpenses),
        net,
        confirmed: confirmedSet.has(r.business_date),
        remaining: confirmedSet.has(r.business_date) ? 0 : Math.max(0, net),
        label: formatDateIST(r.business_date + "T12:00:00"),
      };
    })
    .filter((r) => r.net > 0 || r.confirmed)
    .sort((a, b) => a.business_date.localeCompare(b.business_date));
}

export async function getUnconfirmedUpiDays() {
  const rows = await buildDailyUpiBuckets();
  return rows.filter((r) => !r.confirmed && r.remaining > 0.009);
}

export async function getLenderOutstanding(lenderId) {
  const entries = await localDb.loan_entries
    .where("lender_id")
    .equals(lenderId)
    .toArray();
  let bal = 0;
  for (const e of entries) {
    if (e.entry_type === "RECEIVED") bal += toNum(e.amount);
    else bal -= toNum(e.amount);
  }
  return round2(bal);
}

export async function getTotalLoanOutstanding() {
  const lenders = await localDb.lenders.toArray();
  let total = 0;
  for (const l of lenders) {
    total += await getLenderOutstanding(l.id);
  }
  return round2(total);
}

export async function getMoneyOverview() {
  const [bankBalance, undepositedCash, loanOutstanding, undepositedDays, upiPending] =
    await Promise.all([
      getBankBalance(),
      getUndepositedCashTotal(),
      getTotalLoanOutstanding(),
      getUndepositedCashDays(),
      getUnconfirmedUpiDays(),
    ]);
  return {
    bankBalance,
    undepositedCash,
    loanOutstanding,
    undepositedDayCount: undepositedDays.length,
    upiPendingTotal: round2(upiPending.reduce((s, d) => s + d.remaining, 0)),
    upiPendingDays: upiPending.length,
  };
}

// ─── Lenders / loans ─────────────────────────────────────────────────────────

export async function listLendersWithBalances() {
  const lenders = await localDb.lenders.orderBy("name").toArray();
  const out = [];
  for (const l of lenders) {
    out.push({ ...l, outstanding: await getLenderOutstanding(l.id) });
  }
  return out;
}

export async function createLender({ name, phone, notes }) {
  const row = {
    id: crypto.randomUUID(),
    name: name.trim(),
    phone: phone?.trim() || null,
    notes: notes?.trim() || null,
    created_at: new Date().toISOString(),
  };
  if (supabase && isOnline()) {
    const { data, error } = await supabase.from("lenders").insert(row).select().single();
    if (error) throw error;
    await localDb.lenders.put(data);
    return data;
  }
  await localDb.lenders.put(row);
  return row;
}

export async function recordLoanEntry({
  lenderId,
  entryType,
  amount,
  entryDate,
  note,
  userId,
}) {
  const amt = round2(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");
  if (entryType === "REPAID") {
    const owed = await getLenderOutstanding(lenderId);
    if (amt > owed + 0.009) {
      throw new Error(`Repayment exceeds outstanding (${owed}).`);
    }
    const bank = await getBankBalance();
    if (amt > bank + 0.009) {
      throw new Error(`Not enough bank balance (₹${bank}).`);
    }
  }

  const entry = {
    id: crypto.randomUUID(),
    lender_id: lenderId,
    entry_type: entryType,
    amount: amt,
    entry_date: entryDate || businessDateIST(),
    note: note?.trim() || null,
    created_by: userId,
    created_at: new Date().toISOString(),
  };

  const ledger = {
    id: crypto.randomUUID(),
    entry_date: entry.entry_date,
    entry_type: entryType === "RECEIVED" ? "LOAN_IN" : "LOAN_OUT",
    amount: amt,
    direction: entryType === "RECEIVED" ? "IN" : "OUT",
    note: note?.trim() || null,
    lender_id: lenderId,
    loan_entry_id: entry.id,
    created_by: userId,
    created_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const { data: eData, error: eErr } = await supabase
      .from("loan_entries")
      .insert(entry)
      .select()
      .single();
    if (eErr) throw eErr;
    ledger.loan_entry_id = eData.id;
    const { data: lData, error: lErr } = await supabase
      .from("bank_ledger")
      .insert({ ...ledger, loan_entry_id: eData.id })
      .select()
      .single();
    if (lErr) throw lErr;
    await localDb.loan_entries.put(eData);
    await localDb.bank_ledger.put(lData);
    return { entry: eData, ledger: lData };
  }

  await localDb.loan_entries.put(entry);
  await localDb.bank_ledger.put(ledger);
  return { entry, ledger };
}

export async function listLoanEntries(lenderId) {
  const rows = await localDb.loan_entries
    .where("lender_id")
    .equals(lenderId)
    .toArray();
  return rows.sort((a, b) =>
    String(b.entry_date).localeCompare(String(a.entry_date)),
  );
}

// ─── Cash deposit ────────────────────────────────────────────────────────────

export async function confirmCashDeposit({
  depositedOn,
  note,
  userId,
  dayIds, // optional subset of business_dates; default all undeposited
}) {
  let days = await getUndepositedCashDays();
  if (dayIds?.length) {
    const set = new Set(dayIds);
    days = days.filter((d) => set.has(d.business_date));
  }
  if (!days.length) throw new Error("No undeposited cash to deposit.");

  const total = round2(days.reduce((s, d) => s + d.remaining, 0));
  const deposit = {
    id: crypto.randomUUID(),
    deposited_on: depositedOn || businessDateIST(),
    total_amount: total,
    note: note?.trim() || null,
    created_by: userId,
    created_at: new Date().toISOString(),
  };
  const dayRows = days.map((d) => ({
    id: crypto.randomUUID(),
    cash_deposit_id: deposit.id,
    business_date: d.business_date,
    amount: d.remaining,
  }));
  const ledger = {
    id: crypto.randomUUID(),
    entry_date: deposit.deposited_on,
    entry_type: "CASH_DEPOSIT",
    amount: total,
    direction: "IN",
    note:
      note?.trim() ||
      `Cash deposit covering ${days.map((d) => d.business_date).join(", ")}`,
    cash_deposit_id: deposit.id,
    created_by: userId,
    created_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const { data: dep, error: dErr } = await supabase
      .from("cash_deposits")
      .insert(deposit)
      .select()
      .single();
    if (dErr) throw dErr;
    const daysPayload = dayRows.map((r) => ({
      ...r,
      cash_deposit_id: dep.id,
    }));
    const { data: daysData, error: daysErr } = await supabase
      .from("cash_deposit_days")
      .insert(daysPayload)
      .select();
    if (daysErr) throw daysErr;
    const { data: led, error: lErr } = await supabase
      .from("bank_ledger")
      .insert({ ...ledger, cash_deposit_id: dep.id })
      .select()
      .single();
    if (lErr) throw lErr;
    await localDb.cash_deposits.put(dep);
    await localDb.cash_deposit_days.bulkPut(daysData);
    await localDb.bank_ledger.put(led);
    return { deposit: dep, days: daysData, ledger: led };
  }

  await localDb.cash_deposits.put(deposit);
  await localDb.cash_deposit_days.bulkPut(dayRows);
  await localDb.bank_ledger.put(ledger);
  return { deposit, days: dayRows, ledger };
}

// ─── UPI deposit ─────────────────────────────────────────────────────────────

export async function confirmUpiDeposit({ businessDate, userId, note }) {
  const date = businessDate || businessDateIST();
  const existing = await localDb.upi_deposits
    .where("business_date")
    .equals(date)
    .first();
  if (existing) throw new Error("UPI for this day is already confirmed.");

  const buckets = await buildDailyUpiBuckets();
  const day = buckets.find((b) => b.business_date === date);
  if (!day || day.remaining <= 0) {
    throw new Error("No UPI amount to deposit for this day.");
  }

  const row = {
    id: crypto.randomUUID(),
    business_date: date,
    amount: day.remaining,
    confirmed_at: new Date().toISOString(),
    created_by: userId,
    note: note?.trim() || null,
  };
  const ledger = {
    id: crypto.randomUUID(),
    entry_date: date,
    entry_type: "UPI_DEPOSIT",
    amount: day.remaining,
    direction: "IN",
    note: note?.trim() || `UPI sales deposit for ${date}`,
    upi_deposit_id: row.id,
    created_by: userId,
    created_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const { data: upi, error: uErr } = await supabase
      .from("upi_deposits")
      .insert(row)
      .select()
      .single();
    if (uErr) throw uErr;
    const { data: led, error: lErr } = await supabase
      .from("bank_ledger")
      .insert({ ...ledger, upi_deposit_id: upi.id })
      .select()
      .single();
    if (lErr) throw lErr;
    await localDb.upi_deposits.put(upi);
    await localDb.bank_ledger.put(led);
    return { upi, ledger: led };
  }

  await localDb.upi_deposits.put(row);
  await localDb.bank_ledger.put(ledger);
  return { upi: row, ledger };
}

// ─── Supplier payment ────────────────────────────────────────────────────────

/** Amount owed to supplier = printed invoice total when present. */
export function purchasePayableTotal(inv) {
  const printed = toNum(inv?.printed_grand_total);
  if (printed > 0) return printed;
  return toNum(inv?.total_amount);
}

function paymentStatus(total, paid) {
  const t = toNum(total);
  const p = toNum(paid);
  if (p <= 0) return "UNPAID";
  if (p + 0.009 >= t) return "PAID";
  return "PARTIAL";
}

export async function payPurchaseInvoice({
  purchaseInvoiceId,
  amount,
  entryDate,
  note,
  userId,
}) {
  const inv = await localDb.purchase_invoices.get(purchaseInvoiceId);
  if (!inv) throw new Error("Purchase invoice not found.");

  const amt = round2(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");

  const already = toNum(inv.amount_paid);
  const total = purchasePayableTotal(inv);
  const remaining = round2(Math.max(0, total - already));
  if (amt > remaining + 0.009) {
    throw new Error(`Payment exceeds remaining (₹${remaining}).`);
  }

  const bank = await getBankBalance();
  if (amt > bank + 0.009) {
    throw new Error(`Not enough bank balance (₹${bank}).`);
  }

  const newPaid = round2(already + amt);
  const status = paymentStatus(total, newPaid);
  const date = entryDate || businessDateIST();

  const ledger = {
    id: crypto.randomUUID(),
    entry_date: date,
    entry_type: "SUPPLIER_PAYMENT",
    amount: amt,
    direction: "OUT",
    note: note?.trim() || `Payment for invoice ${inv.invoice_number}`,
    supplier_id: inv.supplier_id,
    purchase_invoice_id: inv.id,
    created_by: userId,
    created_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const { data: led, error: lErr } = await supabase
      .from("bank_ledger")
      .insert(ledger)
      .select()
      .single();
    if (lErr) throw lErr;
    const { data: updated, error: uErr } = await supabase
      .from("purchase_invoices")
      .update({
        amount_paid: newPaid,
        payment_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inv.id)
      .select()
      .single();
    if (uErr) throw uErr;
    await localDb.bank_ledger.put(led);
    await localDb.purchase_invoices.put(updated);
    await invalidateFresh(FreshKeys.PURCHASES, FreshKeys.DASHBOARD);
    return { ledger: led, invoice: updated };
  }

  await localDb.bank_ledger.put(ledger);
  const updated = {
    ...inv,
    amount_paid: newPaid,
    payment_status: status,
    updated_at: new Date().toISOString(),
  };
  await localDb.purchase_invoices.put(updated);
  return { ledger, invoice: updated };
}

export async function listBankLedger(limit = 50) {
  const rows = await localDb.bank_ledger
    .orderBy("entry_date")
    .reverse()
    .limit(limit)
    .toArray();
  return rows;
}

export async function listUnpaidPurchaseInvoices() {
  const all = await localDb.purchase_invoices
    .orderBy("invoice_date")
    .reverse()
    .toArray();
  return all.filter((i) => {
    if (i.status !== "POSTED") return false;
    return paymentStatus(purchasePayableTotal(i), i.amount_paid) !== "PAID";
  });
}
