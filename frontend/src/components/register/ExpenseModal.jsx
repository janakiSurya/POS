import { useState } from "react";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { addExpense } from "../../lib/register";

export function ExpenseModal({ open, sessionId, userId, onClose }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

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
      });
      setAmount("");
      setNote("");
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
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Petty cash out" />
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save expense"}
        </Button>
      </form>
    </Modal>
  );
}
