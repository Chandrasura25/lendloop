// HMAC-SHA256 signing shared by both directions of the n8n integration.
//
//   Convex -> n8n:  signed string = `${timestamp}.${rawBody}`
//   n8n -> Convex:  signed string = `${timestamp}.${METHOD}.${pathname}.${rawBody}`
//
// The timestamp travels in `X-LendLoop-Timestamp` (unix seconds) and the hex digest in
// `X-LendLoop-Signature`. Requests older than SIGNATURE_TOLERANCE_SECONDS are rejected, which
// limits replays; idempotency keys make any replay inside that window harmless.

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison so the check doesn't leak how many characters matched. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifyN8nRequest(
  request: Request,
  rawBody: string,
  secret: string | undefined,
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: "server not configured" };
  const signature = request.headers.get(SIGNATURE_HEADER) ?? "";
  const timestamp = request.headers.get(TIMESTAMP_HEADER) ?? "";
  const ts = Number(timestamp);
  if (!signature || !Number.isInteger(ts)) return { ok: false, reason: "missing signature" };
  if (Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale timestamp" };
  }
  const { pathname } = new URL(request.url);
  const expected = await hmacHex(secret, `${timestamp}.${request.method}.${pathname}.${rawBody}`);
  return timingSafeEqual(expected, signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "bad signature" };
}
