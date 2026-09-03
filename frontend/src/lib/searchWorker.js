import FlexSearch from "flexsearch";

let index = null;

function makeIndex() {
  return new FlexSearch.Document({
    document: {
      id: "id",
      index: ["name", "part_number", "vehicles"],
    },
    tokenize: "forward",
    context: true,
  });
}

function addDoc(p) {
  index.add({
    id: p.id,
    name: p.name || "",
    part_number: p.part_number || "",
    vehicles: p.vehicles || "",
  });
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg?.type) return;

  if (msg.type === "rebuild") {
    index = makeIndex();
    for (const chunk of msg.chunks || []) {
      for (const p of chunk) addDoc(p);
    }
    self.postMessage({ type: "ready", count: (msg.chunks || []).reduce((n, c) => n + c.length, 0) });
    return;
  }

  if (msg.type === "upsert") {
    if (!index) index = makeIndex();
    try {
      index.remove(msg.product.id);
    } catch {
      /* not present */
    }
    addDoc(msg.product);
    self.postMessage({ type: "upserted", id: msg.product.id });
    return;
  }

  if (msg.type === "remove") {
    if (index) {
      try {
        index.remove(msg.id);
      } catch {
        /* ignore */
      }
    }
    self.postMessage({ type: "removed", id: msg.id });
    return;
  }

  if (msg.type === "search") {
    if (!index || !msg.query?.trim()) {
      self.postMessage({ type: "results", requestId: msg.requestId, ids: [] });
      return;
    }
    const results = index.search(msg.query.trim(), { limit: msg.limit || 20 });
    const ids = [];
    const seen = new Set();
    for (const bucket of results) {
      for (const id of bucket.result) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    self.postMessage({ type: "results", requestId: msg.requestId, ids });
  }
};
