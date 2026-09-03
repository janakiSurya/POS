import { catalogGetMany } from "../db/catalogSqlite";

let worker = null;
let requestId = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./searchWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg?.type === "results" && pending.has(msg.requestId)) {
      pending.get(msg.requestId)(msg.ids);
      pending.delete(msg.requestId);
    }
  };
  worker.onerror = (err) => console.warn("Search worker error", err);
  return worker;
}

function productToDoc(p) {
  return {
    id: p.id,
    name: p.name,
    part_number: p.part_number,
    vehicles: (p.vehicle_compatibility || []).join(" "),
  };
}

export async function rebuildSearchIndex(chunks) {
  getWorker().postMessage({ type: "rebuild", chunks });
}

export function upsertSearchProduct(product) {
  getWorker().postMessage({ type: "upsert", product: productToDoc(product) });
}

export function removeSearchProduct(id) {
  getWorker().postMessage({ type: "remove", id });
}

export function searchProductIds(query, limit = 20) {
  const q = query?.trim();
  if (!q) return Promise.resolve([]);
  const id = ++requestId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ type: "search", query: q, limit, requestId: id });
  });
}

/** POS / inventory: ids from worker, then hydrate from SQLite. */
export async function searchProducts(query, limit = 20) {
  const ids = await searchProductIds(query, limit);
  return catalogGetMany(ids);
}
