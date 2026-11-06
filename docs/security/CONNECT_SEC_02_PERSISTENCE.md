# CONNECT-SEC-02 — inactive PostgreSQL persistence

Status: **INACTIVE**, 2026-11-05. References: [#51](https://github.com/zuitzero/Vantara-platform/issues/51), [#49](https://github.com/zuitzero/Vantara-platform/issues/49), [#45](https://github.com/zuitzero/Vantara-platform/issues/45).
Baseline: main `9ffac6e6ae91d1326411fef889907cac3db31ee4`, including PR #50.
Read with [CONNECT-SEC-01](CONNECT_SEC_01_PROTOCOL.md); this implements its persistence boundary, not its proposed HTTP/browser protocol.

## Scope and compatibility

`PostgresGuestAccessRepository` is deliberately **not registered** in a Nest module, controller, provider or feature flag. Nothing calls it from the running application. No landing page, route, cookie, raw-code issuer, legacy migration or request execution is added. Existing Connect issuance/revocation, bearer routes, staff sessions, checkout, Pilot 01, billing and AI retain their behavior.

The migration adds `GuestConnectAccess.generation` with default 1, plus empty bootstrap, guest-session and idempotency-reservation tables. Existing access rows and hashes are retained. A bootstrap requires an already existing access root: deciding how a future new issuer creates that root is a separate integration review. Private persistence records include hashes and internal scope; they must never become HTTP response DTOs or log fields.

## Persistence and trust boundaries

| Record | Constraints / purpose |
| --- | --- |
| Access root | Positive, non-decreasing generation; existing one-root-per-reservation constraint retained. |
| Bootstrap | Unique SHA-256 fingerprint; immutable access, tenant, reservation, property, guest, generation, legacy-hash and expiry snapshot; sticky consumption/revocation. |
| Guest session | Separate from staff `Session`; unique secret fingerprint and bootstrap; immutable scope/expiry, monotonic activity, sticky revocation. One consumed bootstrap produces at most one session. |
| Idempotency reservation | Unique `(accessId, generation, keyHash)`; immutable payload fingerprint; optional immutable-once-set request result, composite tenant/reservation FK. **No claim writer or request execution exists in this phase.** |

Composite access FKs reject foreign tenant/reservation ownership. Property/guest FKs enforce tenant ownership. Matching the reservation's *current* property and guest is additionally enforced by the repository under locks; these mutable associations are not frozen by extra reservation FKs. Tests include a same-tenant wrong-property snapshot inserted directly and rejected by the repository. This is not RLS: database owners and arbitrary direct DML are trusted administrative boundaries, not supported application entry points.

The repository accepts fingerprints only, never raw secrets. Future callers must generate independent cryptographically random 32-byte secrets, hash them before this boundary, derive tenant context from existing server authorization, and never deserialize private scope from guest JSON. Fingerprint syntax cannot prove entropy or authorized issuance. The class itself does not replace `reservations.manage`, HTTP authorization, origin/CSRF checks or cookie handling.

## Atomicity, ordering and time

Every repository operation uses a short interactive transaction, in this order:

1. Resolve a code/session hash only to locate its private parent IDs (never authority).
2. Lock **reservation → access root → bootstrap or guest session**, always in that order. Issuance/generation changes stop at the root.
3. Re-read live reservation, HOTEL tenant, property, guest and access after lock waits under READ COMMITTED.
4. Sample PostgreSQL `clock_timestamp()` after acquiring locks, validate live stay, generation, legacy hash, expiry/revocation and guest binding.
5. For exchange, count active sessions while holding the shared root lock; conditionally consume the code and insert its independent session in the same transaction. Any insert/constraint failure rolls both writes back.

The constructor requires an explicit policy, bounded by the proposed protocol ceilings: five-minute bootstrap, twelve-hour session, thirty-minute idle timeout, three active devices. These remain **candidate product limits**, not activated configuration. Delayed arrival, safe reissue and the difference from legacy post-checkout history also require founder decisions before launch. Logout releases a slot; stale-generation, rotated, revoked, expired or idle sessions do not count toward the current cap. The cap depends on all future writers using this repository/lock protocol; arbitrary SQL insertion is not a supported writer.

Transactions set UTC, READ COMMITTED, a five-second lock timeout, eight-second statement timeout and ten-second transaction timeout. Only serialization/deadlock failures are retried, at most three attempts; other errors fail closed with `GUEST_ACCESS_DENIED`. No raw database error, SQL parameters, token or URL is logged or propagated. Failures after unknown network commit outcomes must not be treated as proof of consumption failure: a future exchange endpoint needs an explicit lost-response/recovery policy.

PostgreSQL transaction-start `now()` is unsuitable after waits. A final preflight plus deferred constraint triggers enforce bootstrap/session expiry at commit as well as during the locked operation. The triggers require consumption and insertion to agree and prevent refreshing an expired session. They use wall-clock UTC; actual database clock correctness remains an operational dependency. See PostgreSQL's [READ COMMITTED behavior](https://www.postgresql.org/docs/18/transaction-iso.html) and [wall-clock functions](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

## Legacy writer coordination and remaining activation gates

Legacy issuance changes `tokenHash` without incrementing generation. New snapshots also bind that hash, and freshly read revocation/stay state deny new exchanges and later session use after legacy rotation, revoke or checkout. Real-service concurrency tests cover these writers winning their existing access/reservation locks. A guest-only `advanceGeneration` invalidates new records **without revoking legacy bearer links**, whose semantics remain unchanged.

This is not approval to activate sessions: audit every future issuer, revoker, reservation reassignment and request writer for the same lock order and atomic authorization. Existing writers are not broadly refactored here. An exchange committed before invalidation can remain as historical data, but subsequent validation denies it. A future mutation must validate and execute inside one coordinated transaction; calling `checkSession` and later creating a request would introduce a race. Idempotency/request-service composition remains a separate PR.

Subsequent small reviews must cover: authorized bootstrap issuance and generation invalidation; fixed-path guest HTTP adapter with exact origin/CSRF/rate limits and independent HttpOnly cookie; token-free fragment shell and browser leak testing; multi-device recovery and legacy migration/rollback; retention/cleanup and metrics without secrets. Provider ingress logging, verified database TLS/hostname and staging gates from CLOUD-03 remain unresolved. Automated tests below are not browser or provider evidence.

## Reproducible synthetic database proof

The API Security CI job starts disposable PostgreSQL **18**, applies the complete migration chain to a fresh database, then runs:

```sh
# CI PostgreSQL service only; never point these at an existing database.
createdb vantara_connect_sec02
pnpm --filter @vantara/api exec prisma migrate deploy
node apps/api/scripts/connect-sec02-ci.cjs
```

The workflow sets the disposable database URL privately in its environment. The helper refuses non-CI/non-loopback/non-exact database names and nonempty application tables. It creates a random-password DML-only test role with no ownership, memberships, DDL, TEMP, CREATE, replication or RLS bypass. Tests recheck database marker, PG major version, privileges and role before writing. They use only synthetic fixtures and redact failure output. No local/Pilot database is opened or copied. This guard is not permission to expose localhost or use tunnels; CI isolation and administrator provisioning are trust prerequisites.

`test:connect-db` requires `NODE_ENV=test`, an explicit opt-in and `CONNECT_SEC02_DATABASE_URL` for the exact role/database/marker. Four independent one-connection Prisma clients provide contenders A/B, a blocker and an observer. Tests assert distinct backend PIDs and observe `pg_blocking_pids`, rather than treating `Promise.all` or an in-memory mutex as proof. The suite covers:

- same-code replay contention and the final device-cap slot;
- real unique-insert failure rolling back consumption;
- bootstrap and session expiry during observed lock waits;
- expiry after repository preflight but before actual COMMIT;
- generation advance, actual legacy rotation/revocation and actual checkout ordering;
- cross-tenant reservation/access/property/guest/result rejection, immutable snapshots, same-tenant wrong-property denial and staff-session separation.

Ordinary API tests skip this suite unless explicitly enabled. Unit tests separately cover malformed fingerprints, configuration refusal, explicit policy bounds, bounded retry and sanitized errors. The workflow also runs existing API tests/build and the isolated Pilot 01 lifecycle; Web CI runs its transport tests/build for these persistence/schema changes. Refer to the PR's CI run links for exact commit results. Sandbox HTTP bind failures locally are not successful HTTP-test evidence; the CI run is required for those cases and PostgreSQL concurrency.

Initial real PostgreSQL evidence: [API Security CI 42166741308](https://github.com/zuitzero/Vantara-platform/actions/runs/42166741308), commit `e555eaff61e541b4a5126197a1d26ede0195e8e1`: full migration chain, 17/17 PostgreSQL persistence tests, 31/31 Pilot tests and API tests/build passed. [Web CI 42166741331](https://github.com/zuitzero/Vantara-platform/actions/runs/42166741331) passed on the same commit. The follow-up adds the reverse ordering (exchange wins before actual legacy revoke/rotation/checkout); see PR #52 for results on its final head. This is disposable database evidence, not a staging deployment or browser assessment.

## Migration, backup and rollback

Use `prisma generate` and `prisma migrate deploy` only against an authorized disposable target for this phase. There is no production migration/deployment claim. New indexes on existing access/request tables and ALTER TABLE locks require a populated-database timing rehearsal and release review before staging/production. Prisma schema generation cannot represent the additional SQL CHECKs/triggers: retain them in migration history and test migrations, never replace this migration with `db push`.

Reverting application code leaves additive schema compatible with legacy flows. Do not reset an existing database or delete historical guest-security records as a rollback mechanism. Before any future activation, require encrypted backup/restore rehearsal, explicit retention/deletion policy, downgrade compatibility check and a reviewed forward migration for schema changes. Dropping tables/functions/columns is not an automatic rollback. No real guest data, database dumps or provider resources are created; generated disposable test credentials remain process-local and are never committed.
