# Vantara Platform

Vantara is the operating system for connected hotel operations.

> **Vantara converts the operation of a hotel into a connected system.**

## Status

Foundation phase. The repository is intentionally starting clean.

## Product pillars

- **Hotel Core**: reservations, rooms, guests, operations and payments.
- **Vantara Connect**: direct guest communication, requests and services.
- **Vantara Intelligence**: insights, automation and decision support.
- **Vantara Data**: the operational source of truth.
- **Vantara Cloud**: secure, scalable infrastructure.

## Repository

This repository contains the next-generation Vantara platform. The previous implementation is retained separately as legacy reference material.

## Engineering principles

1. Multi-tenancy is mandatory.
2. Tenant isolation is enforced server-side.
3. Product decisions precede implementation.
4. Security is a product feature.
5. AI must perform useful work.
6. No decorative complexity without operational value.
7. Every major change is reviewed.
8. Source-of-truth data must be explicit.
9. APIs and domain boundaries are intentional.
10. Build for real hotels, not demos.

See `docs/VANTARA_CONSTITUTION.md` for the full engineering constitution.
