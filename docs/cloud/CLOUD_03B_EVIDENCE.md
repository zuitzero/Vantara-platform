# CLOUD-03B evidence register

Checked **2026-11-01**, public official pages/source only, no authenticated account
or infrastructure inspection. Findings are bounded to these sources as retrieved;
absence of a documented control is not proof that no enterprise arrangement exists.
Decision: [provider note](CLOUD_03B_PROVIDER_DECISION.md).

| ID | Official evidence | Finding / qualification |
| --- | --- | --- |
| R1 | [Render logs](https://render.com/docs/logging) | Public web-service request logging on Pro+ includes URL/path. Documented retention: Hobby7/Pro14/Scale+30 days. No pre-persistence field-removal control established; private-request exclusion does not cover public gateway entry |
| R2 | [Render PG connection modes](https://render.com/docs/postgresql-creating-connecting#ssl-modes-for-internal-connections) | Internal optional self-signed TLS excludes verify-ca/verify-full; require recommended. Do not extrapolate encrypted external endpoints into private strict verification |
| R3 | [Private services](https://render.com/docs/private-services), [WSS](https://render.com/docs/websocket) | Private services lack public subdomains; WebSocket entry supported. Not proof of tenant isolation or log safety |
| R4 | [Render recovery](https://render.com/docs/postgresql-backups) | Paid PITR, 3-day Hobby /7-day Pro+ window, latest ten minutes unavailable; no restore measured here |
| Q1 | [Railway logging](https://docs.railway.com/observability/logs), [CLI HTTP logs](https://docs.railway.com/cli/logs) | Edge HTTP request path fields; history3/7/7/30/up-to90 days by Free/Trial/Hobby/Pro/Enterprise; upgrade can reveal older entries. These are not deletion guarantees |
| Q2 | [Railway edge architecture](https://docs.railway.com/networking/edge-networking), [provider forum reply](https://station.railway.com/questions/can-http-request-logging-be-disabled-or-30c1f581) | TLS ends at provider edge. Forum employee asserts mandatory edge logs, no per-service suppression/redaction and 90-day storage; lower-assurance support statement, obtain contract/retention clarification before relying on it |
| Q3 | [Private networking](https://docs.railway.com/networking/private-networking), [PG service](https://docs.railway.com/databases/postgresql), [official template source](https://github.com/railwayapp-templates/postgres-ssl/blob/main/init-ssl.sh) | Environment-isolated Wireguard network; current mutable template creates CA/leaf and includes RAILWAY_PRIVATE_DOMAIN SAN when supplied. Pin immutable image/source and prove CA distribution, real SAN and renewal; no deployed image was inspected |
| Q4 | [HTTP/WSS limits](https://docs.railway.com/networking/public-networking/specs-and-limits), [PITR](https://docs.railway.com/volumes/point-in-time-recovery), [HA](https://docs.railway.com/databases/postgresql-ha) | HTTP/1.1 WebSocket supported; opt-in WAL-based recovery exists. HA is a conversion/configuration, not implied by a PG template. Plan eligibility/retention/storage cost need quote |
| V1 | [Vercel runtime logs](https://vercel.com/docs/logs/runtime), [drain schema](https://vercel.com/docs/drains/reference/logs) | Concrete Request Path and Search Params are separate from route template. Current listed retention: Hobby1h, Pro1d, Enterprise3d, Observability Plus30d. UI/drain control is not evidence of pre-capture suppression or backend deletion |
| V2 | [Current WebSockets docs](https://vercel.com/docs/functions/websockets), [2026-06-22 announcement](https://vercel.com/changelog/websocket-support-is-now-in-public-beta) | WebSocket/Socket.IO websocket-only support exists; connections end with function duration, reconnect can land on another instance. Corrects older repo audit's blanket Functions limitation, not proof existing Nest is a drop-in |
| V3 | [External rewrites](https://vercel.com/docs/routing/rewrites) | HTTP origin rewrite capability alone does not establish Railway private networking or exact Nest Upgrade behavior |
| A1 | [AWS NLB listeners](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html), [NLB logs](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-access-logs.html) | TCP:443 can carry encrypted traffic to target without decryption. Legacy access logging documented for TLS listeners; do not infer absence of enhanced/flow/security metadata. Architecture deliberately excludes earlier HTTP decryption |
| A2 | [RDS PostgreSQL TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html), [VPC networking](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html) | Provider certificate includes endpoint identity and supports CA/hostname verification; private VPC placement available, not automatic. Correct Prisma Linux implementation still requires proof |
| A3 | [RDS PITR](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html) | Restore to a new instance, latest-restorable time matters; no measured RPO/RTO or retention configuration here |
| P1 | [Prisma6 connector docs](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql), [pinned URL parser](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/url.rs#L269) | prefer/disable/require and explicit strict acceptance; inspect pinned parser rather than transplant libpq parameters. Documentation and source coverage differ for sslrootcert |
| P2 | [Pinned native TLS builder](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/mod.rs#L855), [engine Cargo lock](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/Cargo.lock#L2922), [native-tls0.2.14 source](https://github.com/sfackler/rust-native-tls/blob/v0.2.14/src/lib.rs) | Loads root and selects invalid-cert acceptance from URL; dependency0.2.14 defaults hostname verification on. Source inference only; OS trust backends and deployed Linux behavior untested |
| C1 | [Render pricing](https://render.com/pricing), [official workspace announcement](https://render.com/blog/better-pricing-for-fast-growing-teams) | Indexed official pricing gives service512MiB7/PG1GiB19; announcement Pro25 flat. Dynamic full quote not retrieved. Preserve uncertain Web/API sizing/rates as assumptions |
| C2 | [Railway pricing](https://railway.com/pricing) | Pro20 minimum includes20 usage; RAM0.00000386/GB-s, CPU0.00000772/vCPU-s, volume0.00000006/GB-s, service egress0.05/GB. Actual usage/replicas/recovery extra |
| C3 | [Vercel pricing](https://vercel.com/pricing) | Headline Pro20/month with20 included usage; seats, add-ons and private connectivity are quote/eligibility questions |
| C4 | [Fargate rates/examples](https://aws.amazon.com/fargate/pricing/), [NLB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), [EC2](https://aws.amazon.com/ec2/pricing/on-demand/), [RDS](https://aws.amazon.com/rds/postgresql/pricing/) | US-East public examples anchor compute/LB arithmetic only; EC2/RDS/endpoints/NAT/IP/storage/support not region-quoted. No pricing-calculator/account action |
| C5 | [Render regions](https://render.com/docs/regions), [Railway regions](https://docs.railway.com/deployments/regions), [Vercel edge](https://vercel.com/docs/regions) | Deployment locality and global HTTP entry are different; no residency/compliance claim or region approval |

The provider Directory CLI was attempted read-only; plugin metadata remained
unavailable. No plugin installation, login, sandbox/account creation, credential
read or vendor message followed. Official web documentation supplied this evidence.
No forum assertion overrides a product contract. Recheck on any plan/image/driver
change and record URL, date, exact revision, assumptions and approval separately.

## Repository and validation evidence

- Inspected [Connect controller](../../apps/api/src/connect/connect.controller.ts),
  [issuance/access](../../apps/api/src/connect/connect.service.ts),
  [guest page](../../apps/web/src/app/connect/[token]/page.tsx),
  [PrismaService](../../apps/api/src/prisma/prisma.service.ts), lockfile, Cloud-02
  and Phase A docs. URL-path bearer exists at Web and API boundaries; native Prisma
  has no adapter configuration. No runtime/schema/config changes in this PR.
- Local read-only `prisma -v`: client/CLI6.19.3, native engine hash above,
  darwin-arm64, Node24.22.1. This is version identification, not a TLS handshake.
- API test/build and Web transport/build commands run for this doc change; exact
  outcomes and any EPERM restriction are recorded in the PR. No new test suite or
  provider experiment is represented as executed. The Phase A pointer under infra/staging triggers API/Web/config CI for this PR;
  results do not count as provider acceptance.
- All provider log searches/canaries, Linux TLS negative fixtures, real private DB
  probes, device/WSS, recovery drills and cost quotes remain NOT RUN. No actual
  Connect capability or real guest information appears in samples or evidence.
