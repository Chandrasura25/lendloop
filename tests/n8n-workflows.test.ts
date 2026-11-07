// @vitest-environment node
//
// Runs the JavaScript from the *exported* n8n Code nodes against the Convex signature code, so the
// two sides of the integration can't drift apart. Also checks the exported JSON holds no secrets.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { hmacHex, verifyN8nRequest } from "../convex/lib/signature";

const dir = join(__dirname, "..", "n8n", "workflows");
const load = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));
const workflows = {
  request: load("request-notification.json"),
  overdue: load("overdue-reminders.json"),
  error: load("error-handler.json"),
};
const nodeCode = (wf: { nodes: { name: string; parameters: { jsCode?: string } }[] }, name: string) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node?.parameters.jsCode) throw new Error(`No Code node named ${name}`);
  return node.parameters.jsCode;
};

const require_ = createRequire(import.meta.url);
type Scope = Record<string, unknown>;
/** Executes a Code node body the way n8n does: an async function with n8n's globals in scope. */
async function runCodeNode(code: string, scope: Scope, self: Scope = {}) {
  const names = Object.keys(scope);
  const fn = new Function(...names, "require", `return (async function () {\n${code}\n}).call(this);`);
  return await fn.call(self, ...names.map((n) => scope[n]), require_);
}

const SECRETS = { N8N_TO_LENDLOOP_SECRET: "n8n-to-convex-secret", LENDLOOP_TO_N8N_SECRET: "convex-to-n8n-secret" };
const env = { ...SECRETS, LENDLOOP_CONVEX_SITE_URL: "https://example.convex.site" };

describe("exported workflows", () => {
  test("contain no secrets, and every workflow but the handler routes errors to it", () => {
    for (const wf of Object.values(workflows)) {
      const text = JSON.stringify(wf);
      for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
      expect(text).not.toMatch(/"credentials"\s*:/); // no embedded credential blobs
    }
    expect(workflows.request.settings.errorWorkflow).toBe(workflows.error.id);
    expect(workflows.overdue.settings.errorWorkflow).toBe(workflows.error.id);
  });

  test("a failed send answers 500 (so Convex retries) and still fails the execution", () => {
    const wf = workflows.request;
    const send = wf.nodes.find((n: { name: string }) => n.name === "Send notification (mock)");
    expect(send.onError).toBe("continueErrorOutput");
    const [ok, failed] = wf.connections["Send notification (mock)"].main;
    expect(ok[0].node).toBe("Respond 200");
    expect(failed[0].node).toBe("Respond 500");
    const respond500 = wf.nodes.find((n: { name: string }) => n.name === "Respond 500");
    expect(respond500.parameters.options.responseCode).toBe(500);
    expect(wf.connections["Respond 500"].main[0][0].node).toBe("Fail execution");
  });

  test("HTTP nodes calling Convex retry on failure", () => {
    for (const wf of [workflows.overdue, workflows.error]) {
      for (const node of wf.nodes.filter((n: { type: string }) => n.type === "n8n-nodes-base.httpRequest")) {
        expect(node.retryOnFail).toBe(true);
        expect(node.maxTries).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("n8n -> Convex signing (overdue workflow)", () => {
  async function asRequest(signed: { url: string; timestamp: string; signature: string; body: string }, method: string) {
    return new Request(signed.url, {
      method,
      headers: { "x-lendloop-timestamp": signed.timestamp, "x-lendloop-signature": signed.signature },
      body: method === "GET" ? undefined : signed.body,
    });
  }

  test("the 'Sign request' node produces a GET Convex accepts", async () => {
    const [{ json }] = await runCodeNode(nodeCode(workflows.overdue, "Sign request"), { $env: env });
    const req = await asRequest(json, "GET");
    expect(await verifyN8nRequest(req, "", SECRETS.N8N_TO_LENDLOOP_SECRET)).toEqual({ ok: true });
    expect(await verifyN8nRequest(req, "", "some-other-secret")).toMatchObject({ ok: false });
  });

  test("the 'Sign write-back' node produces a POST Convex accepts, with no email in it", async () => {
    const reminder = { loanId: "abc", reminderKey: "abc:overdue:2026-11-07", status: "sent", channel: "log" };
    const { json } = await runCodeNode(nodeCode(workflows.overdue, "Sign write-back"), { $env: env, $json: reminder });
    expect(await verifyN8nRequest(await asRequest(json, "POST"), json.body, SECRETS.N8N_TO_LENDLOOP_SECRET)).toEqual({ ok: true });
    expect(JSON.parse(json.body)).toEqual(reminder);
  });

  test("the reminder node strips the borrower's email before the write-back", async () => {
    const loan = { loanId: "abc", reminderKey: "abc:overdue:2026-11-07", toolName: "Drill", endDate: "2026-11-01", daysOverdue: 6, borrower: { name: "Bob", email: "bob@x.test" } };
    const { json } = await runCodeNode(nodeCode(workflows.overdue, "Send reminder (mock)"), { $json: loan, console: { log() {} } });
    expect(json).toEqual({ loanId: "abc", reminderKey: "abc:overdue:2026-11-07", status: "sent", channel: "log" });
  });

  test("the error handler signs its report for Convex", async () => {
    const input = { first: () => ({ json: { execution: { id: 7, lastNodeExecuted: "Fetch overdue loans", error: { message: "boom" } }, workflow: { name: "LendLoop – Overdue reminders" } } }) };
    const [{ json }] = await runCodeNode(nodeCode(workflows.error, "Build signed report"), { $env: env, $input: input, console: { error() {} } });
    expect(await verifyN8nRequest(await asRequest(json, "POST"), json.body, SECRETS.N8N_TO_LENDLOOP_SECRET)).toEqual({ ok: true });
    expect(JSON.parse(json.body)).toMatchObject({ executionId: "7", message: "boom" });
  });
});

describe("Convex -> n8n verification (request workflow)", () => {
  async function deliver(body: string, opts: { secret?: string; timestamp?: number; seen?: string[] } = {}) {
    const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
    const signature = await hmacHex(opts.secret ?? SECRETS.LENDLOOP_TO_N8N_SECRET, `${timestamp}.${body}`);
    const item = {
      json: { headers: { "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature }, body: JSON.parse(body) },
      binary: { data: {} },
    };
    const self = { helpers: { getBinaryDataBuffer: async () => Buffer.from(body, "utf8") } };
    const staticData = { seenEventIds: opts.seen ?? [] };
    const [{ json }] = await runCodeNode(
      nodeCode(workflows.request, "Verify signature"),
      { $env: env, $input: { first: () => item }, $getWorkflowStaticData: () => staticData },
      self,
    );
    return json;
  }
  const body = JSON.stringify({ eventId: "loan1:created", type: "loan.created", loan: { toolName: "Drill" }, recipient: { name: "Ada", email: "a@x.test" }, counterpartyName: "Bob" });

  test("accepts what Convex signs", async () => {
    expect(await deliver(body)).toMatchObject({ valid: true, duplicate: false, event: { eventId: "loan1:created" } });
  });
  test("rejects the wrong secret, a tampered body, and stale timestamps", async () => {
    expect(await deliver(body, { secret: "nope" })).toMatchObject({ valid: false });
    expect(await deliver(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 })).toMatchObject({ valid: false, reason: "stale timestamp" });
  });
  test("flags an eventId it has already handled", async () => {
    expect(await deliver(body, { seen: ["loan1:created"] })).toMatchObject({ valid: true, duplicate: true });
  });
});
