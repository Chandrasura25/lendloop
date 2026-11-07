"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import {
  CATEGORIES,
  CONDITIONS,
  type Category,
  type Condition,
  MAX_DESCRIPTION,
  MAX_NAME,
} from "@convex/lib/constants";
import { Badge, useAction } from "./shared";

type Fields = { name: string; category: Category; condition: Condition; description: string };
const EMPTY: Fields = { name: "", category: "power tools", condition: "good", description: "" };

function ToolForm({
  initial = EMPTY,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Fields;
  submitLabel: string;
  onSubmit: (f: Fields) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState<Fields>(initial);
  const { busy, error, run } = useAction();
  return (
    <form
      className="form card"
      onSubmit={async (e) => {
        e.preventDefault();
        if ((await run(() => onSubmit(f))) && !onCancel) setF(EMPTY);
      }}
    >
      <label>
        Name
        <input required maxLength={MAX_NAME} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Cordless drill" />
      </label>
      <div className="form-row">
        <label>
          Category
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Condition
          <select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value as Condition })}>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Short description
        <textarea
          rows={2}
          maxLength={MAX_DESCRIPTION}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Comes with two batteries and a bit set."
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

type Listing = Doc<"tools"> & { status: "available" | "on loan"; until: string | null; overdue: boolean; pendingRequests: number };

function ListingCard({ tool }: { tool: Listing }) {
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();

  if (editing) {
    return (
      <li>
        <ToolForm
          initial={{ name: tool.name, category: tool.category, condition: tool.condition, description: tool.description }}
          submitLabel="Save changes"
          onSubmit={async (f) => {
            await update({ toolId: tool._id, ...f });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="card">
      <div className="spread">
        <strong>{tool.name}</strong>
        <Badge kind={tool.overdue ? "overdue" : tool.status}>
          {tool.status === "available" ? "available" : tool.overdue ? "overdue" : `on loan until ${tool.until}`}
        </Badge>
      </div>
      <div className="row">
        <span className="chip">{tool.category}</span>
        <span className="chip">{tool.condition}</span>
        {tool.pendingRequests > 0 && <span className="chip">{tool.pendingRequests} pending request(s)</span>}
      </div>
      {tool.description && <p className="small" style={{ margin: 0 }}>{tool.description}</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          className="btn danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${tool.name}"? Open requests for it will be cancelled.`)) {
              void run(() => remove({ toolId: tool._id }));
            }
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export default function Listings() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  return (
    <section className="stack">
      <h2 style={{ marginTop: 0 }}>List a tool</h2>
      <ToolForm submitLabel="List it" onSubmit={(f) => create(f)} />
      <h2>Your listings</h2>
      {tools === undefined ? (
        <p className="muted">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="muted">You haven&apos;t listed anything yet.</p>
      ) : (
        <ul className="grid">
          {tools.map((t) => (
            <ListingCard key={t._id} tool={t} />
          ))}
        </ul>
      )}
    </section>
  );
}
