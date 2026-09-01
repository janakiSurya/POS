import { supabase } from "./supabaseClient";
import { isOnline } from "./network";

/** Supabase PostgREST returns max 1000 rows per request — paginate to load all. */
export async function fetchAllFromSupabase(table, options = {}) {
  if (!supabase || !isOnline()) return [];
  const { select = "*", filter = (q) => q, order, pageSize = 1000 } = options;
  const all = [];
  let from = 0;

  while (true) {
    let q = supabase.from(table).select(select);
    q = filter(q);
    if (order) q = order(q);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}
