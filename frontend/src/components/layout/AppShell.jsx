import { Link, useLocation } from "react-router-dom";
import { Button } from "../ui/Button";

const staffLinks = [
  { to: "/pos", label: "POS" },
  { to: "/sales", label: "Bills" },
];

const ownerLinks = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/reports", label: "Reports" },
  { to: "/inventory", label: "Inventory" },
  { to: "/purchases", label: "Purchases" },
  { to: "/import", label: "Excel import" },
  { to: "/pos", label: "POS" },
  { to: "/sales", label: "Bills" },
];

export function AppShell({
  isOwner,
  shopName,
  onSignOut,
  onCloseShift,
  onExpense,
  sessionOpen,
  online = true,
  children,
}) {
  const location = useLocation();
  const links = isOwner ? ownerLinks : staffLinks;

  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-charcoal-3 bg-charcoal">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.png" alt="" className="h-8 w-8 object-contain shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {shopName || "Sri Sri Sathya Sai Automobiles"}
              </p>
              <p className="text-xs text-white-muted">
                {sessionOpen ? "Shift open" : "Shift closed"}
                {!online ? " · Offline" : ""}
              </p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={`rounded-lg px-3 py-2 text-sm ${
                  location.pathname.startsWith(l.to)
                    ? "bg-charcoal-2 text-white"
                    : "text-white-muted hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {sessionOpen ? (
              <>
                <Button variant="ghost" className="text-xs" onClick={onExpense}>
                  Expense
                </Button>
                <Button variant="secondary" className="text-xs" onClick={onCloseShift}>
                  Close shift
                </Button>
              </>
            ) : null}
            <Button variant="ghost" className="text-xs" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
        <nav className="flex md:hidden border-t border-charcoal-3 overflow-x-auto">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`px-4 py-2 text-xs whitespace-nowrap ${
                location.pathname.startsWith(l.to) ? "text-white" : "text-white-muted"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="no-print flex-1">{children}</main>
    </div>
  );
}
