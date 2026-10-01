# Vantara Database Principles

## Core entities

- Tenant
- Membership
- Role
- Permission
- Property
- RoomType
- Room
- Guest
- GuestPreference
- Reservation
- ReservationGuest
- Payment
- GuestRequest
- Conversation
- Message
- Task
- HousekeepingTask
- MaintenanceTicket
- Notification
- AuditLog

Not every entity must ship in the first migration. The schema should evolve from explicit domain requirements.

## Ownership

Every tenant-owned entity must have a clear ownership path to its tenant.

For property-scoped records, the property must itself belong to the tenant.

For user access, membership is the authority connecting a user to a tenant and role.

## Money

Use PostgreSQL numeric/decimal types for monetary values. Never use JavaScript floating point as the database source of truth for money.

## Statuses

Operational states should be represented as explicit enums or constrained values, not arbitrary strings.

## Reservations

Expected lifecycle:
- CONFIRMED
- CHECKED_IN
- CHECKED_OUT
- CANCELLED
- NO_SHOW

Transitions must be validated by domain rules.

## Rooms

Initial operational states:
- AVAILABLE
- OCCUPIED
- CLEANING
- MAINTENANCE
- OUT_OF_SERVICE

Room status changes should be traceable and consistent with reservation and operations workflows.

## Auditability

Sensitive mutations should eventually create audit records including actor, tenant, action, entity and timestamp.

## Analytics

Analytics and dashboard metrics must derive from source-of-truth operational records. No random/mock production metrics.
