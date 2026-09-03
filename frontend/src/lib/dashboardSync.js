import { localDb } from "../db/localDb";
import { supabase } from "./supabaseClient";
import { isOnline } from "./network";
import { hydrateProducts } from "./productHydrate";
import { syncInvoicesFromServer } from "./sales";
import { syncPurchaseInvoicesFromServer } from "./purchases";

/** Pull live data for dashboard — products via delta hydrate, not a full dump. */
export async function syncDashboardData() {
  if (!supabase || !isOnline()) return;

  await hydrateProducts();
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
