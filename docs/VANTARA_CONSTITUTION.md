# Vantara Constitution

This document defines the non-negotiable engineering principles for Vantara Platform.

## 01. Multi-tenancy is mandatory
Every hotel is an isolated tenant boundary. Tenant identity is derived from authenticated server context, never trusted from arbitrary client input.

## 02. Data isolation is non-negotiable
A request authenticated for one tenant must never read, mutate, aggregate or infer data belonging to another tenant.

## 03. Product decisions precede implementation
Architecture exists to serve a defined hotel problem. Implementation should not invent product behavior silently.

## 04. AI must perform useful work
AI features must improve an observable hotel workflow, decision or guest interaction. An AI label without useful behavior is not a feature.

## 05. Operational truth beats decorative complexity
Prefer reliable source-of-truth workflows over impressive-looking but disconnected UI.

## 06. Security is a feature
Authentication, authorization, tenant isolation, auditability, secrets and safe defaults are part of the product, not post-launch cleanup.

## 07. Domain boundaries matter
Reservations, rooms, guests, operations, communication, payments and intelligence should have explicit responsibilities and contracts.

## 08. APIs are contracts
Validate inputs, return predictable errors, authorize every protected operation and document meaningful domain behavior.

## 09. Source-of-truth data must be explicit
Analytics must derive from authoritative operational records. Mock or randomly generated business data must never be presented as production intelligence.

## 10. Every major change is reviewed
Implementation follows a task/specification, tests accompany meaningful behavior, and changes are reviewed before merge.

## 11. Build for real hotels
A feature is complete when it survives realistic operational use, not merely when the screen renders.

## 12. Keep the system evolvable
Vantara Connect, Vantara Intelligence, Vantara Data and future integrations must be possible without repeatedly rewriting the Hotel Core.

---

**Foundation milestone:** `FOUNDATION-001`
