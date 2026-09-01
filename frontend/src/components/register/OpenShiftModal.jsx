import { useState } from "react";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { BlockingModal } from "../ui/Modal";
import { openShift } from "../../lib/register";

export function OpenShiftModal({ open, userId, onDone }) {
  const [cash, setCash] = useState("");
  const [upi, setUpi] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (cash === "" || upi === "") {
      setError("Opening cash and UPI are required.");
      return;
    }
    setPending(true);
    try {
      await openShift({
        userId,
        openingCash: cash,
        openingUpi: upi,
      });
      onDone();
    } catch (err) {
      setError(err.message || "Could not open shift.");
    } finally {
      setPending(false);
    }
  }

  return (
    <BlockingModal open={open} title="Start daily shift">
      <p className="mb-4 text-sm text-white-muted">
        Enter opening cash in drawer and UPI balance before using the counter.
      </p>
      {error ? (
        <p className="mb-3 text-sm text-danger">{error}</p>
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Opening cash (₹)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="Enter amount"
            required
          />
        </div>
        <div>
          <Label>Opening UPI (₹)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={upi}
            onChange={(e) => setUpi(e.target.value)}
            placeholder="Enter amount"
            required
          />
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Opening…" : "Open shift"}
        </Button>
      </form>
    </BlockingModal>
  );
}
