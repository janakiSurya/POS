import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { closeShift, computeExpectedTotals } from "../../lib/register";
import { downloadDayCloseReportPdf } from "../../lib/exportDownload";
import { formatInr } from "../../lib/format";

export function CloseShiftModal({ open, session, userId, onClose, onDone }) {
  const [closingCash, setClosingCash] = useState("");
  const [closingUpi, setClosingUpi] = useState("");
  const [expected, setExpected] = useState({ cash: 0, upi: 0 });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open && session?.id) {
      computeExpectedTotals(session.id).then(setExpected);
      setClosingCash("");
      setClosingUpi("");
      setError("");
    }
  }, [open, session?.id]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const { report } = await closeShift({
        sessionId: session.id,
        userId,
        closingCash,
        closingUpi,
        expectedCash: expected.cash,
        expectedUpi: expected.upi,
      });
      if (report) {
        downloadDayCloseReportPdf(report);
      }
      onDone();
    } catch (err) {
      setError(err.message || "Could not close shift.");
    } finally {
      setPending(false);
    }
  }

  const cashVar =
    closingCash !== ""
      ? Number(closingCash) - expected.cash
      : null;
  const upiVar =
    closingUpi !== "" ? Number(closingUpi) - expected.upi : null;

  return (
    <Modal open={open} onClose={onClose} title="Close shift & tally">
      <p className="mb-3 text-sm text-fog">
        After you enter counted cash and UPI, a PDF end-of-day summary will download
        automatically and be saved for this business date.
      </p>
      <div className="mb-4 space-y-2 text-sm text-fog">
        <p>Expected cash: <span className="text-ink">{formatInr(expected.cash)}</span></p>
        <p>Expected UPI: <span className="text-ink">{formatInr(expected.upi)}</span></p>
      </div>
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Counted physical cash (₹)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={closingCash}
            onChange={(e) => setClosingCash(e.target.value)}
            required
          />
          {cashVar != null ? (
            <p className={`mt-1 text-xs ${cashVar === 0 ? "text-success" : "text-warning"}`}>
              Variance: {formatInr(cashVar)}
            </p>
          ) : null}
        </div>
        <div>
          <Label>Actual UPI balance (₹)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={closingUpi}
            onChange={(e) => setClosingUpi(e.target.value)}
            required
          />
          {upiVar != null ? (
            <p className={`mt-1 text-xs ${upiVar === 0 ? "text-success" : "text-warning"}`}>
              Variance: {formatInr(upiVar)}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Closing…" : "Close shift & download PDF"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
