# Vantara Security Baseline

## Required

- No hard-coded production secrets.
- No fallback JWT secret.
- No seeded production administrator credentials.
- Validate request bodies with DTOs.
- Authenticate protected routes.
- Authorize access at tenant and property boundaries.
- Never trust client-provided tenant ownership.
- Hash passwords using bcrypt/argon2 with appropriate cost parameters.
- Do not log passwords, tokens or sensitive guest information.
- Use secure session/token expiration and rotation strategies.
- Maintain an audit trail for sensitive administrative actions.

## Authentication boundary

Authentication answers: "Who is this?"

Authorization answers: "What may this actor do in this tenant/property?"

Both are required.

## Tenant isolation rule

A valid resource ID is not sufficient authorization.

Conceptually:

```ts
return prisma.room.findFirst({
  where: {
    id,
    property: { tenantId: authenticatedTenantId }
  }
})
```

The exact implementation should use reusable authorization patterns to avoid inconsistent enforcement.

## Production readiness

Before production:
- security review
- dependency audit
- secret management
- rate limiting
- CORS policy
- secure headers
- database backup strategy
- recovery procedure
- audit logging
- monitoring and alerting
