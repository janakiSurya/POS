import { localDb } from "../db/localDb";
import { supabase } from "./supabaseClient";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { buildSearchIndex } from "../hooks/useSync";
import { syncInvoicesFromServer } from "./sales";
import { syncPurchaseInvoicesFromServer } from "./purchases";
import { isOnline } from "./network";

/** Pull live data from Supabase into local DB for dashboard KPIs. */
export async function syncDashboardData() {
  if (!supabase || !isOnline()) return;

  const products = await fetchAllFromSupabase("products");
  await localDb.products.clear();
  if (products.length) {
    await localDb.products.bulkPut(products);
    buildSearchIndex(products);
  } else {
    buildSearchIndex([]);
  }

  await syncInvoicesFromServer(500);
  await syncPurchaseInvoicesFromServer(200);

  const { data: sessions } = await supabase
    .from("register_sessions")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(30);
  if (sessions?.length) await localDb.register_sessions.bulkPut(sessions);

  const { data: expenses } = await supabase
    .from("cash_expenses")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (expenses?.length) await localDb.cash_expenses.bulkPut(expenses);
}
