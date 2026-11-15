import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { isoDaysAgo } from "./lib/dates";

/**
 * Demo data so the overdue-reminder workflow has something to do.
 * Internal: runnable only from the CLI/dashboard, never from the browser.
 *
 *   npx convex run seed:overdueDemo '{"borrowerEmail":"you@example.com"}'
 *
 * Creates a demo lender with two tools and gives the (already signed-in) borrower one loan that
 * ended three days ago, plus one active loan.
 */
export const overdueDemo = internalMutation({
  args: { borrowerEmail: v.string() },
  handler: async (ctx, { borrowerEmail }) => {
    const users = await ctx.db.query("users").collect();
    const borrower = users.find((u) => u.email === borrowerEmail.toLowerCase());
    if (!borrower) throw new ConvexError(`Sign in once as ${borrowerEmail} before seeding.`);

    let lender = users.find((u) => u.tokenIdentifier === "seed|demo-lender");
    const lenderId =
      lender?._id ??
      (await ctx.db.insert("users", {
        tokenIdentifier: "seed|demo-lender",
        name: "Demo neighbor",
        email: "demo-lender@example.invalid",
        role: "user",
        trustedLender: true,
      }));
    lender = (await ctx.db.get(lenderId))!;

    const ladder = await ctx.db.insert("tools", {
      ownerId: lenderId,
      name: "Extension ladder",
      category: "hand tools",
      condition: "good",
      description: "3.5 m, aluminium.",
    });
    const tent = await ctx.db.insert("tools", {
      ownerId: lenderId,
      name: "Four-person tent",
      category: "camping",
      condition: "like new",
      description: "",
    });

    const overdue = await ctx.db.insert("loans", {
      toolId: ladder,
      toolName: "Extension ladder",
      ownerId: lenderId,
      borrowerId: borrower._id,
      startDate: isoDaysAgo(6),
      endDate: isoDaysAgo(3),
      status: "approved",
      decidedAt: Date.now(),
    });
    await ctx.db.insert("loans", {
      toolId: tent,
      toolName: "Four-person tent",
      ownerId: lenderId,
      borrowerId: borrower._id,
      startDate: isoDaysAgo(1),
      endDate: isoDaysAgo(-2),
      status: "approved",
      decidedAt: Date.now(),
    });
    return { overdueLoanId: overdue };
  },
});

/**
 * Fills the public list with a few available tools for the demo lender.
 *
 *   npx convex run seed:showcase
 */
export const showcase = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const lender = users.find((u) => u.tokenIdentifier === "seed|demo-lender");
    if (!lender) throw new ConvexError("Run seed:overdueDemo first so the demo lender exists.");
    const existing = new Set((await ctx.db.query("tools").collect()).map((x) => x.name));
    const items = [
      { name: "Cordless drill", category: "power tools", condition: "good", description: "18 V with two batteries." },
      { name: "Pressure washer", category: "cleaning", condition: "like new", description: "" },
      { name: "Hedge trimmer", category: "garden", condition: "good", description: "" },
      { name: "Stand mixer", category: "kitchen", condition: "fair", description: "" },
      { name: "Socket set", category: "hand tools", condition: "good", description: "" },
      { name: "Camping stove", category: "camping", condition: "good", description: "" },
    ] as const;
    let added = 0;
    for (const item of items) {
      if (existing.has(item.name)) continue;
      await ctx.db.insert("tools", { ownerId: lender._id, ...item });
      added++;
    }
    return { added };
  },
});
