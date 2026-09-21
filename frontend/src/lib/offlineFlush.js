import { getPendingMutations, markMutationDone } from "../db/localDb";
import { syncPendingDayCloseReports } from "./dayCloseReport";
import { pushSaleToServer } from "./sales";
import { supabase } from "./supabaseClient";
import { isOnline } from "./network";
import { normalizeExpensePaymentMode } from "./expenses";

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
        const mode = normalizeExpensePaymentMode(row.payload.payment_mode);
        const { data: expense, error } = await supabase
          .from("cash_expenses")
          .insert({
            id: row.payload.id,
            session_id: row.payload.session_id,
            user_id: row.payload.user_id,
            amount: row.payload.amount,
            note: row.payload.note,
            category: row.payload.category || "MISC",
            payment_mode: mode,
            created_at: row.payload.created_at,
          })
          .select()
          .single();
        if (error) throw error;

        if (mode === "BANK" && row.payload.bank_ledger) {
          const led = row.payload.bank_ledger;
          const { error: lErr } = await supabase.from("bank_ledger").insert({
            ...led,
            cash_expense_id: expense?.id || led.cash_expense_id,
          });
          if (lErr) throw lErr;
        }
      }
      await markMutationDone(row.id);
    } catch {
      // keep pending for next flush
    }
  }
  await syncPendingDayCloseReports();
}
