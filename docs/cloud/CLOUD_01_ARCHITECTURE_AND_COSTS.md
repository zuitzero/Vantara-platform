# CLOUD-01 proposed architecture and cost assumptions

**Design for review, not provisioning authority.** Audited main/date and gaps:
[readiness audit](CLOUD_01_READINESS_AUDIT.md). No account, region, domain or paid
plan has been selected/purchased. All future execution needs a separate approved PR.

## Recommended shape for staging and first 1–2 production pilot hotels

One public HTTPS/WSS gateway -> private Next.js Node service + private long-lived
NestJS service -> private managed PostgreSQL, in a compatible region/private
network. Replicate this topology in an **independent** staging environment with
separate credentials, database, gateway, domains and recovery storage. Never use
the Mac mini, a tunnel, localhost forwarding or the `vantara_pilot01` DB as cloud
infrastructure. No production snapshots or guest records in staging.

Proposed routing (not configuration to apply):

| Public path | Origin / safeguards |
| --- | --- |
| Web/Connect pages | Next.js private service, session/login where appropriate; token pages no-store/referrer suppression, no analytics capturing URLs |
| `/api/*` | Private Nest API, strip spoofed forwarded headers at the trusted gateway, preserve original route prefix and Set-Cookie, enforce auth/DTO/RBAC in API |
| `/socket.io/*` | Private Nest Engine.IO with WebSocket Upgrade and cookies; namespace remains `/realtime`, not `/api/realtime` |
| Public signup | Deny unapproved `/api/onboarding/workspace` before exposure; origin must not be publicly bypassable. A future authenticated provisioning flow replaces reliance on this route. |
| Stripe webhook | Default disabled/denied for staging pilot; narrowly expose only for separately approved sandbox tests with raw-body signature verification. Never route directly to local API. |

The API process is private; authenticated browser requests reach it through a
public gateway. “Private API” does not mean a browser can address a private hostname.
A managed gateway/reverse-proxy service must explicitly support persistent WSS;
do not assume Next rewrites or serverless functions provide that bridge.

Keep HTTP browser base `/api`; a follow-up should separate socket origin/path
configuration so the browser uses the same public origin and `/realtime` namespace.
The current shared NEXT_PUBLIC_API_URL cannot safely be treated as both an API
prefix and socket namespace base. Host-only cookies then stay on one public host;
verify Secure/HttpOnly/SameSite plus server origin/CSRF checks. Do not broaden the
cookie Domain to all subdomains merely to compensate for topology errors.

Start with one API replica only after acknowledging its availability limits;
Socket.IO currently has no shared adapter or cross-process room/revocation strategy.
Horizontal scaling requires reviewed shared state/adapter, connection draining,
reconnect tests, pool budgets and consistent access revocation. No new Redis or
queue is purchased/proposed as already operational. Next cache and API responses
must never mix tenants or cache authenticated/Connect data at CDN layers.

Use provider-managed PostgreSQL with documented maintenance, backups/PITR and
restoration. Separate runtime DML, migration DDL and backup roles; migrations run
once per release, not concurrently at every application startup. TLS settings,
private DNS, pooling and connection budgets must be tested with the actual selected
provider. An unconfigured Postgres container plus a volume is not a backup plan.
Production and staging should not share a network trust zone; use separate
workspaces/accounts if environment/project boundaries do not enforce isolation.

## Provider alternatives — public documentation checked 2026-10-28

Recommended **evaluation candidate**, not an account selection: paid Render
services for gateway/Web/API plus Render managed Postgres. Its documentation
covers [private networking](https://render.com/docs/private-network) and
[WebSockets](https://render.com/docs/websocket); network scope, plan/region support
and gateway configuration still need proof in the later staging implementation.
Paid Postgres has PITR; free compute is not the production recovery option.
[Recovery policy](https://render.com/docs/postgresql-backups) states a 3-day Hobby
or 7-day Pro+ recovery window, with restores not available inside the latest ten
minutes. These are vendor capabilities, not measured Vantara RPO/RTO or a guarantee.

| Alternative | Fit / added work to approve |
| --- | --- |
| Vercel Next Web + Railway API + managed Postgres | Matches aspirational targets in `docs/ARCHITECTURE.md`, but not checked-in deployment config. Vercel Functions cannot host the current WebSocket server ([limits](https://vercel.com/docs/limits)). Cross-provider private networking is not automatic: approve authenticated origin connectivity and a WSS ingress, or accept a deliberately exposed API origin with strict controls. Rework cookie/socket design and verify commercial plan terms. |
| One Railway project per isolated environment | Long-lived services/private networking can fit the topology. [Database docs](https://docs.railway.com/databases/postgresql) distinguish single-node deployment from HA; backup/PITR/pooling and operational ownership must be explicitly configured, not assumed from a template. Do not equate service pricing targets with a contractual DB SLA. |
| Self-managed VM / founder hardware | More OS patching, backups, restore and on-call work; no advantage sufficient to recommend for first live guest data. Founder hardware, tunnels and Pilot DB exposure are expressly excluded. |

Provider Directory was attempted read-only but its CLI plugin metadata was
unavailable; no tooling/account setup was performed. Only official public sources
below support pricing/capability observations. No provider credentials were read.

## Separate monthly cost bands (USD; estimates, not quotes)

Public anchors checked 2026-10-28, excluding tax, FX, domains, mail, support,
extra seats, HA, regional/usage variation and optional security/observability:

- [Render pricing](https://render.com/pricing): 512 MiB app compute $7/month,
  2 GiB app $25/month; 1 GiB Postgres compute $19/month. Verify current workspace
  subscription, storage and bandwidth separately before any approval.
- [Vercel pricing](https://vercel.com/pricing): headline Pro $20/month with $20
  included usage. Treat seats, excess usage and commercial eligibility as quote
  checks; do not assume a free personal tier covers commercial hotel operations.
- [Railway pricing](https://railway.com/pricing): Pro $20 minimum with $20 usage
  credit, then metered resources; RAM $0.00000386/GB-second, CPU
  $0.00000772/vCPU-second, volumes $0.00000006/GB-second, egress $0.05/GB.
  A minimum/credit is not an extra $20 on top of the same covered usage.

| Scenario / explicit sizing assumption | Arithmetic floor and planning envelope |
| --- | --- |
| Candidate Render synthetic staging: 3 x 512 MiB gateway/Web/API + 1 GiB PG | $7×3+$19 = $40 compute/month. Budget **$50–100/month** plus any workspace subscription; test memory/load before accepting tiny instances. |
| Candidate production pilot: 512 MiB gateway, 2 GiB Web, 2 GiB API, 1 GiB PG | $7+$25+$25+$19 = $76 compute/month. Reserve **$100–250/month** plus workspace subscription for storage, encrypted exports, monitoring and headroom; not HA capacity or a recovery SLA. |
| Both candidate environments | **$150–350/month** plus workspace subscriptions/exclusions; staging and production are additive, not one shared database. Restore drills temporarily add database capacity. |
| Railway sensitivity check, not equivalent HA design | At 30 days, combined 2 GB RAM + 0.2 average vCPU + 5 GB volume + 10 GB egress is about $25.30 metered, above the $20 minimum. Allow **$40–120/environment/month** for headroom/recovery/usage; benchmark and quote separately. |
| Split Vercel/Railway alternative | At least the relevant paid Web subscription plus backend/database usage, networking and backups. Allow **$60–180/environment/month** plus seats/exclusions; not a claim of private connectivity at this price. |

Envelopes are analyst allowances above verified unit prices, not vendor offers.
No MXN conversion or Vantara hotel pricing is changed. Reject free/sleeping or
backup-less tiers for a live pilot; if required privacy/HA/recovery cannot fit the
approved budget, defer activation rather than quietly lower the gates.
