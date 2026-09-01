import { round2, toNum } from "./format";

const DEFAULT_GST_PERCENT = 18;

/** ₹ or 0.5% of amount — used for printed vs computed checks. */
export function amountTolerance(amount) {
  return Math.max(1, round2(toNum(amount) * 0.005));
}

export function isClose(a, b, tolerance) {
  const t = tolerance ?? amountTolerance(Math.max(toNum(a), toNum(b)));
  return Math.abs(toNum(a) - toNum(b)) <= t;
}

export function combinedDiscFraction(disc1, disc2) {
  const d1 = toNum(disc1) / 100;
  const d2 = toNum(disc2) / 100;
  if (d1 <= 0 && d2 <= 0) return 0;
  return 1 - (1 - d1) * (1 - d2);
}

/**
 * Purchase line math by supplier format (from real invoice Excel files).
 * - kumar: net rate per unit incl. GST → taxable = rate×qty / 1.18
 * - gayatri: MRP×qty, 15% disc → taxable = gross×(1-disc) / 1.18
 * - kokila: rate×qty (line amount), disc on amount → taxable = amount×(1-disc)
 * - simple: unit cost excl. GST (manual entry)
 */
export function calcModeFromFormat(format) {
  if (format === "gayatri") return "gayatri";
  if (format === "kokila") return "kokila";
  if (format === "kumar") return "kumar";
  return "simple";
}

export function computePurchaseLine(input) {
  const qty = toNum(input.qty ?? input.quantity);
  const gstPercent = toNum(input.gstPercent) || DEFAULT_GST_PERCENT;
  const gstRate = gstPercent / 100;
  const cgstPercent =
    input.cgstPercent != null && input.cgstPercent !== ""
      ? toNum(input.cgstPercent)
      : gstPercent / 2;
  const sgstPercent =
    input.sgstPercent != null && input.sgstPercent !== ""
      ? toNum(input.sgstPercent)
      : gstPercent / 2;
  const discFrac = combinedDiscFraction(
    input.discPercent ?? input.disc_percent,
    input.disc2Percent ?? input.disc2_percent,
  );
  const mrp = toNum(input.mrp);
  const rate = toNum(input.rate ?? input.unit_cost ?? input.unitCost);
  const mode = input.calcMode || "simple";

  let gross = toNum(input.grossAmount ?? input.gross_amount);
  if (!gross && mrp && qty) gross = round2(mrp * qty);

  let taxable = 0;
  let lineInclGst = 0;

  if (mode === "kumar") {
    lineInclGst =
      rate && qty ? round2(rate * qty) : round2(gross * (1 - discFrac));
    taxable = round2(lineInclGst / (1 + gstRate));
  } else if (mode === "gayatri") {
    const disc = discFrac > 0 ? discFrac : 0.15;
    taxable = round2((gross * (1 - disc)) / (1 + gstRate));
    lineInclGst = round2(taxable * (1 + gstRate));
  } else if (mode === "kokila") {
    const amount = rate && qty ? round2(rate * qty) : gross;
    taxable = round2(amount * (1 - discFrac));
    lineInclGst = round2(taxable * (1 + gstRate));
  } else {
    taxable = round2(rate * qty * (1 - discFrac));
    lineInclGst = round2(taxable * (1 + gstRate));
  }

  const cgstAmount = round2(taxable * (cgstPercent / 100));
  const sgstAmount = round2(taxable * (sgstPercent / 100));
  const lineTotal = round2(taxable + cgstAmount + sgstAmount);

  return {
    gross,
    taxable,
    cgstPercent,
    sgstPercent,
    cgstAmount,
    sgstAmount,
    lineTotal,
    lineInclGst,
    gstPercent,
  };
}

export function sumLineField(lines, field) {
  return round2(
    lines.reduce((s, l) => s + toNum(l[field]), 0),
  );
}

export function computeInvoiceTotals(lines, calcMode = "simple") {
  const computedLines = lines.map((line) => {
    const expected = computePurchaseLine({ ...line, calcMode });
    return { line, expected };
  });

  const totals = {
    qty: round2(
      lines.reduce((s, l) => s + toNum(l.qty ?? l.quantity), 0),
    ),
    gross: sumLineField(computedLines.map((c) => c.expected), "gross"),
    taxable: sumLineField(computedLines.map((c) => c.expected), "taxable"),
    cgst: sumLineField(computedLines.map((c) => c.expected), "cgstAmount"),
    sgst: sumLineField(computedLines.map((c) => c.expected), "sgstAmount"),
    grandTotal: sumLineField(computedLines.map((c) => c.expected), "lineTotal"),
  };

  return { computedLines, totals };
}

function printedLineValues(line) {
  return {
    taxable: toNum(line.taxable),
    cgst: toNum(line.cgstAmount ?? line.cgst_amount),
    sgst: toNum(line.sgstAmount ?? line.sgst_amount),
    lineTotal: toNum(line.lineTotal ?? line.line_total),
  };
}

export function compareLineCalculation(line, calcMode) {
  const expected = computePurchaseLine({ ...line, calcMode });
  const printed = printedLineValues(line);
  const hasPrinted =
    printed.taxable > 0 || printed.lineTotal > 0 || printed.cgst > 0;

  const variances = {
    taxable: round2(printed.taxable - expected.taxable),
    cgst: round2(printed.cgst - expected.cgstAmount),
    sgst: round2(printed.sgst - expected.sgstAmount),
    lineTotal: round2(printed.lineTotal - expected.lineTotal),
  };

  const ok =
    !hasPrinted ||
    (isClose(printed.taxable, expected.taxable) &&
      isClose(printed.cgst, expected.cgstAmount) &&
      isClose(printed.sgst, expected.sgstAmount) &&
      isClose(printed.lineTotal, expected.lineTotal));

  return { expected, printed, variances, ok, hasPrinted };
}

export function inferCalcModeFromLines(lines) {
  const raw = lines[0]?.raw_data ?? lines[0]?.rawData;
  if (!raw || typeof raw !== "object") return "simple";
  const keys = Object.keys(raw).join(" ").toLowerCase();
  if (keys.includes("net rate")) return "kumar";
  if (keys.includes("amount taxable") || keys.includes("cost per unit")) return "gayatri";
  if (keys.includes("taxable value") && keys.includes("m.r.p")) return "kokila";
  return "simple";
}

export function compareInvoiceCalculation(parsedOrInvoice) {
  const lines = parsedOrInvoice.lines ?? [];
  const calcMode =
    parsedOrInvoice.calcMode ??
    calcModeFromFormat(parsedOrInvoice.format) ??
    "simple";

  const { computedLines, totals } = computeInvoiceTotals(lines, calcMode);

  const printed = {
    qty: toNum(parsedOrInvoice.printedQty ?? parsedOrInvoice.printed_qty),
    taxable: toNum(
      parsedOrInvoice.printedTaxable ?? parsedOrInvoice.printed_taxable,
    ),
    cgst: toNum(parsedOrInvoice.printedCgst ?? parsedOrInvoice.printed_cgst),
    sgst: toNum(parsedOrInvoice.printedSgst ?? parsedOrInvoice.printed_sgst),
    grandTotal: toNum(
      parsedOrInvoice.printedGrandTotal ?? parsedOrInvoice.printed_grand_total,
    ),
    subtotal: toNum(
      parsedOrInvoice.printedSubTotal ?? parsedOrInvoice.printed_subtotal,
    ),
  };

  const summedFromLines = {
    taxable: round2(lines.reduce((s, l) => s + toNum(l.taxable), 0)),
    cgst: round2(
      lines.reduce(
        (s, l) => s + toNum(l.cgstAmount ?? l.cgst_amount),
        0,
      ),
    ),
    sgst: round2(
      lines.reduce(
        (s, l) => s + toNum(l.sgstAmount ?? l.sgst_amount),
        0,
      ),
    ),
    grandTotal: round2(
      lines.reduce(
        (s, l) => s + toNum(l.lineTotal ?? l.line_total),
        0,
      ),
    ),
  };

  const computed = totals;
  const tol = amountTolerance(
    Math.max(printed.grandTotal, computed.grandTotal, summedFromLines.grandTotal),
  );

  const variance = {
    taxable: round2(printed.taxable - computed.taxable),
    cgst: round2(printed.cgst - computed.cgst),
    sgst: round2(printed.sgst - computed.sgst),
    grandTotal: round2(printed.grandTotal - computed.grandTotal),
    linesTaxable: round2(summedFromLines.taxable - computed.taxable),
    linesGrand: round2(summedFromLines.grandTotal - computed.grandTotal),
  };

  const lineChecks = computedLines.map(({ line, expected }) => {
    const check = compareLineCalculation(
      {
        ...line,
        qty: line.qty ?? line.quantity,
        rate: line.rate ?? line.unit_cost,
        discPercent: line.discPercent ?? line.disc_percent,
        disc2Percent: line.disc2Percent ?? line.disc2_percent,
        cgstPercent: line.cgstPercent ?? line.cgst_percent,
        sgstPercent: line.sgstPercent ?? line.sgst_percent,
        gstPercent: line.gstPercent ?? line.gst_percent,
        lineTotal: line.lineTotal ?? line.line_total,
        cgstAmount: line.cgstAmount ?? line.cgst_amount,
        sgstAmount: line.sgstAmount ?? line.sgst_amount,
      },
      calcMode,
    );
    return {
      lineNo: line.lineNo ?? line.line_no,
      code: line.code ?? line.part_number,
      ...check,
      expected,
    };
  });

  const mismatchLines = lineChecks.filter((l) => l.hasPrinted && !l.ok);

  const ok =
    (!printed.taxable || isClose(printed.taxable, computed.taxable, tol)) &&
    (!printed.cgst || isClose(printed.cgst, computed.cgst, tol)) &&
    (!printed.sgst || isClose(printed.sgst, computed.sgst, tol)) &&
    (!printed.grandTotal ||
      isClose(printed.grandTotal, computed.grandTotal, tol));

  return {
    calcMode,
    printed,
    computed,
    summedFromLines,
    variance,
    tolerance: tol,
    ok,
    lineChecks,
    mismatchLines,
    hasPrintedTotals:
      printed.taxable > 0 ||
      printed.grandTotal > 0 ||
      printed.cgst > 0 ||
      printed.sgst > 0,
  };
}

export function compareStoredInvoice(invoice, lines) {
  const calcMode = inferCalcModeFromLines(lines);
  return compareInvoiceCalculation({
    format: calcMode,
    calcMode,
    printedTaxable: invoice.printed_taxable,
    printedCgst: invoice.printed_cgst,
    printedSgst: invoice.printed_sgst,
    printedGrandTotal: invoice.printed_grand_total,
    printedSubTotal: invoice.printed_subtotal,
    lines: lines.map((l) => ({
      lineNo: l.line_no,
      code: l.part_number,
      qty: l.quantity,
      mrp: l.mrp,
      unit_cost: l.unit_cost,
      rate: l.unit_cost,
      discPercent: l.disc_percent,
      taxable: l.taxable,
      cgstAmount: l.cgst_amount,
      sgstAmount: l.sgst_amount,
      lineTotal: l.line_total,
      cgstPercent: l.cgst_percent,
      sgstPercent: l.sgst_percent,
      rawData: l.raw_data,
    })),
  });
}
