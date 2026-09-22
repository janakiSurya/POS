import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { localDb } from "../../db/localDb";
import { businessDateIST, formatDateIST } from "../../lib/businessDay";
import { formatInr, toNum } from "../../lib/format";
import { isOnline } from "../../lib/network";
import {
  syncInvoicesIfNeeded,
  syncExpensesIfNeeded,
  syncPurchasesIfNeeded,
  syncSuppliersIfNeeded,
} from "../../lib/hybridSync";
import {
  confirmCashDeposit,
  confirmUpiDeposit,
  createLender,
  getMoneyOverview,
  getUndepositedCashDays,
  getUnconfirmedUpiDays,
  listBankLedger,
  listLendersWithBalances,
  listLoanEntries,
  listUnpaidPurchaseInvoices,
  listSupplierPayments,
  payPurchaseInvoice,
  purchasePayableTotal,
  recordLoanEntry,
  getLenderRepayBreakdown,
  syncMoneyFromServer,
} from "../../lib/bank";
import { PageHeader } from "../shared/PageHeader";
import { Card, KpiCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Modal } from "../ui/Modal";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "lenders", label: "Lenders" },
  { id: "cash", label: "Cash deposit" },
  { id: "upi", label: "UPI deposit" },
  { id: "pay", label: "Pay supplier" },
];

function ledgerLabel(type) {
  return (
    {
      LOAN_IN: "Loan received",
      LOAN_OUT: "Loan repaid",
      UPI_DEPOSIT: "UPI deposit",
      CASH_DEPOSIT: "Cash deposit",
      SUPPLIER_PAYMENT: "Supplier payment",
      EXPENSE: "Expense",
    }[type] || type
  );
}

export function MoneyPage({ userId }) {
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [lenders, setLenders] = useState([]);
  const [cashDays, setCashDays] = useState([]);
  const [upiDays, setUpiDays] = useState([]);
  const [unpaid, setUnpaid] = useState([]);
  const [supplierPayments, setSupplierPayments] = useState([]);
  const [invoicesById, setInvoicesById] = useState(new Map());
  const [suppliers, setSuppliers] = useState(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (isOnline()) {
        await Promise.all([
          syncInvoicesIfNeeded(false),
          syncExpensesIfNeeded(false),
          syncPurchasesIfNeeded(false),
          syncSuppliersIfNeeded(false),
          syncMoneyFromServer(),
        ]);
      }
      const [ov, led, lens, cash, upi, unpaidInv, pays, invs, sups] =
        await Promise.all([
          getMoneyOverview(),
          listBankLedger(40),
          listLendersWithBalances(),
          getUndepositedCashDays(),
          getUnconfirmedUpiDays(),
          listUnpaidPurchaseInvoices(),
          listSupplierPayments(50),
          localDb.purchase_invoices.toArray(),
          localDb.suppliers.toArray(),
        ]);
      setOverview(ov);
      setLedger(led);
      setLenders(lens);
      setCashDays(cash);
      setUpiDays(upi);
      setUnpaid(unpaidInv);
      setSupplierPayments(pays);
      setInvoicesById(new Map(invs.map((i) => [i.id, i])));
      setSuppliers(new Map(sups.map((s) => [s.id, s])));
    } catch (err) {
      setError(err.message || "Could not load money data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Money"
        description="Bank balance, loans, cash & UPI deposits, supplier payments"
      >
        <Button variant="secondary" className="text-xs" onClick={refresh}>
          Refresh
        </Button>
      </PageHeader>

      {error ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? "bg-action text-canvas"
                : "border border-ash bg-canvas text-fog hover:bg-paper hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && !overview ? (
        <p className="text-sm text-fog">Loading…</p>
      ) : null}

      {tab === "overview" && overview ? (
        <OverviewTab overview={overview} ledger={ledger} />
      ) : null}
      {tab === "lenders" ? (
        <LendersTab
          userId={userId}
          lenders={lenders}
          onChanged={refresh}
        />
      ) : null}
      {tab === "cash" ? (
        <CashDepositTab
          userId={userId}
          days={cashDays}
          total={overview?.undepositedCash || 0}
          onChanged={refresh}
        />
      ) : null}
      {tab === "upi" ? (
        <UpiDepositTab userId={userId} days={upiDays} onChanged={refresh} />
      ) : null}
      {tab === "pay" ? (
        <PaySupplierTab
          userId={userId}
          unpaid={unpaid}
          suppliers={suppliers}
          invoicesById={invoicesById}
          payments={supplierPayments}
          bankBalance={overview?.bankBalance || 0}
          cashOnHand={overview?.cashOnHand || 0}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}

function OverviewTab({ overview, ledger }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Bank balance" value={formatInr(overview.bankBalance)} />
        <KpiCard
          label="Cash on hand"
          value={formatInr(overview.cashOnHand ?? 0)}
          sub="Loan cash · pay suppliers"
        />
        <KpiCard
          label="Undeposited sales cash"
          value={formatInr(overview.undepositedCash)}
          sub={
            overview.undepositedDayCount
              ? `${overview.undepositedDayCount} day(s) · deposit only`
              : "All clear · deposit only"
          }
        />
        <KpiCard
          label="UPI to confirm"
          value={formatInr(overview.upiPendingTotal)}
          sub={
            overview.upiPendingDays
              ? `${overview.upiPendingDays} day(s)`
              : "All clear"
          }
        />
        <KpiCard
          label="Loans outstanding"
          value={formatInr(overview.loanOutstanding)}
        />
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-ink">Recent bank movements</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-silver">No bank entries yet.</p>
        ) : (
          <div className="space-y-2">
            {ledger.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 border-b border-ash py-2 text-sm last:border-0"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{ledgerLabel(r.entry_type)}</p>
                  <p className="text-xs text-fog">
                    {formatDateIST(r.entry_date + "T12:00:00")}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <p
                  className={`shrink-0 tabular-nums font-semibold ${
                    r.direction === "IN" ? "text-success" : "text-ink"
                  }`}
                >
                  {r.direction === "IN" ? "+" : "−"}
                  {formatInr(r.amount)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function LendersTab({ userId, lenders, onChanged }) {
  const [addOpen, setAddOpen] = useState(false);
  const [loanOpen, setLoanOpen] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [amount, setAmount] = useState("");
  const [entryType, setEntryType] = useState("RECEIVED");
  const [entryDate, setEntryDate] = useState(businessDateIST());
  const [loanNote, setLoanNote] = useState("");
  const [paymentMode, setPaymentMode] = useState("CASH");
  const [repayInfo, setRepayInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function openLoan(lender, type) {
    setLoanOpen(lender);
    setEntryType(type);
    setLoanNote("");
    setEntryDate(businessDateIST());
    setPaymentMode("CASH");
    setError("");
    setHistory(await listLoanEntries(lender.id));
    if (type === "REPAID") {
      const info = await getLenderRepayBreakdown(lender.id, businessDateIST());
      setRepayInfo(info);
      setAmount(info.total > 0 ? String(info.total) : "");
    } else {
      setRepayInfo(null);
      setAmount("");
    }
  }

  async function refreshRepayInfo(date) {
    if (!loanOpen || entryType !== "REPAID") return;
    const info = await getLenderRepayBreakdown(loanOpen.id, date);
    setRepayInfo(info);
    setAmount(info.total > 0 ? String(info.total) : "");
  }

  async function openHistory(lender) {
    setHistoryOpen(lender);
    setHistory(await listLoanEntries(lender.id));
  }

  async function saveLender(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      await createLender({
        name,
        phone,
        notes,
        interestRateMonthly: interestRate,
      });
      setAddOpen(false);
      setName("");
      setPhone("");
      setNotes("");
      setInterestRate("");
      onChanged();
    } catch (err) {
      setError(err.message || "Could not save lender.");
    } finally {
      setPending(false);
    }
  }

  async function saveLoan(e) {
    e.preventDefault();
    if (!loanOpen) return;
    setPending(true);
    setError("");
    try {
      await recordLoanEntry({
        lenderId: loanOpen.id,
        entryType,
        amount,
        entryDate,
        note: loanNote,
        userId,
        paymentMode,
      });
      setLoanOpen(null);
      onChanged();
    } catch (err) {
      setError(err.message || "Could not record loan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setAddOpen(true)}>
          Add lender
        </Button>
      </div>
      {lenders.length === 0 ? (
        <Card className="py-8 text-center text-sm text-silver">
          No lenders yet. Add someone who lent money to the business.
        </Card>
      ) : (
        <div className="space-y-2">
          {lenders.map((l) => (
            <Card
              key={l.id}
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-ink">{l.name}</p>
                <p className="text-xs text-fog">
                  {l.phone || "No phone"}
                  {toNum(l.interest_rate_monthly) > 0
                    ? ` · ${toNum(l.interest_rate_monthly)}%/mo`
                    : ""}{" "}
                  · Principal{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {formatInr(l.outstanding)}
                  </span>
                  {toNum(l.interestDue) > 0 ? (
                    <>
                      {" "}
                      · Interest due{" "}
                      <span className="font-semibold tabular-nums text-ink">
                        {formatInr(l.interestDue)}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs"
                  onClick={() => openHistory(l)}
                >
                  History
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs"
                  onClick={() => openLoan(l, "RECEIVED")}
                >
                  Loan received
                </Button>
                <Button
                  type="button"
                  className="text-xs"
                  disabled={
                    toNum(l.outstanding) <= 0 && toNum(l.interestDue) <= 0
                  }
                  onClick={() => openLoan(l, "REPAID")}
                >
                  Repay
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add lender">
        {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
        <form onSubmit={saveLender} className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>Interest % / month (optional)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
              placeholder="e.g. 2"
            />
            <p className="mt-1 text-xs text-fog">
              Simple interest from each loan date until you repay. Leave blank
              for no interest.
            </p>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save lender"}
          </Button>
        </form>
      </Modal>

      <Modal
        open={Boolean(historyOpen)}
        onClose={() => setHistoryOpen(null)}
        title={`Loan history — ${historyOpen?.name || ""}`}
      >
        <p className="mb-3 text-sm text-fog">
          Principal{" "}
          <span className="font-semibold tabular-nums text-ink">
            {formatInr(historyOpen?.outstanding)}
          </span>
          {toNum(historyOpen?.interestDue) > 0 ? (
            <>
              {" "}
              · Interest due{" "}
              <span className="font-semibold tabular-nums text-ink">
                {formatInr(historyOpen.interestDue)}
              </span>
            </>
          ) : null}
        </p>
        {history.length === 0 ? (
          <p className="py-6 text-center text-sm text-silver">
            No loan entries yet for this lender.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {history.map((h) => {
              const received = h.entry_type === "RECEIVED";
              const mode = h.payment_mode === "CASH" ? "Cash" : "Bank";
              const interestPart = toNum(h.interest_amount);
              const principalPart = round2Display(
                toNum(h.amount) - interestPart,
              );
              return (
                <div
                  key={h.id}
                  className="rounded-lg border border-ash bg-canvas px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {received ? "Loan received" : "Repaid"} · {mode}
                      </p>
                      <p className="mt-0.5 text-xs text-fog">
                        {formatDateIST(h.entry_date + "T12:00:00")}
                        {!received && interestPart > 0
                          ? ` · principal ${formatInr(principalPart)} + interest ${formatInr(interestPart)}`
                          : ""}
                        {h.note ? ` · ${h.note}` : ""}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        received ? "text-success" : "text-danger"
                      }`}
                    >
                      {received ? "+" : "−"}
                      {formatInr(h.amount)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(loanOpen)}
        onClose={() => setLoanOpen(null)}
        title={
          entryType === "RECEIVED"
            ? `Loan received — ${loanOpen?.name || ""}`
            : `Repay loan — ${loanOpen?.name || ""}`
        }
      >
        {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
        <form onSubmit={saveLoan} className="space-y-3">
          <div>
            <Label>Via</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {[
                { id: "CASH", label: "Cash" },
                { id: "BANK", label: "Bank" },
              ].map((opt) => (
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
            <p className="mt-1.5 text-xs text-fog">
              {paymentMode === "CASH"
                ? entryType === "RECEIVED"
                  ? "Adds to cash on hand (separate from sales till)."
                  : "Pays from cash on hand."
                : entryType === "RECEIVED"
                  ? "Adds to bank balance."
                  : "Deducts from bank balance."}
            </p>
          </div>
          {entryType === "REPAID" && repayInfo ? (
            <p className="rounded-lg border border-ash bg-canvas px-3 py-2 text-xs text-fog">
              Principal {formatInr(repayInfo.principal)} · Interest{" "}
              {formatInr(repayInfo.interest)}
              {repayInfo.rateMonthly > 0
                ? ` (${repayInfo.rateMonthly}%/mo)`
                : ""}{" "}
              · Total {formatInr(repayInfo.total)}. Payment goes to interest
              first, then principal.
            </p>
          ) : null}
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
            <Label>Date</Label>
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => {
                setEntryDate(e.target.value);
                refreshRepayInfo(e.target.value);
              }}
              required
            />
          </div>
          <div>
            <Label>Note</Label>
            <Input value={loanNote} onChange={(e) => setLoanNote(e.target.value)} />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending
              ? "Saving…"
              : entryType === "RECEIVED"
                ? "Record loan"
                : "Record repayment"}
          </Button>
        </form>
        {history.length ? (
          <div className="mt-4 border-t border-ash pt-3">
            <p className="mb-2 text-xs font-semibold uppercase text-silver">
              Recent history
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {history.map((h) => (
                <div key={h.id} className="flex justify-between gap-2 text-fog">
                  <span>
                    {formatDateIST(h.entry_date + "T12:00:00")} ·{" "}
                    {h.entry_type === "RECEIVED" ? "Received" : "Repaid"} ·{" "}
                    {h.payment_mode === "CASH" ? "Cash" : "Bank"}
                  </span>
                  <span className="tabular-nums text-ink">{formatInr(h.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function round2Display(n) {
  return Math.round((toNum(n) + Number.EPSILON) * 100) / 100;
}

function CashDepositTab({ userId, days, total, onChanged }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [depositedOn, setDepositedOn] = useState(businessDateIST());

  async function submit() {
    setPending(true);
    setError("");
    try {
      await confirmCashDeposit({
        depositedOn,
        note,
        userId,
      });
      setNote("");
      onChanged();
    } catch (err) {
      setError(err.message || "Could not deposit cash.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-fog">Expected cash to deposit</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
          {formatInr(total)}
        </p>
        <p className="mt-1 text-xs text-fog">
          Sales till cash only (bills − till expenses). Deposit to bank — not
          for suppliers or loan repay. Loan cash is separate (“Cash on hand”).
        </p>
      </Card>

      {days.length === 0 ? (
        <Card className="py-8 text-center text-sm text-silver">
          No undeposited cash.
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-3 font-semibold text-ink">Day breakdown</h2>
            <div className="space-y-2">
              {days.map((d) => (
                <div
                  key={d.business_date}
                  className="flex justify-between gap-3 border-b border-ash py-2 text-sm last:border-0"
                >
                  <div>
                    <p className="font-medium text-ink">{d.label}</p>
                    <p className="text-xs text-fog">
                      Sales {formatInr(d.cashSales)} − till expenses{" "}
                      {formatInr(d.cashExpenses)}
                      {d.deposited > 0
                        ? ` · deposited ${formatInr(d.deposited)}`
                        : ""}
                    </p>
                  </div>
                  <p className="tabular-nums font-semibold text-ink">
                    {formatInr(d.remaining)}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="space-y-3">
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div>
              <Label>Deposit date</Label>
              <Input
                type="date"
                value={depositedOn}
                onChange={(e) => setDepositedOn(e.target.value)}
              />
            </div>
            <div>
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button
              type="button"
              disabled={pending || total <= 0}
              className="w-full"
              onClick={submit}
            >
              {pending
                ? "Depositing…"
                : `Confirm deposit ${formatInr(total)} to bank`}
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}

function UpiDepositTab({ userId, days, onChanged }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(days[0]?.business_date || "");

  useEffect(() => {
    if (!selected && days[0]) setSelected(days[0].business_date);
  }, [days, selected]);

  const day = days.find((d) => d.business_date === selected);

  async function submit() {
    if (!selected) return;
    setPending(true);
    setError("");
    try {
      await confirmUpiDeposit({ businessDate: selected, userId });
      onChanged();
    } catch (err) {
      setError(err.message || "Could not confirm UPI deposit.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {days.length === 0 ? (
        <Card className="py-8 text-center text-sm text-silver">
          No unconfirmed UPI days.
        </Card>
      ) : (
        <Card className="space-y-3">
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div>
            <Label>Business day</Label>
            <select
              className="mt-1 w-full rounded-lg border border-ash bg-paper px-3 py-2.5 text-sm text-ink"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {days.map((d) => (
                <option key={d.business_date} value={d.business_date}>
                  {d.label} — {formatInr(d.remaining)}
                </option>
              ))}
            </select>
          </div>
          {day ? (
            <div className="rounded-lg border border-ash bg-paper/60 px-3 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-fog">UPI sales</span>
                <span className="tabular-nums">{formatInr(day.upiSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fog">UPI expenses</span>
                <span className="tabular-nums">−{formatInr(day.upiExpenses)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-ash pt-2 font-semibold">
                <span>Expected UPI to bank</span>
                <span className="tabular-nums">{formatInr(day.remaining)}</span>
              </div>
            </div>
          ) : null}
          <Button
            type="button"
            disabled={pending || !day}
            className="w-full"
            onClick={submit}
          >
            {pending
              ? "Confirming…"
              : `Confirm UPI deposit ${formatInr(day?.remaining || 0)}`}
          </Button>
        </Card>
      )}
    </div>
  );
}

function PaySupplierTab({
  userId,
  unpaid,
  suppliers,
  invoicesById,
  payments,
  bankBalance,
  cashOnHand,
  onChanged,
}) {
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(businessDateIST());
  const [note, setNote] = useState("");
  const [paymentMode, setPaymentMode] = useState("BANK");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const inv = unpaid.find((i) => i.id === invoiceId);
  const payable = inv ? purchasePayableTotal(inv) : 0;
  const remaining = inv ? roundRemaining(payable, inv.amount_paid) : 0;

  useEffect(() => {
    if (!inv) return;
    setAmount(String(remaining));
    setEntryDate(toDateInputValue(inv.invoice_date) || businessDateIST());
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      await payPurchaseInvoice({
        purchaseInvoiceId: invoiceId,
        amount,
        entryDate,
        note,
        userId,
        paymentMode,
      });
      setInvoiceId("");
      setAmount("");
      setEntryDate(businessDateIST());
      setNote("");
      setPaymentMode("BANK");
      onChanged();
    } catch (err) {
      setError(err.message || "Payment failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-fog">Bank balance</p>
          <p className="text-xl font-bold tabular-nums text-ink">
            {formatInr(bankBalance)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-fog">Cash on hand</p>
          <p className="text-xl font-bold tabular-nums text-ink">
            {formatInr(cashOnHand)}
          </p>
          <p className="mt-1 text-xs text-fog">From cash loans — for paying</p>
        </Card>
      </div>
      <p className="text-xs text-fog">
        Undeposited sales cash is separate (Cash deposit only). Or open{" "}
        <Link className="text-action underline" to="/purchases">
          Purchases
        </Link>{" "}
        for invoice status.
      </p>

      {unpaid.length === 0 ? (
        <Card className="py-8 text-center text-sm text-silver">
          No unpaid purchase invoices.
        </Card>
      ) : (
        <Card>
          {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Purchase invoice</Label>
              <select
                className="mt-1 w-full rounded-lg border border-ash bg-paper px-3 py-2.5 text-sm text-ink"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                required
              >
                <option value="">Select invoice…</option>
                {unpaid.map((i) => {
                  const sup = suppliers.get(i.supplier_id);
                  const rem = roundRemaining(
                    purchasePayableTotal(i),
                    i.amount_paid,
                  );
                  return (
                    <option key={i.id} value={i.id}>
                      {i.invoice_number} · {sup?.name || "Supplier"} · due{" "}
                      {formatInr(rem)}
                    </option>
                  );
                })}
              </select>
            </div>
            {inv ? (
              <p className="text-xs text-fog">
                Invoice {formatInr(payable)}
                {toNum(inv.printed_grand_total) > 0 ? " (printed)" : ""} · Paid{" "}
                {formatInr(inv.amount_paid)} · Remaining {formatInr(remaining)}.
                Amount and date default from the invoice — edit to override.
              </p>
            ) : null}
            <div>
              <Label>Pay from</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {[
                  { id: "CASH", label: "Cash" },
                  { id: "BANK", label: "Bank" },
                ].map((opt) => (
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
            <p className="mt-1.5 text-xs text-fog">
              {paymentMode === "CASH"
                ? "Uses cash on hand (loan cash) — not sales till cash."
                : "Deducts from bank balance."}
            </p>
            </div>
            <div>
              <Label>Pay amount (₹)</Label>
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
              <Label>Payment date</Label>
              <Input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="submit" disabled={pending || !invoiceId} className="w-full">
              {pending
                ? "Paying…"
                : paymentMode === "CASH"
                  ? "Pay from cash"
                  : "Pay from bank"}
            </Button>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-semibold text-ink">Payment history</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-silver">No supplier payments yet.</p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {payments.map((p) => {
              const invRow = invoicesById.get(p.purchase_invoice_id);
              const sup = suppliers.get(p.supplier_id);
              const mode = p.payment_mode === "CASH" ? "Cash" : "Bank";
              const payable = invRow ? purchasePayableTotal(invRow) : 0;
              const paid = toNum(invRow?.amount_paid);
              const rem = invRow
                ? Math.max(
                    0,
                    Math.round((payable - paid + Number.EPSILON) * 100) / 100,
                  )
                : null;
              return (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-3 border-b border-ash py-2 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {invRow?.invoice_number || "Invoice"} · {mode}
                    </p>
                    <p className="text-xs text-fog">
                      {formatDateIST(p.entry_date + "T12:00:00")}
                      {sup ? ` · ${sup.name}` : ""}
                      {invRow
                        ? ` · paid ${formatInr(paid)} of ${formatInr(payable)}`
                        : ""}
                      {rem != null && rem > 0.009
                        ? ` · remaining ${formatInr(rem)}`
                        : rem != null
                          ? " · fully paid"
                          : ""}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums text-ink">
                    −{formatInr(p.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function roundRemaining(total, paid) {
  return Math.round((toNum(total) - toNum(paid) + Number.EPSILON) * 100) / 100;
}

function toDateInputValue(dateStr) {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
