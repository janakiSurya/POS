import { useState } from "react";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { addExpense } from "../../lib/register";
import { EXPENSE_CATEGORIES } from "../../lib/expenses";

export function ExpenseModal({ open, sessionId, userId, onClose }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("MISC");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await addExpense({ sessionId, userId, amount, note, category });
      setAmount("");
      setNote("");
      setCategory("MISC");
      onClose();
    } catch (err) {
      setError(err.message || "Could not save expense.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Cash expense">
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Category</Label>
          <select
            className="w-full rounded-lg border border-ash bg-paper px-3 py-2.5 text-sm text-ink focus:border-electric focus:outline-none"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
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
