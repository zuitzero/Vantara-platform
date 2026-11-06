# CONNECT-SEC-03 — default-off local synthetic HTTP boundary

Refs [#53](https://github.com/zuitzero/Vantara-platform/issues/53), #49, #51 and #45. Baseline main `cf096cf28766518974168a549dfced7f3ae1f818`, including merged #52. Read [protocol](CONNECT_SEC_01_PROTOCOL.md) and [persistence](CONNECT_SEC_02_PERSISTENCE.md) first; those documents describe their historical inactive phases. This increment adds the complete gated API boundary, not the browser shell or rollout.

## Gate and policy review

Default: **OFF**. Both middleware and route guards require all of:

- `NODE_ENV=test` or `development`, `VANTARA_ENV=local`;
- `CONNECT_GUEST_HTTP=synthetic-https-only`;
- `CONNECT_GUEST_POLICY_ACK=candidate-v1-synthetic-only`;
- exact loopback HTTPS `WEB_ORIGIN` (including port), real TLS socket and loopback local/remote addresses.

Every guest service operation also verifies the actual PostgreSQL18 connection is the marked `vantara_connect_sec02` disposable database, logged in directly as its non-owning DML-only test role with no memberships, DDL or elevated privileges. A development flag cannot authorize an accidentally configured real database. This deliberately binds the experiment to the disposable harness; changing that target is a future security review. The verifier is loaded lazily only for gated operations, so default-off startup does not depend on CI tooling or open a new database connection.

Cloud/production cannot enable this through the flag. Forwarding headers cannot supply TLS, IP or tenant authority. Existing main starts HTTP and therefore cannot serve these operations successfully even if someone sets the flag; only the disposable direct-TLS Nest harness is exercised here. Configuring an operator local HTTPS server is a separate review, not an instruction to expose localhost. Tunnels/SSH relays can make remote traffic appear local and cannot be reliably detected here; they remain prohibited.

The acknowledgement authorizes **synthetic experiments only**, not a founder policy decision. Five-minute code, twelve-hour absolute/thirty-minute idle session, three devices, delayed arrival, safe reissue and the loss of legacy post-checkout read history still need product/security approval before any rollout. Tests enforce candidate limits inside the gated experiment. No browser or guest UI is activated, no legacy link is migrated and no deployment is authorized.

## Implemented adapter

| Route | Authority / result |
| --- | --- |
| POST `/api/connect-admin/reservations/:reservationId/bootstrap` | Existing staff AuthGuard, TenantContextGuard, `reservations.manage`; HOTEL/live-stay checks; exact empty JSON object. Returns one random32-byte code and expiry, no bearer URL. |
| POST `/api/guest-connect/session` | Strict `{code}` only; atomic one-use exchange; returns CSRF proof/expiry and independent guest cookie after commit. |
| GET `/api/guest-connect/stay` | Live guest session/reservation; minimized stay and last50 own-guest reservation requests, plus reloadable CSRF proof. No client resource or tenant selector. |
| POST `/api/guest-connect/requests` | Live guest session, CSRF proof and required canonical random32-byte base64url `Idempotency-Key`; existing request fields/automation. Returns minimized request, HTTP200 for first creation or retry. |
| POST `/api/guest-connect/logout` | Empty JSON, guest session and CSRF proof; revokes only this device; HTTP204 and clears only guest cookie. |

The new guest prefix avoids the legacy `/api/connect/:token` collision. Issuance preserves any existing root hash, expiry/revocation and generation. If no root exists, it creates one under the reservation lock using an independent random hash; no usable legacy bearer is delivered. A revoked/expired/terminal root is not silently revived by bootstrap issuance. Safe operator reissue remains a policy review.

Every new operation requires exact configured **HTTPS Origin**, `X-Vantara-Guest: 1`, canonical fixed path (issuance has only its reservation ID), no query, no Authorization header, no content encoding and, when provided, `Sec-Fetch-Site: same-origin`. POST requires JSON; absent/null/foreign/suffix origins fail. Strict Origin is required on GET too; future browser integration must verify actual fetch behavior rather than weakening this contract automatically. Origin, CORS and the marker alone are not authentication. No new CORS allowance is added.

## Secrets, cookies and limits

Only SHA256 fingerprints reach PostgreSQL. Each bootstrap and session uses independent cryptographic randomness. Raw code/guest secret/CSRF proof stay in request-local memory and the authorized delivery, never application logs, SQL fields or audit metadata. The session cookie is `__Host-vantara_guest; Secure; HttpOnly; SameSite=Lax; Path=/`, no Domain. Absolute Expires is rounded down to cookie timestamp precision; no relative Max-Age can extend it during delayed delivery. Logout uses identical scope plus Max-Age0. Staff `vantara_session` is never accepted as guest authority, overwritten or cleared.

Cookie parsing examines all raw Cookie headers and rejects duplicate guest names (even identical values), malformed guest pairs and ambiguous duplicate staff names on the new boundary. Guest operations accept only the independent guest secret. Request/logout additionally require `X-Vantara-CSRF`, a domain-separated HMAC proof bound to that secret, returned only by the origin-checked exchange/stay response. Exact Origin + non-simple JSON/custom headers + session-bound proof protect mutations; SameSite is defense in depth.

Exchange JSON is limited to1KiB, other new bodies to8KiB, cookie text to8KiB. Conditional Nest parsers enforce limits on content-length and chunked input before JSON object allocation. Compression is rejected; parse/size errors return constant text without echoing input. Explicit100KiB fallback preserves legacy parser/raw Stripe webhook behavior. See [Nest raw body/parser documentation](https://docs.nestjs.com/faq/raw-body). Request fields reuse existing Connect semantics with trimmed2..120 title,2..1000 message, real enums and bounded1..100 guest count; ownership and unknown fields fail closed.

A bounded per-process fixed-window limiter allows120 attempts/minute per real peer/method/route, aggregate bootstrap route, maximum1000 entries. No code/hash/cookie/body is a limiter key or log label. This is local test abuse protection, **not a distributed Cloud limiter**; public deployment still requires reviewed shared/ingress limits, parser/header/timeouts and log redaction. A proxy restart resets this local memory. Socket/local network conditions do not prove external edge privacy.

## Atomic request and writer integration

`withSession` owns one bounded Serializable PostgreSQL transaction: resolve the hash; lock **reservation → access → guest session**; re-read and validate tenant/property/guest/stay/generation/hash/revocation/idle/absolute expiry; run the trusted callback; repeat time checks and touch activity; commit (including deferred expiry triggers). Serialization retries are bounded and reauthorize. There is no separately committed session precheck before a request.

The trusted RequestsService transaction entry point reuses its reservation request, housekeeping/maintenance, readiness and audit implementation without opening another transaction. The legacy wrapper continues owning its existing transaction and notification behavior. New requests store an atomic idempotency result keyed by access/generation/key fingerprint, with canonical normalized payload fingerprint and tenant/reservation FK. Claims never commit without their request and operational writes. Same key/payload reauthorizes then returns the existing result reference; changed payload returns409. Current guest matching prevents reuse of a former guest's result after reassignment. Returned status may reflect later staff updates to that same request; this is result-reference idempotency, not a frozen HTTP-response cache.

Notifications are post-commit, best effort, only on first creation; retries do not duplicate delivery. A crash or notification failure after commit can lose a notification. An outbox/reliable delivery guarantee is outside this change. A delayed/lost request response can safely retry the same key. A lost exchange response can consume the code without delivering a usable cookie: require authorized reissue, never replay the old secret. Revocation cannot retract already delivered/in-flight responses or committed work.

Legacy `issue` and `revoke` now lock reservation then access in a bounded transaction and advance generation when they already rotate/revoke the legacy bearer. Their public response/link semantics are retained. This does not bulk revoke or migrate any link. Checkout already updates/locks reservation before room, guest, housekeeping/readiness and audit writes under Serializable retry; new operations serialize on that row and deny terminal stays. No checkout automation is duplicated or rewritten. Terminal lifecycle cannot reopen. Existing assignment paths also update the reservation; fresh room context comes from that locked reservation. Future new reassignment/writer paths must preserve this discipline.

## Evidence and reproducibility

API Security CI creates a fresh marked PostgreSQL18 database and a random-password DML-only role (no owner/DDL/TEMP/membership/bypass). The existing target guard verifies role/database/marker/version and empty starting tables. No local or Pilot database is opened/copied. The CI helper generates a one-day self-signed test certificate in a private temporary directory with SAN127.0.0.1/localhost, deletes it afterwards and never logs its key or database credentials. Clients trust that specific certificate: TLS verification is not disabled.

`pnpm --filter @vantara/api test:connect-db` now runs existing persistence tests plus real Nest HTTPS tests inside their guarded fixture suite. Two separate Nest apps/one-connection Prisma clients represent contenders A/B; a third connection blocks and a fourth observes PostgreSQL lock waits/PIDs. Tests cover gate/Origin/parser/cookie/CSRF/RBAC negatives, two hotels, replay including HTTP contention, same-key HTTP concurrency/conflicts/retries, both writer/mutation orderings for actual revoke/rotate/checkout, expiry rollback of operational effects, delayed post-commit response, logout, canary logs/storage, local rate limiting and legacy HTTP with gate off. Ordinary API tests skip explicit database cases; pure contract tests still run.

After the DB/HTTP suite, CI fingerprints every model's populated synthetic records, reruns `prisma migrate deploy` and verifies byte-equivalent record fingerprints. This is a **populated no-op migration rehearsal**, not evidence of a schema upgrade over a populated production-sized dataset. No new migration is introduced here. Existing fresh chain, API build/tests, Web transport/build and independent Pilot01 PostgreSQL/HTTP suite must all pass. Exact final SHA/counts/run links are recorded in the PR. These are automated HTTP/database tests, not visual browser, ingress logging, provider TLS or real-hotel evidence.

## Rollback and outstanding gates

Disable the new flag/acknowledgement; the new boundary returns404. Retain generations, consumed codes, guest-session revocations, claims and audit history. Legacy readers remain compatible with additive #52 schema; do not reset/drop data, resurrect consumed codes, downgrade generation or revert to permissive logging. Pilot remains a separate local synthetic flow. No pricing/billing/AI integration or production migration is included.

Before public/real use: approve candidate product policies; implement and browser-test token-free shell, fragment cleanup, CSP/XSS/history/reload/cookie behavior; review all future writers and data cleanup; rehearse populated upgrade timing, encrypted backup/restore and forward rollback; resolve outbox/lost-response support; prove first-hop URL/body/cookie logging redaction, verified PostgreSQL CA/hostname, least privilege and distributed rate limits. Usable legacy URL capabilities still block unverified public ingress under CLOUD03. Do not treat this flag as permission to expose localhost, purchase/provision infrastructure, activate accounts or enable live Stripe/AI.
