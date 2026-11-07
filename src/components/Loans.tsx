"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { ActivityList, Badge, useAction } from "./shared";

export type Loan = FunctionReturnType<typeof api.loans.myRequests>[number];

export function LoanStatus({ loan }: { loan: Loan }) {
  if (loan.overdue) return <Badge kind="overdue">overdue</Badge>;
  return <Badge kind={loan.status}>{loan.status}</Badge>;
}

function LoanCard({ loan, perspective }: { loan: Loan; perspective: "borrower" | "owner" }) {
  const decide = useMutation(api.loans.decide);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const { busy, error, run } = useAction();

  return (
    <li className="card">
      <div className="spread">
        <strong>{loan.toolName}</strong>
        <LoanStatus loan={loan} />
      </div>
      <p className="small" style={{ margin: 0 }}>
        {loan.startDate} → {loan.endDate} ·{" "}
        {perspective === "borrower" ? (
          <>
            from {loan.ownerName} {loan.ownerTrusted && <Badge kind="trusted">Trusted Lender</Badge>}
          </>
        ) : (
          <>requested by {loan.borrowerName}</>
        )}
      </p>
      {loan.message && <p className="small muted" style={{ margin: 0 }}>“{loan.message}”</p>}
      <ActivityList activity={loan.activity} />
      {error && <p className="error">{error}</p>}
      <div className="row">
        {perspective === "owner" && loan.status === "pending" && (
          <>
            <button className="btn primary" disabled={busy} onClick={() => run(() => decide({ loanId: loan._id, decision: "approve" }))}>
              Approve
            </button>
            <button className="btn danger" disabled={busy} onClick={() => run(() => decide({ loanId: loan._id, decision: "decline" }))}>
              Decline
            </button>
          </>
        )}
        {perspective === "owner" && loan.status === "approved" && (
          <button className="btn" disabled={busy} onClick={() => run(() => markReturned({ loanId: loan._id }))}>
            Mark as returned
          </button>
        )}
        {perspective === "borrower" && loan.status === "pending" && (
          <button className="btn danger" disabled={busy} onClick={() => run(() => cancel({ loanId: loan._id }))}>
            Cancel request
          </button>
        )}
      </div>
    </li>
  );
}

function LoanList({ loans, perspective, empty }: { loans: Loan[] | undefined; perspective: "borrower" | "owner"; empty: string }) {
  if (loans === undefined) return <p className="muted">Loading…</p>;
  if (loans.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="grid">
      {loans.map((l) => (
        <LoanCard key={l._id} loan={l} perspective={perspective} />
      ))}
    </ul>
  );
}

export function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  return <LoanList loans={loans} perspective="borrower" empty="You haven't requested anything yet." />;
}

export function IncomingRequests() {
  const loans = useQuery(api.loans.incoming);
  return <LoanList loans={loans} perspective="owner" empty="No one has asked to borrow your tools yet." />;
}
