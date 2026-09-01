/**
 * Canonical supplier names and matching — avoids duplicate Kumar / Gayatri / Kokila rows.
 */

const GSTIN_CANONICAL = {
  "37AITPG4383P1ZB": "KUMAR AUTO STORES",
  "37AAWFG4156F1Z0": "GAYATRI AUTO DISTRIBUTORS",
  "37ARTPR0091C1ZK": "KOKILA ENTERPRISES",
};

/** Strip address / suffix noise from supplier names read from Excel summaries. */
export function normalizeSupplierName(name) {
  let s = String(name ?? "").trim();
  if (!s) return "";

  const upper = s.toUpperCase();
  const comma = s.indexOf(",");
  if (
    comma > 0 &&
    /D\.?\s*NO|ROAD|BHIMAVARAM|GARAG|DIST|PIN|AUTOMOB|AGENC|-\d{6}/i.test(upper)
  ) {
    s = s.slice(0, comma).trim();
  }

  s = s.replace(/\s*\(HONDA\)\s*/gi, "").trim();
  s = s.replace(/\s+/g, " ");
  s = s.replace(/AUTOSTORES/gi, "AUTO STORES");

  const key = s.toUpperCase();
  if (key.includes("KUMAR") && key.includes("AUTO")) return "KUMAR AUTO STORES";
  if (key.includes("GAYATRI") && key.includes("AUTO")) return "GAYATRI AUTO DISTRIBUTORS";
  if (key.includes("KOKILA")) return "KOKILA ENTERPRISES";

  return s;
}

export function normalizeSupplierRecord(info) {
  const gstin = info.gstin?.trim().toUpperCase() || null;
  const canonicalFromGstin = gstin ? GSTIN_CANONICAL[gstin] : null;
  const name = canonicalFromGstin || normalizeSupplierName(info.name);

  let address = info.address?.trim() || null;
  const rawName = String(info.name ?? "").trim();
  if (!address && rawName.includes(",")) {
    const comma = rawName.indexOf(",");
    const tail = rawName.slice(comma + 1).trim();
    if (tail && /road|bhimavaram|garag|d\.?\s*no/i.test(tail)) {
      address = tail;
    }
  }

  return {
    name,
    gstin,
    address,
    phone: info.phone?.trim() || null,
    email: info.email?.trim() || null,
  };
}

export function supplierNamesMatch(a, b) {
  return normalizeSupplierName(a) === normalizeSupplierName(b);
}
