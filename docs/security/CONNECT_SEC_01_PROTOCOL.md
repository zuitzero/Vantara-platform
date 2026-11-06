# CONNECT-SEC-01 Phase 1 — protocol and test contracts

Status: **PROPOSED / INACTIVE**, 2026-11-05. Refs [#49](https://github.com/zuitzero/Vantara-platform/issues/49),
[#45](https://github.com/zuitzero/Vantara-platform/issues/45), #47 and merged
[capability proposal](../cloud/CLOUD_03B_CONNECT_CAPABILITY_PROPOSAL.md) / PR #48.
Baseline main `7b8b986a6462d15889cb8ae93266991c78d81231`.
No landing/controller/provider, cookie issuance, schema/migration, feature flag,
legacy-link operation or real data is added. Contracts are imported only by tests.

## Current architecture and deliberate boundary

- [ConnectService](../../apps/api/src/connect/connect.service.ts) mints random32-byte
  bearers, stores SHA256, upserts one GuestConnectAccess per reservation and replaces
  tokenHash on reissue. Access row ID alone is not a generation identifier.
- [Admin controller](../../apps/api/src/connect/connect-admin.controller.ts) derives
  tenant from session/guards and requires reservations.manage for issue/revoke.
  Public legacy GET/POST use a token path; no guest cookie or one-use model exists.
- [Schema](../../apps/api/prisma/schema.prisma) / Connect v1 migration have composite
  reservation/tenant FKs, access expiry/revocation, but no consumed code, generation
  counter, guest session or idempotency table. Staff Session belongs to User and
  active membership; it must not become a guest capability container.
- [Guest UI](../../apps/web/src/app/connect/[token]/page.tsx) reads path token, polls
  every15s and posts through token paths; no fragment/history cleanup or strict CSP
  for a new shell exists. Legacy read may show post-checkout history until access
  expires; mutations require a live confirmed/checked-in stay. Nothing changes here.
- RequestsService owns request creation, housekeeping/maintenance/readiness and
  post-commit notifications. It has a transaction boundary, but no new guest-session
  revalidation/idempotency atomicity. Existing Serializable retries do not by
  themselves serialize a new exchange against every issuer/revoker/checkout writer.

This PR adds pure server preflights, typed private projections/persistence port and
synthetic tests in `apps/api/src/connect/protocol`. They do not authenticate a cookie,
resolve a code, prove entropy or create/consume anything. The test-only in-memory
reference adapter models required outcomes; it is not a production mutex, database
transaction, distributed concurrency test or reusable operational store.

## Candidate wire protocol (routes not registered)

| Operation | Fixed route / authority |
| --- | --- |
| Landing | GET `/connect`, token-free shell; optional `#code=…` bootstrap held only in browser memory |
| Explicit exchange | POST `/api/guest-connect/session`, JSON `{code}` only; no tenant/reservation/property/user/generation/role from client |
| Reload/poll | GET `/api/guest-connect/stay`, independent guest cookie; no bearer/resource identifiers in URL |
| Request | POST `/api/guest-connect/requests`, existing Connect request DTO + required opaque Idempotency-Key header |
| Logout | POST `/api/guest-connect/logout`, exact Origin/CSRF, revoke current guest session and clear only its cookie |

The guest-connect prefix avoids the current `/api/connect/:token[/requests]`
dynamic-route collision. Future code remains inside the Connect domain, calls the
existing request/operational service, and never invents a second request state machine.
No route listed above is implemented. Admin bootstrap issuance requires the existing
reservations.manage boundary and scoped reservation lookup; it must be a reviewed
new operation, not a silent semantic change to current legacy issue().

## Browser, cookie and CSRF contract

A minimal first-party bootstrap script extracts only canonical `#code=` plus43
base64url characters (32 bytes), removes the fragment with history.replaceState
before any **application-initiated** fetch/navigation/telemetry, then waits for an
explicit user action before POST. Initial token-free shell GET necessarily precedes
script execution. No SSR fragment processing, URL-query fallback, return URL,
local/session storage, third-party script, analytics, session replay or service-worker
cache. No redirect from a legacy URL can erase an earlier edge capture.

Later shell CSP must be tested with the actual Next build: default-src 'none';
script-src nonce/hash restricted to reviewed bootstrap/framework assets (no unsafe-inline
or unsafe-eval); connect-src 'self'; narrowly allow needed same-origin styles/images;
base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'. Use
per-response nonce for dynamic inline assets, never a static reused nonce. Enforce
no-store/no-referrer/nosniff. A CSP string alone is not evidence of XSS resistance.

Future exchange-body limit:1KiB enforced before JSON allocation for both length-delimited
and chunked requests; request DTO limits remain the existing operational contract.
Every exchange/request/logout requires POST application/json and an exact configured
HTTPS Origin, rejecting absent/null/suffix/foreign origins, including same-site
foreign subdomains. Never trust client forwarding headers or Origin as tenant
ownership; non-browser clients can forge Origin. Fetch Metadata may add defense,
not replace Origin or live authorization. Do not add the existing local missing-Origin
exception to these future session endpoints. Future local HTTPS test harness needs
separate review; current local HTTP Pilot remains unchanged.

Cookie: `__Host-vantara_guest`, Secure, HttpOnly, SameSite=Lax, Path=/, **no Domain**;
Max-Age/Expires bounded by session expiry; clear with identical scope. Separate from
`vantara_session`, with no User/membership/OWNER authority or staff-cookie fallback.
Never upgrade/overwrite either cookie from the other. Duplicate guest-cookie names
must be rejected, not arbitrarily picked. Raw code/session secret only briefly in
memory for exchange/Set-Cookie, never logs, audit metadata or persistence. Hashes
and internal scope are private server data, not response DTOs or telemetry labels.

## Time, generation and multi-device policy for review

Candidate values in the contracts: code5min, session absolute12h, idle30min,
maximum3 active sessions/access. Code/session expiry also bounded by access expiry
and reservation checkout; exact boundary rejects. Generate each secret independently
using existing32-byte cryptographic randomness, canonical base64url, unique SHA256
hash indexes; validate syntax is not proof of entropy. Use trusted DB/server UTC time,
not client timestamps. No extension from reads can exceed absolute/stay bounds.

New protocol requires HOTEL, consistent tenant/property/guest ownership and reservation/access scope,
CONFIRMED or CHECKED_IN, live generation and unrevoked access on every operation.
Proposed new sessions stop **reads as well as writes** on checkout/terminal state;
legacy's post-checkout history behavior remains unchanged. This difference and TTLs
need product/security review before implementation, especially delayed arrival links.

Mint a separate one-use code per device **without rotating the parent generation**.
Redeeming a consumed code on another device fails; explicit scoped reissue is required.
At cap reject without burning the new code or evicting a device silently. Logout
revokes only that session; expiry/logout frees a slot. Approved revoke-all/reissue-
all/checkout increments generation or revokes parent so all bound codes/sessions
fail. Guest/property reassignment must invalidate the generation. Current legacy issue/revoke must be included in the later coordinated writer
review; they do not currently enforce a generation counter. No active link or device
is revoked in this PR. Lost response after commit may burn a code: require reissue,
not replay returning the old raw session secret. No identity/MFA guarantee from
possession or a click; sharing/history sync/extensions/clipboard/screenshots remain risks.
Guest invitation/account enrollment remains separate; no role grants from Connect.

## Future persistence and race contract — no migration here

Proposed additive generation field on GuestConnectAccess, plus BootstrapCode,
GuestConnectSession and scoped request-idempotency records. Use stable parent
access/tenant/reservation composite FKs, property/tenant consistency and immutable
numeric generation snapshots. Do **not** FK old snapshots to a mutable current
counter: revoked generations must remain auditable without blocking rotation.
Keep staff Session separate; do not use tokenHash itself as a public generation.

A repository exchange must, in one bounded transaction:
1. Look up the unique code hash, derive all ownership from its persisted bindings.
2. Lock authoritative reservation then parent access then code in the reviewed
   common order. Re-read live status/checkout/tenant/property, generation, expiry,
   revocation and unconsumed state at the commit decision; no stale preflight grant.
3. Serialize active-session count on the parent lock; enforce cap, unique fresh
   session hash; conditional consume returns exactly one row and insert paired
   session. Roll back both if either fails. No external calls while locks are held.
4. Commit before Set-Cookie; return only minimized DTO/cookie, not record/hash/scope.

All protocol mint/exchange/revoke/logout/rotation and checkout writers must use the
same serialization discipline or proven Serializable conflict/retry protocol. Simply
marking consumed after reading is unsafe. Check real DB time after lock acquisition;
transaction-start timestamps must not extend a code while waiting for a lock.
PostgreSQL deadlock/serialization retry must recheck policy, be bounded and never
repeat a committed secret response. Application-process locks are insufficient.
The contracts' planExchange is a preflight, not a substitute for this repository.

For guest mutations, live session/parent/reservation checks and idempotency claim
must commit with request + operational side effects. Current request service cannot
be called inside a wrapper transaction while it independently opens another one;
review a narrow transaction-aware internal entry point and retain all existing
room/housekeeping/maintenance/audit rules. Key by server tenant/reservation/access-
generation + opaque key, store canonical payload fingerprint and result reference;
same key+payload returns same result, changed payload conflicts; always re-authorize
before even a cached response. No raw free text/body in idempotency logs. Notifications
remain post-commit and best effort unless a separate outbox PR is approved.

Revocation before exchange/mutation commit must deny and leave no side effects.
If an authorized mutation commits before revoke/checkout acquires the common lock,
keep it committed/audited; a later revoke cannot unsend an in-flight HTTP response or
notification. Document this ordering, recheck before sensitive delivery where useful,
and do not promise instantaneous revocation. Existing legacy races are not fixed here.

## Legacy migration and subsequent bounded PRs

| Increment | Scope / required gate |
| --- | --- |
| 1 (this PR) | Inactive contracts, threat/race protocol, synthetic reference outcomes; review values and semantics |
| 2 | Reviewed additive schema/repository + disposable PostgreSQL tests: two connections/processes, same-code race, cap race, rollback, expiry-after-lock, rotate/revoke/checkout ordering and constraint isolation. No new public routes or active-link operations |
| 3 | Explicitly reviewed gated issuance/exchange/session APIs + tx-aware request/idempotency integration; real HTTP cookie separation, duplicate-cookie rejection, Origin/CSRF, replay, A/B scope, audit/log canaries and lifecycle regressions; no default activation |
| 4 | Token-free shell and fixed guest calls; real browser CSP/XSS, extraction-before-fetch, back/forward/reload, expired-code UX, multi-device/logout and body/cookie/edge canaries. No legacy retirement |
| 5 | Separate operator-reviewed rollout: inventory unexpired legacy capabilities, coordinated issuance/version selection, revocation/expiry window, guest support/reissue, provider evidence and explicit rollback decision; never silently migrate live stays |

Legacy URLs remain on their current private/local permitted path until a reviewed
transition exists. Version new issuance without rewriting old links; keep old API
semantics and Pilot tests. Staging/public ingress is **BLOCKED** while usable legacy
bearers could reach an unverified HTTP log sink, including error/redirect/default-host
paths. “Zero old links issued” is not proof zero usable links remain. Explicitly
revoke/expire old access with approval and prove first-hop/body/cookie log controls.
Rollback must disable new issuance/ingress and preserve generation revocations,
idempotency/audit data and compatible readers; never resurrect consumed codes,
revert to permissive logging, run destructive reset or reopen public signup.

## Executed contracts versus remaining acceptance

Synthetic unit tests cover strict body/fragment syntax, ownership-field rejection,
Origin/method/content type, canonical cookie/path descriptor, A/B scope consistency,
reservation/property/generation mismatch, expiry/revocation/checkout boundaries,
modeled simultaneous one-winner exchange, paired failure rollback, commit-time
revocation and multi-device cap/replay outcomes. They create no real capability,
guest account, browser cookie, server or database. Reference scheduling is single-
process JavaScript; **no PostgreSQL atomicity or browser/CSP acceptance is claimed**.

API/Web/Pilot CI preserves current behavior. Real future repository concurrency,
request idempotency/lifecycle integration, browser history/CSP, provider log/body/
cookie capture, private DB TLS/roles and device/WSS acceptance are NOT RUN here.
The redesign may make managed hosting cheaper by removing URL secrets, but HTTP
terminators still see POST bodies/cookies; [provider gates](../cloud/CLOUD_03B_PROVIDER_DECISION.md)
remain open under #45. No provider purchase, deployment, real data, Stripe/AI or
security bypass is implied. Final validation counts/run links are in the PR.
