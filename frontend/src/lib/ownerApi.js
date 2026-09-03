import { supabase } from "./supabaseClient";
import { isOnline } from "./network";
import { toNum } from "./format";

export async function fetchDashboardKpisRpc() {
  if (!supabase || !isOnline()) return null;
  const { data, error } = await supabase.rpc("owner_dashboard_kpis");
  if (error) throw error;
  return {
    stockCost: toNum(data.stockCost),
    retailValue: toNum(data.retailValue),
    todayRevenue: toNum(data.todayRevenue),
    todayCash: toNum(data.todayCash),
    todayUpi: toNum(data.todayUpi),
    todayCredit: toNum(data.todayCredit),
    grossProfit: toNum(data.grossProfit),
    productCount: Number(data.productCount) || 0,
    lowStock: data.lowStock || [],
    deadStock: data.deadStock || [],
  };
}

export async function fetchReportBundleRpc(startYmd, endYmd) {
  if (!supabase || !isOnline()) return null;
  const { data, error } = await supabase.rpc("owner_report_bundle", {
    p_start: startYmd,
    p_end: endYmd,
  });
  if (error) throw error;
  return data;
}
