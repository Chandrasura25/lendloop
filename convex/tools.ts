import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { getViewer, isAdmin, requireViewer } from "./lib/auth";
import {
  categoryValidator,
  conditionValidator,
  MAX_DESCRIPTION,
  MAX_NAME,
} from "./lib/constants";
import { today } from "./lib/dates";
import { enqueueLoanNotification } from "./automation";

export function cleanText(value: string, label: string, max: number, required = true): string {
  const trimmed = value.trim();
  if (required && !trimmed) throw new ConvexError(`${label} is required.`);
  if (trimmed.length > max) throw new ConvexError(`${label} must be ${max} characters or fewer.`);
  return trimmed;
}

/** A tool is "on loan" while an approved, not-yet-returned loan has started. */
export async function toolAvailability(ctx: QueryCtx, toolId: Id<"tools">, now = today()) {
  const approved = (
    await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect()
  ).filter((l) => l.status === "approved");
  const current = approved.find((l) => l.startDate <= now);
  if (current) {
    return { status: "on loan" as const, until: current.endDate, overdue: current.endDate < now };
  }
  return { status: "available" as const, until: null, overdue: false };
}

/**
 * Public, unauthenticated list for the landing page.
 * Data minimisation: only name and category of available tools. No owner, no IDs, no description.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(100);
    const now = today();
    const result: { name: string; category: string }[] = [];
    for (const tool of tools) {
      const availability = await toolAvailability(ctx, tool._id, now);
      if (availability.status === "available") {
        result.push({ name: tool.name, category: tool.category });
      }
    }
    return result;
  },
});

/** Signed-in browse view: every tool with its availability, optionally filtered by category. */
export const listAll = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .order("desc")
          .take(200)
      : await ctx.db.query("tools").order("desc").take(200);
    const now = today();
    return await Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get(tool.ownerId);
        const availability = await toolAvailability(ctx, tool._id, now);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          ownerName: owner?.name ?? "Unknown",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: tool.ownerId === viewer._id,
          ...availability,
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    const now = today();
    return await Promise.all(
      tools.map(async (tool) => {
        const loans = await ctx.db
          .query("loans")
          .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
          .collect();
        return {
          ...tool,
          ...(await toolAvailability(ctx, tool._id, now)),
          pendingRequests: loans.filter((l) => l.status === "pending").length,
        };
      }),
    );
  },
});

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    return await ctx.db.insert("tools", {
      ownerId: viewer._id,
      name: cleanText(args.name, "Name", MAX_NAME),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", MAX_DESCRIPTION, false),
    });
  },
});

/** Owners edit their own listings. Admins can remove listings but not rewrite them. */
export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Listing not found.");
    if (tool.ownerId !== viewer._id) throw new ConvexError("You can only edit your own listings.");
    await ctx.db.patch(toolId, {
      name: cleanText(args.name, "Name", MAX_NAME),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", MAX_DESCRIPTION, false),
    });
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Listing not found.");
    const owner = tool.ownerId === viewer._id;
    if (!owner && !isAdmin(viewer)) throw new ConvexError("You can only delete your own listings.");

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    const now = today();
    const outOnLoan = loans.some((l) => l.status === "approved" && l.startDate <= now);
    if (owner && !isAdmin(viewer) && outOnLoan) {
      throw new ConvexError("This tool is out on loan. Mark it returned before deleting the listing.");
    }

    // Open requests can't be fulfilled any more: cancel them and tell the borrowers' side.
    for (const loan of loans) {
      if (loan.status === "pending" || (loan.status === "approved" && loan.startDate > now)) {
        await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
        await enqueueLoanNotification(ctx, loan._id, "listing_removed");
      }
    }
    await ctx.db.delete(toolId);
  },
});
