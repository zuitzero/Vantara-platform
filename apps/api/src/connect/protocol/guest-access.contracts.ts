/** CONNECT-SEC-01 Phase 1: unregistered protocol contracts, not an auth implementation. */
import { allowedOrigin } from '../../security/cloud-security';

export const GUEST_PROTOCOL = {
  landing: '/connect',
  exchange: '/api/guest-connect/session',
  stay: '/api/guest-connect/stay',
  requests: '/api/guest-connect/requests',
  logout: '/api/guest-connect/logout',
  cookie: { name: '__Host-vantara_guest', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
  bootstrapTtlMs: 5 * 60_000,
  sessionTtlMs: 12 * 60 * 60_000,
  idleTtlMs: 30 * 60_000,
  maxSessions: 3,
} as const;

export class GuestProtocolDenied extends Error {
  constructor() { super('GUEST_ACCESS_DENIED'); this.name = 'GuestProtocolDenied'; }
}
const deny = (): never => { throw new GuestProtocolDenied(); };
const timestamp = (value: number) => Number.isSafeInteger(value) && value > 0;
const identifier = (value: string) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export const isFingerprint = (value: string) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Private server projections. Never deserialize these from browser JSON or staff cookies.
export interface GuestScope {
  tenantId: string; propertyId: string; reservationId: string; accessId: string; generation: number;
}
export interface StayAuthority {
  tenantType: 'HOTEL'; tenantId: string; accessId: string; generation: number;
  expiresAt: number; revokedAt: number | null;
  reservation: { id: string; tenantId: string; propertyId: string; status: string; checkOut: number };
  property: { id: string; tenantId: string };
  guest: { tenantId: string };
}
export interface BootstrapRecord {
  codeHash: string; scope: GuestScope; issuedAt: number; expiresAt: number;
  consumedAt: number | null; revokedAt: number | null;
}
export interface GuestSessionRecord {
  kind: 'CONNECT_GUEST'; secretHash: string; scope: GuestScope;
  createdAt: number; lastSeenAt: number; expiresAt: number; revokedAt: number | null;
}

export function parseExchangeBody(input: unknown): { code: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return deny();
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || !Object.hasOwn(row, 'code') ||
      typeof row.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(row.code) ||
      Buffer.from(row.code, 'base64url').toString('base64url') !== row.code) return deny();
  return { code: row.code };
}

export function parseBootstrapFragment(fragment: unknown): { code: string } {
  if (typeof fragment !== 'string' || !/^#code=[A-Za-z0-9_-]{43}$/.test(fragment)) return deny();
  return parseExchangeBody({ code: fragment.slice(6) });
}

export function assertExchangeRequest(method: string, origin: unknown, contentType: unknown, trustedOrigin: string): void {
  if (method !== 'POST' || !allowedOrigin(origin, { NODE_ENV: 'production', WEB_ORIGIN: trustedOrigin }) ||
      typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') deny();
}

function liveScope(authority: StayAuthority, now: number): GuestScope {
  const r = authority.reservation, p = authority.property;
  if (!timestamp(now) || authority.tenantType !== 'HOTEL' || authority.revokedAt !== null ||
      !timestamp(authority.expiresAt) || authority.expiresAt <= now || !timestamp(r.checkOut) || r.checkOut <= now ||
      !['CONFIRMED', 'CHECKED_IN'].includes(r.status) || r.tenantId !== authority.tenantId ||
      p.tenantId !== authority.tenantId || authority.guest.tenantId !== authority.tenantId || r.propertyId !== p.id ||
      !Number.isSafeInteger(authority.generation) || authority.generation < 1 ||
      ![authority.tenantId, authority.accessId, r.id, p.id].every(identifier)) return deny();
  return { tenantId: authority.tenantId, accessId: authority.accessId, generation: authority.generation, reservationId: r.id, propertyId: p.id };
}
function matches(scope: GuestScope, live: GuestScope): boolean {
  return (['tenantId', 'propertyId', 'reservationId', 'accessId', 'generation'] as const).every(key => scope[key] === live[key]);
}

/** Preflight only: repository MUST repeat using locked live rows at commit time. */
export function planExchange(bootstrap: BootstrapRecord, authority: StayAuthority, now: number) {
  const scope = liveScope(authority, now);
  if (!isFingerprint(bootstrap.codeHash) || !matches(bootstrap.scope, scope) ||
      bootstrap.consumedAt !== null || bootstrap.revokedAt !== null || !timestamp(bootstrap.issuedAt) ||
      bootstrap.issuedAt > now || !timestamp(bootstrap.expiresAt) || bootstrap.expiresAt <= now ||
      bootstrap.expiresAt <= bootstrap.issuedAt || bootstrap.expiresAt > Math.min(bootstrap.issuedAt + GUEST_PROTOCOL.bootstrapTtlMs, authority.expiresAt, authority.reservation.checkOut)) return deny();
  return { scope, expiresAt: Math.min(now + GUEST_PROTOCOL.sessionTtlMs, authority.expiresAt, authority.reservation.checkOut) };
}

export function assertGuestSession(session: GuestSessionRecord, authority: StayAuthority, now: number): GuestScope {
  const scope = liveScope(authority, now);
  if (session.kind !== 'CONNECT_GUEST' || !isFingerprint(session.secretHash) || !matches(session.scope, scope) ||
      session.revokedAt !== null || !timestamp(session.createdAt) || session.createdAt > now ||
      !timestamp(session.lastSeenAt) || session.lastSeenAt < session.createdAt || session.lastSeenAt > now ||
      session.lastSeenAt + GUEST_PROTOCOL.idleTtlMs <= now || !timestamp(session.expiresAt) || session.expiresAt <= now ||
      session.expiresAt > Math.min(session.createdAt + GUEST_PROTOCOL.sessionTtlMs, authority.expiresAt, authority.reservation.checkOut)) return deny();
  return scope;
}

/** Future persistence port. Hash lookup only; no client ownership, raw code or staff session.
 * Under one transaction/lock protocol: resolve authority, consume once, enforce per-access
 * session cap and insert fresh hashed session, or roll back all writes. No implementation here.
 */
export interface GuestExchangeRepository {
  exchangeOnce(input: { codeHash: string; freshSessionHash: string; now: number }): Promise<GuestSessionRecord>;
}
