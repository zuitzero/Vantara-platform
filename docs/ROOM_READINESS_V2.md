# Room readiness v2

The server derives cached readiness in the same Serializable transaction as operational writes. Priority: administrative OUT_OF_SERVICE lock, active blocking maintenance, active blocking housekeeping, READY. Occupancy is never changed by the resolver. Serialization conflicts retry the complete transaction up to three attempts.

`blocksRoom` defaults to true for existing work and staff-created work, preserving previous behavior. New guest housekeeping requests block; new guest maintenance requests explicitly do not block because there is no issue classification. Staff must triage potentially dangerous maintenance and mark it blocking through the existing maintenance.manage endpoint. Priority and free text do not classify hazards automatically.

Checkout reuses only an active blocking housekeeping task, otherwise creates blocking turnover work. Cancellation and completion stop contributing to readiness. Terminal work cannot reopen, receive assignment changes, or change its blocking flag. Assignment rules and permissions are unchanged.

The existing rooms readiness PATCH now accepts OUT_OF_SERVICE to lock, or READY to release the administrative lock and recalculate. Releasing a lock does not force READY while blocking work remains; CLEANING/MAINTENANCE direct writes are rejected. The Rooms UI labels this administrative lock separately from derived readiness.

The forward migration preserves existing OUT_OF_SERVICE rooms as manual locks, defaults historical tasks/tickets to blocking, and creates explicit review tasks for legacy CLEANING/MAINTENANCE rooms without matching active work before recalculating. It never rewrites occupancy or earlier migrations. Review these migration-created tasks operationally. Deployment must apply and verify this migration before running new code; no production application is claimed here.

Tests use transactional Prisma mocks, including contention/retry simulation. Real PostgreSQL concurrency and browser end-to-end verification remain deployment validation. Guest request closure remains separate from operational work closure; staff closes the linked queue work explicitly. Existing notification publication occurs after the database transaction and does not have an outbox.
