# Hotel onboarding v1

POST /onboarding/workspace remains the only public bootstrap. Server validation trims names, lowercases email/slug, rejects whitespace-only values and enforces a URL-safe slug (3–63 characters, letters/digits with single separating hyphens). Passwords use the existing scrypt format with 8–128 characters and no invented complexity rules. Plans are LOBBY, SUITE or GRAND; omitted plan defaults to LOBBY. Unexpected role/tenant/ownership fields are rejected.

An existing globally unique email is rejected explicitly; v1 does not attach new memberships to existing accounts. A slug conflict is rejected instead of adding random suffixes. Database uniqueness still resolves races. All five bootstrap writes stay inside one Prisma transaction; the subscription is TRIALING with no Stripe IDs or payment claims.

No session is created during bootstrap. /onboarding directs users to the existing POST /auth/login cookie/session flow, then continues authenticated setup. GET /onboarding/status uses hotel.manage and active session tenant context and rejects non-HOTEL tenants. HOTEL_STAFF cannot administer setup.

Setup derives from real properties, room types and rooms. At least one property with a room type and matching room inventory is sufficient; future empty properties do not block completion. Operationally ready here means minimum configured inventory, not a live room-availability or readiness guarantee. No progress percentages or persistent workflow state are added.

Room type creation reuses POST /room-types/properties/:propertyId (name, existing required code, maxGuests). Room creation reuses POST /rooms/properties/:propertyId (number, roomTypeId). Both retain rooms.manage, scope the property to a HOTEL tenant, and reject mismatched room types. Existing RoomType has no description field, so none is invented. Duplicate inventory codes/numbers return useful conflicts.

No schema migration is required. Integration tests use Prisma mocks; true database rollback and browser/session end-to-end validation remain deployment checks. Public signup abuse controls/rate limiting, email verification/recovery, existing-account multi-hotel enrollment, and provisioning notifications are future scoped work. These are not bypassed with fake sessions or billing.

Next routes are rooted in apps/web/app; src/app holds reused UI components. The new route uses the same thin re-export convention as the existing home route. No parallel router was created.
