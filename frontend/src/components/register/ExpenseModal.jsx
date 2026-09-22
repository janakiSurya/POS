import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { addExpense } from "../../lib/register";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_MODES,
} from "../../lib/expenses";
import {
  getBankBalance,
  getCashOnHandBalance,
  getUndepositedCashTotal,
} from "../../lib/bank";
import { formatInr } from "../../lib/format";

export function ExpenseModal({ open, sessionId, userId, onClose }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("MISC");
  const [paymentMode, setPaymentMode] = useState("CASH");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [bankBalance, setBankBalance] = useState(0);
  const [cashInHand, setCashInHand] = useState(0);
  const [salesCash, setSalesCash] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [bank, hand, sales] = await Promise.all([
        getBankBalance(),
        getCashOnHandBalance(),
        getUndepositedCashTotal(),
      ]);
      if (!cancelled) {
        setBankBalance(bank);
        setCashInHand(hand);
        setSalesCash(sales);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await addExpense({
        sessionId,
        userId,
        amount,
        note,
        category,
        paymentMode,
      });
      setAmount("");
      setNote("");
      setCategory("MISC");
      setPaymentMode("CASH");
      onClose();
    } catch (err) {
      setError(err.message || "Could not save expense.");
    } finally {
      setPending(false);
    }
  }

  const modeHint = {
    BANK: "Deducts from bank.",
    HAND: "Deducts from cash in hand (loan money).",
    CASH: "Deducts from sales cash (from bills).",
    UPI: "Logged against UPI (does not change bank or cash).",
  }[paymentMode];

  return (
    <Modal open={open} onClose={onClose} title="Record expense">
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-ash bg-canvas px-2.5 py-2">
          <p className="text-[11px] text-fog">Cash</p>
          <p className="text-sm font-semibold tabular-nums text-ink">
            {formatInr(salesCash)}
          </p>
          <p className="mt-0.5 text-[10px] text-silver">From bills</p>
        </div>
        <div className="rounded-lg border border-ash bg-canvas px-2.5 py-2">
          <p className="text-[11px] text-fog">Cash in hand</p>
          <p className="text-sm font-semibold tabular-nums text-ink">
            {formatInr(cashInHand)}
          </p>
          <p className="mt-0.5 text-[10px] text-silver">From loans</p>
        </div>
        <div className="rounded-lg border border-ash bg-canvas px-2.5 py-2">
          <p className="text-[11px] text-fog">Bank</p>
          <p className="text-sm font-semibold tabular-nums text-ink">
            {formatInr(bankBalance)}
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Paid via</Label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {EXPENSE_PAYMENT_MODES.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPaymentMode(opt.id)}
                className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                  paymentMode === opt.id
                    ? "border-action bg-action text-canvas"
                    : "border-ash bg-paper text-fog hover:bg-canvas hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {modeHint ? (
            <p className="mt-1.5 text-xs text-fog">{modeHint}</p>
          ) : null}
        </div>
        <div>
          <Label>Category</Label>
          <select
            className="w-full rounded-lg border border-ash bg-paper px-3 py-2.5 text-sm text-ink focus:border-electric focus:outline-none"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Amount (₹)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Note</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional details"
          />
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save expense"}
        </Button>
      </form>
    </Modal>
  );
}
