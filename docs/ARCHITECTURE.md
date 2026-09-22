# Vantara Platform Architecture

## Product model

Vantara is a connected hotel operating platform.

```
                         VANTARA
                            |
          +-----------------+-----------------+
          |                 |                 |
     HOTEL CORE       VANTARA CONNECT   VANTARA INTELLIGENCE
          |                 |                 |
 Reservations          Guest requests       Insights
 Rooms                 Communication        Automation
 Guests                Services             Decision support
 Operations
 Payments
          |                 |                 |
          +-----------------+-----------------+
                            |
                       VANTARA DATA
                            |
                       VANTARA CLOUD
```

## Initial domain modules

### Hotel Core
- Properties
- Room types
- Rooms
- Reservations
- Guests
- Payments

### Operations
- Housekeeping
- Maintenance
- Tasks
- Operational status

### Guest Experience
- Guest requests
- Conversations
- Messages
- Notifications
- Services

### Intelligence
- Operational insights
- CRM insights
- Alerts
- Automation
- Future forecasting and revenue intelligence

## Application architecture

The initial codebase is a pnpm workspace:

```
apps/
  web/       # Next.js application
  api/       # NestJS API

packages/
  ui/        # shared UI primitives
  types/     # shared domain contracts
  config/    # shared configuration
  database/  # database package and Prisma boundary
```

The exact package boundaries may evolve as implementation begins. Domain ownership should remain explicit.

## Request flow

```
Browser
  -> Web application
  -> API
  -> Authentication / Authorization
  -> Tenant context
  -> Domain service
  -> Database
```

Protected backend operations must establish tenant context before accessing tenant-owned records.

## Authentication

Initial target:
- short-lived access token
- secure refresh/session strategy
- password hashing with a modern adaptive password hash
- DTO validation
- explicit authorization guards
- no development credentials in production paths

## Multi-tenancy

Tenant context must come from authenticated membership/session context.

Do not accept a `tenantId` from the browser as the authority for protected operations.

Tenant-owned records should carry an explicit ownership relationship where appropriate, and queries should enforce that boundary systematically.

## Frontend

Next.js App Router + React + TypeScript.

Prefer:
- Server Components by default
- Client Components only where interactivity requires them
- typed API contracts
- route-level loading and error states
- accessible UI primitives
- no business claims that the backend cannot substantiate

## Backend

NestJS + TypeScript.

Prefer:
- controllers for transport
- DTOs for validation
- services/use-cases for business behavior
- guards/policies for authorization
- Prisma for persistence
- explicit transactions around multi-record state changes

## Database

PostgreSQL is the operational source of truth.

Money should use exact database numeric types, not floating point.

Dates and business-day calculations must be timezone-aware and property-local where relevant.

## Observability

Foundation should leave room for:
- structured application logs
- request correlation IDs
- audit logs for sensitive operations
- health/readiness endpoints
- error monitoring
- metrics

## Deployment target

- Web: Vercel
- API: Railway initially
- Database: PostgreSQL

Deployment decisions can evolve without coupling domain logic to a provider.
