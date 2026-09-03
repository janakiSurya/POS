import { localDb } from "../db/localDb";
import { supabase } from "./supabaseClient";
import { isOnline } from "./network";
import { toNum } from "./format";

export const EXPENSE_CATEGORIES = [
  { value: "SALARY", label: "Staff Salary" },
  { value: "RENT", label: "Shop Rent" },
  { value: "ELECTRICITY", label: "Electricity Bill" },
  { value: "INTERNET", label: "Internet / Phone" },
  { value: "MISC", label: "Miscellaneous" },
];

export function categoryLabel(value) {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** Current month string "YYYY-MM" in IST */
export function currentMonthKey() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

/** "YYYY-MM" for any Date */
export function monthKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

// ─── Fixed cost templates ────────────────────────────────────────────────────

export async function syncFixedCostsFromServer() {
  if (!supabase || !isOnline()) return;

  const [tRes, lRes] = await Promise.all([
    supabase.from("fixed_cost_templates").select("*"),
    supabase.from("fixed_cost_logs").select("*"),
  ]);

  if (tRes.data?.length) {
    await localDb.fixed_cost_templates.clear();
    await localDb.fixed_cost_templates.bulkPut(tRes.data);
  }
  if (lRes.data?.length) {
    await localDb.fixed_cost_logs.clear();
    await localDb.fixed_cost_logs.bulkPut(lRes.data);
  }
}

export async function getTemplates() {
  return localDb.fixed_cost_templates.filter((t) => t.active !== false).toArray();
}

export async function saveTemplate({ id, userId, name, category, amount, dayOfMonth }) {
  const row = {
    id: id ?? crypto.randomUUID(),
    user_id: userId,
    name: name.trim(),
    category,
    amount: toNum(amount),
    day_of_month: Number(dayOfMonth) || 1,
    active: true,
    created_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const payload = {
      user_id: row.user_id,
      name: row.name,
      category: row.category,
      amount: row.amount,
      day_of_month: row.day_of_month,
      active: row.active,
    };
    const { data, error } = id
      ? await supabase.from("fixed_cost_templates").update(payload).eq("id", id).select().single()
      : await supabase.from("fixed_cost_templates").insert({ ...payload, id: row.id }).select().single();
    if (error) throw error;
    await localDb.fixed_cost_templates.put(data);
    return data;
  }

  await localDb.fixed_cost_templates.put(row);
  return row;
}

export async function deleteTemplate(id) {
  if (supabase && isOnline()) {
    const { error } = await supabase
      .from("fixed_cost_templates")
      .update({ active: false })
      .eq("id", id);
    if (error) throw error;
  }
  await localDb.fixed_cost_templates.update(id, { active: false });
}

// ─── Fixed cost logs (per-month entries) ─────────────────────────────────────

export async function getFixedCostLogsForMonth(month) {
  // month = "YYYY-MM"
  if (supabase && isOnline()) {
    const { data } = await supabase
      .from("fixed_cost_logs")
      .select("*")
      .eq("month", month);
    if (data?.length) {
      await localDb.fixed_cost_logs.bulkPut(data);
    }
  }
  return localDb.fixed_cost_logs.where("month").equals(month).toArray();
}

export async function logFixedCost({ templateId, userId, month, name, category, amount, note, paidDate }) {
  const row = {
    id: crypto.randomUUID(),
    template_id: templateId ?? null,
    user_id: userId,
    month,
    name,
    category,
    amount: toNum(amount),
    note: note || null,
    paid_date: paidDate || null,
    created_at: new Date().toISOString(),
  };

  if (supabase && isOnline()) {
    const { data, error } = await supabase
      .from("fixed_cost_logs")
      .insert({
        template_id: row.template_id,
        user_id: row.user_id,
        month: row.month,
        name: row.name,
        category: row.category,
        amount: row.amount,
        note: row.note,
        paid_date: row.paid_date,
      })
      .select()
      .single();
    if (error) throw error;
    await localDb.fixed_cost_logs.put(data);
    return data;
  }

  await localDb.fixed_cost_logs.put(row);
  return row;
}

export async function deleteFixedCostLog(id) {
  if (supabase && isOnline()) {
    const { error } = await supabase.from("fixed_cost_logs").delete().eq("id", id);
    if (error) throw error;
  }
  await localDb.fixed_cost_logs.delete(id);
}

// ─── Analytics helpers ────────────────────────────────────────────────────────

/** Sum all cash_expenses in a date range (by created_at IST date). */
export function sumDailyExpensesInRange(expenses, startYmd, endYmd) {
  let total = 0;
  for (const e of expenses) {
    const d = isoToYmd(e.created_at);
    if (d >= startYmd && d <= endYmd) total += toNum(e.amount);
  }
  return total;
}

/** Sum fixed_cost_logs whose month falls in the date range. */
export function sumFixedExpensesInRange(logs, startYmd, endYmd) {
  const startMonth = startYmd.slice(0, 7); // "YYYY-MM"
  const endMonth = endYmd.slice(0, 7);
  let total = 0;
  for (const l of logs) {
    if (l.month >= startMonth && l.month <= endMonth) total += toNum(l.amount);
  }
  return total;
}

/** Group cash_expenses by IST date for chart. */
export function buildDailyExpensesByCategory(expenses, startYmd, endYmd) {
  const filtered = expenses.filter((e) => {
    const d = isoToYmd(e.created_at);
    return d >= startYmd && d <= endYmd;
  });
  const byCat = {};
  for (const e of filtered) {
    const cat = e.category || "MISC";
    byCat[cat] = (byCat[cat] || 0) + toNum(e.amount);
  }
  return byCat;
}

function isoToYmd(iso) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}
