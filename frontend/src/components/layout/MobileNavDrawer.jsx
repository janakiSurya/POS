import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/Button";

function MenuIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MobileMenuButton({ open, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink transition-colors hover:bg-paper active:scale-[0.98] ${className || ""}`}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
    >
      {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
    </button>
  );
}

export function MobileNavDrawer({
  open,
  onClose,
  links,
  pathname,
  shopName,
  sessionOpen,
  online,
  onExpense,
  onCloseShift,
  onSignOut,
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-ink-strong/25 backdrop-blur-[1px] transition-opacity md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,88vw)] flex-col border-r border-ash bg-canvas shadow-lg transition-transform duration-200 ease-out md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center gap-3 border-b border-ash px-4 py-4">
          <img src="/logo.png" alt="" className="h-9 w-9 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {shopName || "Sri Sri Sathya Sai Automobiles"}
            </p>
            <p className="text-xs text-fog">
              {sessionOpen ? "Shift open" : "Shift closed"}
              {!online ? " · Offline" : ""}
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-fog">
            Navigation
          </p>
          <ul className="space-y-0.5">
            {links.map((l) => {
              const active = pathname.startsWith(l.to);
              return (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    onClick={onClose}
                    className={`flex items-center rounded-lg px-3 py-3 text-sm font-medium transition-colors active:scale-[0.99] ${
                      active
                        ? "bg-[#dbeaff] text-ink"
                        : "text-fog hover:bg-paper hover:text-ink"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="space-y-2 border-t border-ash p-3">
          {sessionOpen ? (
            <>
              <Button
                variant="ghost"
                className="w-full justify-start px-3"
                onClick={() => {
                  onClose();
                  onExpense?.();
                }}
              >
                Add expense
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start px-3"
                onClick={() => {
                  onClose();
                  onCloseShift?.();
                }}
              >
                Close shift
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            className="w-full justify-start px-3 text-fog"
            onClick={() => {
              onClose();
              onSignOut?.();
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>
    </>
  );
}
