import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Trash2,
  Plus,
  Minus,
  ShoppingCart,
  RotateCcw,
  Banknote,
  Smartphone,
  CreditCard,
  CheckCircle2,
  Printer,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { searchProducts } from "../../lib/searchClient";
import { localDb } from "../../db/localDb";
import {
  buildCartLine,
  completeSale,
  createCustomer,
  findCustomerByPhone,
} from "../../lib/sales";
import {
  formatInr,
  formatQty,
  validateDiscount,
  toNum,
  computeCartTotals,
  round2,
} from "../../lib/format";
import { ReceiptPrint } from "./ReceiptPrint";
import { flushOfflineQueue } from "../../lib/offlineFlush";

const PAYMENT_OPTIONS = [
  { id: "CASH", label: "Cash", icon: Banknote },
  { id: "UPI", label: "UPI", icon: Smartphone },
  { id: "CREDIT", label: "Credit", icon: CreditCard },
];

function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}

export function POSBilling({ session, profile, isOwner }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cart, setCart] = useState([]);
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState(null);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [needName, setNeedName] = useState(false);
  const [payment, setPayment] = useState("CASH");
  const [discountMode, setDiscountMode] = useState("line");
  const [billDiscountPercent, setBillDiscountPercent] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [shop, setShop] = useState(null);
  const [mobilePanel, setMobilePanel] = useState("search");
  const [cartPulse, setCartPulse] = useState(false);
  const searchRef = useRef(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    localDb.shop_settings.get("default").then(setShop);
    flushOfflineQueue();
  }, []);

  useEffect(() => {
    let cancelled = false;
    searchProducts(query).then((rows) => {
      if (!cancelled) {
        setResults(rows);
        setSelectedIdx(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const totals = computeCartTotals(
    cart,
    discountMode,
    billDiscountPercent,
  );

  const clearCart = useCallback(() => {
    setCart([]);
    setError("");
    setBillDiscountPercent("");
    setDiscountMode("line");
    searchRef.current?.focus();
  }, []);

  const rebuildLine = useCallback(
    (line, qty, disc) => {
      return buildCartLine(
        {
          id: line.product_id,
          part_number: line.part_number,
          name: line.name,
          selling_price: line.unit_price,
          purchase_price: line.unit_cost,
          stock_quantity: line.stock_quantity,
        },
        qty,
        disc,
        isOwner,
      );
    },
    [isOwner],
  );

  const switchToBillDiscount = useCallback(() => {
    setDiscountMode("bill");
    setBillDiscountPercent("");
    setCart((c) => c.map((line) => rebuildLine(line, line.quantity, 0)));
    setError("");
  }, [rebuildLine]);

  const switchToLineDiscount = useCallback(() => {
    setDiscountMode("line");
    setBillDiscountPercent("");
    setError("");
  }, []);

  const processSale = useCallback(
    async (printReceipt) => {
      setError("");
      if (!cart.length) {
        setError("Cart is empty.");
        return;
      }
      let cust = customer;
      const normalized = phone.replace(/\D/g, "");
      if (normalized.length >= 10) {
        if (needName && !newCustomerName.trim()) {
          setError("Enter customer name for new phone.");
          return;
        }
        if (needName) {
          cust = await createCustomer({
            phone: normalized,
            name: newCustomerName.trim(),
          });
          setCustomer(cust);
          setNeedName(false);
        }
      }

      if (discountMode === "bill") {
        const err = validateDiscount(profile.role, billDiscountPercent);
        if (err) {
          setError(err);
          return;
        }
      }

      setPending(true);
      try {
        let invoiceNumber = null;
        if (!navigator.onLine || !import.meta.env.VITE_SUPABASE_URL) {
          const meta = await localDb.sync_meta.get("demo_invoice_num");
          const n = meta?.value ?? 1;
          invoiceNumber = `SSA-${String(n).padStart(4, "0")}`;
          await localDb.sync_meta.put({ key: "demo_invoice_num", value: n + 1 });
        }

        const saleLines =
          discountMode === "bill"
            ? cart.map((l) => ({
                ...l,
                discount_percent: 0,
                line_total: round2(toNum(l.unit_price) * toNum(l.quantity)),
              }))
            : cart;

        const { invoice } = await completeSale({
          sessionId: session.id,
          staffId: profile.id,
          customerId: cust?.id,
          paymentMethod: payment,
          lines: saleLines,
          invoiceNumber,
          discountMode,
          billDiscountPercent: totals.billDiscount,
          subtotalAmount: totals.subtotal,
          totalAmount: totals.total,
        });

        setCart([]);
        setPhone("");
        setCustomer(null);
        setNewCustomerName("");
        setBillDiscountPercent("");
        setDiscountMode("line");
        if (isMobile) setMobilePanel("search");

        if (printReceipt) {
          const receiptLines = saleLines.map((l) => ({ ...l, name: l.name }));
          setLastReceipt({
            invoice: {
              ...invoice,
              payment_method: payment,
              subtotal_amount: totals.subtotal,
              bill_discount_percent: totals.billDiscount,
              total_amount: totals.total,
            },
            lines: receiptLines,
            customer: cust,
          });
          setTimeout(() => {
            window.print();
            setLastReceipt(null);
            searchRef.current?.focus();
          }, 300);
        } else {
          searchRef.current?.focus();
        }
      } catch (err) {
        setError(err.message || "Sale failed.");
      } finally {
        setPending(false);
      }
    },
    [
      cart,
      customer,
      phone,
      needName,
      newCustomerName,
      payment,
      session.id,
      profile.id,
      profile.role,
      discountMode,
      billDiscountPercent,
      totals,
      isMobile,
    ],
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === "F1") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "F4") {
        e.preventDefault();
        clearCart();
      }
      if (e.key === "F9") {
        e.preventDefault();
        processSale(true);
      }
      if (e.key === "F10") {
        e.preventDefault();
        processSale(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [processSale, clearCart]);

  const addToCart = useCallback(
    (product) => {
      setCart((c) => {
        const existing = c.find((x) => x.product_id === product.id);
        const lineDisc = discountMode === "bill" ? 0 : undefined;
        if (existing) {
          return c.map((x) =>
            x.product_id === product.id
              ? buildCartLine(
                  { ...product, selling_price: x.unit_price },
                  x.quantity + 1,
                  lineDisc ?? x.discount_percent,
                  isOwner,
                )
              : x,
          );
        }
        return [...c, buildCartLine(product, 1, 0, isOwner)];
      });
      setQuery("");
      setCartPulse(true);
      setTimeout(() => setCartPulse(false), 450);
      searchRef.current?.focus();
    },
    [isOwner, discountMode],
  );

  async function lookupPhone() {
    const normalized = phone.replace(/\D/g, "");
    if (normalized.length < 10) return;
    const found = await findCustomerByPhone(normalized);
    if (found) {
      setCustomer(found);
      setNeedName(false);
    } else {
      setCustomer(null);
      setNeedName(true);
    }
  }

  function updateLine(idx, patch) {
    if (patch.discount_percent != null && discountMode === "bill") {
      switchToLineDiscount();
    }
    setCart((c) =>
      c.map((line, i) => {
        if (i !== idx) return line;
        const disc = patch.discount_percent ?? line.discount_percent;
        if (patch.discount_percent != null) {
          const err = validateDiscount(profile.role, disc);
          if (err) {
            setError(err);
            return line;
          }
          setError("");
        }
        return rebuildLine(
          line,
          patch.quantity ?? line.quantity,
          patch.discount_percent ?? line.discount_percent,
        );
      }),
    );
  }

  function changeBillDiscount(val) {
    const err = validateDiscount(profile.role, val);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setDiscountMode("bill");
    setBillDiscountPercent(val);
    setCart((c) => c.map((line) => rebuildLine(line, line.quantity, 0)));
  }

  function adjustQty(idx, delta) {
    setCart((c) =>
      c.map((line, i) => {
        if (i !== idx) return line;
        const qty = Math.max(1, line.quantity + delta);
        return rebuildLine(
          line,
          qty,
          discountMode === "bill" ? 0 : line.discount_percent,
        );
      }),
    );
  }

  return (
    <>
      {lastReceipt
        ? createPortal(
            <ReceiptPrint
              shop={shop}
              invoice={lastReceipt.invoice}
              lines={lastReceipt.lines}
              customer={lastReceipt.customer}
            />,
            document.body,
          )
        : null}

      <div
        className={`flex flex-col overflow-hidden bg-canvas lg:h-[calc(100dvh-4rem)] lg:flex-row ${
          isMobile
            ? isOwner
              ? "h-[calc(100dvh-7rem)]"
              : "h-[calc(100dvh-3.25rem)]"
            : "h-[calc(100dvh-4rem)]"
        }`}
      >
        {/* Mobile: Search / Cart tabs */}
        <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-ash bg-paper p-1 lg:hidden">
          <button
            type="button"
            onClick={() => setMobilePanel("search")}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors active:scale-[0.98] ${
              mobilePanel === "search"
                ? "bg-canvas text-ink shadow-subtle"
                : "text-fog"
            }`}
          >
            <Search className="h-4 w-4" />
            Search
          </button>
          <button
            type="button"
            onClick={() => setMobilePanel("cart")}
            className={`relative flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors active:scale-[0.98] ${
              mobilePanel === "cart"
                ? "bg-canvas text-ink shadow-subtle"
                : "text-fog"
            } ${cartPulse ? "ring-2 ring-electric/30" : ""}`}
          >
            <ShoppingCart className="h-4 w-4" />
            Cart
            {cart.length > 0 ? (
              <span className="rounded-full bg-action px-1.5 py-0.5 text-[10px] font-bold text-canvas">
                {cart.length}
              </span>
            ) : null}
          </button>
        </div>

        {/* Search panel */}
        <section
          className={`min-h-0 min-w-0 flex-1 flex-col border-b border-ash lg:flex lg:border-b-0 lg:border-r ${
            mobilePanel === "search" ? "flex" : "hidden"
          }`}
        >
          <div className="shrink-0 border-b border-ash bg-canvas px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="mx-auto flex w-full max-w-2xl items-center gap-2 sm:gap-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver" />
                <input
                  ref={searchRef}
                  className="w-full rounded-lg border border-ash bg-paper py-3 pl-10 pr-3 text-base text-ink placeholder:text-silver focus:border-electric focus:outline-none focus:ring-2 focus:ring-electric/20 sm:py-2.5 sm:text-sm"
                  placeholder="Search part name or number…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSelectedIdx((i) => Math.max(i - 1, 0));
                    }
                    if (e.key === "Enter" && results[selectedIdx]) {
                      e.preventDefault();
                      addToCart(results[selectedIdx]);
                    }
                  }}
                  autoFocus={!isMobile}
                />
              </div>
              <p className="hidden shrink-0 text-[11px] text-silver lg:block">
                F1 · F4 · F9 · F10
              </p>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 sm:px-4 sm:py-3">
            <ul className="mx-auto w-full max-w-2xl space-y-1">
              {results.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors active:scale-[0.99] sm:py-2.5 ${
                      i === selectedIdx
                        ? "border-electric/30 bg-paper"
                        : "border-transparent hover:border-ash hover:bg-paper"
                    }`}
                  >
                    <div className="text-sm font-medium text-ink">{p.name}</div>
                    <div className="mt-1 flex flex-col gap-0.5 text-xs text-fog sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <span className="truncate font-mono">{p.part_number}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatInr(p.selling_price)} · {formatQty(p.stock_quantity)} in stock
                      </span>
                    </div>
                  </button>
                </li>
              ))}
              {query && !results.length ? (
                <li className="py-10 text-center text-sm text-silver">No parts found</li>
              ) : null}
              {!query ? (
                <li className="py-16 text-center text-sm text-silver">
                  Type to search inventory
                </li>
              ) : null}
            </ul>
          </div>
        </section>

        {/* Cart panel */}
        <aside
          className={`min-h-0 w-full shrink-0 flex-col border-ash bg-canvas lg:flex lg:w-[min(100%,400px)] lg:border-l xl:w-[420px] ${
            mobilePanel === "cart" ? "flex" : "hidden"
          }`}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-ash px-4 py-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-fog" />
              <h2 className="text-sm font-semibold text-ink">Cart</h2>
              {cart.length > 0 ? (
                <span className="rounded-full bg-action px-2 py-0.5 text-[11px] font-semibold text-canvas">
                  {cart.length}
                </span>
              ) : null}
            </div>
            {cart.length > 0 ? (
              <button
                type="button"
                onClick={clearCart}
                className="inline-flex items-center gap-1 text-xs font-medium text-fog hover:text-ink"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Clear
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ShoppingCart className="h-8 w-8 text-silver" />
                <p className="mt-2 text-sm text-fog">Cart is empty</p>
                <p className="mt-1 text-xs text-silver">Search and add parts from the left</p>
              </div>
            ) : (
              cart.map((line, idx) => (
                <div
                  key={line.product_id}
                  className="rounded-lg border border-ash bg-paper p-3"
                >
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink leading-snug">
                      {line.name}
                    </p>
                    <p className="font-mono text-xs text-fog">
                      {line.part_number}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCart((c) => c.filter((_, i) => i !== idx))
                    }
                    className="shrink-0 rounded-lg p-1.5 text-silver hover:bg-paper hover:text-danger"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
                  <div>
                    <Label className="text-[11px] text-silver">Quantity</Label>
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => adjustQty(idx, -1)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-ash text-fog active:scale-95 hover:bg-canvas hover:text-ink"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <Input
                        type="number"
                        min="1"
                        className="w-14 text-center tabular-nums"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(idx, {
                            quantity: Number(e.target.value),
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => adjustQty(idx, 1)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-ash text-fog active:scale-95 hover:bg-canvas hover:text-ink"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {discountMode === "line" ? (
                    <div className="w-[4.5rem]">
                      <Label className="text-[11px] text-silver">Disc %</Label>
                      <Input
                        type="number"
                        min="0"
                        className="mt-1 text-center tabular-nums"
                        value={line.discount_percent}
                        onChange={(e) =>
                          updateLine(idx, {
                            discount_percent: e.target.value,
                          })
                        }
                      />
                    </div>
                  ) : null}

                  <div className="col-span-2 flex items-center justify-between border-t border-ash pt-2">
                    <span className="text-[11px] text-silver">Line total</span>
                    <span className="text-base font-semibold tabular-nums text-ink">
                      {formatInr(line.line_total)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}

          {cart.length > 0 ? (
            <div className="rounded-lg border border-ash bg-paper p-3">
              <Label className="text-xs text-fog">Discount applies to</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={switchToLineDiscount}
                  className={`min-h-[44px] rounded-lg px-3 py-2 text-xs font-medium transition-colors active:scale-[0.98] ${
                    discountMode === "line"
                      ? "bg-action text-canvas"
                      : "border border-ash text-fog hover:text-ink"
                  }`}
                >
                  Each item
                </button>
                <button
                  type="button"
                  onClick={switchToBillDiscount}
                  className={`min-h-[44px] rounded-lg px-3 py-2 text-xs font-medium transition-colors active:scale-[0.98] ${
                    discountMode === "bill"
                      ? "bg-action text-canvas"
                      : "border border-ash text-fog hover:text-ink"
                  }`}
                >
                  Whole bill
                </button>
              </div>
              {discountMode === "bill" ? (
                <div className="mt-3">
                  <Label className="text-xs text-silver">
                    Bill discount %
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    className="mt-1"
                    placeholder="0"
                    value={billDiscountPercent}
                    onChange={(e) => changeBillDiscount(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-silver">
                    Per-item discounts are disabled in this mode
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-silver">
                  Set discount on each line, or switch to whole bill
                </p>
              )}
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="rounded-lg border border-ash bg-paper p-3">
              <Label className="text-xs">Customer phone</Label>
              <Input
                className="mt-1.5"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={lookupPhone}
                placeholder="10-digit mobile (optional)"
              />
              {customer ? (
                <p className="mt-2 text-xs text-success">
                  {customer.name} · Balance {formatInr(customer.outstanding_balance)}
                </p>
              ) : needName ? (
                <div className="mt-2">
                  <Label className="text-xs">New customer name</Label>
                  <Input
                    className="mt-1.5"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                  />
                </div>
              ) : null}
            </div>

            <div>
              <Label className="mb-2 block text-xs">Payment method</Label>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_OPTIONS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPayment(id)}
                    className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-xs transition-colors active:scale-[0.98] ${
                      payment === id
                        ? "border-action bg-action text-canvas"
                        : "border-ash text-fog hover:border-smoke hover:text-ink"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {error ? (
              <p className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </p>
            ) : null}
          </div>
          </div>

          <div className="shrink-0 border-t border-ash bg-canvas p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          {cart.length > 0 && discountMode === "bill" && totals.billDiscount > 0 ? (
            <div className="mb-2 space-y-1 text-sm text-fog">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatInr(totals.gross)}</span>
              </div>
              <div className="flex justify-between">
                <span>Discount ({totals.billDiscount}%)</span>
                <span className="tabular-nums text-danger">
                  -{formatInr(totals.gross - totals.total)}
                </span>
              </div>
            </div>
          ) : null}
          {cart.length > 0 &&
          discountMode === "line" &&
          totals.gross > totals.total ? (
            <div className="mb-2 flex justify-between text-sm text-fog">
              <span>Line discounts</span>
              <span className="tabular-nums text-danger">
                -{formatInr(totals.gross - totals.total)}
              </span>
            </div>
          ) : null}

            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium text-fog">Total</span>
              <span className="text-2xl font-bold tabular-nums text-ink">
                {formatInr(totals.total)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                className="min-h-[48px] w-full py-3 text-sm active:scale-[0.98]"
                disabled={pending || !cart.length}
                onClick={() => processSale(true)}
              >
                <Printer className="mr-2 inline h-4 w-4" />
                {pending ? "Processing…" : "Print & complete"}
              </Button>
              <Button
                variant="secondary"
                className="min-h-[48px] w-full py-3 text-sm active:scale-[0.98]"
                disabled={pending || !cart.length}
                onClick={() => processSale(false)}
              >
                <CheckCircle2 className="mr-2 inline h-4 w-4" />
                {pending ? "Processing…" : "Complete (no bill)"}
              </Button>
            </div>
          </div>
        </aside>

        {mobilePanel === "search" && cart.length > 0 ? (
          <button
            type="button"
            onClick={() => setMobilePanel("cart")}
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-20 flex min-h-[48px] -translate-x-1/2 items-center gap-2 rounded-full border border-ash bg-canvas px-5 py-2.5 text-sm font-medium text-ink shadow-md active:scale-[0.98] lg:hidden"
          >
            <ShoppingCart className="h-4 w-4" />
            View cart · {formatInr(totals.total)}
            <span className="rounded-full bg-action px-2 py-0.5 text-[10px] font-bold text-canvas">
              {cart.length}
            </span>
          </button>
        ) : null}
      </div>
    </>
  );
}
