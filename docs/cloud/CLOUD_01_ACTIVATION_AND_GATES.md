# CLOUD-01 manual activation, operations and acceptance plan

**Plan only. No actions in this runbook have been performed by this audit.**
See [audit](CLOUD_01_READINESS_AUDIT.md) and [architecture](CLOUD_01_ARCHITECTURE_AND_COSTS.md).
The full #41 remains open after this phase; later implementation requires review.

## Manual-first authenticated activation — future implementation

Current public workspace creation is not an approved founder-only provisioning
or invitation system. Do not set a hotel owner's password for them, share a
founder session, elevate a HOTEL member to PLATFORM OWNER, directly edit live SQL,
or run `demo:*` / `pilot01-ci.cjs` against staging or real hotels. Until a reviewed
activation/invitation path exists, **STOP: no real enrollment workaround**.

1. **Approval ticket:** named founder/operator verifies the organization/champion
   privately, approved environment, legal/privacy/support owner, data scope and
   intended trial. Stage only synthetic `.invalid` identities; real hotel identity
   information is not collected in this audit. Record approver/expiry, no secrets.
2. **Operator authentication:** reviewed PLATFORM-only provisioning capability,
   MFA/step-up and least privilege. Current `hotel.manage` alone is insufficient
   because HOTEL_ADMIN also has it. Introduce a dedicated permission in a later
   reviewed PR; retain normal membership-derived tenant scope everywhere else.
3. **Provision pending workspace:** authenticated command/controller validates
   input, creates HOTEL + property and approved trial atomically, audits actor,
   target and result. Use existing domain logic behind that new boundary, not a
   new unguarded copy of public signup. No operator-supplied tenant ownership is
   accepted without server-side authorization to the target. Failures roll back.
4. **Invite one hotel owner:** proposed one-use random redemption secret stored
   hashed, exact tenant/recipient/role HOTEL_ADMIN, issuer, expiry (proposal 24 h),
   consumed/revoked state and bounded attempts. No invitation model/delivery exists
   yet. Bind acceptance to independently verified recipient identity; existing users
   must authenticate rather than silently acquire another tenant membership.
   Deliver any secret through a reviewed private out-of-band channel; neutral
   notification can direct the recipient to the official portal. Do not embed
   Connect/invitation bearer secrets in email URLs, logs, tickets or screenshots.
5. **Accept privately:** recipient verifies identity, sets their own credential,
   confirms role/property scope; atomically consume invitation and create membership.
   Enforce single use, expiry/revocation, replay and cross-tenant rejection. A GET
   link preview must never consume the invite or create a session. Rotate/revoke
   bootstrap access and revoke all test invitations. No shared/default password.
6. **Configure known inventory/services:** hotel admin uses scoped property/room
   type/room APIs; classify real services with the hotel, do not fabricate facts or
   promise unsupported AI/PMS/WhatsApp integrations. Staff profiles need existing
   memberships; staff enrollment also needs a reviewed invitation path.
7. **Trial policy checkpoint:** #38 owns approved 7/30-day start, UTC expiry,
   permissioned extension/revocation and consistent expiry behavior. Current 14-day
   onboarding is not that policy. No card, no automatic charge or conversion; the
   later approved workflow must implement agreed server policy before promising it.
8. **Acceptance and handoff:** two isolated synthetic tenants/sessions first;
   validate only intended inventory/requests/notifications and owner role, audited
   activation and access revocation. Stop if any boundary leaks. Record evidence
   by commit/environment with secret-free screenshots and test output.

Production release remains a separate approval after synthetic staging passes,
privacy/legal/support agreements and #38 are ready. First real-tenant activation
requires a new explicit authorization; this document never authorizes it.

## Backup, recovery and rollback requirements

Data/release owner must approve and demonstrate these, not just enable a toggle:

- Proposal for real pilot: **RPO ≤15 minutes, RTO ≤4 hours**, subject to business
  acceptance and measured restore drills. Daily encrypted logical exports retained
  30 days plus provider PITR with at least 7-day window; review residency/costs.
  These targets are not currently met or a customer SLA. If provider recovery
  granularity cannot meet RPO, change architecture/budget before onboarding.
- Store encrypted backups separately with restricted restore/delete rights, key
  recovery, expiry enforcement and deletion ledger. No exports on developer laptops,
  public buckets, build artifacts or in Git. Staging backups contain synthetic data
  only; never copy production into staging, even for debugging.
- Drill into a new isolated recovery target, no in-place restore. Verify schema and
  migration history, tenant/resource relationships, row counts, representative
  operations, application compatibility, measured data loss and duration. Keep
  sanitized evidence and alternate responder instructions; repeat monthly and
  before a materially risky migration. No restore performed in phase 1.
- Back up before releases, review existing-data migrations against synthetic
  populated snapshots, migrate once using separate DDL role and a release lock.
  Prefer expand/contract; document both old/new app compatibility. Existing fresh
  CI migration success does not prove safe production upgrades.
- App rollback: pin prior immutable Web/API artifacts, config version and schema
  compatibility; fence new writes if integrity is uncertain, drain/reconnect sockets
  and revert compatible services together. No automatic reverse migration, `db push`,
  destructive reset or migration-history edits. Irreversible DDL requires an explicit
  recovery/forward-fix decision with accepted RPO loss.
- Restores can resurrect sessions, Connect links, invitations and stale billing
  identifiers. Isolate first, invalidate recovered capabilities before ingress,
  reconcile any approved external provider state, and record incident decisions.
  Replaying webhooks or notifications must not double-apply operations.

## Monitoring, privacy and incident ownership

Assign a named primary and backup for release, security, data recovery and hotel
support before external staging. Founder hardware is not the monitoring service.
Require independent HTTPS readiness + DB probe, synthetic scoped request loop,
WebSocket cookie/reconnect check, 5xx/latency and login-abuse alerts, connection/
volume/pool saturation, backup freshness and restore alerts. Public probes expose
no DB details. Protected operations health is not an independent availability check.

Proposed alert policy: two failed minute probes or sustained 5xx above 2% for five
minutes page the primary; escalate after 15 minutes without acknowledgement. Tune
on synthetic staging evidence. No guest names, token paths, request bodies or raw
DB exceptions in alerts. Review proxy/CDN/APM/access logs and cookies/referrers,
not just application audit. Aggregate metrics and route templates only by default.
Define incident severity, write fencing, credential rotation, notice decision,
customer-support channel and a tested rollback/recovery decision tree.

Privacy owner/legal review must settle controller/processor roles, notice/consent
where applicable, data inventory/minimization, subprocessors/regions, retention,
tenant-scoped export/deletion and verification of requester authority. No unsupported
jurisdiction/compliance certification is claimed. Proposed log retention 7 days,
audit/operational retention agreed before real use, backups 30 days with deletion
re-applied after restore. Don't promise immediate deletion from immutable backups;
explain expiry/legal holds. For uploads: **none enabled** until signed access,
MIME/size validation, malware scanning, tenant isolation, deletion and recovery tests
pass. No AI text, telemetry expansion or provider activation in Cloud phase 1.

## Synthetic-only rollout sequence and evidence gates

All gates start **PENDING / NOT RUN for cloud**; local tests and reported Pilot 01
manual UAT are baseline evidence only. Named approvers must replace role labels.

| Gate / sequence | Required evidence / stop condition | Accountable owner |
| --- | --- | --- |
| G0 audit review | Approve topology, cost envelope, named owners and follow-up PR scope; no infrastructure execution as part of this PR | Founder + engineering |
| G1 separate staging PR | Explicit provisioning authorization; isolated managed resources/secrets, private origins/DB, TLS and ingress access control; no local/Pilot URL, tunnel or production data | Release/security |
| G2 transport/auth | HTTPS Secure cookie login/logout, expired/revoked session, membership/RBAC A/B tests; HTTP CORS/CSRF/Origin and hostile WebSocket origins denied; direct private-origin/public-signup bypass blocked; connected sockets lose access after logout/expiry/membership revocation; reconnect works | API/Web/security |
| G3 data/release safety | Fresh and populated synthetic migration tests, runtime vs migration role checks, pool/connection budget and dependency/secret scanning; scoped negative reads and writes over real HTTP/Postgres | Data/release |
| G4 activation/invites/trial | Implement reviewed plan above + #38; replay/expiry/rotation/revocation, email identity and one-owner HOTEL_ADMIN scope; test invite cleanup, approved trial expiry/extension and no surprise billing | Auth/product |
| G5 guest/hotel E2E | Two synthetic hotels, independent devices/networks + mobile: CONFIRMED → Connect → request → hotel notification → Accept/Start/Complete → guest polling/history; rotated/revoked/expired links denied; intentional network-loss recovery | QA/hotel operations |
| G6 recovery/alerts | Measure restore RPO/RTO, prove backup expiry/alerting and prior-artifact rollback; simulate app/DB/socket failures and recovered-token invalidation | Data/operations |
| G7 privacy/operations | Approved retention/export/deletion/upload-disabled policy, logs/URL redaction, support/on-call incident drill and documented notification-loss/manual reconciliation procedure | Privacy/security/support |
| G8 separate go-live decision | All evidence reviewed, #38 policy/agreements ready; separately authorize first real tenant and minimal data scope. No live Stripe, AI or automatic paid conversion implied | Founder + security/privacy |

Staging seed/provisioning must use reviewed cloud-compatible scoped APIs/activation
and fresh synthetic fixtures. Do not copy or weaken the localhost-only Pilot tool.
Keep staging access private to reviewers; distribute capability links only privately.
Acceptance records should contain date, exact build/config revision, environment,
PASS/FAIL/NOT RUN, sanitized evidence and approver. A failed isolation, access,
restore, redaction or enrollment gate blocks advancement; schedule fixes, not waivers
that misrepresent production readiness. Split implementation PRs by transport/config,
activation/invites, #38 trials, recovery/observability and E2E/privacy proof.
