"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";

export default function Home() {
  const tools = useQuery(api.tools.listPublic);

  return (
    <main className="page">
      <header className="topbar">
        <span className="brand">LendLoop</span>
        <Show when="signed-in">
          <div className="row">
            <Link className="btn" href="/dashboard">
              Open dashboard
            </Link>
            <UserButton />
          </div>
        </Show>
      </header>

      <section className="hero">
        <span className="eyebrow">Neighborhood tool sharing</span>
        <h1>
          Borrow what you need. <span>Lend what you don&apos;t.</span>
        </h1>
        <p className="muted">
          A tool-lending board for your neighborhood. List the drill gathering dust in your garage, borrow a
          tent for the weekend, and let LendLoop handle the reminders.
        </p>
        <Show when="signed-out">
          <SignInButton mode="modal" forceRedirectUrl="/dashboard">
            <button className="btn primary">Sign in to lend or borrow</button>
          </SignInButton>
        </Show>
      </section>

      <section className="steps">
        <div className="step">
          <b>1</b>
          <h3>List a tool</h3>
          <p className="muted">Add the drill, ladder or tent you rarely use.</p>
        </div>
        <div className="step">
          <b>2</b>
          <h3>Request dates</h3>
          <p className="muted">Neighbors ask to borrow it for a date range.</p>
        </div>
        <div className="step">
          <b>3</b>
          <h3>Approve and track</h3>
          <p className="muted">Approve, hand it over, and get overdue reminders.</p>
        </div>
      </section>

      <section>
        <h2>Available now</h2>
        {tools === undefined ? (
          <p className="muted">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="muted">Nothing listed yet. Be the first to lend something.</p>
        ) : (
          <ul className="grid">
            {tools.map((tool, i) => (
              <li key={`${tool.name}-${i}`} className="card">
                <strong>{tool.name}</strong>
                <span className="chip">{tool.category}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
