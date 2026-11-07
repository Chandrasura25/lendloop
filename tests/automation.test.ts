import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { hmacHex } from "../convex/lib/signature";
import { drill, isoDate, LENDLOOP_TO_N8N_SECRET, n8nHeaders, setup, signIn, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function requestLoan(t: T) {
  const ada = await signIn(t, "Ada");
  const bob = await signIn(t, "Bob");
  const toolId = await ada.as.mutation(api.tools.create, drill);
  const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(2) });
  return { ada, bob, toolId, loanId };
}

async function eventsFor(t: T) {
  return await t.run((ctx) => ctx.db.query("automationEvents").collect());
}

describe("Convex -> n8n request notifications", () => {
  test("a signed, minimal payload is sent to the owner when a request is created", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = setup();
    const { loanId } = await requestLoan(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(process.env.N8N_REQUEST_WEBHOOK_URL);

    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    const expected = await hmacHex(LENDLOOP_TO_N8N_SECRET, `${headers["x-lendloop-timestamp"]}.${body}`);
    expect(headers["x-lendloop-signature"]).toBe(expected);

    const payload = JSON.parse(body);
    expect(payload).toEqual({
      eventId: `${loanId}:created`,
      type: "loan.created",
      loan: expect.objectContaining({ id: loanId, toolName: "Cordless drill" }),
      recipient: { role: "owner", name: "Ada", email: "ada@lendloop.test" },
      counterpartyName: "Bob",
    });
    // Data minimisation: the borrower's email and the tool description are never sent.
    expect(body).not.toContain("bob@lendloop.test");
    expect(body).not.toContain("Two batteries");

    const [event] = await eventsFor(t);
    expect(event).toMatchObject({ status: "sent", attempts: 1 });
  });

  test("server errors are retried with backoff and end as a visible failure", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = setup();
    await requestLoan(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [event] = await eventsFor(t);
    expect(event).toMatchObject({ status: "failed", attempts: 5, lastError: "n8n responded 503" });
  });

  test("a transient failure recovers on retry without sending twice", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = setup();
    await requestLoan(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [event] = await eventsFor(t);
    expect(event).toMatchObject({ status: "sent", attempts: 2 });
  });

  test("a 401 from n8n (bad signature) is not retried", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = setup();
    await requestLoan(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await eventsFor(t))[0].status).toBe("failed");
  });

  test("admins can retry a failed notification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 400 })));
    const t = setup();
    await requestLoan(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const admin = await signIn(t, "Admin");
    const failures = await admin.as.query(api.automation.failures, {});
    expect(failures.events).toHaveLength(1);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await admin.as.mutation(api.automation.retryEvent, { eventId: failures.events[0]._id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await eventsFor(t))[0].status).toBe("sent");
  });

  test("each state change produces exactly one notification for the right person", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const t = setup();
    const { ada, loanId } = await requestLoan(t);
    await ada.as.mutation(api.loans.decide, { loanId, decision: "approve" });
    await ada.as.mutation(api.loans.markReturned, { loanId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const events = await eventsFor(t);
    expect(events.map((e) => e.idempotencyKey).sort()).toEqual(
      [`${loanId}:approved`, `${loanId}:created`, `${loanId}:returned`].sort(),
    );
    expect(events.every((e) => e.status === "sent")).toBe(true);
  });
});

describe("n8n -> Convex HTTP endpoints", () => {
  async function overdueLoan(t: T) {
    const ada = await signIn(t, "Ada");
    const bob = await signIn(t, "Bob");
    const toolId = await ada.as.mutation(api.tools.create, drill);
    const loanId = await t.run(async (ctx) => {
      const tool = (await ctx.db.get(toolId))!;
      return ctx.db.insert("loans", {
        toolId,
        toolName: tool.name,
        ownerId: ada.userId,
        borrowerId: bob.userId,
        startDate: isoDate(-5),
        endDate: isoDate(-2),
        status: "approved",
      });
    });
    return { loanId, bob };
  }

  test("unsigned, wrongly signed or stale requests are rejected", async () => {
    const t = setup();
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET" })).status).toBe(401);

    const wrong = await n8nHeaders("GET", "/n8n/overdue-loans", "", "not-the-secret");
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET", headers: wrong })).status).toBe(401);

    const signedForOtherPath = await n8nHeaders("GET", "/n8n/workflow-error");
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET", headers: signedForOtherPath })).status).toBe(401);

    const old = await n8nHeaders("GET", "/n8n/overdue-loans");
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET", headers: old })).status).toBe(401);
  });

  test("a tampered body fails the signature check", async () => {
    const t = setup();
    const body = JSON.stringify({ loanId: "x", reminderKey: "x", status: "sent" });
    const headers = await n8nHeaders("POST", "/n8n/reminder-status", body);
    const res = await t.fetch("/n8n/reminder-status", { method: "POST", headers, body: body.replace("sent", "failed") });
    expect(res.status).toBe(401);
  });

  test("overdue loans are listed with only the fields n8n needs", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const res = await t.fetch("/n8n/overdue-loans", { method: "GET", headers: await n8nHeaders("GET", "/n8n/overdue-loans") });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.loans).toEqual([
      {
        loanId,
        reminderKey: `${loanId}:overdue:${isoDate(0)}`,
        toolName: "Cordless drill",
        endDate: isoDate(-2),
        daysOverdue: 2,
        borrower: { name: "Bob", email: "bob@lendloop.test" },
      },
    ]);
  });

  test("reminder write-back is idempotent and today's reminded loans drop off the list", async () => {
    const t = setup();
    const { loanId, bob } = await overdueLoan(t);
    const reminderKey = `${loanId}:overdue:${isoDate(0)}`;
    const body = JSON.stringify({ loanId, reminderKey, status: "sent", channel: "log" });

    for (const expectedDuplicate of [false, true, true]) {
      const headers = await n8nHeaders("POST", "/n8n/reminder-status", body);
      const res = await t.fetch("/n8n/reminder-status", { method: "POST", headers, body });
      expect(res.status).toBe(200);
      expect((await res.json()).duplicate).toBe(expectedDuplicate);
    }
    const reminders = (await eventsFor(t)).filter((e) => e.kind === "overdue_reminder");
    expect(reminders).toHaveLength(1);

    const list = await t.fetch("/n8n/overdue-loans", { method: "GET", headers: await n8nHeaders("GET", "/n8n/overdue-loans") });
    expect((await list.json()).loans).toHaveLength(0);

    // ...and the borrower sees it on the loan.
    const [loan] = await bob.as.query(api.loans.myRequests, {});
    expect(loan.activity[0]).toMatchObject({ kind: "overdue_reminder", status: "sent" });
  });

  test("a reminderKey that doesn't belong to the loan is rejected", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const body = JSON.stringify({ loanId, reminderKey: "someone-else:overdue:2026-01-01", status: "sent" });
    const res = await t.fetch("/n8n/reminder-status", { method: "POST", headers: await n8nHeaders("POST", "/n8n/reminder-status", body), body });
    expect(res.status).toBe(422);
  });

  test("workflow errors are stored once per execution and shown to admins", async () => {
    const t = setup();
    const body = JSON.stringify({ executionId: "42", workflow: "LendLoop – Overdue reminders", node: "Fetch overdue loans", message: "timeout" });
    for (let i = 0; i < 2; i++) {
      const res = await t.fetch("/n8n/workflow-error", { method: "POST", headers: await n8nHeaders("POST", "/n8n/workflow-error", body), body });
      expect(res.status).toBe(200);
    }
    const admin = await signIn(t, "Admin");
    const { workflowErrors } = await admin.as.query(api.automation.failures, {});
    expect(workflowErrors).toHaveLength(1);
    expect(workflowErrors[0]).toMatchObject({ executionId: "42", message: "timeout" });
  });
});
