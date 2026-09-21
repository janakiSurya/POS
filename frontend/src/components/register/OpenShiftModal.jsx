import { useState } from "react";
import { Button } from "../ui/Button";
import { openShift } from "../../lib/register";

export function OpenShiftModal({
  open,
  userId,
  onDone,
  onSignOut,
  shopName,
  profileName,
  embedded = false,
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) return null;

  const name = shopName || "Sri Sri Sathya Sai Automobiles";
  const greeting = profileName ? `Welcome, ${profileName}` : "Welcome";

  async function submit(e) {
    e?.preventDefault?.();
    setError("");
    setPending(true);
    try {
      await openShift({ userId });
      onDone();
    } catch (err) {
      setError(err.message || "Could not open session.");
    } finally {
      setPending(false);
    }
  }

  const formCard = (
    <div className="w-full max-w-md rounded-xl border border-ash bg-canvas p-6 shadow-sm">
      <div className="mb-6 text-center">
        <img
          src="/logo.png"
          alt=""
          className="mx-auto mb-3 h-16 w-16 object-contain sm:h-20 sm:w-20"
        />
        <p className="text-sm text-fog">{greeting}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
          Open today&apos;s session
        </h1>
        <p className="mt-2 text-sm text-fog">
          One session per day. If you ended early, this continues the same day
          session — no opening cash or UPI to enter.
        </p>
      </div>

      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <Button
        type="button"
        disabled={pending}
        className="w-full"
        onClick={submit}
      >
        {pending ? "Opening…" : "Open session"}
      </Button>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
        {formCard}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-paper">
      <header className="flex items-center justify-between gap-3 border-b border-ash bg-canvas px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/logo.png" alt="" className="h-9 w-9 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="text-xs text-fog">POS counter</p>
          </div>
        </div>
        {onSignOut ? (
          <Button variant="ghost" className="shrink-0 px-3 text-xs" onClick={onSignOut}>
            Sign out
          </Button>
        ) : null}
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        {formCard}
      </div>
    </div>
  );
}
