"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { LoanStatus } from "./Loans";
import { activityLabel, Badge, timeAgo, useAction } from "./shared";

// Every action here is also checked server-side with requireAdmin(); hiding the tab is only UX.

function Users() {
  const users = useQuery(api.users.listForAdmin);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const { busy, error, run } = useAction();
  if (!users) return <p className="muted">Loading…</p>;
  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Listings</th><th>Trusted Lender</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id}>
                <td>{u.name}</td>
                <td className="muted">{u.email ?? "—"}</td>
                <td>{u.role}</td>
                <td>{u.listingCount}</td>
                <td>
                  <label className="row" style={{ display: "flex" }}>
                    <input
                      type="checkbox"
                      checked={u.trustedLender}
                      disabled={busy}
                      onChange={(e) => run(() => setTrusted({ userId: u._id, trusted: e.target.checked }))}
                    />
                    {u.trustedLender && <Badge kind="trusted">Trusted</Badge>}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AllListings() {
  const tools = useQuery(api.tools.listAll, {});
  const remove = useMutation(api.tools.remove);
  const { busy, error, run } = useAction();
  if (!tools) return <p className="muted">Loading…</p>;
  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Tool</th><th>Category</th><th>Owner</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t._id}>
                <td>{t.name}</td>
                <td>{t.category}</td>
                <td>{t.ownerName}</td>
                <td>{t.status}</td>
                <td>
                  <button
                    className="btn danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove "${t.name}"? Open requests will be cancelled and borrowers notified.`)) {
                        void run(() => remove({ toolId: t._id }));
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AllLoans() {
  const loans = useQuery(api.loans.adminAll);
  if (!loans) return <p className="muted">Loading…</p>;
  if (loans.length === 0) return <p className="muted">No loans yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Tool</th><th>Borrower</th><th>Owner</th><th>Dates</th><th>Status</th><th>Latest automation</th></tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l._id}>
              <td>{l.toolName}</td>
              <td>{l.borrowerName}</td>
              <td>{l.ownerName}</td>
              <td>{l.startDate} → {l.endDate}</td>
              <td><LoanStatus loan={l} /></td>
              <td className="muted small">{l.activity[0] ? activityLabel(l.activity[0]) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomationHealth() {
  const data = useQuery(api.automation.failures);
  const retry = useMutation(api.automation.retryEvent);
  const { busy, error, run } = useAction();
  if (!data) return <p className="muted">Loading…</p>;
  if (data.events.length === 0 && data.workflowErrors.length === 0) {
    return <p className="muted">No failed automations. Everything is flowing.</p>;
  }
  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {data.events.length > 0 && (
        <ul className="list">
          {data.events.map((e) => (
            <li key={e._id} className="card">
              <div className="spread">
                <strong>{e.kind === "overdue_reminder" ? "Overdue reminder" : `Notification: ${e.event}`}</strong>
                <Badge kind="failed">failed after {e.attempts} attempt(s)</Badge>
              </div>
              <span className="small muted">{e.lastError ?? "No error message"} · {timeAgo(e.updatedAt)}</span>
              {e.kind === "request_notification" && (
                <button className="btn" disabled={busy} onClick={() => run(() => retry({ eventId: e._id }))}>
                  Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.workflowErrors.length > 0 && (
        <>
          <h3>n8n workflow errors</h3>
          <ul className="list">
            {data.workflowErrors.map((w) => (
              <li key={w._id} className="card">
                <strong>{w.workflow}{w.node ? ` · ${w.node}` : ""}</strong>
                <span className="small muted">{w.message} · execution {w.executionId} · {timeAgo(w.receivedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function Admin() {
  return (
    <section className="stack">
      <h2 style={{ marginTop: 0 }}>Automation health</h2>
      <AutomationHealth />
      <h2>Members</h2>
      <Users />
      <h2>All listings</h2>
      <AllListings />
      <h2>All loans</h2>
      <AllLoans />
    </section>
  );
}
