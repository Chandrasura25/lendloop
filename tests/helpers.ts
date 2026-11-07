import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { modules } from "../convex/test.setup";
import { hmacHex, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../convex/lib/signature";


export const N8N_TO_LENDLOOP_SECRET = "test-secret-n8n-to-lendloop";
export const LENDLOOP_TO_N8N_SECRET = "test-secret-lendloop-to-n8n";

export function setup() {
  process.env.N8N_TO_LENDLOOP_SECRET = N8N_TO_LENDLOOP_SECRET;
  process.env.LENDLOOP_TO_N8N_SECRET = LENDLOOP_TO_N8N_SECRET;
  process.env.N8N_REQUEST_WEBHOOK_URL = "https://n8n.test/webhook/lendloop-request";
  process.env.ADMIN_EMAILS = "admin@lendloop.test";
  return convexTest(schema, modules);
}

export type T = ReturnType<typeof setup>;

/** Signs in a user (as Clerk would) and creates their Convex row. */
export async function signIn(t: T, name: string, opts: { emailVerified?: boolean } = {}) {
  const email = `${name.toLowerCase()}@lendloop.test`;
  const as = t.withIdentity({
    subject: `user_${name.toLowerCase()}`,
    givenName: name,
    email,
    emailVerified: opts.emailVerified ?? true,
  });
  const userId = await as.mutation(api.users.store, {});
  return { as, userId, email };
}

export function isoDate(offsetDays: number, from = Date.now()): string {
  return new Date(from + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Builds the headers n8n sends to Convex for a given method/path/body. */
export async function n8nHeaders(method: string, path: string, body = "", secret = N8N_TO_LENDLOOP_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacHex(secret, `${timestamp}.${method}.${path}.${body}`);
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature, "Content-Type": "application/json" };
}

export const drill = {
  name: "Cordless drill",
  category: "power tools" as const,
  condition: "good" as const,
  description: "Two batteries included.",
};
