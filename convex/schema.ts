import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categoryValidator,
  conditionValidator,
  loanEventValidator,
  loanStatusValidator,
} from "./lib/constants";

export default defineSchema({
  // One row per Clerk user. Role and trust live here (server-side), never in client state.
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  // A borrow request. It becomes a loan once approved.
  loans: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(), // snapshot, so history survives if a listing is removed
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD, inclusive
    message: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool", ["toolId"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_and_endDate", ["status", "endDate"]),

  // Every automation side effect (outgoing webhook or n8n write-back).
  // idempotencyKey is unique per real-world action, so retries can't create duplicates.
  automationEvents: defineTable({
    loanId: v.id("loans"),
    kind: v.union(v.literal("request_notification"), v.literal("overdue_reminder")),
    event: v.optional(loanEventValidator), // request notifications only
    idempotencyKey: v.string(),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    channel: v.optional(v.string()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_loan", ["loanId"])
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_status", ["status"]),

  // Failed n8n executions reported by the error workflow, shown to admins.
  workflowErrors: defineTable({
    executionId: v.string(),
    workflow: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    receivedAt: v.number(),
  }).index("by_execution", ["executionId"]),
});
