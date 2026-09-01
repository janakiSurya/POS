import { getPendingMutations, markMutationDone } from "../db/localDb";
import { syncPendingDayCloseReports } from "./dayCloseReport";
import { pushSaleToServer } from "./sales";
import { supabase } from "./supabaseClient";
import { isOnline } from "./network";

export async function flushOfflineQueue() {
  if (!supabase || !isOnline()) return;

  const pending = await getPendingMutations();
  for (const row of pending) {
    try {
      if (row.type === "sale") {
        const { invoice, items, customerId, paymentMethod, total } = row.payload;
        await pushSaleToServer({
          invoice,
          items,
          customerId,
          paymentMethod,
          total,
          staffId: invoice.staff_id,
        });
      }
      if (row.type === "expense") {
        await supabase.from("cash_expenses").insert({
          session_id: row.payload.session_id,
          user_id: row.payload.user_id,
          amount: row.payload.amount,
          note: row.payload.note,
        });
      }
      await markMutationDone(row.id);
    } catch {
      // keep pending for next flush
    }
  }
  await syncPendingDayCloseReports();
}
