import { localDb } from "../db/localDb";
import { supabase } from "./supabaseClient";
import { isOnline } from "./network";
import { hydrateProducts } from "./productHydrate";
import { syncInvoicesFromServer, syncAllInvoicesFromServer } from "./sales";
import { syncPurchaseInvoicesFromServer } from "./purchases";
import { syncAllExpensesFromServer } from "./register";
import { syncFixedCostsFromServer } from "./expenses";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { fetchDashboardKpisRpc, fetchReportBundleRpc } from "./ownerApi";
import {
  FreshKeys,
  KPI_MAX_AGE_MS,
  MAX_AGE_MS,
  ensureFresh,
  getMemoryCache,
  isFresh,
  markFresh,
  reportBundleKey,
  setMemoryCache,
} from "./freshSync";

export async function syncProductsIfNeeded(force = false) {
  return ensureFresh(FreshKeys.PRODUCTS, () => hydrateProducts(), {
    force,
    maxAgeMs: MAX_AGE_MS,
  });
}

export async function syncCustomersIfNeeded(force = false) {
  return ensureFresh(
    FreshKeys.CUSTOMERS,
    async () => {
      if (!supabase || !isOnline()) return;
      const { data } = await supabase.from("customers").select("*");
      if (data?.length) await localDb.customers.bulkPut(data);
    },
    { force, maxAgeMs: MAX_AGE_MS },
  );
}

export async function syncInvoicesIfNeeded(force = false, { all = false } = {}) {
  return ensureFresh(
    FreshKeys.INVOICES,
    async () => {
      if (all) await syncAllInvoicesFromServer();
      else await syncInvoicesFromServer(500);
    },
    { force, maxAgeMs: MAX_AGE_MS },
  );
}

export async function syncExpensesIfNeeded(force = false) {
  return ensureFresh(FreshKeys.EXPENSES, () => syncAllExpensesFromServer(), {
    force,
    maxAgeMs: MAX_AGE_MS,
  });
}

export async function syncPurchasesIfNeeded(force = false) {
  return ensureFresh(
    FreshKeys.PURCHASES,
    () => syncPurchaseInvoicesFromServer(200),
    { force, maxAgeMs: MAX_AGE_MS },
  );
}

export async function syncSuppliersIfNeeded(force = false) {
  return ensureFresh(
    FreshKeys.SUPPLIERS,
    async () => {
      if (!supabase || !isOnline()) return;
      const data = await fetchAllFromSupabase("suppliers", {
        order: (q) => q.order("name"),
      });
      await localDb.suppliers.clear();
      if (data.length) await localDb.suppliers.bulkPut(data);
    },
    { force, maxAgeMs: MAX_AGE_MS },
  );
}

export async function syncSessionsIfNeeded(force = false) {
  return ensureFresh(
    FreshKeys.SESSIONS,
    async () => {
      if (!supabase || !isOnline()) return;
      const { data: sessions } = await supabase
        .from("register_sessions")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(30);
      if (sessions?.length) await localDb.register_sessions.bulkPut(sessions);
    },
    { force, maxAgeMs: MAX_AGE_MS },
  );
}

export async function syncFixedCostsIfNeeded(force = false) {
  return ensureFresh(FreshKeys.FIXED_COSTS, () => syncFixedCostsFromServer(), {
    force,
    maxAgeMs: MAX_AGE_MS,
  });
}

export async function syncShopIfNeeded(force = false) {
  return ensureFresh(
    FreshKeys.SHOP,
    async () => {
      if (!supabase || !isOnline()) return;
      const { data } = await supabase
        .from("shop_settings")
        .select("*")
        .eq("id", "default")
        .single();
      if (data) await localDb.shop_settings.put(data);
    },
    { force, maxAgeMs: MAX_AGE_MS },
  );
}

export async function syncDashboardSupportIfNeeded(force = false) {
  await Promise.all([
    syncProductsIfNeeded(force),
    syncInvoicesIfNeeded(force),
    syncPurchasesIfNeeded(force),
    syncSessionsIfNeeded(force),
    syncExpensesIfNeeded(force),
  ]);
}

export async function getDashboardKpisCached(force = false) {
  if (!force) {
    const mem = getMemoryCache(FreshKeys.DASHBOARD, KPI_MAX_AGE_MS);
    if (mem) return { data: mem, fromCache: true };
  }
  if (!force && (await isFresh(FreshKeys.DASHBOARD, KPI_MAX_AGE_MS))) {
    const mem = getMemoryCache(FreshKeys.DASHBOARD, KPI_MAX_AGE_MS);
    if (mem) return { data: mem, fromCache: true };
  }
  if (!supabase || !isOnline()) return { data: null, fromCache: false };

  const data = await fetchDashboardKpisRpc();
  if (data) {
    setMemoryCache(FreshKeys.DASHBOARD, data);
    await markFresh(FreshKeys.DASHBOARD);
  }
  return { data, fromCache: false };
}

export async function getReportBundleCached(start, end, force = false) {
  const key = reportBundleKey(start, end);
  if (!force) {
    const mem = getMemoryCache(key, KPI_MAX_AGE_MS);
    if (mem) return { data: mem, fromCache: true };
  }
  if (!supabase || !isOnline()) return { data: null, fromCache: false };

  const data = await fetchReportBundleRpc(start, end);
  if (data) {
    setMemoryCache(key, data);
    await markFresh(key);
  }
  return { data, fromCache: false };
}
