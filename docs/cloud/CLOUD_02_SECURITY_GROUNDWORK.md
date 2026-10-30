# CLOUD-02: signup and same-origin transport foundation

Scope: [#43](https://github.com/zuitzero/Vantara-platform/issues/43), part of
[#41](https://github.com/zuitzero/Vantara-platform/issues/41). Updated against
main `dd94979d64981d55b926de8e491206fb6be2d13e`, containing merged
[AI-01 PR #39](https://github.com/zuitzero/Vantara-platform/pull/39) and
[audit PR #42](https://github.com/zuitzero/Vantara-platform/pull/42).
AI-01 remains isolated contracts/validation only: no controller/provider activation
or request execution. CLOUD-02 runtime security behavior is unchanged by this sync.
The Web CI workflow retains both AI-01 path filters and transport tests/config.
This change provisions nothing and does not authorize exposure.

## Configuration contract

| Setting | Local development / synthetic tests | Future isolated staging / production |
| --- | --- | --- |
| NODE_ENV | `development` / `test` | `production`, including staging |
| VANTARA_ENV (API) | absent or `local` | `staging` / `production`, or absent with NODE_ENV=production; unknown values fail startup |
| ALLOW_LOCAL_WORKSPACE_SIGNUP | default denied; exact `true` explicitly opts into synthetic local onboarding | absent / `false`; any other configured value prevents startup; service always denies registration |
| WEB_ORIGIN | exact `http://localhost:3000` default; set explicitly for another local browser origin | required exact HTTPS public origin, no trailing slash, path, comma-list, wildcard, credentials or loopback |
| API_INTERNAL_URL (Web) | exact `http://localhost:3001` default | explicit private HTTP/HTTPS origin including port if needed; no credentials, path or loopback; set at build and runtime |
| NEXT_PUBLIC_API_URL | normally `/api` | absent or `/api` only; public build-time setting, never a secret |
| NEXT_PUBLIC_REALTIME_URL | optional exact origin; default `http://localhost:3001` | absent defaults to browser origin; override must equal WEB_ORIGIN at build and browser origin at runtime |
| DATABASE_URL (API) | existing separate local database / guarded Pilot target | explicit PostgreSQL URL, non-loopback host; secret-managed, private network and verified TLS must be established separately |
| STRIPE_* / AI | no activation by this change | leave unset; existing test-only Stripe key/event verification remains authoritative; no LLM adapter or key added |

API startup validates the nonlocal environment **before Nest/Prisma initialization**.
Unspecified NODE_ENV is not an escape hatch. The API `dev` script explicitly sets
`NODE_ENV=development` (also documented in the API example file); Next sets
its development/production mode. API/Next must receive matching WEB_ORIGIN.
Web production builds intentionally fail with absent Cloud origins/upstream.
The CI build uses reserved `.invalid` synthetic configuration and does not contact
that upstream. Build artifacts must not be promoted across differing configurations.
The origin checks are configuration validation, not DNS/network provenance checks:
localhost DNS aliases, SSH tunnels and private forwarding cannot be detected here.
Never point staging at a developer machine, local/Pilot DB or production database.

Local onboarding exercise: use a disposable synthetic development database, set
`NODE_ENV=development`, `VANTARA_ENV=local`, exact WEB_ORIGIN and explicitly
`ALLOW_LOCAL_WORKSPACE_SIGNUP=true`; restart the API after changing configuration.
Remove the flag after the exercise. Existing Pilot setup/reset still use their
strict local-only guards and need no signup opt-in. Follow
[the Pilot runbook](../PILOT_01_DEMO.md); never relax it for cloud.

## Boundaries and threat model

- **Unauthorized enrollment:** workspace creation is denied in OnboardingService
  before hashing, transaction or audit writes, including direct API requests.
  This adds no platform provisioning/invitation endpoint and grants no new role.
  The existing onboarding page may show the registration form but receives an
  explicit denied response. A trusted Origin is never authorization to enroll.
- **CSRF/login CSRF:** production unsafe HTTP methods require exact WEB_ORIGIN;
  missing/`null`/foreign Origin is denied, even with cookies. GET/HEAD/OPTIONS do
  not authorize writes. Explicit local dev/test allows absent Origin for existing
  synthetic tools; a supplied foreign Origin is rejected. The one exact exemption
  is `/api/billing/webhooks/stripe`: machine callbacks still require the existing
  raw-body signature and test-mode event checks. No broad `/billing` exemption.
  Non-browser clients can spoof Origin: session, permission and resource scope
  guards remain essential. The application does not trust forwarded headers to
  decide cookie security or origin authorization.
- **Cookies:** login/logout share host-only (no Domain), HttpOnly, Path=/,
  SameSite=Lax flags; Secure outside explicit local dev/test. Existing random
  session secrets stay hashed in the database; no static auth signing key added.
  TLS termination and gateway forwarding must preserve Set-Cookie and Cookie.
- **WebSocket cross-site hijacking:** exact Origin enforced at Engine.IO
  `allowRequest` (including WebSocket upgrade) and again before namespace auth;
  CORS is no longer permissive. Namespace authorization retains HOTEL roles,
  notifications.read and tenant-derived room membership. No token query parameter.
- **Revocation:** before each notification delivery, reload session and membership,
  compare bound user/tenant/role and recheck permission. Expired/deleted sessions,
  tenant switches, membership or permission changes withhold delivery and disconnect.
  An idle stale socket stays physically connected until the next event/reconnect;
  it cannot receive a new notification without revalidation. There is no client
  command handler. No promise of instantaneous revocation or race-free transactions:
  revocation between the final DB check and network send is still an in-flight race.
- **Best-effort realtime:** delivery failures do not undo persisted notifications.
  Revalidation adds DB reads per recipient per event; load-test before exposure.
  No shared adapter, queue/outbox or multi-replica consistency is implemented.
- **Capabilities/privacy:** API replies use no-store/no-referrer/nosniff/frame-deny;
  Web uses no-referrer/nosniff/frame-deny and Connect pages no-store. No request,
  handshake cookie, bearer path, body or origin value is added to application logs.
  These headers do not sanitize CDN/proxy/APM/database logs or browser history.
  Connect tokens remain path capabilities; ingress must omit/redact raw paths,
  query, Cookie/Set-Cookie, Authorization and bodies **before** accepting traffic.
  Use route templates/correlation IDs, not hotel/guest names, room IDs or tokens.
  A full CSP, HSTS rollout and telemetry/error redaction audit remain follow-ups.

## Future same-public-origin routing (not deployed)

| Public route | Required future private destination |
| --- | --- |
| `/`, `/onboarding`, `/connect/*`, Next assets | Next.js Node service |
| `/api/*` | Nest with prefix preserved (or Next HTTP rewrite to that same private API) |
| `/socket.io/*` | same long-lived Nest/Socket.IO service; upgrade support, query preserved, sensible idle timeouts |
| Socket namespace `/realtime` | namespace on the above Engine.IO connection; **not** `/api/realtime` |

Public browser URL is HTTPS; Socket.IO negotiates WSS with `path: /socket.io`.
Do not assume the Next HTTP rewrite proxies WebSocket upgrades. A future gateway
must route them explicitly. Keep API/Web origins and PostgreSQL private, reject
direct-origin access and restrict staging to reviewers. No gateway manifest,
provider account, tunnel, firewall rule or deployment is created here.

## Validation and deployment-independent reproduction

```sh
pnpm --filter @vantara/api exec prisma generate
pnpm --filter @vantara/api test
pnpm --filter @vantara/api build
pnpm --filter @vantara/web test
WEB_ORIGIN=https://synthetic-staging.example.invalid \
API_INTERNAL_URL=http://api.internal:3001 pnpm --filter @vantara/web build
```

API tests include fail-closed signup/config, exact-origin policy, secure cookie
flags, session hash/expiry/membership/logout behavior, namespace origin rejection,
per-delivery revocation and tenant isolation. HTTP tests use real Nest routing,
auth/tenant/permission guards and services with **mocked synthetic Prisma records**;
they cover actual Engine.IO upgrade Origin checks, direct-origin signup, login CSRF, Set-Cookie, missing sessions,
client tenant fields and both A→B/B→A guest lookup denial. These are not a real
PostgreSQL or browser test. Web tests exercise same-origin transport config.
Existing API CI separately migrates a fresh disposable PostgreSQL service and
runs the guarded Pilot 01 regression. No real hotel/provider data is used.

Local sandbox result: API build and Web build/TypeScript passed; Web tests passed.
Full API attempt on updated main: 431 passed, 15 skipped; 65 cases blocked by loopback `listen
EPERM` across existing Billing and new HTTP tests. No test is weakened/skipped to
hide that restriction. CI results for the exact PR revision must be checked before
review approval. Automated tests/builds are not browser visual validation.

## Staging gates still pending

1. Human review of this PR and #42; separate authorization for any resource/spend.
2. Private origins/DB, single HTTPS/WSS gateway and independent synthetic staging;
   secret manager, separate runtime/migration roles, verified PostgreSQL TLS/pool
   policy, dependency/secret scanning and egress controls. DB URL host validation
   does not prove encryption, strong credentials, safe DNS or least privilege.
3. Review rate/admission limits for login, Connect, upgrade attempts and messages;
   upstream body/connection limits; centralized sanitized logging and alerts.
4. Real HTTPS browser/device tests: Secure cookie, login/logout, hostile/missing
   Origin, session expiry, tenant switch, connected membership revocation,
   reconnect and two synthetic tenant boundaries over HTTP **and actual WSS**.
5. Existing Pilot real-DB flow in isolated CI; separate synthetic staging fixture
   plan through reviewed activation. No copying or exposing the local Pilot DB.
6. Reviewed authenticated platform-only activation, verified one-use invitations,
   account recovery and #38 trial enforcement. No manual SQL/password workaround.
7. Backup/restore and populated migration drills, rollback artifact/config evidence,
   alert/on-call, privacy retention/deletion/support approval before any real data.

**Rollback:** no schema/data migration was added. Preserve paired Web/API artifact
and configuration revisions. Fence traffic and drain sockets before a compatible
rollback. Reverting this PR reopens public signup and permissive socket origins;
keep ingress and API unreachable rather than roll back an exposed environment to
that behavior. Never enable the local signup flag, weaken Pilot guards or reset a
shared DB to recover staging. No merge/deploy or full readiness is claimed here.
