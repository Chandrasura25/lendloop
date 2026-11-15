"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import Logo from "@/components/Logo";
import { categoryIcon } from "@/components/shared";

const STEPS = [
  { icon: "📦", title: "List a tool", text: "Add the drill, ladder or tent you rarely use. Takes a minute." },
  { icon: "📅", title: "Request dates", text: "Neighbors ask to borrow it for a date range, up to 30 days." },
  { icon: "✅", title: "Approve and track", text: "Approve, hand it over, mark it returned. Reminders go out if it runs late." },
];

function SignIn({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <SignInButton mode="modal" forceRedirectUrl="/dashboard">
      <button className={className}>{children}</button>
    </SignInButton>
  );
}

export default function Home() {
  const tools = useQuery(api.tools.listPublic);

  return (
    <>
      <header className="site-header">
        <div className="site-header-in">
          <Logo />
          <nav className="row">
            <a className="nav-link" href="#how">How it works</a>
            <a className="nav-link" href="#available">Available</a>
            <Show when="signed-out">
              <SignIn className="btn primary sm">Sign in</SignIn>
            </Show>
            <Show when="signed-in">
              <Link className="btn primary sm" href="/dashboard">Open dashboard</Link>
              <UserButton />
            </Show>
          </nav>
        </div>
      </header>

      <main className="page">
        <section className="hero2">
          <div>
            <span className="eyebrow">Neighborhood tool sharing</span>
            <h1>
              Borrow what you need. <span>Lend what you don&apos;t.</span>
            </h1>
            <p className="lead">
              Stop buying a drill you&apos;ll use twice. List what&apos;s gathering dust, borrow what you
              need for the weekend, and let LendLoop handle approvals and reminders.
            </p>
            <div className="row" style={{ gap: "0.75rem" }}>
              <Show when="signed-out">
                <SignIn className="btn primary lg">Sign in to lend or borrow</SignIn>
              </Show>
              <Show when="signed-in">
                <Link className="btn primary lg" href="/dashboard">Open dashboard</Link>
              </Show>
              <a className="btn lg" href="#available">See what&apos;s available</a>
            </div>
            <ul className="trust">
              <li>Free for neighbors</li>
              <li>Owner approves every loan</li>
              <li>Automatic overdue reminders</li>
            </ul>
          </div>

          <div className="showcase" aria-hidden="true">
            <div className="float f1">
              <span className="tile">⛺</span>
              <div>
                <strong>Four-person tent</strong>
                <small>Camping · Like new</small>
              </div>
              <span className="badge available">available</span>
            </div>
            <div className="float f2">
              <span className="tile">📅</span>
              <div>
                <strong>Request · Sat to Sun</strong>
                <small>Sam wants to borrow your ladder</small>
              </div>
              <span className="badge pending">pending</span>
            </div>
            <div className="float f3">
              <span className="tile">🔔</span>
              <div>
                <strong>Reminder sent</strong>
                <small>Return due tomorrow</small>
              </div>
              <span className="badge approved">approved</span>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <h2>How it works</h2>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="step" key={s.title}>
                <span className="step-icon">{s.icon}</span>
                <span className="step-n">Step {i + 1}</span>
                <h3>{s.title}</h3>
                <p className="muted">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="available" className="section">
          <div className="spread" style={{ alignItems: "baseline" }}>
            <h2>Available now</h2>
            {tools && tools.length > 0 && <span className="chip">{tools.length} ready to borrow</span>}
          </div>
          {tools === undefined ? (
            <ul className="grid">
              {[0, 1, 2].map((i) => (
                <li key={i} className="card skeleton" />
              ))}
            </ul>
          ) : tools.length === 0 ? (
            <div className="empty">
              <span className="step-icon">🧰</span>
              <p>Nothing is free right now. Be the first to lend something.</p>
            </div>
          ) : (
            <ul className="grid">
              {tools.map((tool, i) => (
                <li key={`${tool.name}-${i}`} className="card tool">
                  <span className="tile lg">{categoryIcon(tool.category)}</span>
                  <div className="spread" style={{ alignItems: "center" }}>
                    <strong>{tool.name}</strong>
                    <span className="badge available">available</span>
                  </div>
                  <span className="chip">{tool.category}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cta">
          <h2>Got something in the garage?</h2>
          <p>Share it with the street and get something useful back.</p>
          <Show when="signed-out">
            <SignIn className="btn light lg">Get started</SignIn>
          </Show>
          <Show when="signed-in">
            <Link className="btn light lg" href="/dashboard">Go to dashboard</Link>
          </Show>
        </section>
      </main>

      <footer className="footer">
        <span>LendLoop</span>
        <span className="muted small">A neighborhood tool-lending board.</span>
      </footer>
    </>
  );
}
