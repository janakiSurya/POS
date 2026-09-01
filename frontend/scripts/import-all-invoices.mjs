/**
 * Bulk import all Excel invoices from frontend/Invoices/
 * Run: node --experimental-strip-types scripts/import-all-invoices.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parsePurchaseWorkbooks } from "../src/lib/parsePurchaseExcel.ts";
import { normalizeSupplierRecord, normalizeSupplierName } from "../src/lib/normalizeSupplier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INVOICES_DIR = join(__dirname, "../Invoices");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const OWNER_EMAIL = process.env.IMPORT_OWNER_EMAIL || "owner@sathyasai.local";
const OWNER_PASSWORD = process.env.IMPORT_OWNER_PASSWORD || "123456";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function upsertSupplier(supabase, info) {
  const norm = normalizeSupplierRecord(info);

  if (norm.gstin) {
    const { data: byGstin } = await supabase
      .from("suppliers")
      .select("*")
      .eq("gstin", norm.gstin)
      .maybeSingle();
    if (byGstin) {
      const patch = {};
      if (byGstin.name !== norm.name) patch.name = norm.name;
      if (norm.address && !byGstin.address) patch.address = norm.address;
      if (norm.phone && !byGstin.phone) patch.phone = norm.phone;
      if (norm.email && !byGstin.email) patch.email = norm.email;
      if (Object.keys(patch).length) {
        const { data } = await supabase
          .from("suppliers")
          .update(patch)
          .eq("id", byGstin.id)
          .select()
          .single();
        return data;
      }
      return byGstin;
    }
  }

  const { data: all } = await supabase.from("suppliers").select("*");
  const match = all?.find(
    (s) => normalizeSupplierName(s.name) === norm.name,
  );
  if (match) return match;

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: norm.name,
      gstin: norm.gstin,
      address: norm.address,
      phone: norm.phone,
      email: norm.email,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findOrCreateProduct(supabase, line, inwardCost, mrp) {
  const partNumber = line.code.toUpperCase();
  const sell = toNum(mrp) > 0 ? toNum(mrp) : inwardCost * 1.15;

  const { data: existing } = await supabase
    .from("products")
    .select("*")
    .eq("part_number", partNumber)
    .maybeSingle();

  if (existing) {
    const patch = { selling_price: sell, updated_at: new Date().toISOString() };
    if (line.brand?.trim() && !existing.brand) {
      patch.brand = line.brand.trim();
    }
    await supabase.from("products").update(patch).eq("id", existing.id);
    return { ...existing, ...patch };
  }

  const row = {
    part_number: partNumber,
    name: line.description || partNumber,
    purchase_price: inwardCost,
    selling_price: sell,
    stock_quantity: 0,
    min_stock_alert: 5,
    vehicle_compatibility: [],
    uom: line.uom || "PCS",
    brand: line.brand?.trim() || null,
  };

  const { data, error } = await supabase.from("products").insert(row).select().single();
  if (error) throw error;
  return data;
}

async function importInvoice(supabase, parsed, ownerId, fileName) {
  const supplier = await upsertSupplier(supabase, parsed.supplier);

  const { data: duplicate } = await supabase
    .from("purchase_invoices")
    .select("id, invoice_date")
    .eq("supplier_id", supplier.id)
    .eq("invoice_number", parsed.invoiceNumber)
    .maybeSingle();

  if (duplicate) {
    return {
      status: "skipped",
      invoiceNumber: parsed.invoiceNumber,
      supplier: parsed.supplier.name,
      reason: `duplicate (${duplicate.invoice_date})`,
    };
  }

  const { data: invoice, error: invErr } = await supabase
    .from("purchase_invoices")
    .insert({
      supplier_id: supplier.id,
      invoice_number: parsed.invoiceNumber,
      invoice_date: parsed.invoiceDate,
      status: "POSTED",
      source: "EXCEL",
      notes: parsed.notes,
      invoice_type: parsed.invoiceType,
      printed_subtotal: toNum(parsed.printedSubTotal) || null,
      printed_discount: toNum(parsed.printedDiscount) || null,
      printed_taxable: toNum(parsed.printedTaxable) || null,
      printed_cgst: toNum(parsed.printedCgst) || null,
      printed_sgst: toNum(parsed.printedSgst) || null,
      printed_grand_total: toNum(parsed.printedGrandTotal) || null,
      created_by: ownerId,
    })
    .select()
    .single();

  if (invErr) {
    if (invErr.code === "23505") {
      return {
        status: "skipped",
        invoiceNumber: parsed.invoiceNumber,
        supplier: parsed.supplier.name,
        reason: "duplicate constraint",
      };
    }
    throw invErr;
  }

  let lineCount = 0;
  let skipped = 0;
  for (const line of parsed.lines) {
    const inwardCost = toNum(line.rate);
    const qty = Math.max(0, Math.round(toNum(line.qty)));
    if (!line.code || qty <= 0) {
      skipped++;
      continue;
    }

    const product = await findOrCreateProduct(supabase, line, inwardCost, line.mrp);

    const oldCost = toNum(product.purchase_price);
    const applyCost = inwardCost !== oldCost;

    await supabase.rpc("increase_stock", {
      p_product_id: product.id,
      p_qty: qty,
      p_new_cost: inwardCost,
      p_apply_cost: applyCost,
    });

    const lineTotal =
      toNum(line.lineTotal) > 0 ? toNum(line.lineTotal) : inwardCost * qty;

    const { error: lineErr } = await supabase.from("purchase_lines").insert({
      purchase_invoice_id: invoice.id,
      product_id: product.id,
      part_number: line.code,
      description: line.description,
      quantity: qty,
      unit_cost: inwardCost,
      line_total: lineTotal,
      cost_update_decision: applyCost ? "APPLIED" : "SAME",
      line_no: line.lineNo,
      hsn: line.hsn,
      brand: line.brand,
      uom: line.uom || "PCS",
      mrp: toNum(line.mrp) || null,
      disc_percent: toNum(line.discPercent),
      disc2_percent: toNum(line.disc2Percent) || null,
      taxable: toNum(line.taxable) || null,
      cgst_percent: toNum(line.cgstPercent) || null,
      cgst_amount: toNum(line.cgstAmount) || null,
      sgst_percent: toNum(line.sgstPercent) || null,
      sgst_amount: toNum(line.sgstAmount) || null,
      gross_amount: toNum(line.grossAmount) || null,
      gst_percent: toNum(line.gstPercent) || null,
      raw_data: line.rawData,
    });
    if (lineErr) throw lineErr;
    lineCount++;
  }

  const { data: lines } = await supabase
    .from("purchase_lines")
    .select("line_total")
    .eq("purchase_invoice_id", invoice.id);
  const total = lines?.reduce((s, l) => s + toNum(l.line_total), 0) ?? 0;

  await supabase
    .from("purchase_invoices")
    .update({ total_amount: total, updated_at: new Date().toISOString() })
    .eq("id", invoice.id);

  return {
    status: "imported",
    invoiceNumber: parsed.invoiceNumber,
    supplier: parsed.supplier.name,
    lineCount,
    skipped,
    total,
    file: fileName,
  };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  if (authErr) {
    console.error("Auth failed:", authErr.message);
    process.exit(1);
  }

  const ownerId = authData.user?.id;
  console.log("Signed in as", authData.user?.email);

  const files = readdirSync(INVOICES_DIR)
    .filter((f) => f.endsWith(".xlsx"))
    .sort();

  console.log(`Found ${files.length} Excel files in Invoices/\n`);

  const results = [];
  for (const file of files) {
    const buffer = readFileSync(join(INVOICES_DIR, file));
    const parsedList = parsePurchaseWorkbooks(buffer.buffer);
    console.log(`→ ${file} (${parsedList.length} invoice(s))`);

    for (const parsed of parsedList) {
      try {
        const result = await importInvoice(supabase, parsed, ownerId, file);
        results.push(result);
        const icon = result.status === "imported" ? "✓" : "○";
        console.log(
          `  ${icon} ${result.invoiceNumber} — ${result.status}${result.reason ? ` (${result.reason})` : ""}${result.lineCount ? ` · ${result.lineCount} lines` : ""}`,
        );
      } catch (err) {
        console.error(`  ✗ ${parsed.invoiceNumber}:`, err.message);
        results.push({
          status: "error",
          invoiceNumber: parsed.invoiceNumber,
          file,
          reason: err.message,
        });
      }
    }
  }

  const imported = results.filter((r) => r.status === "imported");
  const skipped = results.filter((r) => r.status === "skipped");
  const errors = results.filter((r) => r.status === "error");

  console.log("\n--- Summary ---");
  console.log(`Imported: ${imported.length} invoices, ${imported.reduce((s, r) => s + r.lineCount, 0)} lines`);
  console.log(`Skipped:  ${skipped.length}`);
  console.log(`Errors:   ${errors.length}`);

  const { count: productCount } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true });
  console.log(`Products in DB: ${productCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
