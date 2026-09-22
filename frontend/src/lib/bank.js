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

/** Bank balance from ledger (IN − OUT), bank-mode rows only. */
export async function getBankBalance() {
  const rows = await localDb.bank_ledger.toArray();
  let bal = 0;
  for (const r of rows) {
    if (r.payment_mode === "CASH") continue;
    const amt = toNum(r.amount);
    if (r.direction === "IN") bal += amt;
    else bal -= amt;
  }
  return round2(bal);
}

/**
 * Write an expense OUT from bank or loan cash (cash on hand).
 * paymentMode: "BANK" (default) or "CASH".
 */
export async function recordBankExpenseOut({
  amount,
  entryDate,
  note,
  userId,
  cashExpenseId = null,
  fixedCostLogId = null,
  paymentMode = "BANK",
}) {
  const amt = round2(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");
  const mode = paymentMode === "CASH" ? "CASH" : "BANK";
  if (mode === "BANK") {
    const bank = await getBankBalance();
    if (amt > bank + 0.009) {
      throw new Error(`Not enough bank balance (₹${bank}).`);
    }
  } else {
    const cash = await getCashOnHandBalance();
    if (amt > cash + 0.009) {
      throw new Error(`Not enough cash on hand (₹${cash}).`);
    }
  }
  const ledger = {
    id: crypto.randomUUID(),
    entry_date: entryDate || businessDateIST(),
    entry_type: "EXPENSE",
    amount: amt,
    direction: "OUT",
    payment_mode: mode,
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

/** Per-day sales cash only (till) − cash expenses. Deposit to bank only — not for paying suppliers/loans. */
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
    // Till cash only — UPI/BANK/HAND expenses do not reduce undeposited sales cash
    if (e.payment_mode === "UPI" || e.payment_mode === "BANK" || e.payment_mode === "HAND") continue;
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

/**
 * Cash-on-hand wallet (loan cash etc.) — separate from undeposited sales cash.
 * + cash loan received − cash loan repaid − cash-mode ledger OUTs (supplier, etc.)
 */
export async function getCashOnHandBalance() {
  const [loans, ledger] = await Promise.all([
    localDb.loan_entries.toArray(),
    localDb.bank_ledger.toArray(),
  ]);
  let bal = 0;
  for (const e of loans) {
    if (e.payment_mode !== "CASH") continue;
    if (e.entry_type === "RECEIVED") bal += toNum(e.amount);
    else if (e.entry_type === "REPAID") bal -= toNum(e.amount);
  }
  for (const r of ledger) {
    if (r.payment_mode !== "CASH") continue;
    const amt = toNum(r.amount);
    if (r.direction === "IN") bal += amt;
    else bal -= amt;
  }
  return round2(bal);
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
  return getLenderPrincipalOutstanding(lenderId);
}

/** Principal only: RECEIVED − (REPAID amount − interest_amount). */
export async function getLenderPrincipalOutstanding(lenderId) {
  const entries = await localDb.loan_entries
    .where("lender_id")
    .equals(lenderId)
    .toArray();
  let bal = 0;
  for (const e of entries) {
    if (e.entry_type === "RECEIVED") bal += toNum(e.amount);
    else if (e.entry_type === "REPAID") {
      bal -= toNum(e.amount) - toNum(e.interest_amount);
    }
  }
  return round2(Math.max(0, bal));
}

function daysBetweenYmd(fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return 0;
  const a = new Date(`${String(fromYmd).slice(0, 10)}T12:00:00`);
  const b = new Date(`${String(toYmd).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function normalizeLoanPaymentMode(mode) {
  return mode === "CASH" ? "CASH" : "BANK";
}

/** Unpaid principal slices after FIFO application of repayments. */
export async function getLenderPrincipalTranches(lenderId) {
  const entries = await localDb.loan_entries
    .where("lender_id")
    .equals(lenderId)
    .toArray();
  entries.sort((a, b) => {
    const d = String(a.entry_date).localeCompare(String(b.entry_date));
    if (d !== 0) return d;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  const tranches = [];
  for (const e of entries) {
    if (e.entry_type === "RECEIVED") {
      tranches.push({
        id: e.id,
        entry_date: String(e.entry_date).slice(0, 10),
        remaining: toNum(e.amount),
      });
      continue;
    }
    if (e.entry_type !== "REPAID") continue;
    let principal = round2(toNum(e.amount) - toNum(e.interest_amount));
    for (const t of tranches) {
      if (principal <= 0.009) break;
      const take = Math.min(t.remaining, principal);
      t.remaining = round2(t.remaining - take);
      principal = round2(principal - take);
    }
  }
  return tranches.filter((t) => t.remaining > 0.009);
}

export async function getLenderAccruedInterest(lenderId, asOfDate, monthlyRate) {
  let rate = monthlyRate;
  if (rate == null) {
    const lender = await localDb.lenders.get(lenderId);
    rate = toNum(lender?.interest_rate_monthly);
  }
  rate = toNum(rate);
  if (rate <= 0) return 0;

  const asOf = String(asOfDate || businessDateIST()).slice(0, 10);
  const tranches = await getLenderPrincipalTranches(lenderId);
  let interest = 0;
  for (const t of tranches) {
    const days = daysBetweenYmd(t.entry_date, asOf);
    interest += t.remaining * (rate / 100) * (days / 30);
  }
  return round2(interest);
}

export async function getLenderRepayBreakdown(lenderId, asOfDate) {
  const lender = await localDb.lenders.get(lenderId);
  const principal = await getLenderPrincipalOutstanding(lenderId);
  const interest = await getLenderAccruedInterest(
    lenderId,
    asOfDate,
    lender?.interest_rate_monthly,
  );
  return {
    principal,
    interest,
    total: round2(principal + interest),
    rateMonthly: toNum(lender?.interest_rate_monthly),
  };
}

export async function getTotalLoanOutstanding() {
  const lenders = await localDb.lenders.toArray();
  let total = 0;
  for (const l of lenders) {
    total += await getLenderPrincipalOutstanding(l.id);
  }
  return round2(total);
}

export async function getMoneyOverview() {
  const [
    bankBalance,
    undepositedCash,
    cashOnHand,
    loanOutstanding,
    undepositedDays,
    upiPending,
  ] = await Promise.all([
    getBankBalance(),
    getUndepositedCashTotal(),
    getCashOnHandBalance(),
    getTotalLoanOutstanding(),
    getUndepositedCashDays(),
    getUnconfirmedUpiDays(),
  ]);
  return {
    bankBalance,
    undepositedCash,
    cashOnHand,
    loanOutstanding,
    undepositedDayCount: undepositedDays.length,
    upiPendingTotal: round2(upiPending.reduce((s, d) => s + d.remaining, 0)),
    upiPendingDays: upiPending.length,
  };
}

// ─── Lenders / loans ─────────────────────────────────────────────────────────

export async function listLendersWithBalances() {
  const lenders = await localDb.lenders.orderBy("name").toArray();
  const today = businessDateIST();
  const out = [];
  for (const l of lenders) {
    const outstanding = await getLenderPrincipalOutstanding(l.id);
    const interestDue = await getLenderAccruedInterest(
      l.id,
      today,
      l.interest_rate_monthly,
    );
    out.push({ ...l, outstanding, interestDue });
  }
  return out;
}

export async function createLender({ name, phone, notes, interestRateMonthly }) {
  const rateRaw = interestRateMonthly;
  const rate =
    rateRaw === "" || rateRaw == null || Number.isNaN(Number(rateRaw))
      ? null
      : toNum(rateRaw);
  const row = {
    id: crypto.randomUUID(),
    name: name.trim(),
    phone: phone?.trim() || null,
    notes: notes?.trim() || null,
    interest_rate_monthly: rate != null && rate > 0 ? rate : null,
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
  paymentMode = "BANK",
}) {
  const amt = round2(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");
  const mode = normalizeLoanPaymentMode(paymentMode);
  const date = entryDate || businessDateIST();

  let interestAmount = 0;
  if (entryType === "REPAID") {
    const breakdown = await getLenderRepayBreakdown(lenderId, date);
    if (amt > breakdown.total + 0.009) {
      throw new Error(
        `Repayment exceeds principal + interest (₹${breakdown.total}).`,
      );
    }
    interestAmount = round2(Math.min(amt, breakdown.interest));
    const principalPart = round2(amt - interestAmount);
    if (principalPart > breakdown.principal + 0.009) {
      throw new Error(`Principal portion exceeds outstanding (₹${breakdown.principal}).`);
    }

    if (mode === "BANK") {
      const bank = await getBankBalance();
      if (amt > bank + 0.009) {
        throw new Error(`Not enough bank balance (₹${bank}).`);
      }
    } else {
      const cash = await getCashOnHandBalance();
      if (amt > cash + 0.009) {
        throw new Error(`Not enough cash on hand (₹${cash}).`);
      }
    }
  }

  const entry = {
    id: crypto.randomUUID(),
    lender_id: lenderId,
    entry_type: entryType,
    amount: amt,
    interest_amount: entryType === "REPAID" ? interestAmount : 0,
    payment_mode: mode,
    entry_date: date,
    note: note?.trim() || null,
    created_by: userId,
    created_at: new Date().toISOString(),
  };

  const writeLedger = mode === "BANK";
  const ledger = writeLedger
    ? {
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
      }
    : null;

  if (supabase && isOnline()) {
    const { data: eData, error: eErr } = await supabase
      .from("loan_entries")
      .insert(entry)
      .select()
      .single();
    if (eErr) throw eErr;
    await localDb.loan_entries.put(eData);

    let lData = null;
    if (ledger) {
      ledger.loan_entry_id = eData.id;
      const { data, error: lErr } = await supabase
        .from("bank_ledger")
        .insert({ ...ledger, loan_entry_id: eData.id })
        .select()
        .single();
      if (lErr) throw lErr;
      await localDb.bank_ledger.put(data);
      lData = data;
    }
    return { entry: eData, ledger: lData };
  }

  await localDb.loan_entries.put(entry);
  if (ledger) await localDb.bank_ledger.put(ledger);
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

async function findLedgerForLoanEntry(loanEntryId) {
  const rows = await localDb.bank_ledger.toArray();
  return rows.find((r) => r.loan_entry_id === loanEntryId) || null;
}

/**
 * Correct a loan history row (amount / Cash↔Bank / date / note).
 * Keeps bank_ledger and cash-on-hand in sync.
 */
export async function updateLoanEntry({
  entryId,
  amount,
  entryDate,
  note,
  paymentMode,
}) {
  const existing = await localDb.loan_entries.get(entryId);
  if (!existing) throw new Error("Loan entry not found.");

  const amt = round2(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");
  const mode = normalizeLoanPaymentMode(paymentMode);
  const date = entryDate || existing.entry_date || businessDateIST();
  const noteVal =
    note === undefined ? existing.note : note?.trim() || null;
  const oldMode = normalizeLoanPaymentMode(existing.payment_mode);
  const oldAmt = toNum(existing.amount);

  let interestAmount = 0;
  if (existing.entry_type === "REPAID") {
    // Treat as if this repayment is not yet applied, then re-split interest.
    const all = await localDb.loan_entries
      .where("lender_id")
      .equals(existing.lender_id)
      .toArray();
    let principal = 0;
    for (const e of all) {
      if (e.id === entryId) continue;
      if (e.entry_type === "RECEIVED") principal += toNum(e.amount);
      else if (e.entry_type === "REPAID") {
        principal -= toNum(e.amount) - toNum(e.interest_amount);
      }
    }
    principal = round2(Math.max(0, principal));

    const lender = await localDb.lenders.get(existing.lender_id);
    const rate = toNum(lender?.interest_rate_monthly);
    let interest = 0;
    if (rate > 0) {
      // Rebuild tranches without this repayment (or without this receive if ever).
      const others = all
        .filter((e) => e.id !== entryId)
        .sort((a, b) => {
          const d = String(a.entry_date).localeCompare(String(b.entry_date));
          if (d !== 0) return d;
          return String(a.created_at || "").localeCompare(
            String(b.created_at || ""),
          );
        });
      const tranches = [];
      for (const e of others) {
        if (e.entry_type === "RECEIVED") {
          tranches.push({
            entry_date: String(e.entry_date).slice(0, 10),
            remaining: toNum(e.amount),
          });
          continue;
        }
        if (e.entry_type !== "REPAID") continue;
        let p = round2(toNum(e.amount) - toNum(e.interest_amount));
        for (const t of tranches) {
          if (p <= 0.009) break;
          const take = Math.min(t.remaining, p);
          t.remaining = round2(t.remaining - take);
          p = round2(p - take);
        }
      }
      const asOf = String(date).slice(0, 10);
      for (const t of tranches.filter((x) => x.remaining > 0.009)) {
        const days = daysBetweenYmd(t.entry_date, asOf);
        interest += t.remaining * (rate / 100) * (days / 30);
      }
      interest = round2(interest);
    }

    const maxTotal = round2(principal + interest);
    if (amt > maxTotal + 0.009) {
      throw new Error(
        `Repayment exceeds principal + interest (₹${maxTotal}).`,
      );
    }
    interestAmount = round2(Math.min(amt, interest));
    const principalPart = round2(amt - interestAmount);
    if (principalPart > principal + 0.009) {
      throw new Error(
        `Principal portion exceeds outstanding (₹${principal}).`,
      );
    }
  } else if (existing.entry_type === "RECEIVED") {
    // Shrinking a receive must not leave principal negative after later repayments.
    const all = await localDb.loan_entries
      .where("lender_id")
      .equals(existing.lender_id)
      .toArray();
    let bal = 0;
    const sorted = [...all].sort((a, b) => {
      const d = String(a.entry_date).localeCompare(String(b.entry_date));
      if (d !== 0) return d;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
    for (const e of sorted) {
      const eAmt = e.id === entryId ? amt : toNum(e.amount);
      const eInt = e.id === entryId ? 0 : toNum(e.interest_amount);
      if (e.entry_type === "RECEIVED") bal += eAmt;
      else if (e.entry_type === "REPAID") bal -= eAmt - eInt;
      if (bal < -0.009) {
        throw new Error(
          "Cannot reduce this loan: repayments already exceed the new amount.",
        );
      }
    }
  }

  // Cash / bank affordability after reversing the old effect and applying the new one.
  if (existing.entry_type === "REPAID" || mode === "CASH" || oldMode === "CASH") {
    let cash = await getCashOnHandBalance();
    if (oldMode === "CASH") {
      if (existing.entry_type === "RECEIVED") cash -= oldAmt;
      else cash += oldAmt;
    }
    if (mode === "CASH") {
      if (existing.entry_type === "RECEIVED") cash += amt;
      else cash -= amt;
    }
    if (cash < -0.009) {
      throw new Error(
        `Not enough cash on hand after this change (short ₹${round2(-cash)}).`,
      );
    }
  }
  if (existing.entry_type === "REPAID" || mode === "BANK" || oldMode === "BANK") {
    let bank = await getBankBalance();
    if (oldMode === "BANK") {
      if (existing.entry_type === "RECEIVED") bank -= oldAmt;
      else bank += oldAmt;
    }
    if (mode === "BANK") {
      if (existing.entry_type === "RECEIVED") bank += amt;
      else bank -= amt;
    }
    if (bank < -0.009) {
      throw new Error(
        `Not enough bank balance after this change (short ₹${round2(-bank)}).`,
      );
    }
  }

  const patch = {
    ...existing,
    amount: amt,
    interest_amount:
      existing.entry_type === "REPAID" ? interestAmount : 0,
    payment_mode: mode,
    entry_date: date,
    note: noteVal,
  };

  const existingLedger = await findLedgerForLoanEntry(entryId);

  if (supabase && isOnline()) {
    const { data: eData, error: eErr } = await supabase
      .from("loan_entries")
      .update({
        amount: patch.amount,
        interest_amount: patch.interest_amount,
        payment_mode: patch.payment_mode,
        entry_date: patch.entry_date,
        note: patch.note,
      })
      .eq("id", entryId)
      .select()
      .single();
    if (eErr) throw eErr;
    await localDb.loan_entries.put(eData);

    if (mode === "BANK") {
      const ledgerPayload = {
        entry_date: date,
        entry_type:
          existing.entry_type === "RECEIVED" ? "LOAN_IN" : "LOAN_OUT",
        amount: amt,
        direction: existing.entry_type === "RECEIVED" ? "IN" : "OUT",
        note: noteVal,
        lender_id: existing.lender_id,
        loan_entry_id: entryId,
      };
      if (existingLedger) {
        const { data: lData, error: lErr } = await supabase
          .from("bank_ledger")
          .update(ledgerPayload)
          .eq("id", existingLedger.id)
          .select()
          .single();
        if (lErr) throw lErr;
        await localDb.bank_ledger.put(lData);
      } else {
        const row = {
          id: crypto.randomUUID(),
          ...ledgerPayload,
          created_by: existing.created_by,
          created_at: new Date().toISOString(),
        };
        const { data: lData, error: lErr } = await supabase
          .from("bank_ledger")
          .insert(row)
          .select()
          .single();
        if (lErr) throw lErr;
        await localDb.bank_ledger.put(lData);
      }
    } else if (existingLedger) {
      const { error: dErr } = await supabase
        .from("bank_ledger")
        .delete()
        .eq("id", existingLedger.id);
      if (dErr) throw dErr;
      await localDb.bank_ledger.delete(existingLedger.id);
    }

    return eData;
  }

  await localDb.loan_entries.put(patch);

  if (mode === "BANK") {
    if (existingLedger) {
      await localDb.bank_ledger.put({
        ...existingLedger,
        entry_date: date,
        entry_type:
          existing.entry_type === "RECEIVED" ? "LOAN_IN" : "LOAN_OUT",
        amount: amt,
        direction: existing.entry_type === "RECEIVED" ? "IN" : "OUT",
        note: noteVal,
        lender_id: existing.lender_id,
        loan_entry_id: entryId,
      });
    } else {
      await localDb.bank_ledger.put({
        id: crypto.randomUUID(),
        entry_date: date,
        entry_type:
          existing.entry_type === "RECEIVED" ? "LOAN_IN" : "LOAN_OUT",
        amount: amt,
        direction: existing.entry_type === "RECEIVED" ? "IN" : "OUT",
        note: noteVal,
        lender_id: existing.lender_id,
        loan_entry_id: entryId,
        created_by: existing.created_by,
        created_at: new Date().toISOString(),
      });
    }
  } else if (existingLedger) {
    await localDb.bank_ledger.delete(existingLedger.id);
  }

  return patch;
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
  paymentMode = "BANK",
}) {
  const inv = await localDb.purchase_invoices.get(purchaseInvoiceId);
  if (!inv) throw new Error("Purchase invoice not found.");
  return paySupplier({
    supplierId: inv.supplier_id,
    amount,
    entryDate,
    note,
    userId,
    paymentMode,
    preferInvoiceId: purchaseInvoiceId,
  });
}

/**
 * Pay a supplier against their total due (not picking one invoice).
 * Applies FIFO to oldest unpaid invoices; one ledger history row per payment.
 */
export async function paySupplier({
  supplierId,
  amount,
  entryDate,
  note,
  userId,
  paymentMode = "BANK",
  preferInvoiceId = null,
}) {
  if (!supplierId) throw new Error("Select a supplier.");
  const amt = round2(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");
  const mode = paymentMode === "CASH" ? "CASH" : "BANK";

  const all = await localDb.purchase_invoices.toArray();
  let invoices = all
    .filter((i) => i.supplier_id === supplierId && i.status === "POSTED")
    .map((i) => ({
      ...i,
      remaining: round2(
        Math.max(0, purchasePayableTotal(i) - toNum(i.amount_paid)),
      ),
    }))
    .filter((i) => i.remaining > 0.009)
    .sort((a, b) => {
      const d = String(a.invoice_date).localeCompare(String(b.invoice_date));
      if (d !== 0) return d;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });

  // Optional: when paying from an old per-invoice flow, consume that invoice first.
  if (preferInvoiceId) {
    const preferred = invoices.find((i) => i.id === preferInvoiceId);
    if (!preferred) throw new Error("Invoice is already paid or not found.");
    invoices = [preferred, ...invoices.filter((i) => i.id !== preferInvoiceId)];
  }

  const totalDue = round2(invoices.reduce((s, i) => s + i.remaining, 0));
  if (totalDue <= 0.009) throw new Error("No balance due for this supplier.");
  if (amt > totalDue + 0.009) {
    throw new Error(`Payment exceeds supplier balance (₹${totalDue}).`);
  }

  if (mode === "BANK") {
    const bank = await getBankBalance();
    if (amt > bank + 0.009) {
      throw new Error(`Not enough bank balance (₹${bank}).`);
    }
  } else {
    const cash = await getCashOnHandBalance();
    if (amt > cash + 0.009) {
      throw new Error(`Not enough cash in hand (₹${cash}).`);
    }
  }

  let left = amt;
  const updates = [];
  for (const inv of invoices) {
    if (left <= 0.009) break;
    const take = round2(Math.min(inv.remaining, left));
    const newPaid = round2(toNum(inv.amount_paid) + take);
    updates.push({
      id: inv.id,
      amount_paid: newPaid,
      payment_status: paymentStatus(purchasePayableTotal(inv), newPaid),
      updated_at: new Date().toISOString(),
    });
    left = round2(left - take);
  }

  const supplier = await localDb.suppliers.get(supplierId);
  const date = entryDate || businessDateIST();
  const ledger = {
    id: crypto.randomUUID(),
    entry_date: date,
    entry_type: "SUPPLIER_PAYMENT",
    amount: amt,
    direction: "OUT",
    payment_mode: mode,
    note: note?.trim() || `Payment to ${supplier?.name || "supplier"}`,
    supplier_id: supplierId,
    purchase_invoice_id: null,
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

    const updatedInvoices = [];
    for (const u of updates) {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .update({
          amount_paid: u.amount_paid,
          payment_status: u.payment_status,
          updated_at: u.updated_at,
        })
        .eq("id", u.id)
        .select()
        .single();
      if (error) throw error;
      await localDb.purchase_invoices.put(data);
      updatedInvoices.push(data);
    }
    await localDb.bank_ledger.put(led);
    await invalidateFresh(FreshKeys.PURCHASES, FreshKeys.DASHBOARD);
    return { ledger: led, invoices: updatedInvoices };
  }

  await localDb.bank_ledger.put(ledger);
  const updatedInvoices = [];
  for (const u of updates) {
    const inv = await localDb.purchase_invoices.get(u.id);
    const next = { ...inv, ...u };
    await localDb.purchase_invoices.put(next);
    updatedInvoices.push(next);
  }
  return { ledger, invoices: updatedInvoices };
}

async function persistInvoicePaidUpdates(updates) {
  const updatedInvoices = [];
  if (supabase && isOnline()) {
    for (const u of updates) {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .update({
          amount_paid: u.amount_paid,
          payment_status: u.payment_status,
          updated_at: u.updated_at,
        })
        .eq("id", u.id)
        .select()
        .single();
      if (error) throw error;
      await localDb.purchase_invoices.put(data);
      updatedInvoices.push(data);
    }
  } else {
    for (const u of updates) {
      const inv = await localDb.purchase_invoices.get(u.id);
      const next = { ...inv, ...u };
      await localDb.purchase_invoices.put(next);
      updatedInvoices.push(next);
    }
  }
  return updatedInvoices;
}

/** Plan FIFO allocation of `amt` onto unpaid invoices for a supplier. */
async function planAllocateToSupplier(supplierId, amt) {
  const invoices = (await localDb.purchase_invoices.toArray())
    .filter((i) => i.supplier_id === supplierId && i.status === "POSTED")
    .map((i) => ({
      ...i,
      remaining: round2(
        Math.max(0, purchasePayableTotal(i) - toNum(i.amount_paid)),
      ),
    }))
    .filter((i) => i.remaining > 0.009)
    .sort((a, b) => {
      const d = String(a.invoice_date).localeCompare(String(b.invoice_date));
      if (d !== 0) return d;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });

  let left = round2(amt);
  const updates = [];
  for (const inv of invoices) {
    if (left <= 0.009) break;
    const take = round2(Math.min(inv.remaining, left));
    const newPaid = round2(toNum(inv.amount_paid) + take);
    updates.push({
      id: inv.id,
      amount_paid: newPaid,
      payment_status: paymentStatus(purchasePayableTotal(inv), newPaid),
      updated_at: new Date().toISOString(),
    });
    left = round2(left - take);
  }
  if (left > 0.009) {
    throw new Error("Payment exceeds supplier balance.");
  }
  return updates;
}

/** Plan LIFO reduction of `amt` from amount_paid on invoices. */
async function planDeallocateFromSupplier(supplierId, amt) {
  const invoices = (await localDb.purchase_invoices.toArray())
    .filter((i) => i.supplier_id === supplierId && i.status === "POSTED")
    .filter((i) => toNum(i.amount_paid) > 0.009)
    .sort((a, b) => {
      const d = String(b.invoice_date).localeCompare(String(a.invoice_date));
      if (d !== 0) return d;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });

  let left = round2(amt);
  const updates = [];
  for (const inv of invoices) {
    if (left <= 0.009) break;
    const paid = toNum(inv.amount_paid);
    const take = round2(Math.min(paid, left));
    const newPaid = round2(paid - take);
    updates.push({
      id: inv.id,
      amount_paid: newPaid,
      payment_status: paymentStatus(purchasePayableTotal(inv), newPaid),
      updated_at: new Date().toISOString(),
    });
    left = round2(left - take);
  }
  if (left > 0.009) {
    throw new Error("Cannot reduce payment below what is allocated on invoices.");
  }
  return updates;
}

/**
 * Correct a supplier payment (amount / Cash in hand↔Bank / date / note).
 */
export async function updateSupplierPayment({
  ledgerId,
  amount,
  entryDate,
  note,
  paymentMode,
}) {
  const existing = await localDb.bank_ledger.get(ledgerId);
  if (!existing || existing.entry_type !== "SUPPLIER_PAYMENT") {
    throw new Error("Payment not found.");
  }
  if (!existing.supplier_id) throw new Error("Payment has no supplier.");

  const amt = round2(amount);
  if (amt <= 0) throw new Error("Amount must be greater than zero.");
  const mode = paymentMode === "CASH" ? "CASH" : "BANK";
  const oldAmt = toNum(existing.amount);
  const oldMode = existing.payment_mode === "CASH" ? "CASH" : "BANK";
  const date = entryDate || existing.entry_date || businessDateIST();
  const noteVal =
    note === undefined ? existing.note : note?.trim() || null;

  const outstanding = await getSupplierOutstanding(existing.supplier_id);
  const maxPay = round2(outstanding + oldAmt);
  if (amt > maxPay + 0.009) {
    throw new Error(`Payment exceeds supplier balance (₹${maxPay}).`);
  }

  let cash = await getCashOnHandBalance();
  let bank = await getBankBalance();
  if (oldMode === "CASH") cash = round2(cash + oldAmt);
  else bank = round2(bank + oldAmt);
  if (mode === "CASH") cash = round2(cash - amt);
  else bank = round2(bank - amt);
  if (cash < -0.009) {
    throw new Error(
      `Not enough cash in hand after this change (short ₹${round2(-cash)}).`,
    );
  }
  if (bank < -0.009) {
    throw new Error(
      `Not enough bank balance after this change (short ₹${round2(-bank)}).`,
    );
  }

  const delta = round2(amt - oldAmt);
  let invoiceUpdates = [];
  if (delta > 0.009) {
    invoiceUpdates = await planAllocateToSupplier(existing.supplier_id, delta);
  } else if (delta < -0.009) {
    invoiceUpdates = await planDeallocateFromSupplier(
      existing.supplier_id,
      round2(-delta),
    );
  }

  const patch = {
    entry_date: date,
    amount: amt,
    payment_mode: mode,
    note: noteVal,
  };

  if (supabase && isOnline()) {
    const { data: led, error: lErr } = await supabase
      .from("bank_ledger")
      .update(patch)
      .eq("id", ledgerId)
      .select()
      .single();
    if (lErr) throw lErr;
    await localDb.bank_ledger.put(led);
    const invoices = await persistInvoicePaidUpdates(invoiceUpdates);
    await invalidateFresh(FreshKeys.PURCHASES, FreshKeys.DASHBOARD);
    return { ledger: led, invoices };
  }

  const led = { ...existing, ...patch };
  await localDb.bank_ledger.put(led);
  const invoices = await persistInvoicePaidUpdates(invoiceUpdates);
  return { ledger: led, invoices };
}

export async function getSupplierOutstanding(supplierId) {
  const all = await localDb.purchase_invoices.toArray();
  let due = 0;
  for (const i of all) {
    if (i.supplier_id !== supplierId || i.status !== "POSTED") continue;
    due += Math.max(0, purchasePayableTotal(i) - toNum(i.amount_paid));
  }
  return round2(due);
}

export async function listBankLedger(limit = 50) {
  const rows = await localDb.bank_ledger
    .orderBy("entry_date")
    .reverse()
    .toArray();
  return rows
    .filter((r) => r.payment_mode !== "CASH")
    .slice(0, limit);
}

/** Recent money movements (bank + cash wallet) with party names. */
export async function listRecentMoneyMovements({
  startDate,
  endDate,
  limit = 100,
} = {}) {
  const [ledger, loans, lenders, suppliers] = await Promise.all([
    localDb.bank_ledger.toArray(),
    localDb.loan_entries.toArray(),
    localDb.lenders.toArray(),
    localDb.suppliers.toArray(),
  ]);
  const lenderMap = new Map(lenders.map((l) => [l.id, l]));
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

  const rows = [];

  for (const r of ledger) {
    const date = String(r.entry_date).slice(0, 10);
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    const lender = r.lender_id ? lenderMap.get(r.lender_id) : null;
    const supplier = r.supplier_id ? supplierMap.get(r.supplier_id) : null;
    let party = null;
    if (lender) party = lender.name;
    else if (supplier) party = supplier.name;
    rows.push({
      id: r.id,
      entry_date: date,
      entry_type: r.entry_type,
      amount: toNum(r.amount),
      direction: r.direction,
      payment_mode: r.payment_mode === "CASH" ? "CASH" : "BANK",
      note: r.note || null,
      partyName: party,
      created_at: r.created_at || "",
    });
  }

  // Cash loans live only on loan_entries (not bank_ledger)
  for (const e of loans) {
    if (e.payment_mode !== "CASH") continue;
    const date = String(e.entry_date).slice(0, 10);
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    const lender = lenderMap.get(e.lender_id);
    const received = e.entry_type === "RECEIVED";
    rows.push({
      id: `loan-${e.id}`,
      entry_date: date,
      entry_type: received ? "LOAN_IN" : "LOAN_OUT",
      amount: toNum(e.amount),
      direction: received ? "IN" : "OUT",
      payment_mode: "CASH",
      note: e.note || null,
      partyName: lender?.name || null,
      created_at: e.created_at || "",
    });
  }

  rows.sort((a, b) => {
    const d = String(b.entry_date).localeCompare(String(a.entry_date));
    if (d !== 0) return d;
    return String(b.created_at).localeCompare(String(a.created_at));
  });

  return rows.slice(0, limit);
}

export async function listSupplierPayments(limit = 40) {
  const rows = await localDb.bank_ledger
    .orderBy("entry_date")
    .reverse()
    .toArray();
  return rows
    .filter((r) => r.entry_type === "SUPPLIER_PAYMENT")
    .slice(0, limit);
}

export async function listSupplierPaymentsForSupplier(supplierId) {
  if (!supplierId) return [];
  const rows = await localDb.bank_ledger.toArray();
  return rows
    .filter(
      (r) =>
        r.entry_type === "SUPPLIER_PAYMENT" && r.supplier_id === supplierId,
    )
    .sort((a, b) => {
      const d = String(b.entry_date).localeCompare(String(a.entry_date));
      if (d !== 0) return d;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
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

/** Suppliers that still have unpaid/partial posted invoices. */
export async function listSuppliersWithBalance() {
  const [invoices, suppliers] = await Promise.all([
    localDb.purchase_invoices.toArray(),
    localDb.suppliers.toArray(),
  ]);
  const map = new Map(suppliers.map((s) => [s.id, s]));
  const bySup = new Map();
  for (const inv of invoices) {
    if (inv.status !== "POSTED" || !inv.supplier_id) continue;
    const rem = round2(
      Math.max(0, purchasePayableTotal(inv) - toNum(inv.amount_paid)),
    );
    if (rem <= 0.009) continue;
    if (!bySup.has(inv.supplier_id)) {
      bySup.set(inv.supplier_id, {
        id: inv.supplier_id,
        name: map.get(inv.supplier_id)?.name || "Supplier",
        remaining: 0,
        unpaidCount: 0,
      });
    }
    const row = bySup.get(inv.supplier_id);
    row.remaining = round2(row.remaining + rem);
    row.unpaidCount += 1;
  }
  return [...bySup.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
