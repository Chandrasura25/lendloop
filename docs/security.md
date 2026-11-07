# Security notes

This expands the README's security section into a small threat model: what is protected, from
whom, and where the control lives in the code.

## Assets

- **Accounts and roles**: who is an admin, and who is a Trusted Lender.
- **Listings and loans**: who owns what, who is borrowing it, and when.
- **Personal data**: names and email addresses.
- **Integration secrets**: the two HMAC secrets and n8n's encryption key.

## Trust boundaries

```text
Browser ──(Clerk JWT)──▶ Convex functions ──▶ Convex DB
                              │  ▲
              signed webhook  │  │ signed HTTP calls
                              ▼  │
                             n8n ──▶ (notification channel)
```

Everything from the browser is untrusted. n8n is trusted only as far as its signature proves.

## Threats and controls

| Threat | Control | Where |
| --- | --- | --- |
| A user edits or deletes someone else's listing by calling the API directly | Ownership is checked against the DB row in every mutation | `convex/tools.ts` `update`, `remove` |
| A user approves or declines a request for a tool they don't own | `loan.ownerId === viewer._id` | `convex/loans.ts` `decide`, `markReturned` |
| A user cancels someone else's request | `loan.borrowerId === viewer._id` | `convex/loans.ts` `cancel` |
| A user makes themselves admin | Role is server-side; there's no public mutation that sets it; `setRole` is an `internalMutation` | `convex/users.ts` |
| Someone signs up with an admin's email address | Bootstrap requires `emailVerified === true` from the Clerk JWT | `convex/users.ts` `store` |
| A non-admin reads all loans or user emails | `requireAdmin` on every admin query | `adminAll`, `listForAdmin`, `failures` |
| Over-exposure on the public page | `listPublic` returns only `{ name, category }` of available tools | `convex/tools.ts` |
| Forged calls to the Convex HTTP API | HMAC-SHA256 over timestamp, method, path and raw body; constant-time compare | `convex/lib/signature.ts`, `convex/http.ts` |
| Replaying a captured request | 5-minute timestamp window, plus idempotency keys (`reminderKey`, execution ID) | same, `convex/automation.ts` |
| Reusing a signature on another endpoint | Method and path are part of the signed string | `convex/lib/signature.ts` |
| Forged loan events sent to n8n | n8n verifies the HMAC over the raw body and rejects stale timestamps | *Verify signature* node |
| A leaked secret compromises both directions | Separate secrets per direction | `.env.n8n`, Convex env |
| Secrets committed to git | Secrets live in env vars only; the exported workflows reference `$env.NAME`; a test scans the JSON | `tests/n8n-workflows.test.ts` |
| Invalid or oversized input | Convex validators (fixed enums), trimming, length caps, date format checks | `convex/lib/constants.ts`, `tools.ts`, `loans.ts` |
| Malformed IDs from n8n crash a handler | `ctx.db.normalizeId` plus key/loan consistency checks; `422` instead of `500` | `recordReminder`, `http.ts` |
| Internal errors leak details | Only `ConvexError` messages reach the UI; HTTP `401` doesn't say why | `src/components/shared.tsx`, `http.ts` |

## Notes on specific choices

**Why not put the role in Clerk metadata?** It would work, but then the JWT template becomes part
of the security model, and a stale token keeps its old role until it expires. Keeping the role in
Convex means a demotion takes effect on the very next call.

**Why sign the raw body?** Re-serialising JSON can reorder keys or change whitespace, and then a
valid signature fails to verify, or worse, an attacker gets room to play. Both sides sign and
verify the exact bytes on the wire. The n8n webhook has *Raw Body* enabled for this.

**Why does n8n also deduplicate?** Convex can time out waiting for n8n after the notification has
already gone out. When it retries, n8n recognises the `eventId` and replies `200` without resending.
The ID is only recorded after a successful send, so a failed send can still be retried.

**React and Next.js versions.** React is pinned to the patched 19.1 line (`~19.1.4`), which Clerk
also requires.

## Not covered (would be in production)

- Rate limiting on mutations (e.g. requests per user per hour).
- An audit log of admin actions (who removed which listing and why).
- Account deletion flowing from Clerk to Convex (see `production.md`).
- Content moderation of listing text.
