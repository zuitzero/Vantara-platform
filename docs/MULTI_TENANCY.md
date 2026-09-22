# Vantara Multi-Tenancy

Multi-tenancy is a first-class architectural constraint.

## Model

```
VANTARA
|
+-- Tenant A
|   +-- Memberships
|   +-- Properties
|       +-- Rooms
|       +-- Reservations
|       +-- Guests
|
+-- Tenant B
    +-- Memberships
    +-- Properties
        +-- Rooms
        +-- Reservations
        +-- Guests
```

## Membership model

A user identity should be distinct from tenant membership.

Conceptually:

```
User
  |
  +-- Membership -> Tenant A -> Role
  |
  +-- Membership -> Tenant B -> Role
```

This allows the same person to belong to multiple hotel organizations without making email globally equivalent to tenant membership.

## Request lifecycle

1. Verify authentication.
2. Resolve the actor's active membership.
3. Establish tenant context server-side.
4. Authorize the requested action.
5. Query through tenant-scoped data access.
6. Return only records visible within that context.

## Anti-patterns

- Trusting `tenantId` from request body.
- Global lookup by resource ID for tenant-owned entities.
- Global email uniqueness as a substitute for membership.
- Cross-tenant analytics without an explicit privileged context.
- Client-controlled role or permission claims.

## Future

The model should support:
- multiple properties per hotel group
- staff belonging to one or more properties
- custom roles
- organization-level administration
- property-level authorization
- platform-level support access with explicit privileged controls
