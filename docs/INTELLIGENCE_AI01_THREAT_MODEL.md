# AI-01 threat model and review checklist

Scope/status: proposed, 2026-10-23; see [ADR](adr/AI-01-connect-guest-assistant.md).
Assets: private Connect capability, tenant/property knowledge, stay isolation,
operational integrity, guest privacy, provider budget and truthful guest-facing replies.
Actors: legitimate guest, stolen-link holder, abusive guest, compromised provider,
malicious knowledge text, misconfigured operator/cache and concurrent actors.

## Trust boundaries

1. Guest/browser JSON and raw bearer path are untrusted and secret respectively.
   A Connect link grants only its own stay capability; possession remains the
   existing security model, not proof of the real human guest's identity.
2. Live Connect resolution is trusted server work, not a context supplied by chat.
   Membership RBAC still governs hotel administration and knowledge publication.
3. Knowledge records must come from a scoped approved server source. Schema
   validity/approved:true cannot prove approval or truth; hotel review owns content.
4. Privacy-minimized model input is distinct from raw guest text. Provider output
   is untrusted JSON even if the SDK advertises structured output.
5. Intent/draft/confirmation are separate concepts. No intent grants write access.
   A confirmation preflight is not a DB transaction or request executor.

| Threat / abuse case | AI-01 protection or design requirement | Remaining activation test/gate |
| --- | --- | --- |
| Caller sends tenant/reservation/role IDs | Exact guest-message and confirmation keys; ownership only from resolver | HTTP DTO tests with real fresh scoped authorization in AI-02/03 |
| Confused server context combines hotels/stays | Pure consistency checks include tenant, property and reservation ID | Scoped Prisma queries and real tenant A/B integration tests |
| Cross-property or cross-tenant retrieval/cache | Reject entire mixed-source set, not merely selected fact IDs | Source ACLs, approval provenance, publication invalidation and cache partitioning |
| Prompt/knowledge injection asks for DB writes or refunds | Provider intent union has no execute/tool/URL/action capability; extra fields rejected; all AI-01 execution disabled | Adversarial provider/privacy corpus; do not treat text detection as primary defense |
| Provider invents service/hours/availability/prices | Only exact approved locale facts rendered; no arbitrary answer prose; missing/expired/missing locale falls back | Hotel-approved source + publishing UX; no live stock/availability claims from static facts |
| “Yes” in chat or model confirmed:true causes operations | Separate exact confirmation DTO; draft never executes in AI-01 | AI-04 explicit preview consent plus AI-03 durable state machine |
| Guest confirms another stay's draft or old preview | Private tenant/property/reservation/access/generation binding, revision/ID/expiry/state checks | Scoped storage lookups, fresh access and atomic policy revalidation |
| Token rotates/revokes or checkout races a confirm | Generation/expiry/status preflights reject observed invalid state | Current Connect has a check/write race; AI-03 shared locking/transaction is a release blocker |
| Retries/concurrent confirm creates duplicate tasks | Consumed draft rejected at contract level; idempotency field required | DB uniqueness + payload-bound result mapping; crash/retry/concurrency tests, not implemented here |
| Raw token/guest PII/secret reaches prompt/log/trace | No prompt builder, provider or logger in AI-01; generic errors and telemetry allowlist | Privacy adapter, body/header/URL/APM/error redaction; approved knowledge privacy review before calls |
| Token path leaks via history/proxy/referrer | Retain current Connect compatibility; route templates/no-store/referrer controls proposed | Audit ingress/access logs, frontend analytics, screenshots and share links; never publish real capability URLs |
| Provider text contains HTML, scripts, links or malicious markdown | Arbitrary answer prose rejected; any future draft preview is untrusted | AI-04 plain-text rendering; no HTML/markdown execution or external link fetching |
| Cost amplification, enormous inputs or recursive output | Pure string/list/key bounds; no calls or costs in AI-01 | Transport bytes/depth limits, tenant/access/IP quotas, timeout/output caps, kill switch before first live call |
| Knowledge is stale, withdrawn or untranslated | Explicit approval/expiry/locale/revision; no translation guessing | Enforce withdrawal immediately and purge caches; historical drafts rechecked on confirm |
| Schema changes add a dangerous provider action | Strict unknown-output validator rejects unknown kinds/extra keys | Runtime output schemas/version negotiation reviewed; never cast SDK output directly |
| Provider failure or uncertain request outcome | Static safe ES/EN fallback, never claim success | Result replay after domain commit; post-commit notifications currently lack outbox |

## Data lifecycle and logging review

Only synthetic fixtures are used in AI-01 tests. Do not copy production guest
messages for fixtures, evals, bug reports or prompt examples. Generic exceptions
carry codes only; never attach raw provider errors or input bodies. No network,
provider credentials, transcript/draft tables or audit changes are introduced.

Future provider payload must exclude names, contacts, confirmation codes, room
numbers, access IDs/bindings, credentials, payment data and internal free-form
notes. Even approved knowledge can contain sensitive content: approval must include
privacy classification. A redaction regex or TypeScript brand alone cannot prove
all PII has been removed. If minimization is uncertain, do not dispatch. Raw guest
input validation can accept personal text locally; this does not authorize sending,
storing or logging it. Correlation must not use raw tokens or unsalted token hashes.

## Evidence and remaining limitations

Pure tests demonstrate strict contract rejection, exact fact selection, fallback,
observed scope isolation, explicit consent shape and refusal to execute AI-01.
They do not establish live authentication, DB idempotency, semantic safety,
robust PII redaction, rate limiting, provider compliance or visual acceptance.

No new routes, adapters, store, redactor, prompts or UI are running. Existing
Connect/Requests/RBAC/billing/Pilot behavior stays unchanged. Pilot UAT reported
in #37 is local/manual/synthetic; no AI UI browser acceptance is claimed here.

Before activation reviewers must sign off on:

- [ ] ADR, approved knowledge source/provenance and ES/EN content ownership.
- [ ] Minimal live Connect resolver and tenant/property/stay query constraints.
- [ ] Privacy, provider retention/region/legal settings and logs/traces/proxy checks.
- [ ] Per-tenant/access/IP budgets and deployment kill switch.
- [ ] AI-03 transaction/idempotency proof under concurrency, rotation and failures.
- [ ] AI-04 plain-text preview, accessible explicit confirmation and browser tests.
- [ ] Fallback/handoff wording without availability, emergency or delivery promises.
