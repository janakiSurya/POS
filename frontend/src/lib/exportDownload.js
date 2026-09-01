import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toNum } from "./format";

function safeFilename(parts) {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatDateExport(dateStr) {
  if (!dateStr) return "";
  const d = dateStr.includes("T")
    ? new Date(dateStr)
    : new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function inrPlain(value) {
  const n = toNum(value);
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function purchaseLineRows(lines) {
  return lines.map((l) => [
    l.line_no,
    l.part_number,
    l.description || "",
    l.hsn || "",
    l.brand || "",
    l.uom || "PCS",
    toNum(l.quantity),
    l.mrp != null ? toNum(l.mrp) : "",
    toNum(l.unit_cost),
    l.disc_percent > 0 ? toNum(l.disc_percent) : "",
    l.disc2_percent > 0 ? toNum(l.disc2_percent) : "",
    l.taxable != null ? toNum(l.taxable) : "",
    l.cgst_amount != null ? toNum(l.cgst_amount) : "",
    l.sgst_amount != null ? toNum(l.sgst_amount) : "",
    toNum(l.line_total),
  ]);
}

const PURCHASE_HEADERS = [
  "Line",
  "Part No",
  "Description",
  "HSN",
  "Brand",
  "UOM",
  "Qty",
  "MRP",
  "Rate",
  "Disc %",
  "Disc2 %",
  "Taxable",
  "CGST",
  "SGST",
  "Line Total",
];

export function downloadPurchaseInvoiceExcel({ invoice, supplier, lines, shop }) {
  const meta = [
    ["PURCHASE INVOICE"],
    [],
    ["Buyer (Shop)", shop?.name || "Sri Sri Satya Sai Automobile Agency"],
    ["Buyer GSTIN", shop?.gstin || ""],
    ["Buyer Address", shop?.address || ""],
    [],
    ["Supplier", supplier?.name || ""],
    ["Supplier GSTIN", supplier?.gstin || ""],
    ["Supplier Address", supplier?.address || ""],
    ["Supplier Phone", supplier?.phone || ""],
    [],
    ["Invoice No", invoice.invoice_number],
    ["Invoice Date", formatDateExport(invoice.invoice_date)],
    ["Type", invoice.invoice_type || ""],
    ["Status", invoice.status || ""],
    ["Source", invoice.source || ""],
    [],
    PURCHASE_HEADERS,
    ...purchaseLineRows(lines),
    [],
    ["Printed Subtotal", invoice.printed_subtotal ?? ""],
    ["Printed Discount", invoice.printed_discount ?? ""],
    ["Printed Taxable", invoice.printed_taxable ?? ""],
    ["Printed CGST", invoice.printed_cgst ?? ""],
    ["Printed SGST", invoice.printed_sgst ?? ""],
    ["Printed Grand Total", invoice.printed_grand_total ?? ""],
    ["Computed Total", invoice.total_amount ?? ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(meta);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Invoice");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${safeFilename(["Purchase", invoice.invoice_number, supplier?.name])}.xlsx`,
  );
}

export function downloadPurchaseInvoicePdf({ invoice, supplier, lines, shop }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const shopName =
    shop?.name || "Sri Sri Satya Sai Automobile Agency";

  doc.setFontSize(16);
  doc.text("PURCHASE INVOICE", 14, 14);
  doc.setFontSize(10);
  doc.text(`Invoice: ${invoice.invoice_number}`, 14, 22);
  doc.text(`Date: ${formatDateExport(invoice.invoice_date)}`, 14, 28);
  if (invoice.invoice_type) {
    doc.text(`Type: ${invoice.invoice_type}`, 14, 34);
  }

  doc.text("Buyer", 14, 42);
  doc.setFontSize(9);
  doc.text(shopName, 14, 48);
  if (shop?.gstin) doc.text(`GSTIN: ${shop.gstin}`, 14, 54);

  doc.setFontSize(10);
  doc.text("Supplier", 120, 42);
  doc.setFontSize(9);
  doc.text(supplier?.name || "—", 120, 48);
  if (supplier?.gstin) doc.text(`GSTIN: ${supplier.gstin}`, 120, 54);
  if (supplier?.phone) doc.text(`Phone: ${supplier.phone}`, 120, 60);

  autoTable(doc, {
    startY: 66,
    head: [
      [
        "#",
        "Code",
        "Description",
        "HSN",
        "Brand",
        "UOM",
        "Qty",
        "MRP",
        "Rate",
        "Disc",
        "Taxable",
        "Total",
      ],
    ],
    body: lines.map((l) => [
      l.line_no,
      l.part_number,
      (l.description || "").slice(0, 40),
      l.hsn || "",
      l.brand || "",
      l.uom || "PCS",
      String(toNum(l.quantity)),
      l.mrp ? inrPlain(l.mrp) : "",
      inrPlain(l.unit_cost),
      l.disc_percent > 0 ? `${l.disc_percent}%` : "",
      l.taxable != null ? inrPlain(l.taxable) : "",
      inrPlain(l.line_total),
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [40, 40, 40] },
    margin: { left: 14, right: 14 },
  });

  const finalY = doc.lastAutoTable?.finalY ?? 66;
  let y = finalY + 8;
  doc.setFontSize(10);
  if (invoice.printed_grand_total != null) {
    doc.text(
      `Printed grand total: Rs. ${inrPlain(invoice.printed_grand_total)}`,
      14,
      y,
    );
    y += 6;
  }
  doc.setFont(undefined, "bold");
  doc.text(`Computed total: Rs. ${inrPlain(invoice.total_amount)}`, 14, y);

  doc.save(
    `${safeFilename(["Purchase", invoice.invoice_number, supplier?.name])}.pdf`,
  );
}

export function downloadParsedPurchaseExcel(parsed, shop) {
  const invoice = {
    invoice_number: parsed.invoiceNumber,
    invoice_date: parsed.invoiceDate,
    invoice_type: parsed.invoiceType,
    status: "PREVIEW",
    source: "EXCEL",
    printed_subtotal: parsed.printedSubTotal,
    printed_discount: parsed.printedDiscount,
    printed_taxable: parsed.printedTaxable,
    printed_cgst: parsed.printedCgst,
    printed_sgst: parsed.printedSgst,
    printed_grand_total: parsed.printedGrandTotal,
    total_amount: parsed.lines.reduce((s, l) => s + toNum(l.lineTotal), 0),
  };
  const lines = parsed.lines.map((l) => ({
    line_no: l.lineNo,
    part_number: l.code,
    description: l.description,
    hsn: l.hsn,
    brand: l.brand,
    uom: l.uom,
    quantity: l.qty,
    mrp: l.mrp,
    unit_cost: l.rate,
    disc_percent: l.discPercent,
    disc2_percent: l.disc2Percent,
    taxable: l.taxable,
    cgst_amount: l.cgstAmount,
    sgst_amount: l.sgstAmount,
    line_total: l.lineTotal,
  }));
  downloadPurchaseInvoiceExcel({
    invoice,
    supplier: parsed.supplier,
    lines,
    shop,
  });
}

export function downloadParsedPurchasePdf(parsed, shop) {
  const invoice = {
    invoice_number: parsed.invoiceNumber,
    invoice_date: parsed.invoiceDate,
    invoice_type: parsed.invoiceType,
    printed_grand_total: parsed.printedGrandTotal,
    total_amount: parsed.lines.reduce((s, l) => s + toNum(l.lineTotal), 0),
  };
  const lines = parsed.lines.map((l) => ({
    line_no: l.lineNo,
    part_number: l.code,
    description: l.description,
    hsn: l.hsn,
    brand: l.brand,
    uom: l.uom,
    quantity: l.qty,
    mrp: l.mrp,
    unit_cost: l.rate,
    disc_percent: l.discPercent,
    taxable: l.taxable,
    line_total: l.lineTotal,
  }));
  downloadPurchaseInvoicePdf({
    invoice,
    supplier: parsed.supplier,
    lines,
    shop,
  });
}

export function downloadSalesInvoiceExcel({ invoice, lines, customer, shop }) {
  const meta = [
    ["SALES INVOICE / BILL"],
    [],
    ["Shop", shop?.name || "Sri Sri Satya Sai Automobile Agency"],
    ["Shop Phone", shop?.phone || ""],
    ["Shop GSTIN", shop?.gstin || ""],
    [],
    ["Bill No", invoice.invoice_number],
    ["Date", formatDateExport(invoice.created_at?.slice(0, 10))],
    ["Time", invoice.created_at || ""],
    ["Customer", customer?.name || "Walk-in"],
    ["Customer Phone", customer?.phone || ""],
    ["Payment", invoice.payment_method || ""],
    [],
    ["Part No", "Item", "Qty", "Unit Price", "Disc %", "Line Total"],
    ...lines.map((l) => [
      l.part_number,
      l.name,
      toNum(l.quantity),
      toNum(l.unit_price),
      l.discount_percent > 0 ? toNum(l.discount_percent) : "",
      toNum(l.line_total),
    ]),
    [],
    ["Subtotal", invoice.subtotal_amount ?? ""],
    ["Bill Discount %", invoice.bill_discount_percent ?? ""],
    ["Total", invoice.total_amount ?? ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(meta);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bill");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${safeFilename(["Bill", invoice.invoice_number])}.xlsx`,
  );
}

export function downloadSalesInvoicePdf({ invoice, lines, customer, shop }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const shopName = shop?.name || "Sri Sri Satya Sai Automobile Agency";

  doc.setFontSize(16);
  doc.text("TAX INVOICE / BILL", 14, 16);
  doc.setFontSize(10);
  doc.text(shopName, 14, 24);
  if (shop?.phone) doc.text(shop.phone, 14, 30);
  if (shop?.gstin) doc.text(`GSTIN: ${shop.gstin}`, 14, 36);

  doc.text(`Bill No: ${invoice.invoice_number}`, 120, 24);
  doc.text(
    `Date: ${new Date(invoice.created_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    })}`,
    120,
    30,
  );
  doc.text(`Payment: ${invoice.payment_method || ""}`, 120, 36);

  if (customer) {
    doc.text(`Customer: ${customer.name}`, 14, 44);
    doc.text(`Phone: ${customer.phone}`, 14, 50);
  } else {
    doc.text("Customer: Walk-in", 14, 44);
  }

  autoTable(doc, {
    startY: 58,
    head: [["Part No", "Item", "Qty", "Price", "Disc", "Total"]],
    body: lines.map((l) => [
      l.part_number,
      (l.name || "").slice(0, 35),
      String(toNum(l.quantity)),
      inrPlain(l.unit_price),
      l.discount_percent > 0 ? `${l.discount_percent}%` : "",
      inrPlain(l.line_total),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 40, 40] },
    margin: { left: 14, right: 14 },
  });

  const finalY = doc.lastAutoTable?.finalY ?? 58;
  let y = finalY + 10;
  if (invoice.bill_discount_percent > 0) {
    doc.text(
      `Subtotal: Rs. ${inrPlain(invoice.subtotal_amount)}`,
      14,
      y,
    );
    y += 6;
    doc.text(`Bill discount: ${invoice.bill_discount_percent}%`, 14, y);
    y += 6;
  }
  doc.setFont(undefined, "bold");
  doc.text(`Total: Rs. ${inrPlain(invoice.total_amount)}`, 14, y);

  doc.save(`${safeFilename(["Bill", invoice.invoice_number])}.pdf`);
}

export function downloadInventoryExcel(products) {
  const rows = [
    [
      "Part No",
      "Name",
      "Brand",
      "Category",
      "UOM",
      "Stock Qty",
      "Purchase Price",
      "Selling Price",
      "Min Alert",
      "Rack",
      "Vehicles",
    ],
    ...products.map((p) => [
      p.part_number,
      p.name,
      p.brand || "",
      p.category || "",
      p.uom || "PCS",
      toNum(p.stock_quantity),
      toNum(p.purchase_price),
      toNum(p.selling_price),
      toNum(p.min_stock_alert),
      p.rack_location || "",
      (p.vehicle_compatibility || []).join(", "),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `Inventory_${date}.xlsx`,
  );
}

export function downloadInventoryPdf(products) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text("Inventory Stock List", 14, 14);
  doc.setFontSize(9);
  doc.text(
    `Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · ${products.length} parts`,
    14,
    20,
  );

  autoTable(doc, {
    startY: 26,
    head: [
      ["Part No", "Name", "Brand", "UOM", "Stock", "Cost", "Sell", "Rack"],
    ],
    body: products.map((p) => [
      p.part_number,
      (p.name || "").slice(0, 30),
      p.brand || "",
      p.uom || "PCS",
      String(toNum(p.stock_quantity)),
      inrPlain(p.purchase_price),
      inrPlain(p.selling_price),
      p.rack_location || "",
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [40, 40, 40] },
    margin: { left: 14, right: 14 },
  });

  const date = new Date().toISOString().slice(0, 10);
  doc.save(`Inventory_${date}.pdf`);
}

function formatTimeIST(createdAt) {
  if (!createdAt) return "";
  return new Date(createdAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** End-of-day shift close PDF — opening/closing balances, sales, variances. */
export function downloadDayCloseReportPdf(report) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const shopName = report.shop_name || "Sri Sri Satya Sai Automobile Agency";

  doc.setFontSize(16);
  doc.text("End of Day Report", 14, 16);
  doc.setFontSize(10);
  doc.text(shopName, 14, 24);
  if (report.shop_address) doc.text(report.shop_address, 14, 30);
  doc.text(
    `Business date: ${formatDateExport(report.business_date)} · Generated ${formatTimeIST(report.generated_at)}`,
    14,
    36,
  );

  const summaryRows = [
    ["Opening cash", `Rs. ${inrPlain(report.opening_cash)}`],
    ["Opening UPI", `Rs. ${inrPlain(report.opening_upi)}`],
    ["Cash sales", `Rs. ${inrPlain(report.cash_sales)}`],
    ["UPI sales", `Rs. ${inrPlain(report.upi_sales)}`],
    ["Credit sales", `Rs. ${inrPlain(report.credit_sales)}`],
    ["Total sales", `Rs. ${inrPlain(report.total_sales)}`],
    ["Bill count", String(report.bill_count ?? 0)],
    ["Cash expenses", `Rs. ${inrPlain(report.cash_expenses)}`],
    ["Expected cash in drawer", `Rs. ${inrPlain(report.expected_cash)}`],
    ["Expected UPI balance", `Rs. ${inrPlain(report.expected_upi)}`],
    ["Counted closing cash", `Rs. ${inrPlain(report.closing_cash)}`],
    ["Counted closing UPI", `Rs. ${inrPlain(report.closing_upi)}`],
    ["Cash variance", `Rs. ${inrPlain(report.cash_variance)}`],
    ["UPI variance", `Rs. ${inrPlain(report.upi_variance)}`],
  ];

  autoTable(doc, {
    startY: 42,
    head: [["Summary", "Amount"]],
    body: summaryRows,
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [40, 40, 40] },
    columnStyles: { 0: { cellWidth: 70 }, 1: { halign: "right" } },
    margin: { left: 14, right: 14 },
  });

  let y = doc.lastAutoTable?.finalY ?? 42;

  if (report.bills?.length) {
    y += 8;
    doc.setFontSize(11);
    doc.text("Sales bills today", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Bill no.", "Time", "Payment", "Amount (Rs.)"]],
      body: report.bills.map((b) => [
        b.invoice_number,
        formatTimeIST(b.created_at),
        b.payment_method,
        inrPlain(b.total_amount),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable?.finalY ?? y;
  }

  if (report.expense_entries?.length) {
    y += 8;
    doc.setFontSize(11);
    doc.text("Cash expenses", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Time", "Note", "Amount (Rs.)"]],
      body: report.expense_entries.map((e) => [
        formatTimeIST(e.created_at),
        (e.note || "").slice(0, 50),
        inrPlain(e.amount),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: 14, right: 14 },
    });
  }

  doc.save(
    `${safeFilename(["Day_Close", report.business_date, shopName])}.pdf`,
  );
}
