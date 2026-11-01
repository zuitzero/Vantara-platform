# Proposal: remove guest capability secrets from request URLs

Status **PROPOSED / NOT IMPLEMENTED**, 2026-11-01. Separate security review and an
explicitly scoped implementation PR required. Refs #47/#45; current behavior,
Connect authorization, trial/RBAC, billing and AI are unchanged.
[Provider decision](CLOUD_03B_PROVIDER_DECISION.md).

## Problem and alternatives

Current issuance returns `/connect/:token`; the guest page calls
`/api/connect/:token` and `/api/connect/:token/requests`. The secret therefore crosses
at least two HTTP request-target boundaries. A URL-query token is also visible to
HTTP receivers and URL logs. Redirects, no-referrer, no-store, downstream Nginx
redaction, URL masking or logging only a template in application code do not undo
an earlier edge capture. Even one-time path codes can leak before consumption.

Preferred design for review: **token-free landing route + fragment bootstrap +
one-use POST exchange + isolated guest cookie session**. Alternative: token-free
landing page and separately entered high-entropy one-time code, with greater guest
friction. An ordinary short numeric code requires aggressive online abuse controls
and a reviewed second channel; it must not quietly replace existing token entropy.
No code or token is included in this document.

URI fragments are separated before dereferencing ([RFC3986 §3.5](https://www.rfc-editor.org/rfc/rfc3986#section-3.5));
that prevents the fragment itself being an HTTP request-target component. It does
not make the fragment invisible to JavaScript, clipboard/history sync, screenshots,
extensions or someone sharing the original link. This is a URL-log threat reduction,
not identity verification, guaranteed secrecy, or a reason to trust body logging.

## Proposed trust flow (route names illustrative, no routes added)

1. Existing authorized hotel reservation access issuance generates a random,
   high-entropy bootstrap code with short expiry, hashed at rest, bound to the
   server's tenant/property/reservation and access generation. Proposed expiry5min
   is a product decision for review; delayed-arrival links require a secure reissue
   flow, not a silent long-lived bearer. No guest-supplied tenant or resource scope.
2. A token-free `/connect` shell has no analytics/third-party scripts. Minimal
   bootstrap code reads fragment into memory, immediately uses history.replaceState
   to remove it before async fetch/navigation, and never uses localStorage or URL
   query fallback. Require no-referrer/no-store and reviewed restrictive CSP/XSS
   protections. History removal cannot erase copies already shared/synced.
3. Explicit guest action submits the code in a bounded POST body to a constant
   `/api/connect/session` exchange, with exact same Origin/CSRF checks and no body/
   cookie/header tracing at **any** terminating provider, gateway, app or APM sink.
   GET/link previews must not consume access or issue a session. A bot may still
   execute JavaScript or submit forms; the button is not a proof of human identity.
4. Atomically consume once only if unexpired/unrevoked and reservation remains
   requestable; issue a fresh random guest-session secret, hashed server-side,
   with TTL bounded by stay/access expiry and reviewed inactivity policy. Use a
   separate `__Host-vantara_guest` cookie, Secure/HttpOnly/SameSite=Lax, Path=/,
   no Domain. It never replaces or grants the hotel staff/OWNER/platform session.
   Rotate to prevent fixation; fail replay/concurrent exchange without echoing data.
5. All subsequent guest APIs use constant paths and the guest cookie. Resolve live
   tenant/reservation/generation on the server for each read/write, retain existing
   checkout/revoke/expiry rules and request side effects. Cookie-authenticated
   mutations require Origin/CSRF defenses and server-scoped idempotency; neither
   cookies nor “AI confirmation” permit caller-owned tenant/resource identifiers.
6. Reissue/revoke and checkout invalidate bound sessions/generations as well as
   bootstrap codes. Define logout, lost-device recovery, multi-device behavior,
   short expiry UX and abandoned-code cleanup. Never extend lifecycle or trial
   authority simply to make a link reusable.

## Residual risks and compatibility review

The HTTPS provider can still see exchange body and cookies in memory; require
processor review and proven logging controls for those fields. Do not equate a
fragment with end-to-end encryption against the terminating provider. Third-party
analytics, browser/error breadcrumbs and session replay remain disabled. Avoid
service-worker caches, replays and accidental token-bearing redirect destinations.

A shared fragment/code remains a possession capability until expiry/consumption;
sharing can transfer access. Cookie sessions reduce routine sharing, but don't
prove guest identity. Any verified invitation/email/OTP flow is separate account
enrollment work with its own issuer/recipient/single-use/recovery threat model;
it must not confer HOTEL_ADMIN or reuse Connect access as an invitation.

Backward compatibility cannot mean keeping live old bearer paths on a URL-logging
edge. A later PR must version issuance, review guest UI/API migration together,
set an explicit legacy expiry/revocation window and retain safe legacy ingress
under controlled first-receiver logging until old secrets are dead. A redirect
from an old link is already too late to hide that request. Don't silently break
existing stays or activate a feature flag in this documentation PR. If privacy
cannot be maintained during the overlap, postpone rollout rather than whitelist
legacy leaks. Revoking old links is an operational action requiring approval.

Required future tests: exact-origin exchange/login-CSRF and fixation; A/B tenant/
reservation/property negative access; no ownership fields accepted; replay, expiry,
rotation, checkout and concurrent one-use consumption; independent hotel/guest
cookies; request idempotency/operational side effects; fragments absent from actual
edge request targets; memory/history cleanup across reload/back/forward/mobile;
link previews/XSS/telemetry canaries; cookie/body secrecy in all log layers; legacy
migration/rollback that never reopens revoked generations or public signup.

All tests are **proposed, NOT RUN** here. Provider approval cannot assume this
redesign exists. First review the threat model and UX; only then request a separate
implementation scope and synthetic test authorization. No customer invitation,
real hotel activation, provider LLM or Stripe operation is part of the proposal.
