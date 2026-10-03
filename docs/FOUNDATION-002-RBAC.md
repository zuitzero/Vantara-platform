# FOUNDATION-002 RBAC decision

Vantara has four product experiences, with Zuitzero operational roles separated internally:

1. Guest Connect (`GUEST`)
2. Hotel Command Center (`HOTEL_STAFF`, `HOTEL_ADMIN`)
3. Zuitzero Admin Console (`ZUITZERO_ADMIN`)
4. Vantara Owner Command Center (`OWNER`)

The Owner is a superset of Zuitzero operational capabilities, but Zuitzero Admin is explicitly prevented from billing mutations.

The Owner dashboard may expose the global Vantara network, business metrics, infrastructure, security and Zuitzero operations. The hotel dashboard remains tenant-isolated.

Billing is a protected domain. Read access and mutation access are separate permissions, and sensitive billing mutations are audited.
