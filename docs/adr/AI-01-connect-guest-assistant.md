# ADR AI-01: Vantara Intelligence guest-assistant foundation

Status: **proposed for review**, 2026-10-23. Scope: [issue #37](https://github.com/zuitzero/Vantara-platform/issues/37).
No production activation, provider calls, credentials, new routes, persistence,
migrations, UI, pricing or entitlements in this increment.

## Context inspected

- Nest `AppModule`/`ConnectModule`, Prisma/PostgreSQL and Next App Router;
  the guest UI is `apps/web/src/app/connect/[token]/page.tsx`.
- `ConnectService` hashes a private bearer token, resolves its reservation,
  rejects expiry/revocation, and gates requests to CONFIRMED/CHECKED_IN stays
  before checkout. The access row is reused when a link rotates.
- `ConnectAdminController` requires authenticated membership and
  `reservations.manage`; the public Connect guest has a reservation capability,
  **not** a HOTEL_STAFF/HOTEL_ADMIN/OWNER session or permission elevation.
- `RequestsService.createForReservationGuest` derives guest/property/room from a
  scoped reservation, persists the request and operational work, then publishes
  notifications. It owns automation; an assistant must not duplicate it.
- Current `ConnectService.access` is private and returns guest identity details;
  do not call `stay()` and forward that result to a model as context.
- Connect service tests and Pilot PostgreSQL/HTTP tests already cover the manual
  request path. Issue #37 records local/manual/synthetic Pilot UAT PASS; that is
  not a production certification or validation of an AI conversation UI.
- `ARCHITECTURE.md`, `SECURITY.md`, `MULTI_TENANCY.md`,
  `authorization-model.md`, `CONNECT_V1_1_RELEASE.md`, `PILOT_01_DEMO.md` and
  `AGENTS.md` inform this decision. Official roles come from current RBAC/AGENTS;
  legacy role names and RoomStatus in older shared docs/types are not new authority.

## Decision and trust flow

Guest JSON -> strict transport validation -> fresh Connect authorization ->
scoped hotel-approved knowledge and routing policy -> privacy minimization ->
optional provider intent -> strict unknown-output validation -> deterministic
approved-fact answer, unexecuted draft, or static ES/EN fallback.

User/model/knowledge text is data, never instructions granting capabilities.
Provider output carries only an allowlisted intent. Knowledge output selects
opaque fact references; answers reproduce exact approved locale text with revision
references. Model-generated prose, prices, services, availability and translations
are not accepted as hotel facts. Missing ES/EN content, unknown references,
staleness, missing approval or unavailable provider means fallback/human handoff.
Approval is a server-side provenance decision, not the presence of `approved:true`
in JSON. No client/model can supply the knowledge records or allowed categories.

AI-01 adds pure server-side TypeScript contracts/validators and tests under
`apps/api/src/intelligence`. **There is no Nest module/controller registration,
provider SDK, request executor or integration into Connect.** `rejectAi01Execution`
always rejects; even a valid confirmation preflight cannot create a request.
Pure helpers test consistency over trusted server projections; they do not prove
identity, authenticate a token, consume a draft or enforce database idempotency.

The raw message contract is private input, bounded to 1,000 UTF-16 code units,
explicit `es`/`en`, no caller-owned context/history. Provider intent is a strict
union: knowledge, request_draft, handoff, unsupported. Initial draft categories
are HOUSEKEEPING/MAINTENANCE/FRONT_DESK, additionally constrained by scoped hotel
policy (default empty). Category classification is not evidence that a service
exists, is available, free, guaranteed or has been dispatched. Draft title/message
remain untrusted preview text; future moderation/privacy validation is mandatory.

## Proposed transport — NOT implemented

| Route (Nest prefix `/api`) | Body | Authority and response |
| --- | --- | --- |
| `POST /connect/:token/intelligence/message` | `{language, text}` | Resolve live token/stay first; return `AssistantReply`, never perform operations |
| `POST /connect/:token/intelligence/confirm` | `{draftId, draftRevision, confirmed:true, idempotencyKey}` | Fresh authorization, scoped stored draft, exact preview revision; no payload/tenant/guest IDs accepted |

Future transport must reject extra/nested ownership fields, implicit coercions,
unsupported locales, empty/oversized bodies and control characters. Apply an 8 KiB
JSON body cap, no-store responses, generic error codes, private route-template
logging and referrer policy. Model output JSON size/depth must also be bounded
before parsing (proposed 8 KiB); the pure validators do not implement HTTP limits.
Never echo raw request bodies or provider exceptions to errors, logs or clients.

On message and confirm require a fresh scoped projection containing only tenant,
property, reservation, access ID/private generation binding and lifecycle dates.
Validate HOTEL, reservation/property tenant consistency, reservation ID, current
CONFIRMED/CHECKED_IN status, checkout, expiry and revocation. These IDs stay in
server orchestration, never prompts. Access generation binding changes on rotation:
use the current token hash only privately or a server-keyed HMAC of it, not access
`updatedAt` (lastUsedAt updates it) or access ID alone. Never log binding/hash.

Generic access denial must not reveal another tenant/reservation/draft. Do not
permit searching guests by name/email, listing other stays, arbitrary knowledge
IDs or switching tenant with assistant input. Knowledge/cache keys must include
tenant + property + approved revision + locale. Future conversation/draft keys
also include reservation + access generation. Never use a global cache fallback.

### Confirmation/replay design gate for AI-03

1. Server stores a pending draft with opaque random ID, revision/digest of the
   exact preview, private scope/generation binding, and expiry (proposal: 5 min,
   capped by access expiry/checkout). No model can set confirmation or draft state.
2. Guest explicitly confirms the rendered preview via a separate UI action. “Yes”
   in chat, an intent flag or model confidence cannot confirm. Editing changes the
   revision and requires a new preview. Only the stored payload can be used.
3. Re-resolve authorization and current routing policy at confirmation time;
   reject foreign, rotated, expired, canceled or consumed drafts. The pure
   `assertConfirmation` is only one preflight; it does not implement steps 1/4/5.
4. In one reviewed DB transaction, serialize against rotation/revocation and stay
   lifecycle changes; recheck token generation/access/stay inside that transaction.
   Validate/consume draft and reserve an idempotency key bound to scope, draft,
   revision and payload digest. A reused key with a different operation is a conflict.
5. Invoke the existing request domain logic through a transaction-aware internal
   boundary, then persist request ID + idempotent result atomically. A completed
   replay returns the stored result; concurrent confirmations create at most one
   request. Retry must not depend on whether notification delivery succeeded.

**Current integration gap:** Connect authorization and request creation are separate;
`RequestsService` starts its own readiness transaction, and notification publication
is post-commit. AI-03 must share a transaction-aware domain writer and make token
rotation/revocation/lifecycle writers participate in locking. Calling the existing
public method after an in-memory guard does NOT solve races or idempotency. No
executor/confirm route may activate until real PostgreSQL concurrency/retry tests
prove this. This ADR proposes future persistence, not a migration in AI-01.

## Proposed Nest boundaries

| Boundary | Contract / responsibility |
| --- | --- |
| Future IntelligenceController | DTO/unknown validation and headers, no business writes |
| ConnectAccessResolver | Reuse/extract current Connect checks into a minimal server-only projection without weakening existing routes |
| HotelKnowledgeSource | Read only hotel-admin-approved, published, locale/revision/expiry-scoped facts; no provider/guest writes |
| GuestPrivacyBoundary | Remove/deny PII and secrets before constructing branded RedactedText; fail closed if uncertain |
| IntentProvider | Receives locale, privacy-approved text, opaque references + approved public facts; returns unknown, no tools/DB/URLs |
| Orchestrator + DraftPolicy | Scope checks, allowlisted intents, routing policy, approved facts, fallback; no credentials in prompt context |
| DraftStore | Server-only scope-bound persistence with pending/revision/expiry semantics; no actual store in AI-01 |
| Future confirmation action service | Only AI-03 may implement an executor after the transaction gate above; never expose SDK/tool execution |
| AssistantTelemetry | Fixed outcome/locale/duration buckets; no text, raw token, identity or resource IDs |

Provider selection must stay behind this server-only adapter. No provider is selected,
installed or called here. No frontend imports server context/validators/keys. When
AI-04 needs shared wire types, extract only guest-safe response/input contracts;
do not export `LiveStay`, private bindings or internal knowledge scope to the web.

## Privacy, retention, costs and abuse — activation requirements

No new data or telemetry is persisted in AI-01; its helpers contain no logging or
prompt builder. Raw guest text may contain names, addresses, emails, credentials or
payment data. Input validation is **not redaction**. RedactedText's TS brand is not
a runtime guarantee; no redactor is implemented and no provider receives text.
AI-02 must implement/test a fail-closed privacy boundary and approved knowledge
privacy review before any provider activation; ambiguous content goes to the
ordinary Connect form/front desk, not to a model. Do not send reservation details,
confirmation codes, guest records, room numbers, private notes or raw history.

Proposed budgets, subject to review (not pricing or current enforcement): 5 messages
per minute per access generation plus tenant/IP ceilings, a 10-second provider
deadline, max 1,000 output tokens, 8 approved facts per prompt and 32 retrieval
candidates. Debit tenant quotas before dispatch, no automatic provider retries,
per-tenant kill switch and disabled-by-default activation. Confirm has independent
abuse/replay controls; rate limiting never replaces authorization. Admission/rate
limits must exist from the first live call; AI-05 hardens them, not first introduces them.

No transcript retention by default; process ephemeral minimized messages only.
Pending drafts expire after at most 5 minutes; exclude their bodies from logs.
Proposed idempotency metadata TTL 24 hours (expire invalid pending keys earlier,
retain consumed-result mapping long enough for retries; no message bodies).
Telemetry proposal: aggregate buckets for 7 days, no guest text or identifiers.
Operational requests created later retain existing domain retention/access policy;
no promise of deleting them with chat. Provider zero-retention/no-training terms,
regional processing, deletion and legal review remain activation gates.

## Increment plan / consequences

- **AI-02:** approved knowledge schema + admin approval/publishing and revocation,
  privacy adapter, ES/EN deterministic grounding/fallback, provider stub-first
  tests, mandatory admission budgets. Review any future migration separately.
- **AI-03:** private scoped draft store, preview revisions and consent, transaction-
  aware existing request logic and durable idempotency; real concurrency/failure tests.
- **AI-04:** Connect chat/draft/confirmation UI, plain-text rendering, distinct
  “draft/not sent” state, accessible ES/EN fallback and browser tests in two sessions.
- **AI-05:** fuzzing/prompt-injection corpus, privacy/retention/abuse stress tests,
  observability, kill-switch verification, incident/runbook and production review.

Tradeoff: exact approved locale snippets are less conversational but cannot be
replaced by unchecked model prose. Initial category restriction omits room-service,
pricing, bookings, billing/refunds, emergency handling and mutations of existing
requests/reservations. Fallback must not promise response times or emergency service.
No changes to plan entitlements/billing are implied. All wiring remains absent so
AI-01 is reversible by removing these isolated files. Architectural approval and
future increment security reviews remain required even with green contract tests.
