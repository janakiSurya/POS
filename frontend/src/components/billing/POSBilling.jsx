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
import { searchProducts } from "../../hooks/useSync";
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
  const searchRef = useRef(null);

  useEffect(() => {
    localDb.shop_settings.get("default").then(setShop);
    flushOfflineQueue();
  }, []);

  useEffect(() => {
    setResults(searchProducts(query));
    setSelectedIdx(0);
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

      <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row">

      {/* Search panel */}
      <div className="flex flex-1 flex-col border-b border-charcoal-3 lg:border-b-0 lg:border-r">
        <div className="border-b border-charcoal-3 bg-charcoal-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              className="text-xs"
              onClick={() => searchRef.current?.focus()}
            >
              <Search className="mr-1.5 inline h-3.5 w-3.5" />
              Search
            </Button>
            <Button
              variant="ghost"
              className="text-xs"
              onClick={clearCart}
              disabled={!cart.length}
            >
              <RotateCcw className="mr-1.5 inline h-3.5 w-3.5" />
              Clear cart
            </Button>
            <span className="hidden text-xs text-white-faint sm:inline">
              F1 · F4 · F9 print · F10 no bill
            </span>
          </div>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-5 w-5 text-white-faint" />
            <input
              ref={searchRef}
              className="w-full rounded-xl border border-charcoal-3 bg-charcoal py-3.5 pl-12 pr-4 text-base text-white placeholder:text-white-faint focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/10"
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
              autoFocus
            />
          </div>

          <ul className="mt-3 max-h-[calc(100vh-14rem)] space-y-1 overflow-y-auto">
            {results.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => addToCart(p)}
                  className={`w-full rounded-xl px-4 py-3 text-left transition-all ${
                    i === selectedIdx
                      ? "border border-white/20 bg-charcoal-2 shadow-sm"
                      : "border border-transparent hover:bg-charcoal-2"
                  }`}
                >
                  <div className="font-medium text-white">{p.name}</div>
                  <div className="mt-1 flex justify-between text-xs text-white-muted">
                    <span className="font-mono">{p.part_number}</span>
                    <span>
                      {formatInr(p.selling_price)} · stock{" "}
                      {formatQty(p.stock_quantity)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
            {query && !results.length ? (
              <li className="py-8 text-center text-sm text-white-faint">
                No parts found
              </li>
            ) : null}
            {!query ? (
              <li className="py-12 text-center text-sm text-white-faint">
                Type to search inventory
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      {/* Cart panel */}
      <div className="flex w-full flex-col bg-charcoal-2 lg:w-[min(440px,42%)]">
        <div className="flex items-center justify-between border-b border-charcoal-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-white-muted" />
            <h2 className="font-semibold text-white">Cart</h2>
            {cart.length > 0 ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-charcoal">
                {cart.length}
              </span>
            ) : null}
          </div>
          {cart.length > 0 ? (
            <Button variant="ghost" className="text-xs" onClick={clearCart}>
              Clear
            </Button>
          ) : null}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingCart className="h-10 w-10 text-white-faint" />
              <p className="mt-3 text-sm text-white-muted">Cart is empty</p>
              <p className="mt-1 text-xs text-white-faint">
                Search and tap a part to add
              </p>
            </div>
          ) : (
            cart.map((line, idx) => (
              <div
                key={line.product_id}
                className="rounded-xl border border-charcoal-3 bg-charcoal p-3"
              >
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-white leading-snug">
                      {line.name}
                    </p>
                    <p className="font-mono text-xs text-white-muted">
                      {line.part_number}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCart((c) => c.filter((_, i) => i !== idx))
                    }
                    className="shrink-0 rounded-lg p-1.5 text-white-faint hover:bg-charcoal-3 hover:text-danger"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <Label className="text-xs text-white-faint">Quantity</Label>
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => adjustQty(idx, -1)}
                        className="rounded-lg border border-charcoal-3 p-2 text-white-muted hover:bg-charcoal-2 hover:text-white"
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
                        className="rounded-lg border border-charcoal-3 p-2 text-white-muted hover:bg-charcoal-2 hover:text-white"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {discountMode === "line" ? (
                    <div className="w-20">
                      <Label className="text-xs text-white-faint">Disc %</Label>
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

                  <div className="text-right">
                    <p className="text-xs text-white-faint">Line total</p>
                    <p className="text-lg font-bold tabular-nums text-white">
                      {formatInr(line.line_total)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Discount mode */}
          {cart.length > 0 ? (
            <div className="rounded-xl border border-charcoal-3 bg-charcoal p-3">
              <Label className="text-white-muted">Discount applies to</Label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={switchToLineDiscount}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    discountMode === "line"
                      ? "bg-white text-charcoal"
                      : "border border-charcoal-3 text-white-muted hover:text-white"
                  }`}
                >
                  Each item
                </button>
                <button
                  type="button"
                  onClick={switchToBillDiscount}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    discountMode === "bill"
                      ? "bg-white text-charcoal"
                      : "border border-charcoal-3 text-white-muted hover:text-white"
                  }`}
                >
                  Whole bill
                </button>
              </div>
              {discountMode === "bill" ? (
                <div className="mt-3">
                  <Label className="text-xs text-white-faint">
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
                  <p className="mt-1 text-xs text-white-faint">
                    Per-item discounts are disabled in this mode
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-white-faint">
                  Set discount on each line, or switch to whole bill
                </p>
              )}
            </div>
          ) : null}

          {/* Customer */}
          <div className="rounded-xl border border-charcoal-3 bg-charcoal p-3">
            <Label>Customer phone</Label>
            <Input
              className="mt-1"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={lookupPhone}
              placeholder="10-digit mobile (optional)"
            />
            {customer ? (
              <p className="mt-2 text-sm text-success">
                {customer.name} · Balance{" "}
                {formatInr(customer.outstanding_balance)}
              </p>
            ) : needName ? (
              <div className="mt-2">
                <Label>New customer name</Label>
                <Input
                  className="mt-1"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                />
              </div>
            ) : null}
          </div>

          {/* Payment */}
          <div>
            <Label className="mb-2 block">Payment method</Label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_OPTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPayment(id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-sm transition-all ${
                    payment === id
                      ? "border-white bg-white text-charcoal shadow-sm"
                      : "border-charcoal-3 text-white-muted hover:border-white/30 hover:text-white"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>

        {/* Checkout footer */}
        <div className="border-t border-charcoal-3 bg-white p-4 text-charcoal">
          {cart.length > 0 && discountMode === "bill" && totals.billDiscount > 0 ? (
            <div className="mb-2 space-y-1 text-sm text-charcoal/70">
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
            <div className="mb-2 flex justify-between text-sm text-charcoal/70">
              <span>Line discounts</span>
              <span className="tabular-nums text-danger">
                -{formatInr(totals.gross - totals.total)}
              </span>
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">Total</span>
            <span className="text-3xl font-bold tabular-nums">
              {formatInr(totals.total)}
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button
              className="py-3.5 text-base"
              disabled={pending || !cart.length}
              onClick={() => processSale(true)}
            >
              <Printer className="mr-2 inline h-5 w-5" />
              {pending ? "Processing…" : "Print & complete"}
            </Button>
            <Button
              variant="secondary"
              className="py-3.5 text-base border-charcoal/20 bg-charcoal/5 text-charcoal hover:bg-charcoal/10"
              disabled={pending || !cart.length}
              onClick={() => processSale(false)}
            >
              <CheckCircle2 className="mr-2 inline h-5 w-5" />
              {pending ? "Processing…" : "Complete (no bill)"}
            </Button>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
