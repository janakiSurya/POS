/**
 * Backfill purchase lines missing from a prior partial import.
 * Run: node --experimental-strip-types scripts/repair-import.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parsePurchaseWorkbooks } from "../src/lib/parsePurchaseExcel.ts";
import { normalizeSupplierRecord } from "../src/lib/normalizeSupplier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INVOICES_DIR = join(__dirname, "../Invoices");

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.IMPORT_OWNER_EMAIL || "owner@sathyasai.local";
const password = process.env.IMPORT_OWNER_PASSWORD || "123456";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
    if (line.brand?.trim() && !existing.brand) patch.brand = line.brand.trim();
    await supabase.from("products").update(patch).eq("id", existing.id);
    return existing;
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      part_number: partNumber,
      name: line.description || partNumber,
      purchase_price: inwardCost,
      selling_price: sell,
      stock_quantity: 0,
      min_stock_alert: 5,
      vehicle_compatibility: [],
      uom: line.uom || "PCS",
      brand: line.brand?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function main() {
  const supabase = createClient(url, key);
  await supabase.auth.signInWithPassword({ email, password });

  let repaired = 0;

  for (const file of readdirSync(INVOICES_DIR).filter((f) => f.endsWith(".xlsx"))) {
    const parsedList = parsePurchaseWorkbooks(
      readFileSync(join(INVOICES_DIR, file)).buffer,
    );

    for (const parsed of parsedList) {
      const norm = normalizeSupplierRecord(parsed.supplier);
      const { data: supplier } = await supabase
        .from("suppliers")
        .select("*")
        .eq("gstin", norm.gstin)
        .maybeSingle();
      if (!supplier) continue;

      const { data: invoice } = await supabase
        .from("purchase_invoices")
        .select("*")
        .eq("supplier_id", supplier.id)
        .eq("invoice_number", parsed.invoiceNumber)
        .maybeSingle();
      if (!invoice) continue;

      const { data: existingLines } = await supabase
        .from("purchase_lines")
        .select("line_no, part_number")
        .eq("purchase_invoice_id", invoice.id);

      const have = new Set(
        existingLines?.map((l) => `${l.line_no}:${l.part_number.toUpperCase()}`) ?? [],
      );

      for (const line of parsed.lines) {
        const key = `${line.lineNo}:${line.code.toUpperCase()}`;
        if (have.has(key)) continue;

        const inwardCost = toNum(line.rate);
        const qty = Math.max(0, Math.round(toNum(line.qty)));
        if (!line.code || qty <= 0) continue;

        const product = await findOrCreateProduct(supabase, line, inwardCost, line.mrp);
        const applyCost = inwardCost !== toNum(product.purchase_price);

        await supabase.rpc("increase_stock", {
          p_product_id: product.id,
          p_qty: qty,
          p_new_cost: inwardCost,
          p_apply_cost: applyCost,
        });

        await supabase.from("purchase_lines").insert({
          purchase_invoice_id: invoice.id,
          product_id: product.id,
          part_number: line.code,
          description: line.description,
          quantity: qty,
          unit_cost: inwardCost,
          line_total: toNum(line.lineTotal) || inwardCost * qty,
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

        console.log(`+ ${parsed.invoiceNumber} line ${line.lineNo} ${line.code}`);
        repaired++;
      }

      const { data: allLines } = await supabase
        .from("purchase_lines")
        .select("line_total")
        .eq("purchase_invoice_id", invoice.id);
      const total = allLines?.reduce((s, l) => s + toNum(l.line_total), 0) ?? 0;
      await supabase
        .from("purchase_invoices")
        .update({ total_amount: total, updated_at: new Date().toISOString() })
        .eq("id", invoice.id);
    }
  }

  console.log(`\nRepaired ${repaired} missing line(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
