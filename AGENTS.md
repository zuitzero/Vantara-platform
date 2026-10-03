# Vantara Codex Working Agreement

This repository contains Vantara, a multi-tenant hotel operating platform built by Zuitzero.

## Team model

- Adrien: Founder / Product / Vision
- ChatGPT: Architecture / Product / Technical Direction / Review
- Codex: Implementation / Refactoring / Tests / PR preparation

Codex should execute the agreed product and architecture direction, surface risks early, and leave changes reviewable. Do not merge to `main` unless explicitly instructed.

## Product definition

Vantara turns hotel operations into a connected system. The Hotel Command Center is the operational workspace for hotel staff and administrators. Guest Connect, Zuitzero Admin, and Owner Command Center are separate experiences and must not be mixed into hotel tenant flows.

Official roles:
- `GUEST`
- `HOTEL_STAFF`
- `HOTEL_ADMIN`
- `ZUITZERO_ADMIN`
- `OWNER`

Tenant types:
- `HOTEL`
- `PLATFORM`

Role boundaries:
- `GUEST`, `HOTEL_STAFF`, `HOTEL_ADMIN` belong to HOTEL tenants.
- `ZUITZERO_ADMIN`, `OWNER` belong to PLATFORM tenants.
- `OWNER` must never operate as a hotel membership.

## Security and tenancy rules

These are non-negotiable:

1. Never trust tenant ownership supplied by the client.
2. Derive tenant context from the authenticated session/membership on the server.
3. Every protected resource must enforce both permission and tenant scope.
4. Follow least privilege.
5. Preserve OWNER / PLATFORM and hotel role separation.
6. Billing write operations are OWNER-only on PLATFORM tenants.
7. Prefer server-side authorization over UI-only hiding.
8. Any cross-tenant lookup or mutation must be rejected.
9. Add or update tests whenever authorization, tenant isolation, or operational state behavior changes.
10. Do not weaken guards, permissions, or tests to make a feature pass.

## Permissions

Use the existing permission system. Important groups include:
- `rooms.read`, `rooms.manage`
- `guests.read`, `guests.manage`
- `reservations.read`, `reservations.manage`
- `requests.read`, `requests.manage`
- `housekeeping.read`, `housekeeping.manage`
- `maintenance.read`, `maintenance.manage`
- `staff.read`, `staff.manage`
- `billing.read`, `billing.manage`, `billing.refund`
- `owner.*`

If a new capability needs authorization, add a dedicated permission instead of reusing an unrelated one.

## Room state model

Do not reintroduce the legacy single `RoomStatus` concept.

Rooms now use two independent dimensions:

- `occupancyStatus`: `VACANT | OCCUPIED`
- `readinessStatus`: `READY | CLEANING | MAINTENANCE | OUT_OF_SERVICE`

Examples that must remain valid:
- `OCCUPIED + READY`
- `OCCUPIED + MAINTENANCE`
- `VACANT + CLEANING`
- `VACANT + OUT_OF_SERVICE`

Operational rules:
- Check-in changes occupancy to `OCCUPIED`.
- Check-out changes occupancy to `VACANT` and readiness to `CLEANING`.
- Check-out automatically creates housekeeping work when needed.
- Housekeeping changes readiness only.
- Maintenance changes readiness only.
- Guest-originated housekeeping or maintenance work must not overwrite occupancy truth.

## Reservation lifecycle

Current lifecycle:

`PENDING -> CONFIRMED -> CHECKED_IN -> CHECKED_OUT`

Additional terminal states include `CANCELED` and `NO_SHOW` where allowed by the backend state machine.

Do not duplicate backend automation in the frontend. The frontend should request lifecycle transitions; the API owns room and operational side effects.

## Hotel Command Center principles

The Command Center must use real tenant-scoped data.

Do not present fake revenue, occupancy, intelligence, health, or operational metrics as real data.

Required UI behavior for live modules:
- loading state
- empty state
- error state
- retry or refresh path where appropriate
- role-aware actions
- responsive behavior
- existing Vantara visual language

Current visual language:
- premium dark operational UI
- Vantara / Zuitzero signal aesthetic
- restrained signal green accent
- clear hierarchy, compact operational density
- avoid generic admin-template styling

## Current implementation direction

The active feature branch is expected to be used for the current task. Do not create additional branches unless explicitly requested.

For `feature/reservations-command-center-v1`, implement Reservations in the Hotel Command Center using the real API and existing authorization model.

Target behavior:
- list real tenant-scoped reservations
- show reservation status, dates, guest, room / room type, confirmation code, and relevant stay context
- support allowed lifecycle actions such as confirm, check-in, and check-out
- call the existing reservation status endpoint instead of reproducing lifecycle logic client-side
- respect role permissions
- use loading, empty, error, and mutation-in-progress states
- update UI after successful mutation without inventing backend state
- preserve existing Rooms, Requests, Housekeeping, and Maintenance behavior

## Engineering workflow

Before editing:
1. Inspect relevant existing code and patterns.
2. Reuse established modules and components where they reduce duplication.
3. Check for legacy/duplicate implementations before adding another one.

While editing:
- Keep changes scoped to the task.
- Prefer coherent vertical slices over broad speculative refactors.
- Preserve tenant isolation and RBAC.
- Avoid dead code and duplicate controllers/routes.
- Do not add fake seed/demo metrics to production UI.

Before finishing:
1. Run Prisma generation when Prisma types/schema are touched.
2. Run API tests.
3. Run API build.
4. Run Web build.
5. Fix any failures caused by the change.
6. Summarize modified files, behavior, tests, and any remaining risks.
7. Leave the branch ready for review / PR.
8. Do not merge to `main` unless explicitly instructed.

Canonical validation commands:

```bash
pnpm --filter @vantara/api exec prisma generate
pnpm --filter @vantara/api test
pnpm --filter @vantara/api build
pnpm --filter @vantara/web build
```

## Pull request expectations

A PR should explain:
- what changed
- why it changed
- tenant / RBAC implications
- operational side effects
- validation performed
- known limitations or next steps

Do not claim deployment/database migration completion unless it was actually applied and verified in the target environment.

## Decision rule

When implementation details are ambiguous, prefer the option that preserves:

`security -> tenant truth -> operational truth -> maintainability -> visual polish`

If a choice materially changes product behavior or architecture, surface it instead of silently inventing a new product rule.
