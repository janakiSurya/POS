import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { localDb } from "../../db/localDb";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllFromSupabase } from "../../lib/supabaseFetch";
import { formatInr, formatQty } from "../../lib/format";
import {
  downloadInventoryExcel,
  downloadInventoryPdf,
} from "../../lib/exportDownload";
import { Button } from "../ui/Button";
import { DownloadActions } from "../shared/DownloadActions";
import { Input, Label } from "../ui/Input";
import { Card } from "../ui/Card";
import { buildSearchIndex, searchProducts } from "../../hooks/useSync";
import { isOnline } from "../../lib/network";
import { PageHeader } from "../shared/PageHeader";

const UOM_OPTIONS = ["PCS", "SET", "KG", "LTR", "BOX", "PAIR"];

function emptyForm() {
  return {
    part_number: "",
    name: "",
    category: "",
    brand: "",
    uom: "PCS",
    vehicle_compatibility: "",
    purchase_price: "",
    selling_price: "",
    stock_quantity: "0",
    min_stock_alert: "5",
    rack_location: "",
  };
}

function productToForm(p) {
  return {
    part_number: p.part_number,
    name: p.name,
    category: p.category || "",
    brand: p.brand || "",
    uom: p.uom || "PCS",
    vehicle_compatibility: (p.vehicle_compatibility || []).join(", "),
    purchase_price: String(p.purchase_price ?? ""),
    selling_price: String(p.selling_price ?? ""),
    stock_quantity: String(p.stock_quantity ?? "0"),
    min_stock_alert: String(p.min_stock_alert ?? "5"),
    rack_location: p.rack_location || "",
  };
}

export function InventoryList() {
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadProducts() {
    setLoading(true);
    try {
      if (supabase && isOnline()) {
        try {
          const data = await fetchAllFromSupabase("products");
          if (data.length) {
            await localDb.products.bulkPut(data);
            buildSearchIndex(data);
            setProducts(data);
            return;
          }
        } catch (syncErr) {
          setError(syncErr.message || "Sync failed — showing local inventory.");
        }
      }
      const all = await localDb.products.toArray();
      buildSearchIndex(all);
      setProducts(all);
    } catch (err) {
      setError(err.message || "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) {
      return [...products].sort((a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
      );
    }
    const hits = searchProducts(q, 500);
    if (hits.length) return hits;
    const lower = q.toLowerCase();
    return products.filter(
      (p) =>
        p.part_number?.toLowerCase().includes(lower) ||
        p.name?.toLowerCase().includes(lower) ||
        p.brand?.toLowerCase().includes(lower) ||
        p.category?.toLowerCase().includes(lower) ||
        (p.vehicle_compatibility || []).some((v) =>
          v.toLowerCase().includes(lower),
        ),
    );
  }, [products, query]);

  async function save(e) {
    e.preventDefault();
    setError("");
    const row = {
      id: editing?.id ?? crypto.randomUUID(),
      part_number: form.part_number.trim().toUpperCase(),
      name: form.name.trim(),
      category: form.category.trim() || null,
      brand: form.brand.trim() || null,
      uom: form.uom.trim() || "PCS",
      vehicle_compatibility: form.vehicle_compatibility
        ? form.vehicle_compatibility
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      purchase_price: Number(form.purchase_price) || 0,
      selling_price: Number(form.selling_price) || 0,
      stock_quantity: Number(form.stock_quantity) || 0,
      min_stock_alert: Number(form.min_stock_alert) || 5,
      rack_location: form.rack_location.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (supabase && navigator.onLine) {
      const payload = { ...row };
      const { error: err } = editing
        ? await supabase.from("products").update(payload).eq("id", row.id)
        : await supabase.from("products").insert(payload);
      if (err) {
        setError(err.message);
        return;
      }
    }

    await localDb.products.put(row);
    await loadProducts();
    setForm(emptyForm());
    setEditing(null);
  }

  function startEdit(p) {
    setEditing(p);
    setForm(productToForm(p));
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Inventory"
        description={`${products.length} parts · search by code, name, brand, or vehicle`}
      >
        <DownloadActions
          excelLabel="Excel"
          pdfLabel="PDF"
          onExcel={() => downloadInventoryExcel(filtered)}
          onPdf={() => downloadInventoryPdf(filtered)}
        />
        <Button variant="secondary" className="w-full text-xs sm:w-auto" onClick={loadProducts}>
          Refresh
        </Button>
      </PageHeader>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver" />
        <Input
          className="py-2.5 pl-10 text-base sm:text-sm"
          placeholder="Search parts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <Card>
        <h2 className="mb-4 font-medium text-ink">
          {editing ? `Edit — ${editing.part_number}` : "Add new part"}
        </h2>
        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Part number / code</Label>
            <Input
              value={form.part_number}
              onChange={(e) => setForm({ ...form, part_number: e.target.value })}
              required
              disabled={Boolean(editing)}
              className={editing ? "opacity-70" : ""}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Name / description</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Category</Label>
            <Input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="e.g. Filter, Brake"
            />
          </div>
          <div>
            <Label>Brand</Label>
            <Input
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
            />
          </div>
          <div>
            <Label>UOM</Label>
            <select
              className="w-full rounded-lg border border-ash bg-paper px-3 py-2.5 text-sm text-ink focus:border-electric focus:outline-none"
              value={form.uom}
              onChange={(e) => setForm({ ...form, uom: e.target.value })}
            >
              {UOM_OPTIONS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Purchase price (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.purchase_price}
              onChange={(e) =>
                setForm({ ...form, purchase_price: e.target.value })
              }
            />
          </div>
          <div>
            <Label>Selling price (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.selling_price}
              onChange={(e) =>
                setForm({ ...form, selling_price: e.target.value })
              }
            />
          </div>
          <div>
            <Label>Stock quantity</Label>
            <Input
              type="number"
              min="0"
              value={form.stock_quantity}
              onChange={(e) =>
                setForm({ ...form, stock_quantity: e.target.value })
              }
            />
          </div>
          <div>
            <Label>Min stock alert</Label>
            <Input
              type="number"
              min="0"
              value={form.min_stock_alert}
              onChange={(e) =>
                setForm({ ...form, min_stock_alert: e.target.value })
              }
            />
          </div>
          <div>
            <Label>Rack location</Label>
            <Input
              value={form.rack_location}
              onChange={(e) =>
                setForm({ ...form, rack_location: e.target.value })
              }
              placeholder="e.g. A-01"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Label>Vehicle compatibility (comma separated)</Label>
            <Input
              value={form.vehicle_compatibility}
              onChange={(e) =>
                setForm({ ...form, vehicle_compatibility: e.target.value })
              }
              placeholder="Activa, Splendor, Shine"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="w-full sm:w-auto">
              {editing ? "Update part" : "Add part"}
            </Button>
            {editing ? (
              <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={cancelEdit}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {/* Mobile card list */}
      <div className="space-y-2 lg:hidden">
        {loading ? (
          <p className="py-8 text-center text-sm text-fog">Loading…</p>
        ) : filtered.length === 0 ? (
          <Card className="text-center text-sm text-silver">
            {query ? "No parts match your search." : "No parts yet. Add one or import Excel."}
          </Card>
        ) : (
          filtered.map((p) => (
            <div
              key={p.id}
              className={`rounded-lg border border-ash bg-canvas p-3 ${
                editing?.id === p.id ? "ring-2 ring-electric/20" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-fog">{p.part_number}</p>
                  <p className="mt-0.5 text-sm font-medium text-ink">{p.name}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-fog hover:bg-paper hover:text-ink"
                  onClick={() => startEdit(p)}
                >
                  Edit
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fog">
                <span>Stock {formatQty(p.stock_quantity)}</span>
                <span className="text-right">Sell {formatInr(p.selling_price)}</span>
                <span>Cost {formatInr(p.purchase_price)}</span>
                <span className="text-right">{p.brand || "—"}</span>
              </div>
            </div>
          ))
        )}
        {!loading && filtered.length > 0 ? (
          <p className="text-xs text-silver">
            Showing {filtered.length} of {products.length} parts
          </p>
        ) : null}
      </div>

      <div className="hidden rounded-xl border border-ash lg:block">
        <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-canvas text-xs text-fog shadow-[0_1px_0_0_#e5e5e5]">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Code</th>
              <th className="px-3 py-2.5 font-semibold">Name</th>
              <th className="px-3 py-2.5 font-semibold">Category</th>
              <th className="px-3 py-2.5 font-semibold">Brand</th>
              <th className="px-3 py-2.5 font-semibold">UOM</th>
              <th className="px-3 py-2.5 text-right font-semibold">Stock</th>
              <th className="px-3 py-2.5 text-right font-semibold">Min</th>
              <th className="px-3 py-2.5 font-semibold">Rack</th>
              <th className="px-3 py-2.5 font-semibold">Vehicles</th>
              <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
              <th className="px-3 py-2.5 text-right font-semibold">Sell</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-fog">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-silver">
                  {query ? "No parts match your search." : "No parts yet. Add one or import Excel."}
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-ash ${
                    editing?.id === p.id ? "bg-canvas" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{p.part_number}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={p.name}>
                    {p.name}
                  </td>
                  <td className="px-3 py-2 text-fog">{p.category || "—"}</td>
                  <td className="px-3 py-2 text-fog">{p.brand || "—"}</td>
                  <td className="px-3 py-2 text-fog">{p.uom || "PCS"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQty(p.stock_quantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fog">
                    {formatQty(p.min_stock_alert)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.rack_location || "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[140px] truncate text-xs text-fog">
                    {(p.vehicle_compatibility || []).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatInr(p.purchase_price)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatInr(p.selling_price)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-xs text-fog hover:text-ink"
                      onClick={() => startEdit(p)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && filtered.length > 0 ? (
          <p className="border-t border-ash px-3 py-2 text-xs text-silver">
            Showing {filtered.length} of {products.length} parts
          </p>
        ) : null}
        </div>
      </div>
    </div>
  );
}
