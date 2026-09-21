import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { closeShift, computeExpectedTotals } from "../../lib/register";
import { downloadDayCloseReportPdf } from "../../lib/exportDownload";
import { formatInr } from "../../lib/format";
import { getUndepositedCashTotal, getUnconfirmedUpiDays } from "../../lib/bank";

export function CloseShiftModal({ open, session, userId, onClose, onDone }) {
  const [expected, setExpected] = useState({
    cash: 0,
    upi: 0,
    cashSales: 0,
    upiSales: 0,
    cashExpenses: 0,
    upiExpenses: 0,
  });
  const [depositHint, setDepositHint] = useState({ cash: 0, upiDays: 0 });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open && session?.id) {
      computeExpectedTotals(session.id).then(setExpected);
      Promise.all([getUndepositedCashTotal(), getUnconfirmedUpiDays()]).then(
        ([cash, upiDays]) =>
          setDepositHint({ cash, upiDays: upiDays.length }),
      );
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
      });
      if (report) {
        downloadDayCloseReportPdf(report);
      }
      onDone();
    } catch (err) {
      setError(err.message || "Could not end session.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="End session">
      <p className="mb-3 text-sm text-fog">
        Expected balances from today&apos;s bills minus expenses. A PDF summary
        downloads and is saved (updated if you end again later today).
      </p>

      <div className="mb-4 space-y-2 rounded-xl border border-ash bg-paper/60 px-3 py-3 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-fog">Cash sales</span>
          <span className="tabular-nums text-ink">{formatInr(expected.cashSales)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-fog">Cash expenses</span>
          <span className="tabular-nums text-ink">
            −{formatInr(expected.cashExpenses)}
          </span>
        </div>
        <div className="flex justify-between gap-3 border-t border-ash pt-2 font-semibold">
          <span className="text-ink">Expected cash</span>
          <span className="tabular-nums text-ink">{formatInr(expected.cash)}</span>
        </div>
        <div className="flex justify-between gap-3 pt-2">
          <span className="text-fog">UPI sales</span>
          <span className="tabular-nums text-ink">{formatInr(expected.upiSales)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-fog">UPI expenses</span>
          <span className="tabular-nums text-ink">
            −{formatInr(expected.upiExpenses)}
          </span>
        </div>
        <div className="flex justify-between gap-3 border-t border-ash pt-2 font-semibold">
          <span className="text-ink">Expected UPI</span>
          <span className="tabular-nums text-ink">{formatInr(expected.upi)}</span>
        </div>
      </div>

      {depositHint.cash > 0 || depositHint.upiDays > 0 ? (
        <p className="mb-3 rounded-lg border border-ash bg-paper/80 px-3 py-2 text-xs text-fog">
          After ending: deposit cash / confirm UPI in{" "}
          <Link to="/money" className="font-medium text-action underline" onClick={onClose}>
            Money
          </Link>
          {depositHint.cash > 0
            ? ` · undeposited cash about ${formatInr(depositHint.cash)}`
            : ""}
          {depositHint.upiDays > 0
            ? ` · ${depositHint.upiDays} UPI day(s) to confirm`
            : ""}
          .
        </p>
      ) : null}

      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <form onSubmit={submit} className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? "Ending…" : "End session & download PDF"}
        </Button>
      </form>
    </Modal>
  );
}
