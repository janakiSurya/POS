import { localDb } from "../db/localDb";

const IDB_NAME = "ssa_catalog_sqlite";
const IDB_STORE = "db";
const IDB_KEY = "products";
const WASM_URL = "/sql-wasm.wasm";

let SQL = null;
let db = null;
let initPromise = null;
let persistTimer = null;

async function loadInitSqlJs() {
  // Browser ESM entry has no default export; load the CJS wasm build via Vite.
  const mod = await import("sql.js/dist/sql-wasm.js");
  return mod.default ?? mod;
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes() {
  const idb = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get(IDB_KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } finally {
    idb.close();
  }
}

async function saveBytes(bytes) {
  const idb = await openIdb();
  try {
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

function schedulePersist() {
  if (!db) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const data = db.export();
      saveBytes(data).catch((err) => console.warn("Catalog persist failed", err));
    } catch (err) {
      console.warn("Catalog export failed", err);
    }
  }, 250);
}

function ensureSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      part_number TEXT,
      name TEXT,
      category TEXT,
      brand TEXT,
      uom TEXT,
      vehicle_compatibility TEXT,
      purchase_price REAL,
      selling_price REAL,
      stock_quantity REAL,
      min_stock_alert REAL,
      rack_location TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_part ON products(part_number);
    CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
  `);
}

function toRow(p) {
  return {
    id: p.id,
    part_number: p.part_number || "",
    name: p.name || "",
    category: p.category ?? null,
    brand: p.brand ?? null,
    uom: p.uom || "PCS",
    vehicle_compatibility: JSON.stringify(p.vehicle_compatibility || []),
    purchase_price: Number(p.purchase_price) || 0,
    selling_price: Number(p.selling_price) || 0,
    stock_quantity: Number(p.stock_quantity) || 0,
    min_stock_alert: Number(p.min_stock_alert) || 0,
    rack_location: p.rack_location ?? null,
    updated_at: p.updated_at || new Date().toISOString(),
  };
}

function fromSql(row) {
  if (!row) return null;
  let vehicles = [];
  try {
    vehicles = row.vehicle_compatibility ? JSON.parse(row.vehicle_compatibility) : [];
  } catch {
    vehicles = [];
  }
  return {
    id: row.id,
    part_number: row.part_number,
    name: row.name,
    category: row.category,
    brand: row.brand,
    uom: row.uom,
    vehicle_compatibility: vehicles,
    purchase_price: row.purchase_price,
    selling_price: row.selling_price,
    stock_quantity: row.stock_quantity,
    min_stock_alert: row.min_stock_alert,
    rack_location: row.rack_location,
    updated_at: row.updated_at,
  };
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] ?? null;
}

export async function initCatalog() {
  if (db) return db;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const initSqlJs = await loadInitSqlJs();
    SQL = await initSqlJs({ locateFile: () => WASM_URL });
    const bytes = await loadBytes();
    db = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
    ensureSchema();
    const count = catalogCount();
    if (count === 0) {
      const fromDexie = await localDb.products.toArray();
      if (fromDexie.length) await catalogBulkPut(fromDexie, { persistDexie: false });
    }
    return db;
  })();
  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

export function catalogCount() {
  if (!db) return 0;
  const row = queryOne("SELECT COUNT(*) AS n FROM products");
  return Number(row?.n) || 0;
}

export async function catalogGet(id) {
  await initCatalog();
  return fromSql(queryOne("SELECT * FROM products WHERE id = ?", [id]));
}

export async function catalogGetByPart(partNumber) {
  await initCatalog();
  return fromSql(
    queryOne("SELECT * FROM products WHERE part_number = ? COLLATE NOCASE", [
      partNumber,
    ]),
  );
}

export async function catalogGetMany(ids) {
  await initCatalog();
  if (!ids?.length) return [];
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => "?").join(",");
  const rows = queryAll(
    `SELECT * FROM products WHERE id IN (${placeholders})`,
    unique,
  );
  const map = new Map(rows.map((r) => [r.id, fromSql(r)]));
  return ids.map((id) => map.get(id)).filter(Boolean);
}

export async function catalogPage({ offset = 0, limit = 80, query = "" } = {}) {
  await initCatalog();
  const q = query.trim();
  if (!q) {
    const rows = queryAll(
      "SELECT * FROM products ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?",
      [limit, offset],
    );
    return rows.map(fromSql);
  }
  const like = `%${q.replace(/%/g, "")}%`;
  const rows = queryAll(
    `SELECT * FROM products
     WHERE part_number LIKE ? COLLATE NOCASE
        OR name LIKE ? COLLATE NOCASE
        OR brand LIKE ? COLLATE NOCASE
        OR category LIKE ? COLLATE NOCASE
        OR vehicle_compatibility LIKE ? COLLATE NOCASE
     ORDER BY name COLLATE NOCASE
     LIMIT ? OFFSET ?`,
    [like, like, like, like, like, limit, offset],
  );
  return rows.map(fromSql);
}

export async function catalogAll() {
  await initCatalog();
  return queryAll("SELECT * FROM products ORDER BY name COLLATE NOCASE").map(fromSql);
}

export async function catalogForIndex(chunkSize = 400) {
  await initCatalog();
  const total = catalogCount();
  const chunks = [];
  for (let offset = 0; offset < total; offset += chunkSize) {
    const rows = queryAll(
      "SELECT id, name, part_number, vehicle_compatibility FROM products LIMIT ? OFFSET ?",
      [chunkSize, offset],
    );
    chunks.push(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        part_number: r.part_number,
        vehicles: (() => {
          try {
            return JSON.parse(r.vehicle_compatibility || "[]").join(" ");
          } catch {
            return "";
          }
        })(),
      })),
    );
  }
  return chunks;
}

function upsertSql(p) {
  const r = toRow(p);
  db.run(
    `INSERT OR REPLACE INTO products (
      id, part_number, name, category, brand, uom, vehicle_compatibility,
      purchase_price, selling_price, stock_quantity, min_stock_alert, rack_location, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.id,
      r.part_number,
      r.name,
      r.category,
      r.brand,
      r.uom,
      r.vehicle_compatibility,
      r.purchase_price,
      r.selling_price,
      r.stock_quantity,
      r.min_stock_alert,
      r.rack_location,
      r.updated_at,
    ],
  );
}

export async function catalogPut(p, { persistDexie = true } = {}) {
  await initCatalog();
  upsertSql(p);
  schedulePersist();
  if (persistDexie) await localDb.products.put(p);
}

export async function catalogBulkPut(products, { persistDexie = true } = {}) {
  await initCatalog();
  db.run("BEGIN");
  try {
    for (const p of products) upsertSql(p);
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
  schedulePersist();
  if (persistDexie && products.length) await localDb.products.bulkPut(products);
}

export async function catalogDelete(id) {
  await initCatalog();
  db.run("DELETE FROM products WHERE id = ?", [id]);
  schedulePersist();
  await localDb.products.delete(id);
}

export async function catalogUpdate(id, patch) {
  await initCatalog();
  const current = await catalogGet(id);
  if (!current) return;
  await catalogPut({ ...current, ...patch, id });
}
