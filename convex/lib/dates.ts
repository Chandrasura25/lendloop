import { ConvexError } from "convex/values";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date as YYYY-MM-DD (UTC). Loans are whole days, so UTC is good enough here. */
export function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function assertIsoDate(value: string, label: string): void {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ConvexError(`${label} must be a date in YYYY-MM-DD format.`);
  }
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/** Inclusive date ranges overlap. ISO dates compare correctly as strings. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** YYYY-MM-DD for `days` days before today (negative = in the future). */
export function isoDaysAgo(days: number, now = Date.now()): string {
  return today(now - days * 86_400_000);
}
