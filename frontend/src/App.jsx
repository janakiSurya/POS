import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { useSync } from "./hooks/useSync";
import { LoginForm } from "./components/auth/LoginForm";
import { AppShell } from "./components/layout/AppShell";
import { OpenShiftModal } from "./components/register/OpenShiftModal";
import { CloseShiftModal } from "./components/register/CloseShiftModal";
import { ExpenseModal } from "./components/register/ExpenseModal";
import { POSBilling } from "./components/billing/POSBilling";
import { SalesHistory } from "./components/billing/SalesHistory";
import { Dashboard } from "./components/dashboard/Dashboard";
import { SalesReports } from "./components/reports/SalesReports";
import { InventoryList } from "./components/inventory/InventoryList";
import { PurchaseEntry } from "./components/inventory/PurchaseEntry";
import { ExcelImport } from "./components/inventory/ExcelImport";
import { getTodayOpenSession } from "./lib/register";
import { DEMO_PROFILE, seedDemoData } from "./lib/demo";
import { flushOfflineQueue } from "./lib/offlineFlush";
import { isOnline } from "./lib/network";
import { localDb } from "./db/localDb";

function ProtectedApp({ profile, isOwner, signOut }) {
  const [session, setSession] = useState(null);
  const [needOpen, setNeedOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [shopName, setShopName] = useState("");

  const { online } = useSync(Boolean(profile));

  const refreshSession = useCallback(async () => {
    try {
      const s = await getTodayOpenSession();
      setSession(s);
      setNeedOpen(!s);
    } finally {
      setSessionReady(true);
    }
  }, []);

  useEffect(() => {
    seedDemoData();
    refreshSession();
    localDb.shop_settings.get("default").then((s) => setShopName(s?.name));
    flushOfflineQueue();
    const t = setInterval(() => {
      if (isOnline()) flushOfflineQueue();
    }, 30000);
    return () => clearInterval(t);
  }, [refreshSession]);

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center text-fog">
        Loading…
      </div>
    );
  }

  if (needOpen && !session) {
    return (
      <OpenShiftModal open userId={profile.id} onDone={() => refreshSession()} />
    );
  }

  return (
    <>
      <AppShell
        isOwner={isOwner}
        shopName={shopName}
        sessionOpen={session?.status === "OPEN"}
        online={online}
        onSignOut={signOut}
        onCloseShift={() => setCloseOpen(true)}
        onExpense={() => setExpenseOpen(true)}
      >
        <Routes>
          <Route
            path="/"
            element={<Navigate to={isOwner ? "/dashboard" : "/pos"} replace />}
          />
          <Route path="/sales" element={<SalesHistory />} />
          <Route
            path="/pos"
            element={
              session?.status === "OPEN" ? (
                <POSBilling session={session} profile={profile} isOwner={isOwner} />
              ) : needOpen ? (
                <Navigate to="/" replace />
              ) : (
                <div className="p-6 text-center text-fog">
                  Shift is closed for today. Open a new shift to bill.
                </div>
              )
            }
          />
          {isOwner ? (
            <>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/reports" element={<SalesReports />} />
              <Route
                path="/analytics"
                element={<Navigate to="/reports" replace />}
              />
              <Route path="/inventory" element={<InventoryList />} />
              <Route
                path="/purchases"
                element={<PurchaseEntry profile={profile} isOwner />}
              />
              <Route
                path="/import"
                element={<ExcelImport profile={profile} isOwner />}
              />
            </>
          ) : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
      <CloseShiftModal
        open={closeOpen}
        session={session}
        userId={profile.id}
        onClose={() => setCloseOpen(false)}
        onDone={() => {
          setCloseOpen(false);
          refreshSession();
        }}
      />
      <ExpenseModal
        open={expenseOpen}
        sessionId={session?.id}
        userId={profile.id}
        onClose={() => setExpenseOpen(false)}
      />
    </>
  );
}

export default function App() {
  const { user, profile, loading, signOut } = useAuth();
  const [demoProfile, setDemoProfile] = useState(null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-fog">
        Loading…
      </div>
    );
  }

  const activeProfile = profile || demoProfile;
  if (!user && !demoProfile) {
    return <LoginForm onDemo={() => setDemoProfile(DEMO_PROFILE)} />;
  }

  if (!activeProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center text-fog">
        Signing in…
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ProtectedApp
        profile={activeProfile}
        isOwner={activeProfile?.role === "owner"}
        signOut={async () => {
          if (demoProfile) setDemoProfile(null);
          else await signOut();
        }}
      />
    </BrowserRouter>
  );
}
