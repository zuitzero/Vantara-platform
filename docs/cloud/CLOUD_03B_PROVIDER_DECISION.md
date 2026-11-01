# CLOUD-03B provider feasibility decision — 2026-11-01

Refs [#47](https://github.com/zuitzero/Vantara-platform/issues/47) and
[#45](https://github.com/zuitzero/Vantara-platform/issues/45). Documentation only,
from main `bd9a1395f130797013cf3e985eedee1cbbc5d77f` (merged #39/#42/#44/#46).
**No provider is approved; #45 stays open.** No account, resource, domain, secret,
purchase, deployment or runtime change is authorized by this decision.

## Recommendation and scope

Preferred **feasibility candidate**: AWS NLB **TCP:443 passthrough**, customer-controlled
TLS-terminating Nginx on private compute, private Next/Nest services and private
RDS PostgreSQL in one VPC. No CDN, ALB, managed HTTP edge or third-party WAF before
that gateway. NLB does not decrypt this listener's traffic; this removes the
upstream HTTP request-target visibility of the selected services by design, not
by downstream redaction. RDS documents a CA/endpoint-verifiable certificate.
This is a documented architectural fit, **not a deployed security PASS**. [A1][A2]

Fallback: a dedicated staging EC2 gateway/containers with TLS terminated there,
only 443 public and API/Web ports reachable solely on private container interfaces,
plus private RDS in the same VPC. This avoids the NLB charge and preserves control
of the first HTTP parser, but creates a single-host availability/patching burden.
Use only if a named operator accepts certificate renewal, host hardening, incident
response and restore duties. No founder hardware, tunnel or Pilot database.
If neither candidate fits staffing/budget, stop; don't weaken either blocker.

Render remains **BLOCKED for the unchanged application** on both edge capture and
private DB identity verification. Railway and Vercel combinations are not automatic
escapes from URL-bearing platform logs. A reviewed token redesign could change the
logging threat, but is a separate proposal, not a dependency silently implemented
here. [Proposal](CLOUD_03B_CONNECT_CAPABILITY_PROPOSAL.md).

## Evidence semantics and comparison

**PASS** = the specific capability is supported by cited documentation/design.
**UNKNOWN** = required detail or test evidence missing; operationally blocks approval.
**BLOCKED** = current design conflicts with the requirement, or lacks indispensable
proof. No cell claims tested cloud behavior or vendor-wide insecurity.
All source identifiers resolve in the [dated evidence register](CLOUD_03B_EVIDENCE.md).

| Candidate | First HTTP receiver / current bearer URL gate | Private DB CA + hostname with Prisma6 | Private Web/API and same-origin cookies | WSS / recovery / maintenance |
| --- | --- | --- | --- | --- |
| Render gateway + private Web/API + Render PG | **BLOCKED**: Pro+ public-service request logs include requested URL/path before Nginx; no pre-persistence suppression established. Avoiding Pro UI visibility is not proof of non-capture [R1] | **BLOCKED**: internal self-signed TLS explicitly excludes verify-ca/verify-full; require encrypts but is not equivalent identity verification [R2] | **PASS documented** private services; one gateway can preserve host-only cookies. Actual isolation/host policy **UNKNOWN** [R3] | **PASS documented** WebSockets and paid PITR; Pro+7-day recovery, latest ten minutes unavailable. Restore/rotation tests **UNKNOWN** [R3][R4] |
| Railway gateway + private Web/API + Railway PG | **BLOCKED**: edge terminates TLS; HTTP log fields include path. No documented pre-ingest suppression established [Q1][Q2] | **UNKNOWN**: template CA + optional private-host SAN is promising, not a pinned deployed certificate or supported rotation contract. Wireguard is not Postgres server identity [Q3] | **PASS documented** environment-isolated private network; single gateway shape fits. No public API/DB domains allowed [Q3] | **PASS documented** HTTP/1.1 WebSockets and opt-in PITR; single-node template is not assumed HA. Operator/image/CA/backup responsibility must be settled [Q4] |
| Vercel Web + Railway API/PG | **BLOCKED**: Vercel records concrete request paths/search parameters; Railway public backend adds a second logging boundary [V1][Q1] | **UNKNOWN**, same Railway driver/CA tests; never expose DB to solve split networking | **UNKNOWN/BLOCKED unchanged**: providers do not share the cited Railway private network. Need separately reviewed authenticated connectivity and one public-origin HTTP/WSS gateway; separate browser hosts break existing cookie assumptions | Vercel now supports WebSockets/Socket.IO; function-duration termination and reconnect/state distribution require adaptation. External rewrite support is not proof of private long-lived Nest routing [V2][V3] |
| Vercel Web + private backend / RDS | **BLOCKED** on current Vercel ingress URL logs; changing DB does not fix first HTTP capture [V1] | **PASS provider capability**, actual Prisma/native Linux CA/hostname test **UNKNOWN**; cross-provider private reachability **UNKNOWN** [A2] | Private connectivity/plan and gateway **UNKNOWN**, additional support/egress boundary; don't claim ordinary HTTP rewrite is private networking | Vercel WSS capability exists; existing single-process Nest lifecycle is not proven compatible; RDS PITR capability exists [V2][A3] |
| AWS TCP NLB -> owned TLS gateway -> private Web/API + RDS | **PASS documented design**: TCP listener carries ciphertext until owned gateway; real canary/config evidence **UNKNOWN** [A1] | **PASS RDS capability + Prisma source support**; actual endpoint/CA/hostname/rotation tests **UNKNOWN** [A2][P1][P2] | **PASS VPC design**: separate security groups, API only from gateway/Web as needed, RDS only from API/release job; validate no public endpoints [A2] | HTTP/1.1 Upgrade belongs to owned gateway/Nest; prove idle/reconnect/drain. RDS PITR restore is to a new instance. More IAM/network/cert/on-call work [A1][A3] |

Single-public-origin contract remains `/api/*` -> private Nest with prefix intact;
`/socket.io/*` -> the same Nest/Engine.IO with Upgrade, Cookie, Origin and query;
namespace `/realtime`. Web/Connect -> private Next. Preserve Secure/HttpOnly/host-only
cookies and server Origin/RBAC/tenant checks; no client tenant authority. Deny public
signup at gateway and API; no real Stripe/AI. One API replica until shared state,
revocation and notification delivery semantics are reviewed. The Phase A template
assumes TLS offload upstream; it **cannot be deployed unchanged** for the owned-TLS
candidate. A separate config review must add TLS termination/cert renewal. [repo]

## The two decisive blockers

**First receiver:** Render's request logs are platform-generated, not application
stdout. Dashboard filtering, disabling a drain, shorter retention, no-referrer,
no-store or Nginx category logs do not prove prevention of earlier persistence.
Railway also documents edge HTTP path logging; its log-history table explicitly
allows older logs to reappear on upgrade. A provider forum employee reply asserts
90-day storage and no per-service suppression; treat that as a vendor statement
needing a binding answer, not a contract or all-plan guarantee. Vercel distinguishes
route templates from concrete request paths and exposes search params. None of the
reviewed product pages establishes a suitable first-capture opt-out. [R1][Q1][V1]

For each candidate ask for written, plan/region-specific answers: which edge/WAF/
abuse/support stores see URL, query, headers or body; can fields be removed **before
any persistence**, including error requests/upgrades; actual backend retention vs UI
history; replicas/backups/support access/deletion; whether the setting covers custom
and default domains and CDN bypass. No vendor messages were sent. A shorter UI
window or commercial compliance report is not this evidence.

**Prisma and DB:** the repo uses default native Prisma Client, not adapter-pg;
lockfile and local `prisma -v` identify 6.19.3, engine
`c2990dca591cba766e3b7ef5d9e8a84796e47ab7` (macOS local, Linux target untested).
The pinned native parser recognizes prefer/disable/require and defaults certificate
acceptance to permissive; `sslaccept=strict` is required explicitly. Its connector
adds the supplied `sslcert` trust certificate and retains native TLS hostname checks.
That is source-supported capability, not proof against any provider endpoint. [P1][P2]

Do not copy libpq `sslmode=verify-full` into this engine and assume identical
behavior: pinned parser treats unsupported SSL modes as prefer. It parses `sslcert`;
a `sslrootcert` entry on the current documentation page is not evidence that this
pinned native parser consumes it. No driver, engine, URL or production setting is
changed here. Proposed proof settings must be checked against the exact binary:
require TLS, strict acceptance, reviewed CA via sslcert, real provider endpoint
hostname; never accept_invalid_certs or a mismatched CNAME/IP. [P1][P2]

Render's documented internal limitation cannot be waived by saying “self-signed
can be trusted” in principle: need supported trust distribution, correct SAN,
private endpoint verification and rotation, or a revised provider contract.
External Render PG is a **different public network** design, not a private-connection
PASS. Railway's current source includes private-domain SAN when its environment
supplies it; pin the image and inspect actual CA/SAN/renewal before any inference.
No switch to JS driver, sidecar or tunnel is approved to get a green result. [R2][Q3]

## Pricing, region and operational decision

USD, **staging only**, 30 days/720h, no credits/free tiers/reservations assumed;
not a quote, customer pricing or spend approval. Taxes/FX/domain and commercial
support vary. Current public anchors and uncertain inputs are separated below.

| Candidate / explicit sizing | Arithmetic anchors | Planning allowance / unknowns |
| --- | --- | --- |
| Render: gateway512MiB, Web/API2GiB each, PG1GiB, Pro workspace | Prior Phase A $7 + 25 + 25 + 19 + workspace25 = $101; current official indexed PG19/service7 and workspace announcement25; Web/API25 remain reconfirmation inputs | $150–200 infra reserve, plus staff; storage/build/egress/restore extras. Security **BLOCKED regardless of price** [C1] |
| Railway all-in-one | Pro minimum20 includes20 usage, not an extra charge. Example total2GB RAM +0.2 average vCPU +5GB volume +10GB egress: 2,592,000s × (2×0.00000386 +0.2×0.00000772 +5×0.00000006) +10×0.05 ≈ $25.29 | $60–150 reserve; example is not a memory/load guarantee for four services. PITR/storage/HA, replicas, builds and egress must be quoted; no default HA assumption [C2] |
| Vercel + Railway/managed PG | Pro headline20/month includes20 usage, plus separate backend/database cost; no double-counting either vendor's included credit | $100–250 reserve, private connectivity/paid networking potentially above this; seats, function/WS duration, logging add-ons, egress and two-vendor support need quote [C3] |
| Preferred AWS NLB + private compute/RDS | NLB example anchor0.0225/h -> $16.20 base + NLCU. Fargate Linux/x86 example: 0.000011244/vCPU-sec, 0.000001235/GB-sec. Gateway0.25CPU/0.5GB + Web/API0.5CPU/1GB each -> ≈ $44.43 compute/720h | Illustrative base $60.63 excludes RDS/storage/networking. Allow $200–350 infra total pending quote: RDS/storage/temporary restore35–90, private egress/endpoints/NAT strategy40–100, logs/secrets/IPs10–30, headroom. Not additive verified vendor unit rates [C4] |
| Fallback EC2 TLS gateway + private containers + RDS | EC2/RDS region-specific rates not quoted; no invented instance price | $100–220 infra reserve, subject to measured sizing and full quote; lower automation, greater host/on-call ownership [C4] |

Reserve **6–10 operator hours/month at illustrative $75/h = $450–750** separately
for patches, certificate/CA rotation, logging audits and restore/on-call drills;
initial setup/security work16–32h = $1,200–2,400, not a vendor fee. Preferred combined
planning envelope is therefore $650–1,100/month plus tax/FX/support/domain. No named
person/rate/cap is approved. If staffing is unavailable, the candidate is BLOCKED.
No HA/production availability promise is included.

Region: use one approved deployment region per staging environment, with colocated
DB/compute. Render lists US Oregon/Ohio/Virginia, Frankfurt, Singapore; Railway lists
California/Virginia/Amsterdam/Singapore. AWS us-east-1 is **only the pricing example**,
not a residency choice. A Vercel global edge can process traffic outside the function
region; mapping all logs/backups/subprocessors remains required. Obtain latency,
data-residency, legal and capacity review before selecting. [C5]

## Staged proof and release gates

| Gate | Current state | Evidence required before approval |
| --- | --- | --- |
| G0 integrated baseline and docs scope | **PASS** | main SHA above; only Markdown in this PR |
| G1 pre-persistence URL safety | Render/Railway/Vercel **BLOCKED**; owned TLS design **PASS**, deployed proof **UNKNOWN** | Reviewed exact network path + plan answer; no earlier HTTP termination; synthetic canaries in path/query/encoded errors/upgrades; inspect every edge/security/drain/support sink with retention/deletion evidence, not just Nginx |
| G2 actual Prisma private TLS | Render internal **BLOCKED**; others **UNKNOWN** | Exact Linux engine + actual private endpoint: correct CA/host succeeds; wrong CA, trusted-CA wrong SAN, expired cert and TLS-disabled server all fail; capture sanitized outcomes only; prove CA rotation/reconnect. pg_stat_ssl/openssl/psql alone insufficient |
| G3 private networking and roles | **UNKNOWN** | No public API/Web/DB bypass; restricted SGs/project boundaries; runtime DML vs migration DDL/backup roles, SET ROLE/DDL denial, two-tenant HTTP/Postgres negatives |
| G4 transport/session | **UNKNOWN** | Real HTTPS Secure cookie, exact Origin/CSRF, WSS namespace/path, expiry/logout/revocation, reconnect/drain, mobile/independent networks |
| G5 recovery, admission and privacy | **UNKNOWN** | PITR/export restore to new isolated target, measured proposed RPO15min/RTO4h; restored capability revocation; 429/tenant quotas/load; alerts, deletion/on-call/rollback evidence |
| G6 founder approval | **BLOCKED pending feasibility** | Only after G1–G5 evidence: named account/region/domain/vendor owners, verified quote + cap/alerts, signed-off risks; then separate explicit provisioning/deployment authorization |

Tests above are designs, **NOT RUN against providers**. Under current restrictions,
first prepare reviewed offline TLS fixtures/harness and collect public/written vendor
policy without creating accounts. Any actual managed-endpoint proof needs a separately
authorized synthetic evaluation environment before a final spend/rollout decision;
this document supplies neither authorization. Existing API/Pilot/Phase A loopback
checks cannot establish managed endpoint identity or first-edge retention.

[R1]: https://render.com/docs/logging
[R2]: https://render.com/docs/postgresql-creating-connecting#ssl-modes-for-internal-connections
[R3]: https://render.com/docs/private-services
[R4]: https://render.com/docs/postgresql-backups
[Q1]: https://docs.railway.com/observability/logs
[Q2]: https://docs.railway.com/networking/edge-networking
[Q3]: https://github.com/railwayapp-templates/postgres-ssl/blob/main/init-ssl.sh
[Q4]: https://docs.railway.com/volumes/point-in-time-recovery
[V1]: https://vercel.com/docs/logs/runtime
[V2]: https://vercel.com/docs/functions/websockets
[V3]: https://vercel.com/docs/routing/rewrites
[A1]: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html
[A2]: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html
[A3]: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html
[P1]: https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/url.rs#L269
[P2]: https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/mod.rs#L855
[C1]: https://render.com/pricing
[C2]: https://railway.com/pricing
[C3]: https://vercel.com/pricing
[C4]: https://aws.amazon.com/fargate/pricing/
[C5]: CLOUD_03B_EVIDENCE.md
[repo]: ../../infra/staging/README.md
