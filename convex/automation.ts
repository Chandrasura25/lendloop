import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import type { LoanEvent } from "./lib/constants";
import { daysBetween } from "./lib/dates";
import { hmacHex, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/signature";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30s, 1m, 2m, 4m
const REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------------------------
// Convex -> n8n: request notifications (transactional outbox + scheduled delivery with retries)
// ---------------------------------------------------------------------------------------------

/**
 * Called inside the mutation that changed the loan, so the outbox row is written in the same
 * transaction as the state change. If the mutation fails, no notification is queued; if it
 * commits, delivery is guaranteed to be attempted. The idempotency key is one per loan + event,
 * so calling this twice for the same transition is a no-op.
 */
export async function enqueueLoanNotification(ctx: MutationCtx, loanId: Id<"loans">, event: LoanEvent) {
  const idempotencyKey = `${loanId}:${event}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing) return existing._id;
  const eventId = await ctx.db.insert("automationEvents", {
    loanId,
    kind: "request_notification",
    event,
    idempotencyKey,
    status: "pending",
    attempts: 0,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.automation.deliverLoanNotification, { eventId });
  return eventId;
}

const RECIPIENT: Record<LoanEvent, "owner" | "borrower"> = {
  created: "owner",
  cancelled: "owner",
  approved: "borrower",
  declined: "borrower",
  returned: "borrower",
  listing_removed: "borrower",
};

/** Everything the webhook needs, and nothing else. */
export const getDelivery = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.kind !== "request_notification" || !event.event) return null;
    const loan = await ctx.db.get(event.loanId);
    if (!loan) return null;
    const recipientRole = RECIPIENT[event.event];
    const [recipient, counterparty] = await Promise.all([
      ctx.db.get(recipientRole === "owner" ? loan.ownerId : loan.borrowerId),
      ctx.db.get(recipientRole === "owner" ? loan.borrowerId : loan.ownerId),
    ]);
    return {
      status: event.status,
      payload: {
        eventId: event.idempotencyKey,
        type: `loan.${event.event}`,
        loan: {
          id: loan._id,
          toolName: loan.toolName,
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
        },
        recipient: { role: recipientRole, name: recipient?.name ?? "Neighbor", email: recipient?.email ?? null },
        counterpartyName: counterparty?.name ?? "A neighbor",
      },
    };
  },
});

export const recordDeliveryAttempt = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    ok: v.boolean(),
    retryable: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, ok, retryable, error }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return { status: "failed" as const, attempts: 0 };
    const attempts = event.attempts + 1;
    const status: Doc<"automationEvents">["status"] = ok
      ? "sent"
      : retryable && attempts < MAX_ATTEMPTS
        ? "pending"
        : "failed";
    await ctx.db.patch(eventId, {
      attempts,
      status,
      channel: ok ? "n8n" : event.channel,
      lastError: ok ? undefined : error?.slice(0, 300),
      updatedAt: Date.now(),
    });
    return { status, attempts };
  },
});

export const deliverLoanNotification = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const delivery = await ctx.runQuery(internal.automation.getDelivery, { eventId });
    if (!delivery || delivery.status !== "pending") return;

    const url = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.recordDeliveryAttempt, {
        eventId,
        ok: false,
        retryable: false,
        error: "N8N_REQUEST_WEBHOOK_URL or LENDLOOP_TO_N8N_SECRET is not set in the Convex environment.",
      });
      return;
    }

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacHex(secret, `${timestamp}.${body}`);

    let error: string | undefined;
    let retryable = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
          "Idempotency-Key": delivery.payload.eventId,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        error = `n8n responded ${res.status}`;
        // 4xx means the request itself is wrong (e.g. bad signature); retrying won't fix it.
        retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }

    const { status, attempts } = await ctx.runMutation(internal.automation.recordDeliveryAttempt, {
      eventId,
      ok: !error,
      retryable,
      error,
    });
    if (status === "pending") {
      await ctx.scheduler.runAfter(
        BASE_BACKOFF_MS * 2 ** (attempts - 1),
        internal.automation.deliverLoanNotification,
        { eventId },
      );
    }
  },
});

// ---------------------------------------------------------------------------------------------
// n8n -> Convex: overdue reminders and error reports (called from http.ts after signature check)
// ---------------------------------------------------------------------------------------------

export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_and_endDate", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(500);
    const result = [];
    for (const loan of loans) {
      const reminderKey = `${loan._id}:overdue:${today}`;
      const already = await ctx.db
        .query("automationEvents")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", reminderKey))
        .unique();
      if (already?.status === "sent") continue; // today's reminder is done; a re-run won't resend
      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower?.email) continue;
      result.push({
        loanId: loan._id,
        reminderKey,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { name: borrower.name, email: borrower.email },
      });
    }
    return result;
  },
});

/** Idempotent write-back: the same reminderKey can arrive many times, it is stored once. */
export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId) throw new ConvexError("Unknown loan.");
    if (!args.reminderKey.startsWith(`${loanId}:overdue:`)) throw new ConvexError("reminderKey does not match loan.");
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Unknown loan.");

    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.reminderKey))
      .unique();
    if (existing?.status === "sent") return { duplicate: true };
    const fields = {
      status: args.status,
      channel: args.channel?.slice(0, 40),
      lastError: args.error?.slice(0, 300),
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, attempts: existing.attempts + 1 });
    } else {
      await ctx.db.insert("automationEvents", {
        loanId,
        kind: "overdue_reminder",
        idempotencyKey: args.reminderKey,
        attempts: 1,
        ...fields,
      });
    }
    return { duplicate: false };
  },
});

export const recordWorkflowError = internalMutation({
  args: {
    executionId: v.string(),
    workflow: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflowErrors")
      .withIndex("by_execution", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing) return { duplicate: true };
    await ctx.db.insert("workflowErrors", {
      executionId: args.executionId.slice(0, 64),
      workflow: args.workflow.slice(0, 120),
      node: args.node?.slice(0, 120),
      message: args.message.slice(0, 500),
      receivedAt: Date.now(),
    });
    return { duplicate: false };
  },
});

// ---------------------------------------------------------------------------------------------
// Admin visibility: nothing fails silently
// ---------------------------------------------------------------------------------------------

export const failures = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const failed = await ctx.db
      .query("automationEvents")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(50);
    const workflowErrors = await ctx.db.query("workflowErrors").order("desc").take(50);
    return {
      events: failed.map((e) => ({
        _id: e._id,
        kind: e.kind,
        event: e.event ?? null,
        attempts: e.attempts,
        lastError: e.lastError ?? null,
        updatedAt: e.updatedAt,
      })),
      workflowErrors: workflowErrors.map((w) => ({
        _id: w._id,
        workflow: w.workflow,
        node: w.node ?? null,
        message: w.message,
        executionId: w.executionId,
        receivedAt: w.receivedAt,
      })),
    };
  },
});

export const retryEvent = mutation({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    await requireAdmin(ctx);
    const event = await ctx.db.get(eventId);
    if (!event || event.kind !== "request_notification") throw new ConvexError("Nothing to retry.");
    if (event.status !== "failed") throw new ConvexError("Only failed notifications can be retried.");
    await ctx.db.patch(eventId, { status: "pending", attempts: 0, lastError: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.automation.deliverLoanNotification, { eventId });
  },
});
