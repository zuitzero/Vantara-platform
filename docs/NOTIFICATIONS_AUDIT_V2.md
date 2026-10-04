# Notifications and audit v2

Existing AuditLog/AuditService and Notification/NotificationsService remain authoritative. No duplicate event tables or external delivery providers are added.

## Audit

A global HTTP interceptor derives user/tenant identity from authenticated server context using AsyncLocalStorage. Domain services call the centralized auditMutation writer with their own transaction client; actor fields are not accepted in DTOs. Non-HTTP internal workflows are SYSTEM actors. Public workspace bootstrap is SYSTEM with the server-created user ID, not client-supplied identity.

Audited in the same transaction: reservation creation, room assignment, confirmation, check-in/out, cancel/no-show; guest creation; manual room occupancy and OUT_OF_SERVICE lock/unlock; housekeeping/maintenance creation, assignment changes, status and blocking changes; operational staff creation/context changes; workspace creation. Automatically created post-checkout/guest-request operational work also records its creation in that transaction. No-op lifecycle calls do not create duplicate audits. Guest profile updates have no existing endpoint, so none is invented. Permission denials remain recorded by PermissionsGuard. Ordinary validation mistakes are not audited.

Bootstrap failures after starting its transaction are recorded separately after rollback, without email, slug, password or raw error. If the database cannot store that failure, a generic warning is emitted and the original error remains authoritative. This is the only success/failure exception: successful bootstrap audit is atomic.

Metadata is allowlisted to operational IDs, statuses, flags, role/permission codes and plan. Raw payloads, guest names/contacts/notes, passwords, tokens and secrets are never passed. Reads sanitize historical metadata too; IP/user agent are omitted from the hotel read projection and are not captured automatically.

GET /audit derives active tenant from auth, uses security.read, requires HOTEL context, defaults to 25 rows and caps at 100, with bounded offset and optional AuditAction filter. HOTEL_ADMIN receives security.read; HOTEL_STAFF does not. Platform memberships cannot use this hotel trail. The Activity UI shows timestamp, actor, action, resource and selected summaries, not raw JSON.

## Notifications

publish validates tenant/audience and recipient ownership, persists first, then emits. HOTEL targets are User IDs linked through HOTEL_ADMIN/HOTEL_STAFF Membership; GUEST targets retain existing tenant-scoped Guest IDs. Only IN_APP is supported here. HOTEL reads/mark-read recheck membership and scope tenant, audience and recipient. Realtime uses official roles and current membership at connection; platform/legacy roles cannot join hotel rooms.

Assignment/reassignment to real staff derives recipient from OperationalStaff → Membership.userId. High/urgent maintenance creation generates one attention notification (targeted when assigned, broadcast otherwise). Same assignment, ordinary status/flag edits and unassignment do not notify. Existing guest-request notifications, including urgency severity, remain supported.

Staff workflow notifications persist inside the same Serializable transaction as work and audit. Each retry has a separate emission buffer; realtime flushes only after a successful commit. A socket error does not turn committed work into an API failure: persisted notifications remain readable. This is not an outbox and does not guarantee delivery while the process crashes after commit.

NotificationRead stores per-user receipts with a compound notification/tenant FK. A user's read never modifies the shared Notification row or another user's receipt. Migration preserves historical targeted HOTEL read states for known staff recipients. Historical broadcast readAt cannot identify who read it and is ignored; those broadcasts may reappear unread. Old readAt remains for legacy non-HOTEL behavior.

## Remaining limitations

No email/SMS, Resend, PostHog or external observability. No durable outbox/realtime replay, retention policy or streaming audit export. Existing guest-request publish remains after its domain transaction, so a notification persistence failure may follow a committed request; retry/idempotency needs a dedicated outbox slice. Guest realtime currently joins user identity rooms while Guest events use Guest IDs; persistent guest events are kept, but a complete Guest Connect delivery mapping is outside this hotel task. Sockets authorize on connection rather than continuous session expiry/tenant switching.

Legacy singular notification.* files still exist but are not registered in AppModule; they are not used by the new paths. Two pre-existing AuthModule import gaps in Requests/Operations were fixed after an actual Nest module composition test exposed them. No broad legacy refactor was performed.

The forward migration extends AuditAction and adds NotificationRead only. It has not been applied to production. Tests cover real service/guard/module wiring with Prisma mocks; live PostgreSQL rollback/concurrency and browser/session verification remain target-environment checks.
