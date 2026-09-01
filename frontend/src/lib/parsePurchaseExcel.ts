import * as XLSX from "xlsx";
import { normalizeSupplierRecord } from "./normalizeSupplier.js";

export type ParsedPurchaseLine = {
  lineNo: number;
  code: string;
  description: string;
  hsn: string | null;
  brand: string | null;
  uom: string;
  qty: string;
  mrp: string;
  rate: string;
  discPercent: string | null;
  taxable: string;
  cgstPercent: string | null;
  cgstAmount: string | null;
  sgstPercent: string | null;
  sgstAmount: string | null;
  lineTotal: string | null;
  disc2Percent: string | null;
  grossAmount: string | null;
  gstPercent: string | null;
  rawData: Record<string, unknown> | null;
};

export type ParsedPurchaseFile = {
  format: string;
  supplier: {
    name: string;
    gstin: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: string | null;
  printedSubTotal: string | null;
  printedDiscount: string | null;
  printedTaxable: string | null;
  printedCgst: string | null;
  printedSgst: string | null;
  printedGrandTotal: string | null;
  printedQty: string | null;
  notes: string | null;
  lines: ParsedPurchaseLine[];
};

type SummaryMap = Map<string, unknown>;

const FIELD_ALIASES = {
  code: ["code", "item code", "sku", "part code"],
  description: ["description", "name", "item"],
  qty: ["qty", "quantity"],
  rate: [
    "rate",
    "net rate",
    "net rate printed",
    "net rate exact",
    "net rate rs printed",
    "net rate rs exact",
  ],
  mrp: ["mrp", "m r p", "m.r.p"],
  brand: ["brand", "brand group", "brand / group", "supplier brand group", "supplier / brand group", "group"],
  hsn: ["hsn", "hsn code"],
  disc: ["disc %", "disc", "discount", "disc 1", "dis %"],
  disc2: ["disc 2"],
  taxable: [
    "taxable",
    "taxable amount",
    "taxable value",
    "taxable value printed",
    "amount taxable",
  ],
  lineTotal: [
    "line total",
    "line total incl gst",
    "line total incl. gst",
    "line amt incl gst",
    "line amt incl. gst",
    "line total taxable+gst",
    "line total (taxable+gst)",
  ],
  uom: ["uom", "unit"],
  cgstPercent: ["cgst %", "cgst"],
  cgstAmount: ["cgst value", "cgst amt", "cgst amount"],
  sgstPercent: ["sgst %", "sgst"],
  sgstAmount: ["sgst value", "sgst amt", "sgst amount"],
  gstAmount: ["gst amount", "gst amt", "total gst"],
  lineNo: ["s.no", "sno", "sn", "s no", "#"],
  invoiceNo: ["invoice no", "invoice number"],
  invoiceDate: ["invoice date"],
  grossLine: ["gross rate x qty", "gross mrp x qty", "mrp value gross", "amount"],
  costPerUnit: ["cost per unit excl gst", "cost per unit"],
  gayatriCheck: ["check amount (gross x 85% / 1.18)"],
  gstPercent: ["gst %", "gst percent"],
} as const;

type FieldName = keyof typeof FIELD_ALIASES;

function money(value: unknown): string {
  if (value == null || value === "") return "0.00";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function moneyOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function qty(value: unknown): string {
  if (value == null || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

function text(value: unknown): string | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function requiredText(value: unknown, fallback = ""): string {
  return text(value) ?? fallback;
}

/** Skip TOTAL rows and footnote paragraphs that share the line-items sheet. */
function isSkippableLineRow(row: Record<string, unknown>): boolean {
  const code = text(cell(row, "code"));
  if (!code) return true;
  const c = code.trim();
  if (/^total$/i.test(c)) return true;
  if (c.length > 45) return true;
  if (
    /^[•\u2022]|pricing rule|verification status|inventory note|structural warning|corrections from|billing discrepancy|note on the page|one unresolved/i.test(
      c,
    )
  ) {
    return true;
  }
  return false;
}

function asPercent(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n <= 1) return (n * 100).toFixed(2);
  return n.toFixed(2);
}

/** Combine Disc 1 + Disc 2 when both are fractions/percents. */
function combinedDiscPercent(disc1: unknown, disc2: unknown): string | null {
  const d1 = asPercent(disc1);
  if (disc2 == null || disc2 === "") return d1;
  const d2 = asPercent(disc2);
  if (!d1) return d2;
  if (!d2) return d1;
  const f1 = Number(d1) / 100;
  const f2 = Number(d2) / 100;
  const combined = 1 - (1 - f1) * (1 - f2);
  return (combined * 100).toFixed(2);
}

function normalizeUom(value: unknown): string {
  const raw = requiredText(value).toUpperCase();
  if (!raw) return "PCS";
  if (raw === "PC" || raw === "PCS") return "PCS";
  if (raw === "ST" || raw === "SEY" || raw === "SET") return "SET";
  return raw;
}

function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = requiredText(value);
  const match = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    return `${match[3]}-${month}-${day}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/** Strip spaces, currency symbols, and punctuation so similar headers match. */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/₹/g, "")
    .replace(/rs\.?/g, "")
    .replace(/[^a-z0-9%+/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summaryKeyNorm(key: string): string {
  return normalizeHeader(key);
}

function loadSummary(wb: XLSX.WorkBook): SummaryMap {
  const sheetName =
    wb.SheetNames.find((name) => /invoice\s*summary/i.test(name)) ??
    wb.SheetNames.find((name) => /^summary$/i.test(name)) ??
    "Invoice Summary";
  const sheet = wb.Sheets[sheetName];
  const map: SummaryMap = new Map();
  if (!sheet) return map;
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
  });
  for (const row of rows) {
    if (!row || row[0] == null || row[0] === "") continue;
    const key = String(row[0]).trim();
    const val = row.slice(1).find((v) => v != null && v !== "");
    if (val != null) {
      map.set(key, val);
      map.set(summaryKeyNorm(key), val);
    }
  }
  return map;
}

function pick(map: SummaryMap, ...keys: string[]) {
  for (const key of keys) {
    if (map.has(key)) return map.get(key);
    const norm = summaryKeyNorm(key);
    if (map.has(norm)) return map.get(norm);
  }
  return undefined;
}

function aliasesMatch(header: string, aliases: readonly string[]) {
  const norm = normalizeHeader(header);
  return aliases.some((alias) => {
    const a = normalizeHeader(alias);
    if (!a) return false;
    // Exact match, or header starts with alias + extra words
    // ("net rate printed" matches "net rate"). Do not match
    // "hsn code" as "code".
    return norm === a || norm.startsWith(`${a} `);
  });
}

function rowHasAlias(cells: unknown[], aliases: readonly string[]) {
  return cells.some((cell) => cell != null && cell !== "" && aliasesMatch(String(cell), aliases));
}

function findHeaderRowIndex(rawRows: unknown[][]): number {
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row) || row.length < 2) continue;
    const hasCode = rowHasAlias(row, FIELD_ALIASES.code);
    const hasQty = rowHasAlias(row, FIELD_ALIASES.qty);
    if (hasCode && hasQty) return i;
  }
  return -1;
}

function sheetToObjects(
  sheet: XLSX.WorkSheet,
): Record<string, unknown>[] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  const headerIdx = findHeaderRowIndex(raw);
  if (headerIdx < 0) {
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    range: headerIdx,
    defval: null,
    raw: true,
  });
}

function lineRows(wb: XLSX.WorkBook, sheetName = "Line Items") {
  const sheet = wb.Sheets[sheetName] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return sheetToObjects(sheet);
}

function headerKey(row: Record<string, unknown>, aliases: readonly string[]) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const matches = keys.filter((key) => aliasesMatch(key, [alias]));
    if (!matches.length) continue;
    // Prefer printed / shorter headers over recalc / exact / formula columns.
    matches.sort((a, b) => {
      const score = (k: string) => {
        const n = normalizeHeader(k);
        if (n.includes("recalc") || n.includes("check") || n.includes("diff")) return 3;
        if (n.includes("exact")) return 2;
        if (n.includes("printed")) return 0;
        return 1;
      };
      const s = score(a) - score(b);
      if (s !== 0) return s;
      return a.length - b.length;
    });
    return matches[0];
  }
  return null;
}

function cell(row: Record<string, unknown>, field: FieldName | readonly string[]) {
  const aliases = typeof field === "string" ? FIELD_ALIASES[field] : field;
  const key = headerKey(row, aliases);
  return key ? row[key] : undefined;
}

function hasField(row: Record<string, unknown>, field: FieldName) {
  return headerKey(row, FIELD_ALIASES[field]) != null;
}

function snapshotRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null || value === "") continue;
    out[key] = value;
  }
  return out;
}

function inlineInvoiceMeta(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const invNo = text(row["Invoice No"] ?? row["Invoice No."]);
    if (invNo) {
      return {
        invoiceNumber: invNo,
        invoiceDate: parseDate(row["Invoice Date"] ?? row["Invoice date"]),
      };
    }
  }
  return null;
}

type SummaryInvoiceTotals = {
  qty: string | null;
  taxable: string | null;
  cgst: string | null;
  sgst: string | null;
  grandTotal: string | null;
};

function loadSummaryInvoiceTable(wb: XLSX.WorkBook): Map<string, SummaryInvoiceTotals> {
  const map = new Map<string, SummaryInvoiceTotals>();
  const sheetName =
    wb.SheetNames.find((name) => /invoice\s*summary/i.test(name)) ??
    wb.SheetNames.find((name) => /^summary$/i.test(name));
  if (!sheetName) return map;
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return map;
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
  });
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.[0]) continue;
    const key = normalizeHeader(String(row[0]));
    if (key === "invoice no" || key.startsWith("invoice no ")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return map;
  const header = rows[headerIdx] ?? [];
  const col = (label: string) =>
    header.findIndex((h) => normalizeHeader(String(h ?? "")).includes(normalizeHeader(label)));
  const taxableCol = col("taxable");
  const cgstCol = col("cgst");
  const sgstCol = col("sgst");
  const grandCol = header.findIndex((h) => {
    const n = normalizeHeader(String(h ?? ""));
    return n.includes("net amount") || n === "grand total";
  });
  const qtyCol = col("total qty") >= 0 ? col("total qty") : col("qty");

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.[0]) continue;
    const invNo = text(row[0]);
    if (!invNo || normalizeHeader(invNo) === "total") continue;
    map.set(invNo, {
      qty: qtyCol >= 0 && row[qtyCol] != null ? String(row[qtyCol]) : null,
      taxable:
        taxableCol >= 0 && row[taxableCol] != null
          ? money(row[taxableCol])
          : null,
      cgst: cgstCol >= 0 && row[cgstCol] != null ? money(row[cgstCol]) : null,
      sgst: sgstCol >= 0 && row[sgstCol] != null ? money(row[sgstCol]) : null,
      grandTotal:
        grandCol >= 0 && row[grandCol] != null ? money(row[grandCol]) : null,
    });
  }
  return map;
}

function splitMultiInvoice(
  wb: XLSX.WorkBook,
  parsed: ParsedPurchaseFile,
  rows: Record<string, unknown>[],
): ParsedPurchaseFile[] {
  const invoiceNos = new Set<string>();
  for (const row of rows) {
    const no = text(row["Invoice No"] ?? row["Invoice No."]);
    if (no) invoiceNos.add(no);
  }

  if (invoiceNos.size <= 1) {
    const inline = inlineInvoiceMeta(rows);
    if (inline) {
      parsed.invoiceNumber = inline.invoiceNumber;
      parsed.invoiceDate = inline.invoiceDate;
    }
    return [parsed];
  }

  const table = loadSummaryInvoiceTable(wb);
  return [...invoiceNos].map((invNo) => {
    const invLines = parsed.lines.filter(
      (l) => text(l.rawData?.["Invoice No"] ?? l.rawData?.["Invoice No."]) === invNo,
    );
    const firstRow = rows.find((r) => text(r["Invoice No"] ?? r["Invoice No."]) === invNo);
    const totals = table.get(invNo);
    return {
      ...parsed,
      invoiceNumber: invNo,
      invoiceDate: parseDate(firstRow?.["Invoice Date"] ?? firstRow?.["Invoice date"]),
      lines: invLines,
      printedSubTotal: totals?.taxable ?? parsed.printedSubTotal,
      printedTaxable: totals?.taxable ?? parsed.printedTaxable,
      printedCgst: totals?.cgst ?? parsed.printedCgst,
      printedSgst: totals?.sgst ?? parsed.printedSgst,
      printedGrandTotal: totals?.grandTotal ?? parsed.printedGrandTotal,
      printedQty:
        totals?.qty ?? String(invLines.reduce((s, l) => s + Number(l.qty), 0)),
    };
  });
}

function detectFormat(sample: Record<string, unknown>): "kumar" | "gayatri" | "kokila" | "generic" {
  const keys = Object.keys(sample).map((k) => normalizeHeader(k));
  const exact = (alias: string) => keys.includes(normalizeHeader(alias));
  const hasKey = (alias: string) => {
    const a = normalizeHeader(alias);
    return keys.some((k) => k === a || k.startsWith(`${a} `));
  };

  // Old Kumar: Supplier / Brand Group or Taxable Amount
  // New Kumar: Brand column + Item Code
  if (
    hasKey("supplier brand group") ||
    exact("taxable amount") ||
    (exact("brand") && hasField(sample, "code"))
  ) {
    return "kumar";
  }

  // Kokila: Code + Name (not Item Code)
  if (exact("code") && exact("name") && !hasKey("item code")) {
    return "kokila";
  }

  // Gayatri: Item Code + Amount (taxable) / check column
  if (
    hasKey("item code") &&
    (hasKey("amount taxable") || hasKey("check amount") || hasKey("description"))
  ) {
    return "gayatri";
  }

  return "generic";
}

export function parsePurchaseWorkbook(buffer: ArrayBuffer): ParsedPurchaseFile {
  const all = parsePurchaseWorkbooks(buffer);
  return all[0];
}

export function parsePurchaseWorkbooks(buffer: ArrayBuffer): ParsedPurchaseFile[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const rows = lineRows(wb);
  const sample = rows[0] ?? {};
  const format = detectFormat(sample);

  let parsed: ParsedPurchaseFile;
  if (format === "kumar") parsed = parseKumar(wb, rows);
  else if (format === "gayatri") parsed = parseGayatri(wb, rows);
  else if (format === "kokila") parsed = parseKokila(wb, rows);
  else parsed = parseGeneric(wb, rows);

  return splitMultiInvoice(wb, parsed, rows).map((p) => ({
    ...p,
    supplier: { ...p.supplier, ...normalizeSupplierRecord(p.supplier) },
  }));
}

function parseGayatri(wb: XLSX.WorkBook, rows: Record<string, unknown>[]): ParsedPurchaseFile {
  const summary = loadSummary(wb);
  const lines: ParsedPurchaseLine[] = [];
  for (const row of rows) {
    const code = text(cell(row, "code"));
    if (isSkippableLineRow(row)) continue;
    const qtyVal = Number(qty(cell(row, "qty"))) || 1;
    const mrpUnit = money(cell(row, "rate") ?? row["Rate"]);
    const taxableVal = money(cell(row, "taxable") ?? row["Amount (taxable)"]);
    const costUnit = money(
      cell(row, "costPerUnit") ??
        row["Cost per unit (excl. GST)"] ??
        Number(taxableVal) / qtyVal,
    );
    const grossLine =
      row["Gross (Rate x Qty)"] != null
        ? money(row["Gross (Rate x Qty)"])
        : money(Number(mrpUnit) * qtyVal);

    lines.push({
      lineNo: Number(cell(row, "lineNo")) || lines.length + 1,
      code,
      description: requiredText(cell(row, "description"), code),
      hsn: text(cell(row, "hsn")),
      brand: "Honda",
      uom: normalizeUom(cell(row, "uom")),
      qty: String(qtyVal),
      mrp: mrpUnit,
      rate: costUnit,
      discPercent: "15.00",
      disc2Percent: null,
      taxable: taxableVal,
      cgstPercent: asPercent(cell(row, "cgstPercent")),
      cgstAmount: moneyOrNull(cell(row, "cgstAmount")),
      sgstPercent: asPercent(cell(row, "sgstPercent")),
      sgstAmount: moneyOrNull(cell(row, "sgstAmount")),
      lineTotal: moneyOrNull(cell(row, "lineTotal")),
      grossAmount: grossLine,
      gstPercent: "18",
      rawData: snapshotRow(row),
    });
  }
  return {
    format: "gayatri",
    supplier: {
      name: requiredText(
        pick(summary, "Seller", "Supplier"),
        "GAYATRI AUTO DISTRIBUTORS",
      ),
      gstin: text(pick(summary, "Seller GSTIN", "Supplier GSTIN")),
      address: text(pick(summary, "Seller Address", "Supplier address", "Supplier Address")),
      phone: text(pick(summary, "Seller Phone", "Supplier phone / e-mail", "Supplier Phone")),
      email: text(pick(summary, "Seller Email")),
    },
    invoiceNumber: requiredText(
      pick(summary, "Invoice No.", "Invoice no.", "Invoice Number"),
      "UNKNOWN",
    ),
    invoiceDate: parseDate(pick(summary, "Invoice Date", "Invoice date")),
    invoiceType: text(pick(summary, "Type", "Document type", "Sale Type")),
    printedSubTotal: moneyOrNull(pick(summary, "Sub Total", "Sub Total (taxable value)")),
    printedDiscount: moneyOrNull(pick(summary, "Discount")),
    printedTaxable: moneyOrNull(
      pick(summary, "Taxable (GST 18%)", "Taxable Amount", "Sub Total (taxable value)"),
    ),
    printedCgst: moneyOrNull(pick(summary, "CGST Payable", "CGST Amount @ 9%", "CGST @ 9%")),
    printedSgst: moneyOrNull(pick(summary, "SGST Payable", "SGST Amount @ 9%", "SGST @ 9%")),
    printedGrandTotal: moneyOrNull(
      pick(summary, "GRAND TOTAL", "NET AMOUNT PAYABLE", "NET AMOUNT"),
    ),
    printedQty: String(lines.reduce((s, l) => s + Number(l.qty), 0)),
    notes: null,
    lines,
  };
}

function parseKumar(wb: XLSX.WorkBook, rows: Record<string, unknown>[]): ParsedPurchaseFile {
  const summary = loadSummary(wb);
  const lines: ParsedPurchaseLine[] = [];
  for (const row of rows) {
    const code = text(cell(row, "code"));
    if (isSkippableLineRow(row)) continue;

    const rateVal =
      cell(row, "rate") ??
      row["Net Rate (₹) printed"] ??
      row["Net Rate (₹) exact"] ??
      row["Rate"];
    const disc2 = asPercent(cell(row, "disc2") ?? row["Disc 2"]);
    const disc = combinedDiscPercent(
      cell(row, "disc") ?? row["Disc %"] ?? row["Disc 1"],
      cell(row, "disc2") ?? row["Disc 2"],
    );
    const taxableRaw = cell(row, "taxable");
    const cgstAmt = moneyOrNull(cell(row, "cgstAmount"));
    const sgstAmt = moneyOrNull(cell(row, "sgstAmount"));
    const gstTotal = moneyOrNull(cell(row, "gstAmount"));
    let cgstAmount = cgstAmt;
    let sgstAmount = sgstAmt;
    let cgstPercent = asPercent(cell(row, "cgstPercent")) ?? "9";
    let sgstPercent = asPercent(cell(row, "sgstPercent")) ?? "9";
    if (!cgstAmount && !sgstAmount && gstTotal != null) {
      const half = (Number(gstTotal) / 2).toFixed(2);
      cgstAmount = half;
      sgstAmount = half;
      cgstPercent = "9";
      sgstPercent = "9";
    }

    const qtyVal = qty(cell(row, "qty"));
    const mrpVal = money(cell(row, "mrp"));
    const grossLine = money(
      row["MRP Value (Gross)"] ??
        row["Gross (MRP x Qty)"] ??
        Number(mrpVal) * Number(qtyVal),
    );

    lines.push({
      lineNo: Number(cell(row, "lineNo")) || lines.length + 1,
      code,
      description: requiredText(cell(row, "description"), code),
      hsn: text(cell(row, "hsn")),
      brand: text(cell(row, "brand")),
      uom: normalizeUom(cell(row, "uom")),
      qty: qtyVal,
      mrp: mrpVal,
      rate: money(rateVal),
      discPercent: disc,
      disc2Percent: disc2,
      taxable: money(taxableRaw),
      cgstPercent,
      cgstAmount,
      sgstPercent,
      sgstAmount,
      lineTotal: moneyOrNull(cell(row, "lineTotal")),
      grossAmount: grossLine,
      gstPercent: cgstPercent ? String(Number(cgstPercent) * 2) : "18",
      rawData: snapshotRow(row),
    });
  }

  const phoneRaw = text(
    pick(summary, "Seller Phone", "Supplier phone / e-mail", "Supplier Phone"),
  );
  let phone: string | null = phoneRaw;
  let email: string | null = null;
  if (phoneRaw?.includes("|")) {
    const [p, e] = phoneRaw.split("|").map((s) => s.trim());
    phone = p || null;
    email = e || null;
  }

  return {
    format: "kumar",
    supplier: {
      name: requiredText(
        pick(summary, "Seller", "Supplier"),
        "KUMAR AUTO STORES",
      ),
      gstin: text(pick(summary, "Seller GSTIN", "Supplier GSTIN")),
      address: text(pick(summary, "Seller Address", "Supplier address", "Supplier Address")),
      phone,
      email,
    },
    invoiceNumber: requiredText(
      pick(summary, "Invoice No.", "Invoice no.", "Invoice Number"),
      "UNKNOWN",
    ),
    invoiceDate: parseDate(pick(summary, "Invoice Date", "Invoice date")),
    invoiceType: text(pick(summary, "Type", "Document type")) ?? "CREDIT",
    printedSubTotal: moneyOrNull(
      pick(
        summary,
        "Sub Total (Taxable Value)",
        "Sub Total (taxable value)",
        "Sub Total",
      ),
    ),
    printedDiscount: null,
    printedTaxable: moneyOrNull(
      pick(
        summary,
        "Sub Total (Taxable Value)",
        "Sub Total (taxable value)",
        "Taxable Amount",
      ),
    ),
    printedCgst: moneyOrNull(pick(summary, "CGST Amount @ 9%", "CGST @ 9%", "CGST Payable")),
    printedSgst: moneyOrNull(pick(summary, "SGST Amount @ 9%", "SGST @ 9%", "SGST Payable")),
    printedGrandTotal: moneyOrNull(
      pick(summary, "NET AMOUNT PAYABLE", "GRAND TOTAL", "NET AMOUNT"),
    ),
    printedQty: moneyOrNull(pick(summary, "Total Quantity", "Total Qty")),
    notes: null,
    lines,
  };
}

function parseKokila(wb: XLSX.WorkBook, rows: Record<string, unknown>[]): ParsedPurchaseFile {
  const summary = loadSummary(wb);
  const lines: ParsedPurchaseLine[] = [];
  for (const row of rows) {
    const code = text(cell(row, "code"));
    if (isSkippableLineRow(row)) continue;
    const quantity = qty(cell(row, "qty"));
    const taxable = money(cell(row, "taxable") ?? row["Taxable Value"]);
    const mrpVal = money(cell(row, "mrp") ?? row["M.R.P"]);
    const amountGross = money(cell(row, "grossLine") ?? row["Amount"]);
    lines.push({
      lineNo: Number(cell(row, "lineNo")) || lines.length + 1,
      code,
      description: requiredText(cell(row, "description"), code),
      hsn: text(cell(row, "hsn")),
      brand: text(cell(row, "brand")),
      uom: "PCS",
      qty: quantity,
      mrp: mrpVal,
      rate: money(cell(row, "rate")),
      discPercent: asPercent(cell(row, "disc") ?? row["Dis %"]),
      disc2Percent: null,
      taxable,
      cgstPercent: asPercent(cell(row, "cgstPercent")),
      cgstAmount: moneyOrNull(cell(row, "cgstAmount")),
      sgstPercent: asPercent(cell(row, "sgstPercent")),
      sgstAmount: moneyOrNull(cell(row, "sgstAmount")),
      lineTotal: moneyOrNull(cell(row, "lineTotal")),
      grossAmount: amountGross,
      gstPercent: "18",
      rawData: snapshotRow(row),
    });
  }
  return {
    format: "kokila",
    supplier: {
      name: requiredText(pick(summary, "Seller", "Supplier"), "KOKILA ENTERPRISES"),
      gstin: text(pick(summary, "Seller GSTIN", "Supplier GSTIN")),
      address: text(pick(summary, "Seller Address", "Supplier address")),
      phone: text(pick(summary, "Seller Phone", "Supplier Phone")),
      email: text(pick(summary, "Seller Email")),
    },
    invoiceNumber: requiredText(
      pick(summary, "Invoice No.", "Invoice no."),
      "UNKNOWN",
    ),
    invoiceDate: parseDate(pick(summary, "Invoice Date", "Invoice date")),
    invoiceType: text(pick(summary, "Sale Type", "Document type")),
    printedSubTotal: moneyOrNull(
      pick(summary, "Total Amount (pre-discount, incl. tax)", "Sub Total"),
    ),
    printedDiscount: null,
    printedTaxable: moneyOrNull(pick(summary, "Taxable Amount")),
    printedCgst: moneyOrNull(pick(summary, "Add CGST @ 9%", "CGST @ 9%")),
    printedSgst: moneyOrNull(pick(summary, "Add SGST @ 9%", "SGST @ 9%")),
    printedGrandTotal: moneyOrNull(pick(summary, "NET AMOUNT", "GRAND TOTAL")),
    printedQty: moneyOrNull(pick(summary, "Total Quantity", "Total Qty")),
    notes: "Flat 20% discount on all lines.",
    lines,
  };
}

function parseGeneric(wb: XLSX.WorkBook, rows: Record<string, unknown>[]): ParsedPurchaseFile {
  const lines: ParsedPurchaseLine[] = [];
  for (const row of rows) {
    const code = text(cell(row, "code"));
    if (isSkippableLineRow(row)) continue;
    const quantity = qty(cell(row, "qty"));
    const rate = money(cell(row, "rate"));
    const mrpVal = money(cell(row, "mrp"));
    const taxableRaw = cell(row, "taxable");
    const gstTotal = moneyOrNull(cell(row, "gstAmount"));
    let cgstAmount = moneyOrNull(cell(row, "cgstAmount"));
    let sgstAmount = moneyOrNull(cell(row, "sgstAmount"));
    if (!cgstAmount && !sgstAmount && gstTotal != null) {
      const half = (Number(gstTotal) / 2).toFixed(2);
      cgstAmount = half;
      sgstAmount = half;
    }
    const disc2 = asPercent(cell(row, "disc2"));
    lines.push({
      lineNo: Number(cell(row, "lineNo")) || lines.length + 1,
      code,
      description: requiredText(cell(row, "description"), code),
      hsn: text(cell(row, "hsn")),
      brand: text(cell(row, "brand")),
      uom: normalizeUom(cell(row, "uom")),
      qty: quantity,
      mrp: mrpVal,
      rate,
      discPercent: combinedDiscPercent(cell(row, "disc"), cell(row, "disc2")),
      disc2Percent: disc2,
      taxable:
        taxableRaw != null && taxableRaw !== ""
          ? money(taxableRaw)
          : money((Number(quantity) * Number(rate)) / 1.18),
      cgstPercent: asPercent(cell(row, "cgstPercent")) ?? "9",
      cgstAmount,
      sgstPercent: asPercent(cell(row, "sgstPercent")) ?? "9",
      sgstAmount,
      lineTotal: moneyOrNull(cell(row, "lineTotal")),
      grossAmount: money(Number(mrpVal) * Number(quantity)),
      gstPercent: asPercent(cell(row, "gstPercent")) ?? "18",
      rawData: snapshotRow(row),
    });
  }
  if (!lines.length) {
    throw new Error("No line items found. Need a Code and Qty column.");
  }

  const summary = loadSummary(wb);
  return {
    format: "generic",
    supplier: {
      name: requiredText(
        pick(summary, "Seller", "Supplier"),
        requiredText(wb.SheetNames[0], "Supplier"),
      ),
      gstin: text(pick(summary, "Seller GSTIN", "Supplier GSTIN")),
      address: text(pick(summary, "Seller Address", "Supplier address")),
      phone: text(pick(summary, "Seller Phone", "Supplier phone / e-mail")),
      email: null,
    },
    invoiceNumber: requiredText(
      pick(summary, "Invoice No.", "Invoice no."),
      "",
    ),
    invoiceDate: parseDate(
      pick(summary, "Invoice Date", "Invoice date") ?? new Date().toISOString().slice(0, 10),
    ),
    invoiceType: text(pick(summary, "Document type", "Type")) ?? "CREDIT",
    printedSubTotal: moneyOrNull(pick(summary, "Sub Total (taxable value)", "Sub Total")),
    printedDiscount: null,
    printedTaxable: moneyOrNull(pick(summary, "Sub Total (taxable value)", "Taxable Amount")),
    printedCgst: moneyOrNull(pick(summary, "CGST @ 9%", "CGST Amount @ 9%")),
    printedSgst: moneyOrNull(pick(summary, "SGST @ 9%", "SGST Amount @ 9%")),
    printedGrandTotal: moneyOrNull(pick(summary, "GRAND TOTAL", "NET AMOUNT PAYABLE")),
    printedQty: String(lines.reduce((s, l) => s + Number(l.qty), 0)),
    notes: null,
    lines,
  };
}
