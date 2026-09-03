import { getSyncMeta, setSyncMeta } from "../db/localDb";
import { isOnline } from "./network";

/** Sync freshness keys (stored in Dexie sync_meta). */
export const FreshKeys = {
  PRODUCTS: "fresh_products",
  CUSTOMERS: "fresh_customers",
  INVOICES: "fresh_invoices",
  EXPENSES: "fresh_expenses",
  PURCHASES: "fresh_purchases",
  SUPPLIERS: "fresh_suppliers",
  SESSIONS: "fresh_sessions",
  FIXED_COSTS: "fresh_fixed_costs",
  DASHBOARD: "fresh_dashboard",
  SHOP: "fresh_shop",
};

/** Default: skip network if synced within 5 minutes. */
export const MAX_AGE_MS = 5 * 60 * 1000;
/** KPIs / report RPC: 2 minutes. */
export const KPI_MAX_AGE_MS = 2 * 60 * 1000;

const memoryCache = new Map();
const listeners = new Set();

export function reportBundleKey(start, end) {
  return `fresh_report_bundle:${start}:${end}`;
}

export async function isFresh(key, maxAgeMs = MAX_AGE_MS) {
  const ts = await getSyncMeta(key);
  if (!ts) return false;
  const age = Date.now() - new Date(ts).getTime();
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}

export async function markFresh(key) {
  await setSyncMeta(key, new Date().toISOString());
}

export async function invalidateFresh(...keys) {
  for (const key of keys) {
    await setSyncMeta(key, "");
    memoryCache.delete(key);
  }
  for (const fn of listeners) {
    try {
      fn(keys);
    } catch {
      /* ignore */
    }
  }
}

/** Clear KPI + report RPC caches after sales / expenses / stock changes. */
export async function invalidateOwnerAggregates() {
  const reportKeys = [];
  for (const key of memoryCache.keys()) {
    if (String(key).startsWith("fresh_report_bundle:")) reportKeys.push(key);
  }
  await invalidateFresh(
    FreshKeys.DASHBOARD,
    FreshKeys.INVOICES,
    FreshKeys.EXPENSES,
    FreshKeys.PRODUCTS,
    ...reportKeys,
  );
}

export function onFreshInvalidated(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setMemoryCache(key, value) {
  memoryCache.set(key, { value, at: Date.now() });
}

export function getMemoryCache(key, maxAgeMs = KPI_MAX_AGE_MS) {
  const row = memoryCache.get(key);
  if (!row) return null;
  if (Date.now() - row.at > maxAgeMs) {
    memoryCache.delete(key);
    return null;
  }
  return row.value;
}

/**
 * Run syncFn only when force=true or the key is stale.
 * Returns { synced: boolean }.
 */
export async function ensureFresh(
  key,
  syncFn,
  { force = false, maxAgeMs = MAX_AGE_MS } = {},
) {
  if (!force && (await isFresh(key, maxAgeMs))) {
    return { synced: false };
  }
  await syncFn();
  // Only stamp fresh when online — offline no-ops must not suppress later sync.
  if (isOnline()) await markFresh(key);
  return { synced: true };
}
