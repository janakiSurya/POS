import { localDb } from "../db/localDb";
import { catalogGet, catalogGetByPart, catalogPut, catalogUpdate } from "../db/catalogSqlite";
import { upsertSearchProduct } from "./searchClient";
import { supabase } from "./supabaseClient";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { toNum, round2 } from "./format";
import {
  normalizeSupplierRecord,
  supplierNamesMatch,
} from "./normalizeSupplier";

/** Selling price from invoice MRP; falls back to cost + 15% if MRP missing. */
export function sellingPriceFromMrp(mrp, purchaseCost) {
  const m = toNum(mrp);
  if (m > 0) return m;
  const c = toNum(purchaseCost);
  return c > 0 ? round2(c * 1.15) : 0;
}

export async function applyProductBrand(productId, brand) {
  const b = brand?.trim();
  if (!b || !productId) return;
  const updated_at = new Date().toISOString();
  await catalogUpdate(productId, { brand: b, updated_at });
  if (supabase && navigator.onLine) {
    await supabase
      .from("products")
      .update({ brand: b, updated_at })
      .eq("id", productId);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();
    if (data) {
      await catalogPut(data);
      upsertSearchProduct(data);
    }
  }
}

export async function setSellingPriceFromMrp(productId, mrp) {
  const sell = toNum(mrp);
  if (sell <= 0) return;
  const updated_at = new Date().toISOString();
  await catalogUpdate(productId, {
    selling_price: sell,
    updated_at,
  });
  if (supabase && navigator.onLine) {
    await supabase
      .from("products")
      .update({ selling_price: sell, updated_at })
      .eq("id", productId);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();
    if (data) {
      await catalogPut(data);
      upsertSearchProduct(data);
    }
  }
}

function pickPrinted(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function findSupplierByNormalized(info) {
  const norm = normalizeSupplierRecord(info);

  if (norm.gstin) {
    const localGstin = await localDb.suppliers
      .filter((s) => s.gstin === norm.gstin)
      .first();
    if (localGstin) return localGstin;

    if (supabase && navigator.onLine) {
      const { data } = await supabase
        .from("suppliers")
        .select("*")
        .eq("gstin", norm.gstin)
        .maybeSingle();
      if (data) {
        await localDb.suppliers.put(data);
        return data;
      }
    }
  }

  const all = await localDb.suppliers.toArray();
  const byName = all.find((s) => supplierNamesMatch(s.name, norm.name));
  if (byName) return byName;

  if (supabase && navigator.onLine) {
    const remote = await fetchAllFromSupabase("suppliers");
    if (remote.length) {
      await localDb.suppliers.bulkPut(remote);
      const match = remote.find((s) => supplierNamesMatch(s.name, norm.name));
      if (match) return match;
    }
  }

  return null;
}

async function patchSupplierIfNeeded(id, norm, existing) {
  const patch = {};
  if (existing.name !== norm.name) patch.name = norm.name;
  if (norm.address && !existing.address) patch.address = norm.address;
  if (norm.phone && !existing.phone) patch.phone = norm.phone;
  if (norm.email && !existing.email) patch.email = norm.email;
  if (!Object.keys(patch).length) return existing;

  if (supabase && navigator.onLine) {
    const { data, error } = await supabase
      .from("suppliers")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await localDb.suppliers.put(data);
    return data;
  }

  const updated = { ...existing, ...patch };
  await localDb.suppliers.put(updated);
  return updated;
}

export async function findOrCreateSupplier(info) {
  const norm = normalizeSupplierRecord(info);
  let supplier = await findSupplierByNormalized(norm);

  if (supplier) {
    return patchSupplierIfNeeded(supplier.id, norm, supplier);
  }

  const row = {
    id: crypto.randomUUID(),
    name: norm.name,
    gstin: norm.gstin,
    address: norm.address,
    phone: norm.phone,
    email: norm.email,
  };

  if (supabase && navigator.onLine) {
    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        name: row.name,
        gstin: row.gstin,
        address: row.address,
        phone: row.phone,
        email: row.email,
      })
      .select()
      .single();
    if (error) {
      // Another row may exist with same GSTIN — return that supplier
      if (error.code === "23505" && norm.gstin) {
        const existing = await findSupplierByNormalized(norm);
        if (existing) return patchSupplierIfNeeded(existing.id, norm, existing);
      }
      throw error;
    }
    await localDb.suppliers.put(data);
    return data;
  }

  await localDb.suppliers.put(row);
  return row;
}

export async function findPurchaseInvoiceDuplicate(supplierId, invoiceNumber) {
  const num = invoiceNumber?.trim();
  if (!supplierId || !num) return null;

  const local = await localDb.purchase_invoices
    .filter((i) => i.supplier_id === supplierId && i.invoice_number === num)
    .first();
  if (local) return local;

  if (supabase && navigator.onLine) {
    const { data } = await supabase
      .from("purchase_invoices")
      .select("*")
      .eq("supplier_id", supplierId)
      .eq("invoice_number", num)
      .maybeSingle();
    if (data) {
      await localDb.purchase_invoices.put(data);
      return data;
    }
  }
  return null;
}

export async function findPurchaseInvoiceDuplicateBySupplierName(
  supplierName,
  invoiceNumber,
  supplierMeta = {},
) {
  const num = invoiceNumber?.trim();
  if (!num) return null;

  const supplier = await findSupplierByNormalized({
    name: supplierName,
    gstin: supplierMeta.gstin,
  });
  if (!supplier) return null;
  return findPurchaseInvoiceDuplicate(supplier.id, num);
}

export async function updatePurchaseInvoiceTotal(invoiceId) {
  const lines = await localDb.purchase_lines
    .where("purchase_invoice_id")
    .equals(invoiceId)
    .toArray();
  const total = lines.reduce((s, l) => s + toNum(l.line_total), 0);
  const updatedAt = new Date().toISOString();
  await localDb.purchase_invoices.update(invoiceId, {
    total_amount: total,
    updated_at: updatedAt,
  });
  if (supabase && navigator.onLine) {
    await supabase
      .from("purchase_invoices")
      .update({ total_amount: total, updated_at: updatedAt })
      .eq("id", invoiceId);
  }
  return total;
}

export async function postPurchaseLine({
  productId,
  partNumber,
  description,
  quantity,
  unitCost,
  applyCost,
  purchaseInvoiceId,
  lineNo,
  hsn,
  brand,
  uom,
  mrp,
  discPercent,
  disc2Percent,
  taxable,
  cgstPercent,
  cgstAmount,
  sgstPercent,
  sgstAmount,
  lineTotal,
  grossAmount,
  gstPercent,
  rawData,
}) {
  if (productId) {
    if (supabase && navigator.onLine) {
      await supabase.rpc("increase_stock", {
        p_product_id: productId,
        p_qty: quantity,
        p_new_cost: unitCost,
        p_apply_cost: applyCost,
      });
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();
      if (data) {
        await catalogPut(data);
        upsertSearchProduct(data);
      }
    } else {
      const p = await catalogGet(productId);
      if (p) {
        await catalogUpdate(productId, {
          stock_quantity: toNum(p.stock_quantity) + quantity,
          purchase_price: applyCost ? unitCost : p.purchase_price,
          updated_at: new Date().toISOString(),
        });
        const updated = await catalogGet(productId);
        if (updated) upsertSearchProduct(updated);
      }
    }
    await applyProductBrand(productId, brand);
  }

  const decision =
    applyCost === null ? "SAME" : applyCost ? "APPLIED" : "KEPT_OLD";

  const computedLineTotal =
    lineTotal != null && lineTotal !== ""
      ? toNum(lineTotal)
      : unitCost * quantity;

  const line = {
    id: crypto.randomUUID(),
    purchase_invoice_id: purchaseInvoiceId,
    product_id: productId,
    part_number: partNumber,
    description,
    quantity,
    unit_cost: unitCost,
    line_total: computedLineTotal,
    cost_update_decision: decision,
    line_no: lineNo,
    hsn: hsn || null,
    brand: brand || null,
    uom: uom || "PCS",
    mrp: mrp != null ? toNum(mrp) : null,
    disc_percent: discPercent != null ? toNum(discPercent) : 0,
    disc2_percent: disc2Percent != null ? toNum(disc2Percent) : null,
    taxable: taxable != null ? toNum(taxable) : null,
    cgst_percent: cgstPercent != null ? toNum(cgstPercent) : null,
    cgst_amount: cgstAmount != null ? toNum(cgstAmount) : null,
    sgst_percent: sgstPercent != null ? toNum(sgstPercent) : null,
    sgst_amount: sgstAmount != null ? toNum(sgstAmount) : null,
    gross_amount: grossAmount != null ? toNum(grossAmount) : null,
    gst_percent: gstPercent != null ? toNum(gstPercent) : null,
    raw_data: rawData ?? null,
  };

  await localDb.purchase_lines.put(line);

  if (supabase && navigator.onLine) {
    await supabase.from("purchase_lines").insert({
      purchase_invoice_id: purchaseInvoiceId,
      product_id: productId,
      part_number: partNumber,
      description,
      quantity,
      unit_cost: unitCost,
      line_total: line.line_total,
      cost_update_decision: decision,
      line_no: lineNo,
      hsn: line.hsn,
      brand: line.brand,
      uom: line.uom,
      mrp: line.mrp,
      disc_percent: line.disc_percent,
      disc2_percent: line.disc2_percent,
      taxable: line.taxable,
      cgst_percent: line.cgst_percent,
      cgst_amount: line.cgst_amount,
      sgst_percent: line.sgst_percent,
      sgst_amount: line.sgst_amount,
      gross_amount: line.gross_amount,
      gst_percent: line.gst_percent,
      raw_data: line.raw_data,
    });
  }

  await updatePurchaseInvoiceTotal(purchaseInvoiceId);
  return line;
}

export async function createPurchaseInvoice({
  supplierId,
  invoiceNumber,
  invoiceDate,
  createdBy,
  status = "POSTED",
  source = "MANUAL",
  notes,
  invoiceType,
  printedSubTotal,
  printedDiscount,
  printedTaxable,
  printedCgst,
  printedSgst,
  printedGrandTotal,
}) {
  const existing = await findPurchaseInvoiceDuplicate(supplierId, invoiceNumber);
  if (existing) {
    throw new Error(
      `Duplicate invoice: ${invoiceNumber} was already imported on ${existing.invoice_date}.`,
    );
  }

  const row = {
    id: crypto.randomUUID(),
    supplier_id: supplierId,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    status,
    source,
    notes: notes || null,
    invoice_type: invoiceType || null,
    printed_subtotal: pickPrinted(printedSubTotal),
    printed_discount: pickPrinted(printedDiscount),
    printed_taxable: pickPrinted(printedTaxable),
    printed_cgst: pickPrinted(printedCgst),
    printed_sgst: pickPrinted(printedSgst),
    printed_grand_total: pickPrinted(printedGrandTotal),
    total_amount: 0,
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (supabase && navigator.onLine) {
    const { data, error } = await supabase
      .from("purchase_invoices")
      .insert({
        supplier_id: supplierId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        status,
        source,
        notes: row.notes,
        invoice_type: row.invoice_type,
        printed_subtotal: row.printed_subtotal,
        printed_discount: row.printed_discount,
        printed_taxable: row.printed_taxable,
        printed_cgst: row.printed_cgst,
        printed_sgst: row.printed_sgst,
        printed_grand_total: row.printed_grand_total,
        created_by: createdBy,
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error(
          `Duplicate invoice: ${invoiceNumber} already exists for this supplier.`,
        );
      }
      throw error;
    }
    await localDb.purchase_invoices.put(data);
    return data;
  }

  await localDb.purchase_invoices.put(row);
  return row;
}

export async function syncPurchaseInvoicesFromServer(limit = 200) {
  if (!supabase) return;
  const { data: invoices } = await supabase
    .from("purchase_invoices")
    .select("*")
    .order("invoice_date", { ascending: false })
    .limit(limit);
  await localDb.purchase_invoices.clear();
  await localDb.purchase_lines.clear();
  if (invoices?.length) {
    await localDb.purchase_invoices.bulkPut(invoices);
    const ids = invoices.map((i) => i.id);
    const lines = await fetchAllFromSupabase("purchase_lines", {
      filter: (q) => q.in("purchase_invoice_id", ids),
    });
    if (lines.length) await localDb.purchase_lines.bulkPut(lines);
  }
  const suppliers = await fetchAllFromSupabase("suppliers", {
    order: (q) => q.order("name"),
  });
  await localDb.suppliers.clear();
  if (suppliers.length) await localDb.suppliers.bulkPut(suppliers);
}

export async function loadPurchaseInvoiceDetails(invoiceId) {
  const invoice = await localDb.purchase_invoices.get(invoiceId);
  if (!invoice) return null;
  const lines = await localDb.purchase_lines
    .where("purchase_invoice_id")
    .equals(invoiceId)
    .toArray();
  lines.sort((a, b) => a.line_no - b.line_no);
  const supplier = await localDb.suppliers.get(invoice.supplier_id);
  return { invoice, lines, supplier };
}
