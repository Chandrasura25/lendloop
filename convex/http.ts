import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { today } from "./lib/dates";
import { verifyN8nRequest } from "./lib/signature";

// Endpoints n8n calls. Every request must carry a valid HMAC signature made with
// N8N_TO_LENDLOOP_SECRET (a different secret from the one used for Convex -> n8n).

const http = httpRouter();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Handler = (ctx: ActionCtx, body: unknown) => Promise<Response>;

function signed(handler: Handler) {
  return httpAction(async (ctx, request) => {
    const raw = await request.text();
    const check = await verifyN8nRequest(request, raw, process.env.N8N_TO_LENDLOOP_SECRET);
    if (!check.ok) return json({ error: "unauthorized" }, 401); // don't tell the caller why
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
    }
    try {
      return await handler(ctx, body);
    } catch (e) {
      if (e instanceof ConvexError) return json({ error: String(e.data) }, 422);
      throw e;
    }
  });
}

function str(obj: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    if (required) throw new ConvexError(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new ConvexError(`${key} must be a string`);
  return value;
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConvexError("expected a JSON object");
  return body as Record<string, unknown>;
}

// Daily reminder workflow: fetch loans past their end date that haven't been reminded today.
http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: signed(async (ctx) => {
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today: today() });
    return json({ date: today(), count: loans.length, loans });
  }),
});

// Daily reminder workflow: write back the result of each reminder. Idempotent on reminderKey.
http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: signed(async (ctx, body) => {
    const b = asObject(body);
    const status = str(b, "status");
    if (status !== "sent" && status !== "failed") throw new ConvexError("status must be sent or failed");
    const result = await ctx.runMutation(internal.automation.recordReminder, {
      loanId: str(b, "loanId")!,
      reminderKey: str(b, "reminderKey")!,
      status,
      channel: str(b, "channel", false),
      error: str(b, "error", false),
    });
    return json({ ok: true, ...result });
  }),
});

// Error workflow: report failed n8n executions so admins see them in the app.
http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: signed(async (ctx, body) => {
    const b = asObject(body);
    const result = await ctx.runMutation(internal.automation.recordWorkflowError, {
      executionId: str(b, "executionId")!,
      workflow: str(b, "workflow")!,
      node: str(b, "node", false),
      message: str(b, "message")!,
    });
    return json({ ok: true, ...result });
  }),
});

export default http;
