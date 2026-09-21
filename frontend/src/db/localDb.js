import Dexie from "dexie";

export const localDb = new Dexie("ssa_pos");

localDb.version(1).stores({
  products:
    "id, part_number, name, updated_at, stock_quantity, [part_number+name]",
  customers: "id, phone, updated_at",
  register_sessions: "id, business_date, status",
  invoices: "id, invoice_number, session_id, created_at",
  invoice_items: "id, invoice_id, product_id",
  suppliers: "id, name",
  purchase_invoices: "id, supplier_id, status, updated_at, invoice_date",
  purchase_lines: "id, purchase_invoice_id",
  cash_expenses: "id, session_id",
  offline_mutations: "++id, type, created_at, status",
  sync_meta: "key",
  shop_settings: "id",
});

localDb.version(2).stores({
  register_sessions: "id, business_date, status, opened_at",
});

localDb.version(3).stores({
  day_close_reports: "id, session_id, business_date, created_at",
});

localDb.version(4).stores({
  fixed_cost_templates: "id, active",
  fixed_cost_logs: "id, template_id, month",
});

localDb.version(5).stores({
  lenders: "id, name",
  loan_entries: "id, lender_id, entry_date, entry_type",
  bank_ledger: "id, entry_date, entry_type",
  cash_deposits: "id, deposited_on",
  cash_deposit_days: "id, cash_deposit_id, business_date",
  upi_deposits: "id, business_date",
});

export async function getSyncMeta(key) {
  const row = await localDb.sync_meta.get(key);
  return row?.value ?? null;
}

export async function setSyncMeta(key, value) {
  await localDb.sync_meta.put({ key, value });
}

export async function queueMutation(mutation) {
  await localDb.offline_mutations.add({
    ...mutation,
    status: "pending",
    created_at: new Date().toISOString(),
  });
}

export async function getPendingMutations() {
  return localDb.offline_mutations.where("status").equals("pending").toArray();
}

export async function markMutationDone(id) {
  await localDb.offline_mutations.update(id, { status: "done" });
}
