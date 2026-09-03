import { supabase } from "./supabaseClient";
import { fetchAllFromSupabase } from "./supabaseFetch";
import { isOnline } from "./network";
import { getSyncMeta, setSyncMeta } from "../db/localDb";
import {
  catalogBulkPut,
  catalogCount,
  catalogForIndex,
  initCatalog,
} from "../db/catalogSqlite";
import { rebuildSearchIndex } from "./searchClient";

/** Dexie/SQLite first, then only products changed since last sync. */
export async function hydrateProducts() {
  await initCatalog();

  if (supabase && isOnline()) {
    const last = await getSyncMeta("products_last_sync");
    const data = last
      ? await fetchAllFromSupabase("products", {
          filter: (q) => q.gt("updated_at", last),
        })
      : await fetchAllFromSupabase("products");
    if (data.length) await catalogBulkPut(data);
    await setSyncMeta("products_last_sync", new Date().toISOString());
  }

  const chunks = await catalogForIndex();
  await rebuildSearchIndex(chunks);
  return catalogCount();
}
