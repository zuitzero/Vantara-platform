# Vantara Connect v1.1 release verification

This document separates automated confidence from manual end-to-end acceptance. Do not mark a scenario passed without executing it. Work against a disposable test hotel with synthetic guest data. Never paste real Connect tokens into PR comments, CI logs or support tickets.

## Automated gates

- API Security CI: Jest service contract / tenant-scope tests, NestJS build, Prisma migration chain.
- Web Command Center CI: Next.js production build. Verify its route output contains `/connect/[token]`, `/`, and `/onboarding`. A green build alone does not guarantee the guest route exists after duplicate app-directory regressions.
- Tests added for a Connect request round-trip at service boundary: token -> create reservation request -> tenant and reservation-scoped stay query -> updated/completed status. This uses mocks, NOT an HTTP server or database.

## Manual end-to-end checklist (requires running API + web + PostgreSQL)

1. Create two different HOTEL tenants (A and B), each with its own staff user, guest and future confirmed reservation. Use synthetic identities. Keep credentials and tokens private.
2. In hotel A's Reservations, generate a Connect link. Open it in a separate incognito session (no hotel auth cookies). Confirm only A reservation details appear and all four guest request shortcuts submit canonical categories.
3. Submit a housekeeping request from Connect. Confirm the hotel receives a new notification toast; **View request** opens the correct Requests card. Confirm corresponding housekeeping operational task as applicable.
4. Accept, start and complete the request as hotel staff. Confirm Connect updates after up to 15 seconds while visible, announces status changes, moves completed work out of Active requests and into collapsed History. Expand History and confirm details are still present. Check background tab pause and resume.
5. Disconnect the guest browser network temporarily. Confirm Connect warns and retries rather than losing the displayed stay. Restore network and confirm status recovery. Do not create a duplicate POST by retrying the request blindly.
6. Generate a replacement access token for the same reservation. Verify the prior token no longer exposes the stay or creates requests; verify the new one works.
7. Revoke the new link from hotel A. Verify GET and POST with the revoked link are rejected. A previously open browser should lose access on the next refresh/poll.
8. Change the reservation to a post-checkout state and verify no new guest requests can be created. Confirm expiration policy separately with a controlled clock/test data (never manipulate production reservations).
9. Sign in as hotel B. Verify tenant B cannot read, update, revoke, or list A's reservation, request, or Connect access through authenticated endpoints. Do not assume front-end navigation alone enforces this.
10. Verify notification permissions for HOTEL_STAFF versus HOTEL_ADMIN, and check no guest can authenticate to hotel-only API or hotel Socket.IO room.
11. Confirm Billing, CRM, Reservations and Onboarding load; perform one safe read flow in each. Verify Next.js routes remain correct.
12. Observe network and server logs for leaked tokens, duplicate requests, uncaught errors and cross-tenant data. Do not log sensitive material into tickets.

## Required release evidence

Record each item as PASS, FAIL, or NOT RUN, with date, environment, build commit and sanitized evidence. Attach CI run links, not token URLs. A failure in revocation, tenant isolation, request authorization or guest-data exposure is a release blocker. Also block release if core guest submission or hotel request processing is broken.

## Known gaps / follow-ups

- This PR does NOT add true browser E2E infrastructure, a real-Postgres integration test suite, or synthetic test data provisioning. Browser/database verification above must be executed before release approval.
- Connect currently uses foreground polling rather than guest WebSockets. This is a 15-second target, not an instantaneous delivery SLA.
- The stay API returns at most 50 recent requests. Long-stay full history pagination is not yet implemented.
- Concurrent access revocation and in-flight POST race tests require integration-level validation.
- Operational workflows and notification delivery need replay/recovery tests across service failure boundaries.
