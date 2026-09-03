import { useCallback, useEffect, useRef, useState } from "react";
import { localDb } from "../db/localDb";
import { supabase } from "../lib/supabaseClient";
import { isOnline } from "../lib/network";
import { catalogDelete, catalogPut } from "../db/catalogSqlite";
import { removeSearchProduct, upsertSearchProduct } from "../lib/searchClient";
import {
  FreshKeys,
  invalidateFresh,
  invalidateOwnerAggregates,
  markFresh,
} from "../lib/freshSync";
import {
  syncCustomersIfNeeded,
  syncProductsIfNeeded,
  syncSessionsIfNeeded,
  syncShopIfNeeded,
} from "../lib/hybridSync";

export { searchProducts } from "../lib/searchClient";

export function useSync(enabled) {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const channelRef = useRef(null);
  const wasOfflineRef = useRef(false);

  const pullProducts = useCallback(async (force = false) => {
    setSyncing(true);
    try {
      await syncProductsIfNeeded(force);
      setLastSync(new Date().toISOString());
    } catch (err) {
      console.warn("Product sync failed, using local catalog.", err);
    } finally {
      setSyncing(false);
    }
  }, []);

  const pullCustomers = useCallback(async (force = false) => {
    await syncCustomersIfNeeded(force);
  }, []);

  const fullSync = useCallback(
    async (force = false) => {
      if (!enabled) return;
      setSyncing(true);
      try {
        await syncShopIfNeeded(force);
        await syncProductsIfNeeded(force);
        await syncCustomersIfNeeded(force);
        await syncSessionsIfNeeded(force);
        setLastSync(new Date().toISOString());
      } catch (err) {
        console.warn("Background sync failed.", err);
      } finally {
        setSyncing(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => {
      wasOfflineRef.current = true;
      setOnline(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Initial soft sync once when auth enables sync
  useEffect(() => {
    if (!enabled) return;
    fullSync(false);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps -- mount / enable only

  // Force sync only when reconnecting after offline
  useEffect(() => {
    if (!enabled || !online || !wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    fullSync(true);
  }, [enabled, online, fullSync]);

  useEffect(() => {
    if (!enabled || !supabase || !isOnline()) return;

    channelRef.current = supabase
      .channel("owner-live-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            await catalogDelete(payload.old.id);
            removeSearchProduct(payload.old.id);
          } else {
            await catalogPut(payload.new);
            upsertSearchProduct(payload.new);
          }
          await markFresh(FreshKeys.PRODUCTS);
          await invalidateFresh(FreshKeys.DASHBOARD);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoices" },
        async (payload) => {
          if (payload.new) await localDb.invoices.put({ ...payload.new, synced: true });
          else if (payload.old?.id) await localDb.invoices.delete(payload.old.id);
          await invalidateOwnerAggregates();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cash_expenses" },
        async (payload) => {
          if (payload.new) await localDb.cash_expenses.put(payload.new);
          else if (payload.old?.id) await localDb.cash_expenses.delete(payload.old.id);
          await invalidateFresh(FreshKeys.EXPENSES, FreshKeys.DASHBOARD);
        },
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (navigator.storage?.persist) {
      navigator.storage.persist();
    }
  }, []);

  return { syncing, lastSync, online, fullSync, pullProducts, pullCustomers };
}
