import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { enqueueLoanNotification } from "./automation";
import { getViewer, requireAdmin, requireViewer } from "./lib/auth";
import { MAX_LOAN_DAYS, MAX_MESSAGE } from "./lib/constants";
import { assertIsoDate, daysBetween, overlaps, today } from "./lib/dates";
import { cleanText } from "./tools";

/** Automation history for a loan, e.g. "Reminder sent 2 days ago". No payloads, no emails. */
async function activityFor(ctx: QueryCtx, loan: Doc<"loans">) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
    .collect();
  return events
    .map((e) => ({
      kind: e.kind,
      event: e.event ?? null,
      status: e.status,
      attempts: e.attempts,
      at: e.updatedAt,
    }))
    .sort((a, b) => b.at - a.at);
}

async function present(ctx: QueryCtx, loan: Doc<"loans">) {
  const [owner, borrower, activity] = await Promise.all([
    ctx.db.get(loan.ownerId),
    ctx.db.get(loan.borrowerId),
    activityFor(ctx, loan),
  ]);
  const now = today();
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    toolId: loan.toolId,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    message: loan.message ?? null,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < now,
    ownerName: owner?.name ?? "Unknown",
    ownerTrusted: owner?.trustedLender ?? false,
    borrowerName: borrower?.name ?? "Unknown",
    activity,
  };
}

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { toolId, startDate, endDate, message }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("That listing no longer exists.");
    if (tool.ownerId === viewer._id) throw new ConvexError("You can't borrow your own tool.");

    assertIsoDate(startDate, "Start date");
    assertIsoDate(endDate, "End date");
    if (startDate < today()) throw new ConvexError("Start date can't be in the past.");
    if (endDate < startDate) throw new ConvexError("End date must be on or after the start date.");
    if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) {
      throw new ConvexError(`Loans can be at most ${MAX_LOAN_DAYS} days.`);
    }

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    if (loans.some((l) => l.status === "approved" && overlaps(l.startDate, l.endDate, startDate, endDate))) {
      throw new ConvexError("The tool is already booked for some of those dates.");
    }
    if (
      loans.some(
        (l) =>
          l.status === "pending" &&
          l.borrowerId === viewer._id &&
          overlaps(l.startDate, l.endDate, startDate, endDate),
      )
    ) {
      throw new ConvexError("You already have a pending request for those dates.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      message: message ? cleanText(message, "Message", MAX_MESSAGE, false) || undefined : undefined,
      status: "pending",
    });
    await enqueueLoanNotification(ctx, loanId, "created");
    return loanId;
  },
});

/** Only the tool's owner can approve or decline, and only while the request is pending. */
export const decide = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approve"), v.literal("decline")) },
  handler: async (ctx, { loanId, decision }) => {
    const viewer = await requireViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Request not found.");
    if (loan.ownerId !== viewer._id) throw new ConvexError("Only the tool's owner can decide on this request.");
    if (loan.status !== "pending") throw new ConvexError(`This request is already ${loan.status}.`);

    if (decision === "decline") {
      await ctx.db.patch(loanId, { status: "declined", decidedAt: Date.now() });
      await enqueueLoanNotification(ctx, loanId, "declined");
      return;
    }

    const others = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", loan.toolId))
      .collect();
    if (
      others.some(
        (l) => l.status === "approved" && overlaps(l.startDate, l.endDate, loan.startDate, loan.endDate),
      )
    ) {
      throw new ConvexError("Those dates now clash with a loan you already approved.");
    }
    await ctx.db.patch(loanId, { status: "approved", decidedAt: Date.now() });
    await enqueueLoanNotification(ctx, loanId, "approved");

    // Other pending requests for the same dates can no longer be met.
    for (const other of others) {
      if (
        other._id !== loanId &&
        other.status === "pending" &&
        overlaps(other.startDate, other.endDate, loan.startDate, loan.endDate)
      ) {
        await ctx.db.patch(other._id, { status: "declined", decidedAt: Date.now() });
        await enqueueLoanNotification(ctx, other._id, "declined");
      }
    }
  },
});

/** The borrower can withdraw their own pending request. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Request not found.");
    if (loan.borrowerId !== viewer._id) throw new ConvexError("You can only cancel your own requests.");
    if (loan.status !== "pending") throw new ConvexError(`This request is already ${loan.status}.`);
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanNotification(ctx, loanId, "cancelled");
  },
});

/** The lender confirms the tool came back. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Loan not found.");
    if (loan.ownerId !== viewer._id) throw new ConvexError("Only the tool's owner can mark it returned.");
    if (loan.status !== "approved") throw new ConvexError("Only an approved loan can be marked returned.");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await enqueueLoanNotification(ctx, loanId, "returned");
  },
});

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((l) => present(ctx, l)));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((l) => present(ctx, l)));
  },
});

export const adminAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(300);
    return await Promise.all(loans.map((l) => present(ctx, l)));
  },
});
