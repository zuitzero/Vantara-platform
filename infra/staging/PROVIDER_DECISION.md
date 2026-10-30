# Provider decision sheet — Phase A, 2026-10-30

**Evaluation candidate only: Render paid services + managed PostgreSQL, one isolated
staging workspace/region. Not selected/purchased. Founder sign-off fields are PENDING.**

| Decision | Candidate / evidence / outstanding proof |
| --- | --- |
| Public edge and WSS | Render [web service managed TLS](https://render.com/docs/web-services), [WebSocket support](https://render.com/docs/websocket); Nginx routes HTTP/upgrade to private apps; verify timeout/drain/custom-host policy on actual plan |
| Private app network | Separate [private services](https://render.com/docs/private-services) for Web/API in same region; [network scope](https://render.com/docs/private-network) requires isolation/access review, not public onrender origins |
| PostgreSQL | [Managed paid Postgres](https://render.com/docs/postgresql-creating-connecting); disable external access, validate strict internal TLS self-signed CA/hostname with Prisma6. **Blocker until proven** |
| Logging | Outer managed edge must suppress/redact capability-bearing paths before retention; downstream safe Nginx logs cannot fix edge capture. **Blocker until provider evidence** |
| Recovery | [Paid PITR](https://render.com/docs/postgresql-backups): workspace Hobby 3 days / Pro+7 days; recent ten minutes not restorable. Pro+ candidate for 7-day gate; actual RPO/RTO/restore not measured |
| Plan sizing | Current [compute plan names](https://render.com/docs/compute-plans): gateway 0.5c-512mb, Web/API 1c-2g, PG 0.5c-1g candidate; benchmark before acceptance. No free/sleeping tiers, no HA claim |

Provider Directory was attempted read-only; CLI plugin metadata unavailable and
public setup page could not be fetched. No install, login, sandbox or account was
created. Official sources were consulted instead; none authorize provisioning.

## Cost inputs and approval (USD/month, not a quote)

[Pricing page](https://render.com/pricing) is dynamically rendered: full current
compute/DB quote was not extractable. [Official workspace pricing announcement](https://render.com/blog/better-pricing-for-fast-growing-teams)
states Pro $25/month flat subscription. Recheck all units, workspace separation,
region, taxes and contract terms in an owned account before approval.

| Item | Planning input | Status |
| --- | --- | --- |
| Gateway 0.5c-512mb | $7 | Official indexed pricing anchor; reconfirm current regional quote |
| Web + API 1c-2g | $25 each | Prior CLOUD-01 assumption, **not freshly quoted** |
| PG 0.5c-1g | $19 | Prior CLOUD-01 assumption, **not freshly quoted**, storage separate |
| Dedicated Pro workspace | $25 | Official announcement anchor; confirm current terms |
| Compute + workspace illustrative subtotal | 7 + 25 + 25 + 19 + 25 = **$101** | Arithmetic scenario only, not approved spend |
| Storage/egress/log-safe monitoring/exports/restore capacity | **TBD** | Quote required; restores temporarily add DB capacity |
| Staging planning reserve | **$150–200** | Analyst allowance, not vendor offer or authorized cap |
| Production | **Separate quote TBD** | Never share staging DB/credentials; no production sizing in Phase A |

Reject candidate if strict private DB TLS, least privilege or pre-capture edge
redaction cannot be demonstrated. Re-evaluate a private-network managed container +
managed Postgres alternative in a later decision; do not silently choose another
provider, loosen verification, use a tunnel or expose API to meet the estimate.

Approval record: founder/account owner **PENDING**; region/residency **PENDING**;
owned domain **PENDING**; confirmed quote + hard monthly cap/alerts **PENDING**;
TLS/redaction proof **PENDING**; release/data/security/on-call owners **PENDING**.
No funds, credentials, provider API calls or deployment occurred in this work.
