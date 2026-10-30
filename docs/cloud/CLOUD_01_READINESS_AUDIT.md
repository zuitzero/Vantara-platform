# CLOUD-01 phase 1 — deployment-readiness audit

**Audit only / NO-GO for real-hotel activation.** Reviewed 2026-10-28 against main
`80039c59cc210b10fa9f21b7bf04745e73a5163a`. Addresses only Step 1 of
[issue #41](https://github.com/zuitzero/Vantara-platform/issues/41), not its deployment acceptance.
No deployment or purchase was performed. No hosting/billing accounts, secrets,
databases, invitations or real/customer data were created or accessed. No runtime/schema/pricing changes.

Companion documents: [architecture/costs](CLOUD_01_ARCHITECTURE_AND_COSTS.md) and
[activation/operations/gates](CLOUD_01_ACTIVATION_AND_GATES.md).
This is a repository audit, not a penetration test or inspection of provider
accounts, actual network policy, backups, credentials or deployed services.

## Verified inventory

| Area | Existing evidence / current behavior |
| --- | --- |
| Workspace | Root pnpm 10.15.0 workspace + lockfile; CI uses Node 22 and `pnpm install --no-frozen-lockfile`. Proposed reproducible releases should use the reviewed lockfile with `--frozen-lockfile`; not changed here. |
| Web | [package](../../apps/web/package.json): Next ^16, React ^19, Socket.IO client ^4.8.1. Source App Router is `apps/web/src/app`, including `/`, `/onboarding`, `/connect/[token]`. `pnpm --filter @vantara/web build` then `... start` (Next default port 3000). A static export cannot replace this app. |
| API | [package](../../apps/api/package.json): Nest ^11, Prisma/client ^6, Stripe 22.6.0, validation and Socket.IO. Generate Prisma, `pnpm --filter @vantara/api build`, then `... start` (`node dist/main.js`, package working directory); `dev` is watch mode, not a release command. |
| Startup | [main.ts](../../apps/api/src/main.ts) sets `/api`, raw-body support, strict whitelist/reject-extra DTO validation and `PORT` default 3001. No startup env-schema validation, explicit HTTP CORS, proxy trust, throttling or security-header setup found. |
| HTTP / realtime | [Next rewrite](../../apps/web/next.config.ts) forwards `/api/*` using API_INTERNAL_URL (localhost fallback). [Socket hook](../../apps/web/src/app/use-realtime-notifications.ts) independently uses NEXT_PUBLIC_API_URL or localhost:3001, namespace `/realtime`, Engine.IO default path `/socket.io`. Gateway allows configured WEB_ORIGIN or permissive origin fallback. HTTP rewrite does not establish WebSocket routing. |
| Auth | [controller](../../apps/api/src/auth/auth.controller.ts), [service](../../apps/api/src/auth/auth.service.ts): scrypt password verification, random session bearer stored SHA-256 hashed, host-only HttpOnly SameSite=Lax cookie, Secure only with NODE_ENV=production. Session TTL 30 days; logout deletes that session; active membership checked server-side. No email verification, MFA, password recovery, dedicated CSRF/origin enforcement or rate limiter found. Socket authorization is checked at connection; no ongoing logout/expiry/membership-change disconnect was found. |
| Tenancy/RBAC | Current [RBAC](../../apps/api/src/rbac/rbac.service.ts) enforces HOTEL vs PLATFORM roles and membership; DTOs reject client ownership fields. Prisma has tenant indexes/composite FKs for some domains. Migrations do not establish database RLS; connection credentials alone do not isolate application tenants. Service/query checks remain essential. |
| Creation / trial | [onboarding](../../apps/api/src/onboarding/onboarding.controller.ts) exposes unguarded POST `/api/onboarding/workspace`; its transaction creates a new user, HOTEL, HOTEL_ADMIN, first property and TRIALING subscription. Existing email/slug conflicts rejected; cannot enroll existing user into another workspace. Email is syntactically checked, not verified. |
| Entitlements | [service](../../apps/api/src/entitlements/entitlements.service.ts): TRIAL_DAYS=14, active trial gets GRAND limits; expired/unpaid reports READ_ONLY. Capacity checks found at new Room/Staff creation; this is not evidence that all mutations become read-only. No permissioned trial-extension flow found. 7/30-day rules belong to [#38](https://github.com/zuitzero/Vantara-platform/issues/38), not this PR. |
| Invitations / staff | No invitation model/token/redemption/mailer or authenticated platform tenant-provisioning endpoint found. [StaffService](../../apps/api/src/staff/staff.service.ts) creates an operational profile from an **existing** HOTEL membership, not a user invitation or login account. |
| Billing | [StripeProvider](../../apps/api/src/billing/stripe.provider.ts) accepts only test keys and signed test-mode events. Checkout/Portal/reconcile require HOTEL_ADMIN and billing permissions; prices/URLs are server configured. Persistent event deduplication and audits exist. No live activation here; leaving secrets absent fails billing actions closed but does not hide/disable the existing Billing UI/routes. |
| Persistence | [Prisma schema](../../apps/api/prisma/schema.prisma), one global [PrismaService](../../apps/api/src/prisma/prisma.service.ts) connects on module startup/disconnects on destroy. PostgreSQL required; CI exercises PostgreSQL 18 fresh migrations. No configured managed backups, pool size, TLS contract or RPO/RTO in repo. No actual database was inspected. |
| Migrations | Existing SQL chain includes historical enum replacement/room-state changes; fresh migration CI is not an upgrade/restore test against existing populated data. Release must run reviewed `prisma migrate deploy` once with a separate migration role; never `db push`, reset or synthetic scripts against live data. |
| Storage / jobs | No upload/multipart/object-storage path, mail delivery, durable queue/outbox or scheduled cleanup/reconciliation job found. Connect polls every 15 seconds in a visible guest tab; this is client polling, not a server scheduler. Future uploads remain disabled until scoped access/scanning/retention are designed. |
| Health / monitoring | Public [health](../../apps/api/src/health.controller.ts) returns static OK. Protected operations health performs SELECT 1, but API/realtime are reported UP without independent checks. DB error text can flow through operations/incident logging. This is not an external monitor or sanitized production readiness probe. |
| Notifications | Durable records + per-user receipts and best-effort Socket.IO delivery; process-local buffering for selected transactions. Request publication is post-commit; no durable retry/outbox. Multiple API replicas lack a shared Socket.IO adapter/revocation strategy. |
| Deployment / CI | No tracked Dockerfile, compose, IaC, Railway/Vercel deployment manifest or deploy workflow found. Two Actions workflows test/build and a disposable Pilot DB. They have path filters; this documentation-only PR does not trigger them. App startup does not run migrations. No checked-in release/rollback/restore automation. |
| AI | No Intelligence module is registered on inspected main. PR #39 / #37 are separate; do not assume an open architecture PR is merged or enable AI as part of Cloud work. |

## Environment contract inventory (names only; never actual values)

| Variable | Boundary / requirement for later staging |
| --- | --- |
| DATABASE_URL | Server secret only; new environment-specific private PostgreSQL connection, least-privilege runtime role, verified TLS/pool settings; migration role injected only into the release job. Not the Pilot/local URL. |
| NODE_ENV / PORT | API: production mode over HTTPS, even on staging, so Secure cookie is exercised; platform runtime port. Web: production build/start; align platform health/ports. NODE_ENV is not an environment-isolation boundary. |
| API_INTERNAL_URL | Web server build/rewrite target; never a secret-bearing URL. Rewrites are built into release configuration: build separately for environment and verify resolved upstream; no localhost fallback in cloud. |
| NEXT_PUBLIC_API_URL | Public build-time browser configuration, never keys/passwords. One value currently serves incompatible HTTP-base and socket-origin assumptions; review separate realtime configuration in follow-up. |
| WEB_ORIGIN | Exact public Web HTTPS origins for gateway policy; no wildcard or unset permissive fallback. WebSocket Origin checks must be explicit: HTTP CORS alone is not access control. |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET | Optional sandbox secrets only, server scope, separate account/endpoint per environment if later approved. Default no configured billing credentials and controlled egress; no live key/event accepted. |
| STRIPE_PRICE_LOBBY / SUITE / GRAND | Server test catalog identifiers only; no prices changed or products created. |
| BILLING_SUCCESS_URL / CANCEL_URL / PORTAL_RETURN_URL | Trusted environment-specific HTTPS URLs if sandbox billing is separately tested; no local callbacks in cloud. |
| PILOT01_* / PG* / PRISMA_* | Existing demo helpers require strict local-only roles/base/markers and reject connection overrides. Do not inject demo configuration, copy its DB, relax guards or run its CI bootstrap in cloud. Prisma tooling variables need separate review if introduced later. |

Only `apps/api/.env.example` is tracked; ignore rules exclude local env files.
That is not a secret-scan result. Deployment/CI secret storage, access review and
rotation are required. Never read or paste actual local env files for this audit.

## Prioritized risks and ownership

P0 = blocker before browser-accessible staging; P1 = blocker before real guest data.
Owners below are responsibilities to assign to named people before execution.

| ID / priority | Risk / necessary follow-up | Owner |
| --- | --- | --- |
| R1 P0 | Localhost fallbacks, HTTP/socket namespace mismatch and host-only cookies across split hosts can break auth/realtime. Prove same-origin routing, handshake cookie and reconnect behavior. | API/Web + release |
| R2 P0 | Public workspace creation has no authenticated enrollment/invite boundary. Disable unapproved signup at ingress and private origin; implement audited platform activation before inviting hotels. UI hiding alone is insufficient. | Auth/security |
| R3 P0 | No reviewed secret/env schema, origin policy, abuse limits or header/log redaction. Apply admission limits, explicit WebSocket Origin enforcement, cookie/CSRF tests and provider/ingress access policy before exposure. | Security/release |
| R4 P1 | Runtime DDL/shared DB role or absent tenant constraints can amplify a query bug. Separate credentials/networks; test negative tenant access over HTTP/Postgres; audit FKs and RLS feasibility without claiming it already exists. | Data/API |
| R5 P1 | No proved backup/restore or migration rollback compatibility. Encrypted PITR/exports + isolated restore drill + release manifests required. | Data/release |
| R6 P1 | 14-day trial and partial enforcement do not meet #38; no secure invitation acceptance/extension. Do not promise 7/30 days or charge/convert automatically. | Product + auth |
| R7 P1 | Token-in-path, free-text guest PII and unsanitized DB/provider/incident errors can leak through infrastructure logs/APM/cache. Audit every logging layer and no-store/referrer controls. | Privacy/security |
| R8 P1 | Notification loss/duplicate request retry and in-flight token revocation races remain; no shared realtime state across replicas. Document manual recovery, test failures, and review transaction/outbox hardening. | Operations/API |
| R9 P1 | No external readiness, alert escalation, session/invite revocation drill, cleanup/export/deletion process. Local green tests do not establish these controls. | Operations/privacy |
| R10 P1 | Recovery of old DB snapshots can resurrect session/Connect/invite capabilities and billing state. Fence traffic, revoke recovered capabilities and reconcile approved provider state before re-opening. | Security/data |

No gate is closed by this audit. [The release plan](CLOUD_01_ACTIVATION_AND_GATES.md)
records proposed evidence and stop conditions. Local synthetic Pilot UAT is reported
in #35/#41; it is not evidence of deployed staging, real hotel use or production safety.

## Validation of this audit change

- Documentation-only: three new Markdown files; local link check resolved 21
  repository links, whitespace check passed and no credential-shaped values were
  found in those files. This is not a full repository secret/dependency scan.
- API build and Web build/TypeScript passed locally; Web output still contains
  `/`, `/onboarding`, `/connect/[token]`. No schema changed; no migrations executed.
- API test attempt: 316 passed, 15 integration tests skipped, 53 existing HTTP
  tests blocked by sandbox `listen EPERM` on loopback. No test failures were hidden
  or safety controls weakened; no local server/database exposed to bypass this.
- Existing baseline evidence for the exact inspected main commit:
  [API Security CI](https://github.com/zuitzero/Vantara-platform/actions/runs/38533147195)
  and [Web CI](https://github.com/zuitzero/Vantara-platform/actions/runs/38533147129)
  succeeded. These are historical baseline runs, not new cloud/staging validation.
  The existing path filters do not trigger CI for `docs/cloud/**`; no workflow
  changes, deploy runs, purchases or real-guest tests are added for this audit.
