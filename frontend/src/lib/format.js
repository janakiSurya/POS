import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toString();
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNum(value) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function lineTotal(unitPrice, qty, discPercent = 0) {
  const factor = 1 - toNum(discPercent) / 100;
  return round2(toNum(unitPrice) * toNum(qty) * Math.max(0, factor));
}

export const STAFF_MAX_DISCOUNT = 20;

export function validateDiscount(role, discPercent) {
  const d = toNum(discPercent);
  if (d < 0) return "Discount cannot be negative.";
  if (role === "staff" && d > STAFF_MAX_DISCOUNT) {
    return `Staff max discount is ${STAFF_MAX_DISCOUNT}%.`;
  }
  if (d > 100) return "Discount cannot exceed 100%.";
  return null;
}

/** Sum of qty × unit price before any discounts. */
export function cartGrossTotal(lines) {
  return round2(
    lines.reduce((s, l) => s + toNum(l.unit_price) * toNum(l.quantity), 0),
  );
}

/** Sum of line totals (per-line discounts applied). */
export function cartLinesTotal(lines) {
  return round2(lines.reduce((s, l) => s + toNum(l.line_total), 0));
}

export function applyBillDiscount(amount, billDiscPercent) {
  const factor = 1 - toNum(billDiscPercent) / 100;
  return round2(toNum(amount) * Math.max(0, factor));
}

export function computeCartTotals(lines, discountMode, billDiscountPercent) {
  const gross = cartGrossTotal(lines);
  if (discountMode === "bill") {
    const disc = toNum(billDiscountPercent);
    const total = applyBillDiscount(gross, disc);
    return { gross, subtotal: gross, billDiscount: disc, total };
  }
  const total = cartLinesTotal(lines);
  return { gross, subtotal: total, billDiscount: 0, total };
}
