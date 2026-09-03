import { localDb, queueMutation } from "../db/localDb";
import { catalogGet, catalogGetMany, catalogUpdate } from "../db/catalogSqlite";
import { supabase } from "./supabaseClient";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { lineTotal, toNum } from "./format";
import { isOnline } from "./network";
import { invalidateOwnerAggregates } from "./freshSync";

export async function findCustomerByPhone(phone) {
  const normalized = phone.replace(/\D/g, "");
  const local = await localDb.customers.where("phone").equals(normalized).first();
  if (local) return local;
  if (!supabase) return null;
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("phone", normalized)
    .maybeSingle();
  if (data) await localDb.customers.put(data);
  return data;
}

export async function createCustomer({ phone, name }) {
  const normalized = phone.replace(/\D/g, "");
  const row = {
    id: crypto.randomUUID(),
    phone: normalized,
    name,
    outstanding_balance: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (supabase && navigator.onLine) {
    const { data, error } = await supabase
      .from("customers")
      .insert({ phone: normalized, name })
      .select()
      .single();
    if (error) throw error;
    await localDb.customers.put(data);
    return data;
  }

  await localDb.customers.put(row);
  return row;
}

export async function completeSale({
  sessionId,
  staffId,
  customerId,
  paymentMethod,
  lines,
  invoiceNumber,
  discountMode = "line",
  billDiscountPercent = 0,
  subtotalAmount,
  totalAmount,
}) {
  const total =
    totalAmount != null
      ? toNum(totalAmount)
      : lines.reduce((s, l) => s + toNum(l.line_total), 0);
  const subtotal =
    subtotalAmount != null ? toNum(subtotalAmount) : total;
  const billDisc =
    discountMode === "bill" ? toNum(billDiscountPercent) : 0;

  // Optimistic local stock
  for (const line of lines) {
    const product = await catalogGet(line.product_id);
    if (!product) throw new Error(`Product missing: ${line.product_id}`);
    if (product.stock_quantity < line.quantity) {
      throw new Error(`Insufficient stock for ${product.name}`);
    }
    await catalogUpdate(line.product_id, {
      stock_quantity: product.stock_quantity - line.quantity,
      updated_at: new Date().toISOString(),
    });
  }

  const invoice = {
    id: crypto.randomUUID(),
    invoice_number: invoiceNumber,
    session_id: sessionId,
    customer_id: customerId || null,
    subtotal_amount: subtotal,
    bill_discount_percent: billDisc,
    total_amount: total,
    payment_method: paymentMethod,
    staff_id: staffId,
    created_at: new Date().toISOString(),
    synced: false,
  };

  const items = lines.map((l) => ({
    id: crypto.randomUUID(),
    invoice_id: invoice.id,
    product_id: l.product_id,
    quantity: l.quantity,
    unit_price: l.unit_price,
    unit_cost: l.unit_cost,
    discount_percent: l.discount_percent || 0,
    line_total: l.line_total,
  }));

  await localDb.invoices.put(invoice);
  await localDb.invoice_items.bulkPut(items);
  await invalidateOwnerAggregates();

  if (paymentMethod === "CREDIT" && customerId) {
    const customer = await localDb.customers.get(customerId);
    if (customer) {
      const bal = toNum(customer.outstanding_balance) + total;
      await localDb.customers.update(customerId, {
        outstanding_balance: bal,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const payload = { invoice, items, customerId, paymentMethod, total };

  if (supabase && isOnline()) {
    try {
      const serverInvoice = await pushSaleToServer({
        invoice,
        items,
        customerId,
        paymentMethod,
        total,
        staffId,
      });
      return { invoice: serverInvoice, items };
    } catch (err) {
      await queueMutation({ type: "sale", payload });
      return { invoice, items, queued: true };
    }
  }

  await queueMutation({ type: "sale", payload });
  return { invoice, items, queued: true };
}

/** Insert sale on server and replace the optimistic local invoice (avoids duplicate bills). */
export async function pushSaleToServer({
  invoice,
  items,
  customerId,
  paymentMethod,
  total,
  staffId,
}) {
  const localInvoiceId = invoice.id;

  let invoiceNumber = invoice.invoice_number;
  if (!invoiceNumber) {
    const { data: num, error: numErr } = await supabase.rpc("next_invoice_number");
    if (numErr) throw numErr;
    invoiceNumber = num;
  }

  const { data: existing } = await supabase
    .from("invoices")
    .select("*")
    .eq("invoice_number", invoiceNumber)
    .eq("session_id", invoice.session_id)
    .maybeSingle();

  if (existing) {
    const { data: existingItems } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", existing.id);
    await replaceLocalInvoiceWithServer(localInvoiceId, existing, existingItems ?? []);
    return existing;
  }

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      session_id: invoice.session_id,
      customer_id: customerId,
      subtotal_amount: invoice.subtotal_amount ?? total,
      bill_discount_percent: invoice.bill_discount_percent ?? 0,
      total_amount: total,
      payment_method: paymentMethod,
      staff_id: staffId ?? invoice.staff_id,
    })
    .select()
    .single();
  if (invErr) throw invErr;

  const itemRows = items.map((l) => ({
    invoice_id: inv.id,
    product_id: l.product_id,
    quantity: l.quantity,
    unit_price: l.unit_price,
    unit_cost: l.unit_cost,
    discount_percent: l.discount_percent ?? 0,
    line_total: l.line_total,
  }));
  const { data: insertedItems, error: itemsErr } = await supabase
    .from("invoice_items")
    .insert(itemRows)
    .select();
  if (itemsErr) throw itemsErr;

  for (const l of items) {
    const { data: ok } = await supabase.rpc("reduce_stock", {
      p_product_id: l.product_id,
      p_qty: l.quantity,
    });
    if (!ok) throw new Error("Stock reduction failed on server.");
  }

  if (paymentMethod === "CREDIT" && customerId) {
    const { data: cust } = await supabase
      .from("customers")
      .select("outstanding_balance")
      .eq("id", customerId)
      .single();
    if (cust) {
      await supabase
        .from("customers")
        .update({ outstanding_balance: toNum(cust.outstanding_balance) + total })
        .eq("id", customerId);
    }
  }

  await replaceLocalInvoiceWithServer(localInvoiceId, inv, insertedItems ?? itemRows);
  return inv;
}

async function replaceLocalInvoiceWithServer(localInvoiceId, serverInvoice, serverItems) {
  await localDb.invoice_items.where("invoice_id").equals(localInvoiceId).delete();
  await localDb.invoices.delete(localInvoiceId);

  await localDb.invoices.put({ ...serverInvoice, synced: true });

  const rows = (serverItems ?? []).map((it) => ({
    id: it.id ?? crypto.randomUUID(),
    invoice_id: serverInvoice.id,
    product_id: it.product_id,
    quantity: it.quantity,
    unit_price: it.unit_price,
    unit_cost: it.unit_cost,
    discount_percent: it.discount_percent ?? 0,
    line_total: it.line_total,
  }));
  if (rows.length) await localDb.invoice_items.bulkPut(rows);
}

function unsyncedInvoicesNotOnServer(serverInvoices, localInvoices) {
  const serverKeys = new Set(
    serverInvoices.map((i) => `${i.invoice_number ?? ""}|${i.session_id}|${toNum(i.total_amount)}`),
  );
  return localInvoices.filter((i) => {
    if (i.synced) return false;
    const key = `${i.invoice_number ?? ""}|${i.session_id}|${toNum(i.total_amount)}`;
    return !serverKeys.has(key);
  });
}

/** Remove stale local copies that share bill no. with a synced server invoice. */
export async function cleanupDuplicateInvoices() {
  const all = await localDb.invoices.toArray();
  const groups = new Map();
  for (const inv of all) {
    if (!inv.invoice_number) continue;
    const key = `${inv.invoice_number}|${inv.session_id}`;
    const list = groups.get(key) ?? [];
    list.push(inv);
    groups.set(key, list);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep =
      group.find((i) => i.synced) ??
      group.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    for (const inv of group) {
      if (inv.id === keep.id) continue;
      await localDb.invoices.delete(inv.id);
      await localDb.invoice_items.where("invoice_id").equals(inv.id).delete();
    }
  }
}

export function dedupeInvoiceList(invoices) {
  const map = new Map();
  for (const inv of invoices) {
    const key = inv.invoice_number ? `${inv.invoice_number}|${inv.session_id}` : inv.id;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, inv);
      continue;
    }
    const preferInv =
      (inv.synced && !prev.synced) ||
      (inv.synced === prev.synced &&
        String(inv.created_at) > String(prev.created_at));
    if (preferInv) map.set(key, inv);
  }
  return [...map.values()].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
}

/** Wipe local bills/sessions when server has no sales data (after admin reset). */
export async function clearLocalSalesCache() {
  const unsyncedInvoices = (await localDb.invoices.toArray()).filter((i) => !i.synced);
  const unsyncedIds = new Set(unsyncedInvoices.map((i) => i.id));
  const unsyncedItems = (await localDb.invoice_items.toArray()).filter((it) =>
    unsyncedIds.has(it.invoice_id),
  );

  await localDb.invoices.clear();
  await localDb.invoice_items.clear();
  await localDb.register_sessions.clear();
  await localDb.cash_expenses.clear();
  await localDb.day_close_reports.clear();

  if (unsyncedInvoices.length) {
    await localDb.invoices.bulkPut(unsyncedInvoices);
    if (unsyncedItems.length) await localDb.invoice_items.bulkPut(unsyncedItems);
  }

  const pending = await localDb.offline_mutations.toArray();
  for (const row of pending) {
    if (row.type === "sale" || row.type === "expense") {
      await localDb.offline_mutations.delete(row.id);
    }
  }

  await localDb.sync_meta.put({ key: "demo_invoice_num", value: 1 });
}

export async function syncInvoicesFromServer(limit = 200) {
  if (!supabase || !isOnline()) return;
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("syncInvoicesFromServer", error);
    return;
  }
  if (!invoices?.length) {
    await clearLocalSalesCache();
    return;
  }

  const localAll = await localDb.invoices.toArray();
  const unsynced = unsyncedInvoicesNotOnServer(invoices, localAll);
  await localDb.invoices.bulkPut(invoices);
  if (unsynced.length) await localDb.invoices.bulkPut(unsynced);

  const invoiceIds = [
    ...new Set([...invoices.map((i) => i.id), ...unsynced.map((i) => i.id)]),
  ];
  const { data: items, error: itemsErr } = await supabase
    .from("invoice_items")
    .select("*")
    .in("invoice_id", invoiceIds);
  if (itemsErr) {
    console.error("syncInvoicesFromServer items", itemsErr);
    return;
  }
  if (items?.length) {
    const unsyncedIds = new Set(unsynced.map((i) => i.id));
    const localItems = await localDb.invoice_items.toArray();
    const localOnly = localItems.filter((it) => unsyncedIds.has(it.invoice_id));
    await localDb.invoice_items.bulkPut(items);
    if (localOnly.length) await localDb.invoice_items.bulkPut(localOnly);
  }
  await cleanupDuplicateInvoices();
}

/** Pull full invoice history for reports (paginated). */
export async function syncAllInvoicesFromServer() {
  if (!supabase || !isOnline()) return;
  const invoices = await fetchAllFromSupabase("invoices", {
    order: (q) => q.order("created_at", { ascending: false }),
  });
  if (!invoices.length) {
    await clearLocalSalesCache();
    return;
  }

  const localAll = await localDb.invoices.toArray();
  const unsynced = unsyncedInvoicesNotOnServer(invoices, localAll);
  await localDb.invoices.bulkPut(invoices);
  if (unsynced.length) await localDb.invoices.bulkPut(unsynced);

  const ids = [...new Set([...invoices.map((i) => i.id), ...unsynced.map((i) => i.id)])];
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const items = await fetchAllFromSupabase("invoice_items", {
      filter: (q) => q.in("invoice_id", chunk),
    });
    if (items.length) {
      const unsyncedIds = new Set(unsynced.map((inv) => inv.id));
      const localItems = await localDb.invoice_items.toArray();
      const localOnly = localItems.filter((it) => unsyncedIds.has(it.invoice_id));
      await localDb.invoice_items.bulkPut(items);
      if (localOnly.length) await localDb.invoice_items.bulkPut(localOnly);
    }
  }
  await cleanupDuplicateInvoices();
}

export async function loadInvoiceDetails(invoiceId) {
  const invoice = await localDb.invoices.get(invoiceId);
  if (!invoice) return null;
  const items = await localDb.invoice_items
    .where("invoice_id")
    .equals(invoiceId)
    .toArray();
  const products = await catalogGetMany(items.map((it) => it.product_id));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const lines = items.map((item) => ({
    ...item,
    name: productMap.get(item.product_id)?.name ?? "Part",
    part_number: productMap.get(item.product_id)?.part_number ?? "",
  }));
  let customer = null;
  if (invoice.customer_id) {
    customer = await localDb.customers.get(invoice.customer_id);
  }
  return { invoice, lines, customer };
}

export function buildCartLine(product, qty, discPercent, isOwner) {
  const unit_price = toNum(product.selling_price);
  const unit_cost = isOwner ? toNum(product.purchase_price) : 0;
  const quantity = toNum(qty) || 1;
  const discount_percent = toNum(discPercent);
  const line_total = lineTotal(unit_price, quantity, discount_percent);
  return {
    product_id: product.id,
    part_number: product.part_number,
    name: product.name,
    quantity,
    unit_price,
    unit_cost,
    discount_percent,
    line_total,
    stock_quantity: product.stock_quantity,
  };
}
