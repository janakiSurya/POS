import { useCallback, useEffect, useRef, useState } from "react";
import FlexSearch from "flexsearch";
import { localDb, getSyncMeta, setSyncMeta } from "../db/localDb";
import { supabase } from "../lib/supabaseClient";
import { fetchAllFromSupabase } from "../lib/supabaseFetch";
import { isOnline } from "../lib/network";

let searchIndex = null;
let indexProducts = [];

export function buildSearchIndex(products) {
  indexProducts = products;
  const index = new FlexSearch.Document({
    document: {
      id: "id",
      index: ["name", "part_number", "vehicles"],
    },
    tokenize: "forward",
    context: true,
  });
  for (const p of products) {
    index.add({
      id: p.id,
      name: p.name,
      part_number: p.part_number,
      vehicles: (p.vehicle_compatibility || []).join(" "),
    });
  }
  searchIndex = index;
  return index;
}

export function searchProducts(query, limit = 20) {
  if (!searchIndex || !query.trim()) return [];
  const q = query.trim();
  const results = searchIndex.search(q, { limit, enrich: true });
  const ids = new Set();
  for (const bucket of results) {
    for (const hit of bucket.result) {
      ids.add(hit);
    }
  }
  const map = new Map(indexProducts.map((p) => [p.id, p]));
  return [...ids].map((id) => map.get(id)).filter(Boolean);
}

export function useSync(enabled) {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const channelRef = useRef(null);

  const pullProducts = useCallback(async () => {
    if (!supabase) return;
    if (!isOnline()) {
      const all = await localDb.products.toArray();
      buildSearchIndex(all);
      return;
    }
    setSyncing(true);
    try {
      const last = await getSyncMeta("products_last_sync");
      const data = last
        ? await fetchAllFromSupabase("products", {
            filter: (q) => q.gt("updated_at", last),
          })
        : await fetchAllFromSupabase("products");
      if (data.length) {
        await localDb.products.bulkPut(data);
      }
      const all = await localDb.products.toArray();
      buildSearchIndex(all);
      const now = new Date().toISOString();
      await setSyncMeta("products_last_sync", now);
      setLastSync(now);
    } catch (err) {
      console.warn("Product sync failed, using local inventory.", err);
      const all = await localDb.products.toArray();
      buildSearchIndex(all);
    } finally {
      setSyncing(false);
    }
  }, []);

  const pullCustomers = useCallback(async () => {
    if (!supabase || !isOnline()) return;
    const { data } = await supabase.from("customers").select("*");
    if (data?.length) await localDb.customers.bulkPut(data);
  }, []);

  const pullShopSettings = useCallback(async () => {
    if (!supabase || !isOnline()) return;
    const { data } = await supabase.from("shop_settings").select("*").eq("id", "default").single();
    if (data) await localDb.shop_settings.put(data);
  }, []);

  const fullSync = useCallback(async () => {
    if (!enabled) return;
    if (!isOnline()) {
      const all = await localDb.products.toArray();
      buildSearchIndex(all);
      return;
    }
    await pullShopSettings();
    await pullProducts();
    await pullCustomers();
    const sessions = await supabase?.from("register_sessions").select("*");
    if (sessions?.data) {
      await localDb.register_sessions.clear();
      await localDb.register_sessions.bulkPut(sessions.data);
    }
  }, [enabled, pullProducts, pullCustomers, pullShopSettings]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !supabase) return;
    fullSync();

    if (!isOnline()) return;

    channelRef.current = supabase
      .channel("products-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            await localDb.products.delete(payload.old.id);
          } else {
            await localDb.products.put(payload.new);
          }
          const all = await localDb.products.toArray();
          buildSearchIndex(all);
        },
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [enabled, fullSync]);

  useEffect(() => {
    if (!enabled || !online || !supabase) return;
    fullSync();
  }, [enabled, online, fullSync, supabase]);

  useEffect(() => {
    if (navigator.storage?.persist) {
      navigator.storage.persist();
    }
  }, []);

  return { syncing, lastSync, online, fullSync, pullProducts, pullCustomers };
}

export function useLocalProducts(isOwner) {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    localDb.products.toArray().then((rows) => {
      buildSearchIndex(rows);
      setProducts(rows);
    });
    const interval = setInterval(() => {
      localDb.products.toArray().then(setProducts);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const forRole = products.map((p) => {
    if (isOwner) return p;
    const { purchase_price, ...rest } = p;
    return rest;
  });

  return forRole;
}
