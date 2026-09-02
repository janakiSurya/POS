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
  const isPos = location.pathname.startsWith("/pos");

  return (
    <div className="flex min-h-full flex-col bg-paper">
      <header className="no-print sticky top-0 z-30 border-b border-ash bg-canvas">
        <div
          className={`mx-auto flex items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3 ${
            isPos ? "max-w-none" : "max-w-7xl"
          }`}
        >
          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            <img src="/logo.png" alt="" className="h-7 w-7 shrink-0 object-contain sm:h-8 sm:w-8" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ink sm:text-sm">
                {isPos
                  ? "Sathya Sai POS"
                  : shopName || "Sri Sri Sathya Sai Automobiles"}
              </p>
              <p className="hidden text-xs text-fog sm:block">
                {sessionOpen ? "Shift open" : "Shift closed"}
                {!online ? " · Offline" : ""}
              </p>
            </div>
          </div>
          <nav
            className={`hidden flex-1 items-center gap-1 md:flex ${
              isOwner ? "justify-start" : "justify-center"
            }`}
          >
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  location.pathname.startsWith(l.to)
                    ? "bg-[#dbeaff] text-ink"
                    : "text-fog hover:bg-paper hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {isPos && !isOwner ? (
              <Link
                to="/sales"
                className="rounded-lg px-2 py-1.5 text-xs font-medium text-fog hover:bg-paper hover:text-ink md:hidden"
              >
                Bills
              </Link>
            ) : null}
            {sessionOpen ? (
              <>
                <Button
                  variant="ghost"
                  className="hidden px-2 text-xs sm:inline-flex"
                  onClick={onExpense}
                >
                  Expense
                </Button>
                <Button
                  variant="secondary"
                  className="px-2 text-[11px] sm:px-3 sm:text-xs"
                  onClick={onCloseShift}
                >
                  <span className="hidden sm:inline">Close shift</span>
                  <span className="sm:hidden">Close</span>
                </Button>
              </>
            ) : null}
            <Button variant="ghost" className="px-2 text-xs" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
        {!isPos || isOwner ? (
        <nav className="flex gap-1 overflow-x-auto border-t border-ash px-2 py-1 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`shrink-0 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors active:scale-[0.98] ${
                location.pathname.startsWith(l.to)
                  ? "bg-[#dbeaff] text-ink"
                  : "text-fog hover:bg-paper hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        ) : null}
      </header>
      <main
        className={`no-print mx-auto w-full flex-1 ${
          location.pathname.startsWith("/pos")
            ? "max-w-none px-0 py-0"
            : "max-w-7xl px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-6"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
