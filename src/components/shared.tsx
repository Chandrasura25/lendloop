"use client";

import { ConvexError } from "convex/values";
import { useState } from "react";

/** Server-side ConvexErrors carry a user-facing message; anything else stays generic. */
export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) return String(err.data);
  return "Something went wrong. Please try again.";
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export type Activity = {
  kind: "request_notification" | "overdue_reminder";
  event: string | null;
  status: "pending" | "sent" | "failed";
  attempts: number;
  at: number;
};

const EVENT_TEXT: Record<string, string> = {
  created: "Owner notified of request",
  cancelled: "Owner notified of cancellation",
  approved: "Borrower notified of approval",
  declined: "Borrower notified of decline",
  returned: "Borrower notified of return",
  listing_removed: "Borrower notified listing was removed",
};

export function activityLabel(a: Activity): string {
  const what = a.kind === "overdue_reminder" ? "Overdue reminder" : (EVENT_TEXT[a.event ?? ""] ?? "Notification");
  if (a.status === "sent") return `${what} · sent ${timeAgo(a.at)}`;
  if (a.status === "failed") return `${what} · failed after ${a.attempts} attempt${a.attempts === 1 ? "" : "s"}`;
  return `${what} · queued${a.attempts ? `, retrying (attempt ${a.attempts})` : ""}`;
}

export function ActivityList({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) return null;
  return (
    <ul className="activity" aria-label="Automation activity">
      {activity.map((a, i) => (
        <li key={i}>{activityLabel(a)}</li>
      ))}
    </ul>
  );
}

export function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`badge ${kind.replace(/\s/g, "")}`}>{children}</span>;
}

/** Runs an async action, tracks pending state and shows the server's error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}
