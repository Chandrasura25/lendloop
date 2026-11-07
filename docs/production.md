# What I'd change to run this in production

The take-home is built to be correct and safe, but sized for a demo. These are the changes I'd make
before real neighbors used it, roughly in priority order.

## 1. Notifications people actually receive

- Replace the two mock Send nodes with a transactional email provider (Postmark, SES or Resend), on
  a domain with SPF, DKIM and DMARC. Keep the provider's API key in an **n8n credential**, not in a
  node.
- Add notification preferences (email on or off per event type) and a one-click unsubscribe.
- Template the messages, and localise them if the neighborhood needs more than one language.

## 2. Identity lifecycle

- Sync users from Clerk's signed webhooks (`user.created`, `user.updated`, `user.deleted`) instead of
  only on sign-in.
- On `user.deleted`, delete the user's listings, keep their loan history anonymised, and remove their
  name and email.

## 3. n8n hardening

- Run n8n on Postgres in queue mode with separate workers, so a slow run doesn't block webhooks.
- Put the editor behind SSO and TLS. Expose only `/webhook/*` publicly, ideally with an IP
  allow-list for Convex's egress.
- Move the signing secrets from container env vars into a secrets manager (or n8n external secrets).
- Back up the n8n database, and keep the workflow JSON in git as the source of truth, deployed by CI.
- Upgrade path: the Code nodes target n8n 1.x. On n8n 2.x, the external task runner needs
  `NODE_FUNCTION_ALLOW_BUILTIN=crypto` and env-var access configured the same way.

## 4. Secret rotation

- Add a key ID to the signature header (`X-LendLoop-Signature: k2=…`). Have the receivers accept the
  current and previous key during a rotation window, and rotate on a schedule.

## 5. Data and scale

- Store a denormalised `currentLoanId` and `nextAvailableDate` on each tool, updated in the loan
  mutations. Listing availability then stops needing a loans query per tool.
- Paginate the browse, request and admin lists (Convex `paginate`).
- Rate-limit request creation and listing creation per user.
- Store a neighborhood time zone, and compute "today" and "overdue" in local time rather than UTC.
- Add Convex cron cleanup for old `automationEvents` (e.g. keep 90 days).

## 6. Observability and operations

- Send structured logs from Convex and n8n to one place, and alert when an `automationEvents` row
  becomes `failed` or a `workflowErrors` row appears. The admin page is useful, but someone has to
  look at it.
- Add Sentry to the Next.js app.
- Add a health check that runs the overdue workflow's GET once an hour and alerts on non-200 responses.

## 7. Product safety and privacy

- Let users report and block each other, add a moderation queue for listings, and keep an audit log
  of admin actions.
- Write a privacy notice and a retention policy, and add an export of a user's own data.
- Add terms that cover damage or loss. The app records the condition of a tool when it's listed;
  photos at hand-over would help settle disputes.

## 8. Delivery

- Use separate Convex deployments and Clerk instances for preview, staging and production.
- Have CI run tests, then deploy Convex (`npx convex deploy`), then deploy the app to Vercel. Import
  the n8n workflows in a separate CI step.
- Add Playwright end-to-end tests for the main flows: sign in, list, request, approve, return.
