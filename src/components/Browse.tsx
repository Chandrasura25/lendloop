"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORIES, type Category, MAX_MESSAGE } from "@convex/lib/constants";
import { Badge, useAction } from "./shared";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: (sent: boolean) => void }) {
  const request = useMutation(api.loans.request);
  const { busy, error, run } = useAction();
  const [startDate, setStart] = useState(todayIso());
  const [endDate, setEnd] = useState(todayIso());
  const [message, setMessage] = useState("");

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => request({ toolId, startDate, endDate, message: message || undefined }))) onDone(true);
      }}
    >
      <div className="form-row">
        <label>
          From
          <input type="date" required min={todayIso()} value={startDate} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Until
          <input type="date" required min={startDate} value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label>
        Note to the owner (optional)
        <input maxLength={MAX_MESSAGE} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </button>
        <button type="button" className="btn" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function Browse() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.listAll, category ? { category } : {});
  const [requesting, setRequesting] = useState<Id<"tools"> | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  return (
    <section className="stack">
      <div className="spread">
        <label style={{ minWidth: 220 }}>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {sent && <p className="muted small">Request sent for {sent}. The owner has been notified.</p>}
      </div>

      {tools === undefined ? (
        <p className="muted">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="muted">No tools in this category yet.</p>
      ) : (
        <ul className="grid">
          {tools.map((tool) => (
            <li key={tool._id} className="card">
              <div className="spread">
                <strong>{tool.name}</strong>
                {tool.status === "available" ? (
                  <Badge kind="available">available</Badge>
                ) : (
                  <Badge kind={tool.overdue ? "overdue" : "on loan"}>
                    {tool.overdue ? "overdue" : `on loan until ${tool.until}`}
                  </Badge>
                )}
              </div>
              <div className="row">
                <span className="chip">{tool.category}</span>
                <span className="chip">{tool.condition}</span>
              </div>
              {tool.description && <p className="small" style={{ margin: 0 }}>{tool.description}</p>}
              <p className="muted small" style={{ margin: 0 }}>
                Lent by {tool.isMine ? "you" : tool.ownerName}{" "}
                {tool.ownerTrusted && <Badge kind="trusted">Trusted Lender</Badge>}
              </p>
              {!tool.isMine &&
                (requesting === tool._id ? (
                  <RequestForm
                    toolId={tool._id}
                    onDone={(ok) => {
                      setRequesting(null);
                      if (ok) setSent(tool.name);
                    }}
                  />
                ) : (
                  <button
                    className="btn"
                    onClick={() => {
                      setSent(null);
                      setRequesting(tool._id);
                    }}
                  >
                    Request to borrow
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
