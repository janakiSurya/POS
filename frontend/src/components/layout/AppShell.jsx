import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "../ui/Button";
import { MobileMenuButton, MobileNavDrawer } from "./MobileNavDrawer";

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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const title = isPos
    ? "Sathya Sai POS"
    : shopName || "Sri Sri Sathya Sai Automobiles";

  return (
    <div className="flex min-h-full flex-col bg-paper">
      <MobileNavDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        links={links}
        pathname={location.pathname}
        shopName={shopName}
        sessionOpen={sessionOpen}
        online={online}
        onExpense={onExpense}
        onCloseShift={onCloseShift}
        onSignOut={onSignOut}
      />

      <header className="no-print sticky top-0 z-30 border-b border-ash bg-canvas">
        <div
          className={`mx-auto flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 ${
            isPos ? "max-w-none" : "max-w-7xl"
          }`}
        >
          <MobileMenuButton
            open={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="-ml-1 md:hidden"
          />

          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 md:flex-none">
            <img
              src="/logo.png"
              alt=""
              className="hidden h-8 w-8 shrink-0 object-contain sm:block"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{title}</p>
              <p className="text-xs text-fog md:hidden">
                {sessionOpen ? "Shift open" : "Shift closed"}
                {!online ? " · Offline" : ""}
              </p>
              <p className="hidden text-xs text-fog md:block">
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

          <div className="ml-auto hidden shrink-0 items-center gap-1 sm:gap-2 md:flex">
            {sessionOpen ? (
              <>
                <Button variant="ghost" className="px-2 text-xs" onClick={onExpense}>
                  Expense
                </Button>
                <Button variant="secondary" className="px-3 text-xs" onClick={onCloseShift}>
                  Close shift
                </Button>
              </>
            ) : null}
            <Button variant="ghost" className="px-2 text-xs" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
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
