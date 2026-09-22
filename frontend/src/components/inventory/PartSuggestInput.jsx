import { useEffect, useId, useRef, useState } from "react";
import { searchProducts } from "../../lib/searchClient";
import { localDb } from "../../db/localDb";
import { formatInr, toNum } from "../../lib/format";
import { Input } from "../ui/Input";

function isLocalProduct(p) {
  return Boolean(p?.exclude_from_gst);
}

/**
 * Text field with dropdown of existing catalog parts.
 * Pick a match to reuse the same product (avoids duplicates from typos).
 *
 * @param {"gst"|"local"|"all"} [scope="all"] — gst: only GST parts; local: only local/no-GST parts
 */
export function PartSuggestInput({
  value,
  onChange,
  onPick,
  scope = "all",
  placeholder,
  required,
  className,
  disabled,
  inputMode,
  "aria-label": ariaLabel,
}) {
  const listId = useId();
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const q = String(value || "").trim();
    if (q.length < 1) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        // Over-fetch then filter by GST/local so each entry mode stays separate.
        const rows = (await searchProducts(q, 40)) || [];
        let localFlags = new Map();
        if (scope === "gst" || scope === "local") {
          const ids = rows.map((r) => r.id).filter(Boolean);
          if (ids.length) {
            const locals = await localDb.products.bulkGet(ids);
            localFlags = new Map(
              locals.filter(Boolean).map((p) => [p.id, Boolean(p.exclude_from_gst)]),
            );
          }
        }
        const enriched = rows.map((p) => ({
          ...p,
          exclude_from_gst:
            localFlags.get(p.id) ?? Boolean(p.exclude_from_gst),
        }));
        const filtered =
          scope === "local"
            ? enriched.filter(isLocalProduct)
            : scope === "gst"
              ? enriched.filter((p) => !isLocalProduct(p))
              : enriched;
        if (!cancelled) {
          setResults(filtered.slice(0, 12));
          setHighlight(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, scope]);

  useEffect(() => {
    function onDoc(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(product) {
    onPick?.(product);
    setOpen(false);
    setResults([]);
  }

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && results[highlight]) {
      e.preventDefault();
      pick(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && results.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        className={className}
        disabled={disabled}
        inputMode={inputMode}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={showList}
        autoComplete="off"
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-ash bg-paper shadow-lg"
        >
          {results.map((p, i) => {
            const stock = toNum(p.stock_quantity);
            const active = i === highlight;
            return (
              <li key={p.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm ${
                    active ? "bg-electric/10" : "hover:bg-canvas"
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(p);
                  }}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">
                      {p.part_number || "—"}
                    </span>
                    <span className="text-[11px] tabular-nums text-silver">
                      stock {stock}
                      {toNum(p.selling_price) > 0
                        ? ` · sell ${formatInr(p.selling_price)}`
                        : ""}
                    </span>
                  </span>
                  <span className="truncate text-fog">{p.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
