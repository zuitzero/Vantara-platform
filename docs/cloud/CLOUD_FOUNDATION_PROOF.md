# CLOUD-FOUNDATION · Disposable Showroom admission proof

[Release 1.0 #64](https://github.com/zuitzero/Vantara-platform/issues/64) builds on [CLOUD-04](CLOUD_04_SHOWROOM_DESIGN.md), [CLOUD-05A](CLOUD_05A_SHOWROOM_BOUNDARY.md) and [CONNECT-SEC-03/04](../security/CONNECT_SEC_03_HTTP.md). The enclosed proof exercises the existing product on a reserved host and throwaway PostgreSQL 18. The public release gate stays closed.

## Admission and route contract

The default gateway retains CLOUD-05A. The review-only renderer `node infra/staging/showroom-gateway.cjs --disposable-guest-proof` adds the exact POST guest and operator routes and the existing notification read-receipt endpoint. Use the matching dedicated Web and API entrypoints. They require the existing CLOUD-05A settings, `SHOWROOM_GUEST_MODE=disposable-proof`, `SHOWROOM_REPLICAS=1`, a reserved HTTPS `.example.invalid` origin and the private ingress proof. API and Web bind to loopback. The declared replica count is a configuration prerequisite. An actual singleton deployment and prevention of parallel listeners remain provider checks.

| Exact route | Authority and behavior |
| --- | --- |
| GET `/connect` | CSP-protected Next shell. The code travels only in the browser fragment and is removed before application requests. Explicit confirmation sends it in the exchange body. |
| POST `/api/showroom-admission/issue`, `/api/showroom-admission/revoke` | Dedicated `connect.showroom.invite` grant for one exact `tenantId:userId` pair configured only on the API as `SHOWROOM_GUEST_OPERATOR`. Requires authenticated HOTEL_STAFF in that HOTEL tenant. A general administrator, a second hotel and a guest have no grant. Body accepts only a canonical reservation ID. |
| POST `/api/guest-connect/session`, `/stay`, `/requests`, `/logout` under the same prefix | Fixed-path guest protocol with one-use exchange, independent host-only Secure HttpOnly cookie, strict HTTPS Origin, duplicate-cookie rejection, explicit CSRF for writes, and idempotency. The reservation and tenant come from the guest session. Only the preset towels request is accepted, up to three new requests per stay across reissues. |
| PATCH `/api/notifications/:id/read` and WSS `/socket.io/?EIO=4&transport=websocket`, namespace `/realtime` | Existing scoped staff permissions. The WebSocket reconnect authenticates again. Guest history uses fixed-path HTTP polling. |
| Legacy link, issuance, signup, billing, tenant switch, alternative host and unknown or encoded routes | Denied by the existing raw layers. The proof does not accept forwarded protocol headers as ingress authority. |

An invite expires at the earliest of five minutes and the stay boundary. Use one device per reservation generation. The viewer session ends after 60 minutes, 15 minutes without accepted traffic, checkout or operator revocation, whichever comes first. Reissue invalidates the previous code and session in the same transaction as the next invite. The staff session, membership and reservation are verified under locks, and successful issuance or revocation writes a credential-free audit record. A reserved root namespace separates this authority from legacy roots without schema changes. The raw code appears once in the authorized issue response. Keep it out of logs, recordings, sharing tools and exports. QR possession remains bearer possession.

## Reproduce the isolated proof

Run **API Security CI**, **Web Command Center CI** and **Staging Phase A configuration** on the reviewed SHA. The workflow creates a fresh named PostgreSQL 18 database in its service container. `apps/api/scripts/showroom-ci.cjs` refuses a nonempty target or mismatched connection, runs the existing migration chain as the database-owner migrator, then seeds with a separate fixture identity. The app runtime cannot edit roles or passwords, read billing or migrations, create schema objects, or assume the migrator/fixture roles. The fixture adds loopback Nginx TLS with a throwaway certificate, authenticated WSS, real Next/Nest and Chromium on disposable data. The provider-neutral renderer is inspectable offline with `node --test infra/staging/*.test.cjs` and contains placeholders.

Verify token-free route/history, staff guest-cookie separation, A/B denials, replay, revocation, role privileges and scoped requests. Keep outputs as case labels and statuses. Neither the fixture database nor its authority has a relationship to Pilot 01. Recovery at this stage means stopping the proof gateway and both origin processes. Revert the stacked cuts in reverse order and keep the original Pilot environment untouched.

## Mandatory release gates

| Gate | Disposition |
| --- | --- |
| Disposable engineering tests | See the stacked PRs for exact commits, PASS/FAIL and CI artifacts. |
| First HTTP receiver | **BLOCKED.** Capture synthetic canaries for authorized and rejected paths, query, cookies, exchange/issuance body and response across access/error/security/export/support sinks. Require absence before persistence. |
| PostgreSQL | **BLOCKED.** Verify the pinned Linux Prisma engine using the provider private endpoint, correct CA and DNS hostname. Wrong CA, wrong hostname and cleartext must fail. Rehearse CA rotation and prove no direct public network path. Local HTTPS cert testing covers browser ingress only. |
| Origin and staff admission | **BLOCKED.** Prove off-network origins inaccessible, approved certificate lifecycle, reviewed operator MFA and identity provisioning, provider-driven replica ceiling and access controls. Consider secret and actor rotation plus real limits under shared NAT. |
| Recovery and operations | **NOT RUN.** Measure isolated backup restore, invalidate restored invitations/sessions before ingress, rehearse monitoring, retention and rollback. |
| Physical phone/laptop, founder Mac mini | **NOT RUN.** Rehearse on independently connected devices only after the preceding gates and separate founder approval. |

[Provider evidence checklist](CLOUD_03B_EVIDENCE.md) · [Activation and recovery](CLOUD_01_ACTIVATION_AND_GATES.md)
