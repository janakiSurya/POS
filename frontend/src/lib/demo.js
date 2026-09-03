import { localDb } from "../db/localDb";
import { catalogBulkPut } from "../db/catalogSqlite";
import { rebuildSearchIndex } from "./searchClient";

export async function seedDemoData() {
  if (import.meta.env.VITE_SUPABASE_URL) return;

  const existing = await localDb.products.count();
  if (existing > 0) return;

  const shop = {
    id: "default",
    name: "Sri Sri Satya Sai Automobile Agency",
    phone: "",
    address: "",
    invoice_prefix: "SSA",
    next_invoice_number: 1,
    thank_you_line: "Thank you — visit again",
  };
  await localDb.shop_settings.put(shop);

  const products = [
    {
      id: "demo-1",
      part_number: "AF-100",
      name: "Air filter Activa",
      category: "Filter",
      vehicle_compatibility: ["Activa", "125"],
      purchase_price: 85,
      selling_price: 120,
      stock_quantity: 24,
      min_stock_alert: 5,
      rack_location: "A-01",
      brand: "Honda",
      uom: "PCS",
      updated_at: new Date().toISOString(),
    },
    {
      id: "demo-2",
      part_number: "BP-220",
      name: "Brake pad Shine",
      category: "Brake",
      vehicle_compatibility: ["Shine", "Unicorn"],
      purchase_price: 180,
      selling_price: 280,
      stock_quantity: 12,
      min_stock_alert: 5,
      rack_location: "B-03",
      brand: "Aftermarket",
      uom: "PCS",
      updated_at: new Date().toISOString(),
    },
    {
      id: "demo-3",
      part_number: "CH-889",
      name: "Chain kit Splendor",
      category: "Chain",
      vehicle_compatibility: ["Splendor", "Passion"],
      purchase_price: 320,
      selling_price: 450,
      stock_quantity: 6,
      min_stock_alert: 3,
      rack_location: "C-12",
      brand: "Aftermarket",
      uom: "SET",
      updated_at: new Date().toISOString(),
    },
  ];

  await catalogBulkPut(products);
  await rebuildSearchIndex([
    products.map((p) => ({
      id: p.id,
      name: p.name,
      part_number: p.part_number,
      vehicles: (p.vehicle_compatibility || []).join(" "),
    })),
  ]);

  await localDb.sync_meta.put({ key: "demo_invoice_num", value: 1 });
}

export const DEMO_PROFILE = {
  id: "demo-owner",
  full_name: "Demo Owner",
  role: "owner",
};

export const DEMO_STAFF = {
  id: "demo-staff",
  full_name: "Demo Staff",
  role: "staff",
};
