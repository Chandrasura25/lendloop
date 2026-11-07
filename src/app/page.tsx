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
        <h1>Borrow what you need. Lend what you don&apos;t.</h1>
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
