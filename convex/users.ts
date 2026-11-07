import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewer, requireAdmin } from "./lib/auth";

/**
 * Called by the client right after sign-in. Creates or refreshes the user's row from the
 * verified Clerk JWT. The role is never taken from the client: new users are "user", unless their
 * *verified* email is listed in the ADMIN_EMAILS Convex env var (bootstrap for the first admin).
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("You need to sign in first.");

    const name =
      identity.givenName ?? identity.name ?? identity.nickname ?? identity.email?.split("@")[0] ?? "Neighbor";
    const email = identity.email?.toLowerCase();

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }

    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const bootstrapAdmin = !!email && identity.emailVerified === true && adminEmails.includes(email);

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: bootstrapAdmin ? "admin" : "user",
      trustedLender: false,
    });
  },
});

/** What the UI needs to know about the viewer. No email, no token identifier. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return {
      _id: viewer._id,
      name: viewer.name,
      role: viewer.role,
      trustedLender: viewer.trustedLender,
    };
  },
});

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return await Promise.all(
      users.map(async (u) => {
        const listings = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
          .collect();
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          trustedLender: u.trustedLender,
          listingCount: listings.length,
        };
      }),
    );
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Promote/demote a user. Internal on purpose: not callable from the browser, only from the
 * Convex dashboard or CLI, e.g.
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("admin"), v.literal("user")) },
  handler: async (ctx, { email, role }) => {
    const users = await ctx.db.query("users").collect();
    const user = users.find((u) => u.email === email.toLowerCase());
    if (!user) throw new ConvexError(`No user with email ${email}. They need to sign in once first.`);
    await ctx.db.patch(user._id, { role });
    return { userId: user._id, role };
  },
});
