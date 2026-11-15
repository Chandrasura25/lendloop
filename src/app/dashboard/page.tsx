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
import Logo from "@/components/Logo";
import { Badge } from "@/components/shared";

const TABS = [
  { id: "browse", label: "Browse tools", icon: "🔎" },
  { id: "listings", label: "My listings", icon: "📦" },
  { id: "requests", label: "My requests", icon: "📅" },
  { id: "incoming", label: "Incoming requests", icon: "📥" },
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

  const tabs = me?.role === "admin" ? [...TABS, { id: "admin" as const, label: "Admin", icon: "🛡️" }] : TABS;

  return (
    <>
      <header className="site-header">
        <div className="site-header-in">
          <Link href="/" style={{ textDecoration: "none" }}>
            <Logo />
          </Link>
          <div className="row" style={{ gap: "0.75rem" }}>
            {me && (
              <span className="user-pill">
                <span className="avatar">{me.name.slice(0, 1).toUpperCase()}</span>
                <span className="user-name">{me.name}</span>
                {me.role === "admin" && <Badge kind="trusted">admin</Badge>}
                {me.trustedLender && <Badge kind="trusted">Trusted</Badge>}
              </span>
            )}
            <UserButton />
          </div>
        </div>
      </header>

    <main className="page">
      <section className="dash-hero">
        <div>
          <h1 className="dash-title">{me ? `Welcome back, ${me.name}` : "Your dashboard"}</h1>
          <p className="muted">Browse what neighbors are lending, manage your listings, and track every request.</p>
        </div>
        {me && pendingIncoming > 0 && (
          <button className="alert-chip" onClick={() => setTab("incoming")}>
            📥 {pendingIncoming} request{pendingIncoming === 1 ? "" : "s"} waiting for you
          </button>
        )}
      </section>

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
                <span aria-hidden="true">{t.icon}</span> {t.label}
                {t.id === "incoming" && pendingIncoming > 0 ? <span className="count">{pendingIncoming}</span> : null}
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
    </>
  );
}
