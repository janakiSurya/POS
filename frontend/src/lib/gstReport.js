/** GST sales bill report — 1% of GST-eligible sales; excludes local / no-GST lines. */

import { localDb } from "../db/localDb";
import { catalogGetMany } from "../db/catalogSqlite";
import { toNum, round2 } from "./format";
import {
  addDaysYmd,
  filterInvoicesByDateRange,
  invoiceDateIST,
} from "./reportMetrics";
import { businessDateIST } from "./businessDay";

/** Flat GST rate on sales (₹1 lakh sales → ₹1,000 GST). */
export const GST_FLAT_RATE = 0.01;

/** Last 90 calendar days inclusive (IST). */
export function last90DaysRangeIST() {
  const end = businessDateIST();
  const start = addDaysYmd(end, -89);
  return { start, end };
}

/**
 * Build GST sales report for bills in [startDate, endDate] (IST YMD).
 * Local / exclude_from_gst product lines are omitted from sales;
 * bills that are entirely local are omitted from the list.
 * GST payable = 1% of GST-eligible sales.
 */
export async function buildGstSalesReport({ startDate, endDate }) {
  const start = startDate || last90DaysRangeIST().start;
  const end = endDate || last90DaysRangeIST().end;

  const [allInvoices, allItems, customers] = await Promise.all([
    localDb.invoices.toArray(),
    localDb.invoice_items.toArray(),
    localDb.customers.toArray(),
  ]);

  const inRange = filterInvoicesByDateRange(allInvoices, start, end).sort(
    (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
  );

  const itemsByInvoice = new Map();
  for (const it of allItems) {
    if (!itemsByInvoice.has(it.invoice_id)) itemsByInvoice.set(it.invoice_id, []);
    itemsByInvoice.get(it.invoice_id).push(it);
  }

  const productIds = new Set();
  for (const inv of inRange) {
    for (const it of itemsByInvoice.get(inv.id) || []) {
      if (it.product_id) productIds.add(it.product_id);
    }
  }
  const products = await catalogGetMany([...productIds]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  if (productIds.size) {
    const allLocal = await localDb.products.toArray();
    for (const p of allLocal) {
      if (!productIds.has(p.id)) continue;
      const cur = productMap.get(p.id);
      if (!cur) productMap.set(p.id, p);
      else if (p.exclude_from_gst) {
        productMap.set(p.id, { ...cur, exclude_from_gst: true });
      }
    }
  }

  const customerMap = new Map(customers.map((c) => [c.id, c]));

  const bills = [];
  let excludedLineTotal = 0;
  let excludedBillCount = 0;

  for (const inv of inRange) {
    const lines = itemsByInvoice.get(inv.id) || [];
    let salesAmount = 0;
    let localAmount = 0;
    let gstLineCount = 0;

    if (lines.length === 0) {
      salesAmount = toNum(inv.total_amount);
      gstLineCount = 1;
    } else {
      for (const line of lines) {
        const amt = toNum(line.line_total);
        const prod = productMap.get(line.product_id);
        if (prod?.exclude_from_gst) {
          localAmount = round2(localAmount + amt);
        } else {
          salesAmount = round2(salesAmount + amt);
          gstLineCount += 1;
        }
      }
    }

    excludedLineTotal = round2(excludedLineTotal + localAmount);

    if (salesAmount <= 0.009 && gstLineCount === 0) {
      excludedBillCount += 1;
      continue;
    }

    const gstPayable = round2(salesAmount * GST_FLAT_RATE);
    const cust = inv.customer_id ? customerMap.get(inv.customer_id) : null;

    bills.push({
      id: inv.id,
      invoice_number: inv.invoice_number,
      entry_date: invoiceDateIST(inv.created_at),
      created_at: inv.created_at,
      payment_method: inv.payment_method,
      customer_name: cust?.name || null,
      customer_phone: cust?.phone || null,
      bill_total: toNum(inv.total_amount),
      sales_amount: salesAmount,
      gst_payable: gstPayable,
      local_excluded: localAmount,
    });
  }

  const totals = bills.reduce(
    (acc, b) => {
      acc.sales_amount = round2(acc.sales_amount + b.sales_amount);
      acc.gst_payable = round2(acc.gst_payable + b.gst_payable);
      acc.bill_total = round2(acc.bill_total + b.bill_total);
      return acc;
    },
    { sales_amount: 0, gst_payable: 0, bill_total: 0 },
  );

  return {
    startDate: start,
    endDate: end,
    gstRatePercent: GST_FLAT_RATE * 100,
    bills,
    totals,
    billCount: bills.length,
    excludedBillCount,
    excludedLineTotal,
  };
}
