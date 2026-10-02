# Vantara Authorization Model

## Product contexts

- `GUEST`: Guest Connect. Scoped to the guest's active hotel/stay context.
- `HOTEL_STAFF`: Hotel operations. Tenant-scoped.
- `HOTEL_ADMIN`: Hotel management/owner. Tenant-scoped.
- `ZUITZERO_ADMIN`: Internal platform operations. Platform-scoped. **Read-only for billing.**
- `OWNER`: Zuitzero owner. Full platform control, including billing and owner-only controls.

## Core rule

Role, tenant membership and permission are separate concepts. The backend is the source of truth for authorization. UI visibility is not a security boundary.

## Billing boundary

| Role | Billing read | Billing write |
| --- | --- | --- |
| GUEST | own payment context only | own checkout/payment actions only |
| HOTEL_STAFF | no | no |
| HOTEL_ADMIN | hotel billing read | hotel billing actions allowed only by explicit hotel billing permission |
| ZUITZERO_ADMIN | yes | **no** |
| OWNER | yes | **yes** |

All sensitive billing mutations must create an audit event. Secrets, card data and tokens must never be written to the audit payload.

## Tenant isolation

Hotel resources must always resolve through the authenticated user's membership. A client-provided tenant ID is never sufficient to authorize access.

## Owner elevation

`OWNER` includes the operational capabilities of `ZUITZERO_ADMIN`, but `ZUITZERO_ADMIN` does not inherit owner capabilities. Owner-only actions must use explicit owner permissions/checks.

## Defense in depth

Application RBAC is paired with database controls where the deployment path supports them. Supabase documentation recommends RLS for granular application access and treating authorization claims as trusted only when stored in protected app metadata; do not expose service-role credentials to clients.
