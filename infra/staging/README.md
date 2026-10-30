# CLOUD-03 Phase A — offline staging candidate

Refs [#45](https://github.com/zuitzero/Vantara-platform/issues/45), #41.
**Phase A only; do not close #45. No services, tenants, credentials or deployments
are created. Phase B needs separate founder authorization.**

## Consolidated architecture audit

Inspected main `b68ff9b3bed78fa6f9fd27786ab45ea3e88ddb1c` includes #39/#42/#44.
Nest/Prisma 6/PostgreSQL + Next 16 App Router remain the operational stack.
[Cloud audit](../../docs/cloud/CLOUD_01_READINESS_AUDIT.md),
[transport foundation](../../docs/cloud/CLOUD_02_SECURITY_GROUNDWORK.md),
[AI ADR](../../docs/adr/AI-01-connect-guest-assistant.md) remain authoritative context.

| Boundary | Present on main | Phase A disposition / unresolved gate |
| --- | --- | --- |
| Signup | Service denies by default; only explicit local/test opt-in | Gateway also denies normalized signup path; no invitation or platform activation workaround |
| Auth/tenancy | Hashed sessions, Secure host-only cookies, exact Origin/CSRF, RBAC + scoped Prisma queries | Keep app unchanged; API and DB must stay private; Origin alone is not authorization |
| Connect | Reservation capability in URL, expiry/revocation, server-owned request automation | Never log URL/body/headers; upstream edge/APM redaction still unproved |
| Realtime | `/socket.io` transport, `/realtime` namespace; per-delivery auth recheck | Explicit gateway Upgrade; one API replica, revocation race and DB-read/load costs remain |
| Intelligence | Pure contracts/tests, execution always rejected, no Nest provider/controller | No AI activation, provider SDK, prompt or key |
| Billing | Test-only provider/events, guarded operations | No Stripe keys injected; candidate gateway blocks billing routes entirely |
| Database/release | Fresh migration + synthetic two-tenant HTTP/Postgres CI | No cloud TLS/role/restore proof; existing Pilot tools remain localhost-only |
| Legacy code | Singular `notification.*` stub coexists with active plural `notifications.*` | Encountered during audit; no broad cleanup or migration to stub |

## Candidate topology and reproducible contract

Evaluation candidate: **one isolated paid Render staging environment**: public
managed HTTPS/WSS edge -> Nginx gateway -> private Next Node + long-lived Nest ->
private managed PostgreSQL. One API replica; separate production workspace/network,
DB, credentials, artifacts and gateway later. Region/account/domain/spend unapproved.
See [provider decision sheet](PROVIDER_DECISION.md) for unresolved feasibility.

`staging.example.json` is deliberately non-deployable: `.invalid` public origin,
`.staging.internal` placeholder DNS, no secrets. Strict offline validation rejects
real/local origins, unknown/secret fields, real data mode, trial/signup enablement,
Pilot DB, combined DB roles or insecure TLS intent. It validates **intent**, not
actual TLS, grants, network isolation or an injected DATABASE_URL. No .env is read.

```sh
node infra/staging/config.cjs check
node infra/staging/config.cjs render > /tmp/vantara-staging-nginx.conf
node --test infra/staging/*.test.cjs
# CI ONLY: installed Nginx, no public bindings; actual proxy integration test:
STAGING_NGINX_TEST=1 node --test infra/staging/*.test.cjs
```

Rendering writes no provider manifest, makes no network calls and starts nothing.
Do not run the output as a service. It is a review artifact for a later approved
release with owned hostname/private DNS/access policy. CI substitutes loopback
addresses for disposable fake upstreams; it never exposes developer localhost.
No Terraform/Blueprint/auto-deploy hook or cloud token is supplied.

| Service | Build / run contract for later approved immutable artifacts |
| --- | --- |
| Web | `pnpm --filter @vantara/web build`, then `pnpm --filter @vantara/web start`; supply matching JSON webEnvironment at build/run; private port 3000 |
| API | Prisma generate, `pnpm --filter @vantara/api build`, then `pnpm --filter @vantara/api start`; JSON apiEnvironment plus runtime DATABASE_URL from secret manager; private port 3001 |
| Gateway | Render managed edge terminates HTTPS/WSS; only trusted provider edge reaches Nginx port 8080. Nginx HTTP upstream is within reviewed private network, never a public origin. If end-to-end TLS required, approve TLS upstreams/mTLS separately |
| DB | Independent managed PostgreSQL 18 candidate, private DNS; deny external CIDRs, separate runtime/migrator secrets, verified TLS, no local/Pilot/production connection |

Pin reviewed source SHA, committed pnpm lockfile/dependency graph and image digests in later
release artifacts (current CI installs with --no-frozen-lockfile); don't build
from mutable main or mix Web/API revisions. No new Docker image is claimed here.
Only the API gets runtime DB credentials; only the one-shot release migration job
gets migration credentials. No secrets in NEXT_PUBLIC variables, logs or Git.
Stripe/AI/PILOT01/PG override variables must be absent from the staging release.

## Exact routes and transport

| Public route | Destination / behavior |
| --- | --- |
| `/api/*` | Nest, prefix and query preserved; original Origin/Cookie/Set-Cookie retained; no API prefix stripping |
| `/socket.io/*` | Same Nest instance, HTTP/1.1 Upgrade + Connection, cookie and query preserved, 75s idle timeout; namespace is `/realtime`, not a separate HTTP `/api/realtime` route |
| `/api/onboarding/workspace[/]` | 403 at ingress and denied in application; normalized encoded variants covered |
| `/api/billing/*` | 403 for this no-provider-activation candidate, even signed sandbox callbacks |
| Web/Connect/Next assets | Private Next; no-store at gateway, no-referrer; avoid CDN response caching entirely initially |
| Unknown Host/default provider hostname | closed with 444; actual owned-host/edge policy must be tested later |

Proxy resets client forwarding headers and sets fixed HTTPS scheme. It does not
trust a client tenant, Origin, X-Forwarded-For or forwarded Host as authorization.
App remains responsible for session, RBAC, tenant/resource and Connect scoping.
HTTP rewrite in Next is not used as the WebSocket bridge. Preserve raw POST body
for any later separately approved Stripe sandbox signature test; none enabled now.

## Ingress privacy and admission limits

Safe access log contains only fixed route category + status, never raw target,
query, IP, Cookie, Authorization, Referer, User-Agent, body or resource IDs.
Nginx error messages cannot be reliably field-redacted, so this candidate drops
request-context error logs to `/dev/null`; status-only metrics must provide failure
alerting. Startup diagnostics are allowed before traffic with no guest requests.
Integration sends synthetic capability canaries in paths/encoded paths/query,
headers and body and inspects **actual Nginx access logs**. It does not prove
Render edge/CDN/APM, Nest/Prisma errors, browser history or downstream logs safe.
Disable request tracing/APM/session replay and outer-edge access capture or prove
upstream sanitization **before** public requests. If provider cannot do that,
reject this candidate; a downstream redactor cannot undo prior capture.

Configured provisional limits: API 10r/s/IP burst20; login 2r/min/IP burst4;
upgrade 2r/s/IP burst5; 5 sockets/IP; 20 active HTTP connections/IP and 100 total;
16KiB body; 10s header/body timeout. Real integration sends an 8-request login
burst (including spoofed forwarding), expects 429, and verifies oversized body 413.
Do not load-test a remote service in Phase A. Shared NAT/edge IPs may over-throttle:
provider real-IP CIDRs and spoof rejection are unapproved; do not enable broad
trust in X-Forwarded-For to solve it. Use reviewer-only ingress meanwhile.

IP/connection limits are not tenant quotas. Follow-up API admission must derive
keys from live authenticated tenant/session or freshly resolved Connect access,
not client tenant IDs; proposed 60 mutations/min/tenant + 10 requests/min/access,
5 sockets/session and bounded concurrent DB work. No tenant limiter is implemented
here. Before Phase B exposure, test two synthetic tenants for fair isolation,
429/retry behavior, NAT/reconnect load and pool saturation. Disposition: **blocked**
until quotas, alerts and meaningful load envelope are approved. Revalidation on
notification send is not atomic with logout; no instantaneous revocation promise.
Single process/best-effort delivery has no outbox or shared adapter; no scale-out.

## PostgreSQL TLS and least privilege — requirements, not applied grants

Prisma is v6: use a provider-validated private connection with `sslmode=require`,
`sslaccept=strict` and mounted CA via `sslcert` when needed (relative to Prisma
schema directory), `connection_limit=5`, bounded pool timeout. `require` alone is
not a hostname/CA-verification test. [Prisma v6 SSL parameters](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql)
and [Render internal TLS caveat](https://render.com/docs/postgresql-creating-connecting).
Never set accept_invalid_certs/disable verification; private DNS is not TLS proof.
Render internal self-signed chain/hostname validation remains a selection blocker.
Later tests must reject wrong CA and hostname using the **actual Prisma driver**,
verify negotiated TLS via pg_stat_ssl, and reject external/public DB access.

| Role | Required privileges / credential location |
| --- | --- |
| `vantara_staging_runtime` | LOGIN, no superuser/CREATEDB/CREATEROLE/BYPASSRLS/replication; CONNECT target DB, USAGE app schema, explicit model-table SELECT/INSERT/UPDATE/DELETE and required sequence USAGE; not table/schema owner, no CREATE/DDL, no writes to `_prisma_migrations`, no role membership allowing SET ROLE to migrator |
| `vantara_staging_migrator` | Isolated release job only; own app schema/objects, run reviewed `prisma migrate deploy` once under release lock; no superuser/cross-database or runtime injection; expiring credential |
| Backup operator | Separate restricted export/recovery capability, not API role; encrypted destination access distinct from runtime, no app writes |

Bootstrap an **empty new** staging database under approved operator credentials;
revoke PUBLIC CONNECT/TEMP/schema CREATE, give only named roles required access.
After each migration grant the explicit Prisma model allowlist, excluding migration
metadata; avoid blanket default grants that expose `_prisma_migrations`. Do not
create a shadow DB or use migrate dev/db push/reset in staging. Verify runtime DDL,
SET ROLE and cross-DB denial, role ownership, intended DML, migrations and two-tenant
negative HTTP/Postgres tests. No RLS exists: a DB login does not replace app tenancy.
Budget one API pool of 5 plus migration/backup/admin reserve (propose 10 reserved),
validate against selected plan connection cap; no pool-per-request or shared prod DB.

## Synthetic setup strategy — no enrollment bypass

Phase A creates no cloud fixture tool or users. Existing Pilot integration remains
an isolated CI regression, not staging provisioning. No dump, copy, restore, seed,
role marker or localhost-only Pilot helper may target staging.
Before Phase B, separately review an idempotent synthetic-only fixture/enrollment
command bound to an attested empty staging DB, operator approval, distinct runtime
and provisioner roles, `.invalid` identities and server-derived tenant ownership.
It must reject populated/foreign DBs before writes and never enable public signup.
Then create A/B synthetic hotels with unique rooms/types/guests/reservations and
random private credentials/capabilities; use normal APIs for guest requests and
operational transitions. No real hotel activation, shared passwords or SQL workaround.
Reset strategy: append fresh synthetic stays, revoke sessions/links, retain audit;
foreign ownership rejection with zero writes; explicit operator authorization for
destructive teardown of isolated fixtures only. No such reset runs in Phase A.

## Recovery, rollback and acceptance

Release/data owner + backup approver must be named before Phase B. Proposed RPO
15min/RTO4h are targets, not measured guarantees. Paid PITR >=7 days, encrypted
logical export daily retained30 days, separate restricted storage/key recovery;
restore monthly into a NEW isolated target and measure lag/time, tenant relations,
operations, migration compatibility and invalidation of restored sessions/Connect
links before traffic. No production backup enters staging. Budget temporary recovery
capacity and test deletion/recovery retention; alert on stale backups/failed drills.

Pin paired old/new API/Web/gateway/config artifacts; snapshot before migrations,
review populated-synthetic upgrade and backward compatibility. Fence writes, drain
sockets, roll back compatible artifacts together, verify auth/tenant/Connect health.
No blind reverse DDL or DB reset; irreversible DDL needs forward-fix/recovery decision.
Never revert to public signup/permissive origins. Restore and rollback are NOT RUN.

Phase B gates: owner/vendor/region/domain/spend approval; private origins/DB + verified
TLS/roles; reviewer ingress; outer-log evidence; tenant admission/load/alerts; reviewed
synthetic provisioner; independent devices/mobile HTTPS/WSS cookie/login/logout,
Connect expiry/revoke, room/request lifecycle, A/B negative tests and reconnect;
measured restore/rollback; privacy/support/on-call ownership. Each must record exact
revision/config, PASS/FAIL/NOT RUN and approver. Do not treat CI as browser or cloud
acceptance. API/Web/Pilot CI is triggered for these config changes. See PR for exact
run links and local sandbox restrictions. No acceptance checkbox closes #45 here.
