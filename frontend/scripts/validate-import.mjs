/**
 * Compare Excel invoice files against Supabase purchase data.
 * Run: node --experimental-strip-types scripts/validate-import.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parsePurchaseWorkbooks } from "../src/lib/parsePurchaseExcel.ts";

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

async function fetchAll(supabase, table, filter = (q) => q) {
  const all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await filter(
      supabase.from(table).select("*"),
    ).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function main() {
  const supabase = createClient(url, key);
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (authErr) throw authErr;

  const dbInvoices = await fetchAll(supabase, "purchase_invoices");
  const dbLines = await fetchAll(supabase, "purchase_lines");
  const suppliers = await fetchAll(supabase, "suppliers");

  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const dbByInv = new Map(dbInvoices.map((i) => [i.invoice_number, i]));

  let issues = 0;
  let expectedLines = 0;
  let dbLinesMatched = 0;

  console.log("Invoice validation (Excel parser vs database)\n");

  for (const file of readdirSync(INVOICES_DIR)
    .filter((f) => f.endsWith(".xlsx"))
    .sort()) {
    const parsedList = parsePurchaseWorkbooks(
      readFileSync(join(INVOICES_DIR, file)).buffer,
    );
    for (const parsed of parsedList) {
      expectedLines += parsed.lines.length;
      const sumQty = parsed.lines.reduce((s, l) => s + toNum(l.qty), 0);
      const sumTax = parsed.lines.reduce((s, l) => s + toNum(l.taxable), 0);

      const dbInv = dbByInv.get(parsed.invoiceNumber);
      if (!dbInv) {
        console.log(`✗ ${parsed.invoiceNumber} — NOT IN DATABASE (${parsed.lines.length} lines in Excel)`);
        issues++;
        continue;
      }

      const invLines = dbLines.filter((l) => l.purchase_invoice_id === dbInv.id);
      const dbQty = invLines.reduce((s, l) => s + toNum(l.quantity), 0);
      const dbTax = invLines.reduce((s, l) => s + toNum(l.taxable), 0);

      const lineOk = invLines.length === parsed.lines.length;
      const qtyOk = dbQty === sumQty;
      if (lineOk) dbLinesMatched += invLines.length;

      const flags = [];
      if (!lineOk) flags.push(`lines ${invLines.length}/${parsed.lines.length}`);
      if (!qtyOk) flags.push(`qty ${dbQty}/${sumQty}`);

      const taxPrinted = toNum(parsed.printedTaxable);
      if (taxPrinted > 0 && Math.abs(dbTax - sumTax) > 1) {
        flags.push(`taxable db ${dbTax.toFixed(0)} vs excel ${sumTax.toFixed(0)}`);
      }

      const icon = flags.length ? "✗" : "✓";
      const sup = supMap.get(dbInv.supplier_id) ?? "";
      console.log(
        `${icon} ${parsed.invoiceNumber.padEnd(10)} ${String(invLines.length).padStart(3)} lines · qty ${dbQty} · ${sup.slice(0, 20)}${flags.length ? ` — ${flags.join(", ")}` : ""}`,
      );
      if (flags.length) issues++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Excel line items: ${expectedLines}`);
  console.log(`DB lines matched: ${dbLinesMatched}`);
  console.log(`Issues: ${issues}`);
  console.log(
    `Unique products: ${new Set(dbLines.map((l) => l.part_number)).size} (same part on multiple invoices = one product)`,
  );

  if (issues > 0) {
    console.log("\nRun: node --experimental-strip-types scripts/repair-import.mjs");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
