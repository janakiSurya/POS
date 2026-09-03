import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { localDb } from "../../db/localDb";
import { syncExpensesIfNeeded, syncFixedCostsIfNeeded } from "../../lib/hybridSync";
import {
  EXPENSE_CATEGORIES,
  categoryLabel,
  currentMonthKey,
  deleteFixedCostLog,
  deleteTemplate,
  getFixedCostLogsForMonth,
  getTemplates,
  logFixedCost,
  saveTemplate,
} from "../../lib/expenses";
import { FreshKeys, invalidateFresh } from "../../lib/freshSync";
import { formatInr, toNum } from "../../lib/format";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Card } from "../ui/Card";
import { Modal } from "../ui/Modal";
import { PageHeader } from "../shared/PageHeader";

const MONTH_LABEL = (() => {
  const now = new Date();
  return now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "long",
    year: "numeric",
  });
})();

function emptyTemplate() {
  return { name: "", category: "MISC", amount: "", dayOfMonth: "1" };
}

function isoToDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  });
}

// ─── Daily tab ────────────────────────────────────────────────────────────────
function DailyExpensesTab({ userId }) {
  const [expenses, setExpenses] = useState([]);
  const [catFilter, setCatFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      await syncExpensesIfNeeded(force);
      const all = await localDb.cash_expenses.toArray();
      // Filter to current month (IST)
      const month = currentMonthKey();
      const filtered = all.filter((e) => {
        const d = e.created_at?.slice(0, 7);
        return d === month;
      });
      // Sort newest first
      filtered.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
      setExpenses(filtered);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const shown = catFilter === "ALL"
    ? expenses
    : expenses.filter((e) => (e.category || "MISC") === catFilter);

  const total = shown.reduce((s, e) => s + toNum(e.amount), 0);

  // Group by date label
  const groups = {};
  for (const e of shown) {
    const d = isoToDate(e.created_at) || "Unknown";
    (groups[d] = groups[d] || []).push(e);
  }
  const dateKeys = Object.keys(groups);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {[{ value: "ALL", label: "All" }, ...EXPENSE_CATEGORIES].map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCatFilter(c.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              catFilter === c.value
                ? "bg-action text-canvas"
                : "border border-ash bg-canvas text-fog hover:bg-paper hover:text-ink"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-ash bg-canvas px-4 py-3">
        <span className="text-sm text-fog">Total — {MONTH_LABEL}</span>
        <span className="text-lg font-bold tabular-nums text-ink">{formatInr(total)}</span>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-fog">Loading…</p>
      ) : dateKeys.length === 0 ? (
        <Card className="py-8 text-center text-sm text-silver">
          No daily expenses recorded this month.
        </Card>
      ) : (
        <div className="space-y-4">
          {dateKeys.map((date) => (
            <div key={date}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-silver">{date}</p>
              <div className="space-y-1">
                {groups[date].map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between rounded-lg border border-ash bg-canvas px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <span className="rounded bg-paper px-1.5 py-0.5 text-[10px] font-medium uppercase text-fog">
                        {categoryLabel(e.category || "MISC")}
                      </span>
                      {e.note ? (
                        <p className="mt-0.5 truncate text-xs text-fog">{e.note}</p>
                      ) : null}
                    </div>
                    <p className="ml-3 shrink-0 font-semibold tabular-nums text-ink">
                      {formatInr(e.amount)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Monthly fixed tab ────────────────────────────────────────────────────────
function MonthlyFixedTab({ userId }) {
  const [templates, setTemplates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [form, setForm] = useState(emptyTemplate());
  const [editId, setEditId] = useState(null);
  const [logModal, setLogModal] = useState(null); // template to log
  const [logAmount, setLogAmount] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logDate, setLogDate] = useState("");
  const [error, setError] = useState("");
  const [logError, setLogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [logging, setLogging] = useState(false);
  const month = currentMonthKey();

  const load = useCallback(async (force = false) => {
    await syncFixedCostsIfNeeded(force);
    const [ts, ls] = await Promise.all([
      getTemplates(),
      getFixedCostLogsForMonth(month),
    ]);
    setTemplates(ts);
    setLogs(ls);
  }, [month]);

  useEffect(() => { load(false); }, [load]);

  async function submitTemplate(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await saveTemplate({ id: editId ?? undefined, userId, ...form });
      await invalidateFresh(FreshKeys.FIXED_COSTS, FreshKeys.DASHBOARD);
      setForm(emptyTemplate());
      setEditId(null);
      await load(true);
    } catch (err) {
      setError(err.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Remove this recurring expense?")) return;
    await deleteTemplate(id);
    await invalidateFresh(FreshKeys.FIXED_COSTS, FreshKeys.DASHBOARD);
    await load(true);
  }

  function startEdit(t) {
    setEditId(t.id);
    setForm({
      name: t.name,
      category: t.category,
      amount: String(t.amount),
      dayOfMonth: String(t.day_of_month || 1),
    });
    setError("");
  }

  function openLogModal(t) {
    setLogModal(t);
    setLogAmount(String(t.amount));
    setLogNote("");
    setLogDate("");
    setLogError("");
  }

  async function submitLog(e) {
    e.preventDefault();
    setLogError("");
    setLogging(true);
    try {
      await logFixedCost({
        templateId: logModal.id,
        userId,
        month,
        name: logModal.name,
        category: logModal.category,
        amount: logAmount,
        note: logNote,
        paidDate: logDate || null,
      });
      setLogModal(null);
      await invalidateFresh(FreshKeys.FIXED_COSTS, FreshKeys.DASHBOARD, FreshKeys.EXPENSES);
      await load(true);
    } catch (err) {
      setLogError(err.message || "Could not log.");
    } finally {
      setLogging(false);
    }
  }

  async function removeLog(id) {
    await deleteFixedCostLog(id);
    await invalidateFresh(FreshKeys.FIXED_COSTS, FreshKeys.DASHBOARD, FreshKeys.EXPENSES);
    await load(true);
  }

  const loggedTemplateIds = new Set(logs.map((l) => l.template_id));
  const totalLogged = logs.reduce((s, l) => s + toNum(l.amount), 0);

  return (
    <div className="space-y-6">
      {/* This month summary */}
      <div className="flex items-center justify-between rounded-xl border border-ash bg-canvas px-4 py-3">
        <span className="text-sm text-fog">Fixed costs logged — {MONTH_LABEL}</span>
        <span className="text-lg font-bold tabular-nums text-ink">{formatInr(totalLogged)}</span>
      </div>

      {/* Template list */}
      <Card>
        <h3 className="mb-3 font-semibold text-ink">Recurring templates</h3>
        {templates.length === 0 ? (
          <p className="text-sm text-silver">No templates yet. Add one below.</p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => {
              const logged = loggedTemplateIds.has(t.id);
              const log = logs.find((l) => l.template_id === t.id);
              return (
                <div
                  key={t.id}
                  className="flex flex-col gap-2 rounded-lg border border-ash px-3 py-2.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink">{t.name}</p>
                      <span className="rounded bg-paper px-1.5 py-0.5 text-[10px] uppercase text-fog">
                        {categoryLabel(t.category)}
                      </span>
                      {logged ? (
                        <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                          Paid {MONTH_LABEL}
                        </span>
                      ) : (
                        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          Pending
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-fog">
                      {formatInr(t.amount)} · Due day {t.day_of_month || 1}
                      {log ? ` · Paid ${formatInr(log.amount)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {!logged ? (
                      <Button
                        variant="secondary"
                        className="px-2.5 text-xs"
                        onClick={() => openLogModal(t)}
                      >
                        Mark paid
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="px-2.5 text-xs text-danger"
                        onClick={() => log && removeLog(log.id)}
                      >
                        Undo
                      </Button>
                    )}
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-xs text-fog hover:bg-paper hover:text-ink"
                      onClick={() => startEdit(t)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-danger hover:bg-danger/5"
                      onClick={() => handleDelete(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Logged this month (non-template entries) */}
      {logs.filter((l) => !l.template_id).length > 0 ? (
        <Card>
          <h3 className="mb-3 font-semibold text-ink">Other fixed costs this month</h3>
          <div className="space-y-2">
            {logs.filter((l) => !l.template_id).map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg border border-ash px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-ink">{l.name}</p>
                  <p className="text-xs text-fog">{categoryLabel(l.category)}{l.note ? ` · ${l.note}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold tabular-nums text-ink">{formatInr(l.amount)}</p>
                  <button type="button" onClick={() => removeLog(l.id)} className="text-danger hover:opacity-70">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Add / edit template form */}
      <Card>
        <h3 className="mb-3 font-semibold text-ink">
          {editId ? "Edit template" : "Add recurring expense"}
        </h3>
        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        <form onSubmit={submitTemplate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Label>Name</Label>
            <Input
              placeholder="e.g. Staff Salary, Shop Rent"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Category</Label>
            <select
              className="w-full rounded-lg border border-ash bg-paper px-3 py-2.5 text-sm text-ink focus:border-electric focus:outline-none"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Typical amount (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Day of month due</Label>
            <Input
              type="number"
              min="1"
              max="31"
              value={form.dayOfMonth}
              onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? "Saving…" : editId ? "Update template" : "Add template"}
            </Button>
            {editId ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setEditId(null); setForm(emptyTemplate()); setError(""); }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {/* Mark paid modal */}
      <Modal
        open={Boolean(logModal)}
        onClose={() => setLogModal(null)}
        title={`Mark paid — ${logModal?.name ?? ""}`}
      >
        {logError ? <p className="mb-3 text-sm text-danger">{logError}</p> : null}
        <form onSubmit={submitLog} className="space-y-4">
          <div>
            <Label>Amount paid (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={logAmount}
              onChange={(e) => setLogAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Date paid</Label>
            <Input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Input
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
              placeholder="e.g. August salary"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setLogModal(null)}>Cancel</Button>
            <Button type="submit" disabled={logging}>
              {logging ? "Saving…" : "Confirm payment"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function ExpensesPage({ userId }) {
  const [tab, setTab] = useState("daily");

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Expenses"
        description="Track daily cash outflows and log monthly fixed costs like salary, rent, and bills."
      />

      <div className="flex gap-1 rounded-xl border border-ash bg-canvas p-1">
        {[
          { id: "daily", label: "Daily expenses" },
          { id: "fixed", label: "Monthly fixed" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-action text-canvas shadow-sm"
                : "text-fog hover:bg-paper hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "daily" ? (
        <DailyExpensesTab userId={userId} />
      ) : (
        <MonthlyFixedTab userId={userId} />
      )}
    </div>
  );
}
