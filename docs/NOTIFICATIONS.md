# Vantara Notifications & Operations

Vantara uses one event-driven notification architecture for three audiences: guests, hotel staff, and Zuitzero operations.

## Principles

- Business events are emitted by domain services, not directly by UI components.
- Notifications are persisted before delivery when practical so transient delivery failures do not erase history.
- Every notification is scoped to a tenant when it belongs to hotel operations.
- Zuitzero operational alerts are isolated from tenant-visible notifications and must not expose guest PII or secrets.
- Severity controls delivery behavior: info, warning, high, critical.
- Repeated infrastructure failures are deduplicated into incidents rather than producing notification storms.

## Initial event flow

```text
Guest / Hotel action
        ↓
Domain event
        ↓
Notification service
        ↓
Recipient + channel policy
        ↓
Web notification center / toast

Infrastructure signal
        ↓
Incident engine
        ↓
Zuitzero Operations alert
```

## Guest request lifecycle

```text
CREATED → ACKNOWLEDGED → IN_PROGRESS → COMPLETED
                         ↘ CANCELLED
```

Every transition should generate the appropriate recipient notification. The guest sees progress for their own request; hotel staff sees operational work; Zuitzero receives only system/technical failures.

## Future delivery channels

- In-app realtime events
- Browser push
- WhatsApp
- Email
- Mobile push

The initial implementation should keep the delivery interface channel-agnostic so adding WhatsApp or push does not require rewriting domain services.

## Zuitzero incident policy

Operational alerts should contain service, environment, severity, incident key, timestamps, and safe diagnostic metadata. Do not include passwords, tokens, payment credentials, or unnecessary guest information.

High and critical incidents require durable incident records and human review before any destructive remediation. Safe automated recovery may be added later behind explicit allowlists and post-action health checks.
