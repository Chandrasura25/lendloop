import { v } from "convex/values";

// Shared by the Convex functions and the Next.js UI so both sides agree on the allowed values.
export const CATEGORIES = [
  "power tools",
  "hand tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;

export const CONDITIONS = ["like new", "good", "fair", "well used"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Condition = (typeof CONDITIONS)[number];

export const categoryValidator = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const conditionValidator = v.union(...CONDITIONS.map((c) => v.literal(c)));

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);
export type LoanStatus = "pending" | "approved" | "declined" | "cancelled" | "returned";

// Events that trigger a request notification through n8n.
export const LOAN_EVENTS = [
  "created", // borrower requested -> notify owner
  "cancelled", // borrower withdrew -> notify owner
  "approved", // -> notify borrower
  "declined", // -> notify borrower
  "returned", // -> notify borrower
  "listing_removed", // listing deleted while request open -> notify borrower
] as const;
export type LoanEvent = (typeof LOAN_EVENTS)[number];
export const loanEventValidator = v.union(...LOAN_EVENTS.map((e) => v.literal(e)));

export const MAX_LOAN_DAYS = 30;
export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 500;
export const MAX_MESSAGE = 300;
