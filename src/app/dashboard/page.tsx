"use client";

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import Admin from "@/components/Admin";
import Browse from "@/components/Browse";
import Listings from "@/components/Listings";
import { IncomingRequests, MyRequests } from "@/components/Loans";
import { Badge } from "@/components/shared";

const TABS = [
  { id: "browse", label: "Browse tools" },
  { id: "listings", label: "My listings" },
  { id: "requests", label: "My requests" },
  { id: "incoming", label: "Incoming requests" },
] as const;
type TabId = (typeof TABS)[number]["id"] | "admin";

/** Creates/refreshes the viewer's Convex user row once Clerk auth reaches Convex. */
function useStoreUser() {
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    store()
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setReady(false));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, store]);
  return ready;
}

export default function Dashboard() {
  const ready = useStoreUser();
  const me = useQuery(api.users.me, ready ? {} : "skip");
  const [tab, setTab] = useState<TabId>("browse");
  const incoming = useQuery(api.loans.incoming, ready ? {} : "skip");
  const pendingIncoming = incoming?.filter((l) => l.status === "pending").length ?? 0;

  const tabs = me?.role === "admin" ? [...TABS, { id: "admin" as const, label: "Admin" }] : TABS;

  return (
    <main className="page">
      <header className="topbar">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          LendLoop
        </Link>
        <div className="row">
          {me && (
            <span className="muted small">
              Hi {me.name}
              {me.role === "admin" && <> · <Badge kind="trusted">admin</Badge></>}
              {me.trustedLender && <> · <Badge kind="trusted">Trusted Lender</Badge></>}
            </span>
          )}
          <UserButton />
        </div>
      </header>

      {!me ? (
        <p className="muted">Loading your account…</p>
      ) : (
        <>
          <nav className="tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                className="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === "incoming" && pendingIncoming > 0 ? ` (${pendingIncoming})` : ""}
              </button>
            ))}
          </nav>
          {tab === "browse" && <Browse />}
          {tab === "listings" && <Listings />}
          {tab === "requests" && <MyRequests />}
          {tab === "incoming" && <IncomingRequests />}
          {tab === "admin" && me.role === "admin" && <Admin />}
        </>
      )}
    </main>
  );
}
