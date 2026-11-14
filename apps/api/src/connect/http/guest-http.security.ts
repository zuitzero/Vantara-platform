import { CanActivate, ExecutionContext, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { GUEST_PROTOCOL, parseExchangeBody } from '../protocol/guest-access.contracts';

export const GUEST_COOKIE = GUEST_PROTOCOL.cookie.name;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const csrf = (secret: string) => createHmac('sha256', secret).update('vantara-guest-csrf-v1').digest('base64url');
export function enabled(env: NodeJS.ProcessEnv = process.env) {
  return ['test', 'development'].includes(env.NODE_ENV ?? '') && env.VANTARA_ENV === 'local' &&
    env.CONNECT_GUEST_HTTP === 'synthetic-https-only' && env.CONNECT_GUEST_POLICY_ACK === 'candidate-v1-synthetic-only';
}
export function trustedOrigin(env: NodeJS.ProcessEnv = process.env) {
  const value = env.WEB_ORIGIN ?? '';
  try { const url = new URL(value); if (url.origin === value && url.protocol === 'https:' && !url.username && !url.password && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return value; } catch {}
  throw new ForbiddenException('Guest boundary unavailable.');
}
const deny = () => { throw new ForbiddenException('Guest request denied.'); };
function cookies(req: Request, name: string) {
  const headers: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'cookie') headers.push(req.rawHeaders[i + 1]);
  if (headers.join(';').length > 8192) return deny();
  const matches = headers.flatMap(value => value.split(';')).map(value => value.trim()).filter(value => value.split('=')[0] === name);
  if (matches.length > 1 || matches.some(value => !value.includes('='))) return deny();
  return matches[0]?.slice(name.length + 1);
}
export function guestSecret(req: Request) {
  const secret = cookies(req, GUEST_COOKIE);
  try { return parseExchangeBody({ code: secret }).code; } catch { return deny(); }
}
export function checkCsrf(req: Request, secret: string) {
  const supplied = req.headers['x-vantara-csrf']; const expected = csrf(secret);
  if (typeof supplied !== 'string' || ! /^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) deny();
}
function canonicalRoute(req: Request) {
  return [['POST', '/api/guest-connect/session'], ['GET', '/api/guest-connect/stay'], ['POST', '/api/guest-connect/stay'], ['POST', '/api/guest-connect/requests'], ['POST', '/api/guest-connect/logout']].some(([method, path]) => req.method === method && req.originalUrl === path) || (req.method === 'POST' && /^\/api\/connect-admin\/reservations\/[^/?]+\/bootstrap$/.test(req.originalUrl));
}
export function requireGuestTransport(req: Request) {
  if (!enabled()) throw new NotFoundException();
  const loopback = (value?: string) => value === '::1' || value === '::ffff:127.0.0.1' || value === '127.0.0.1';
  // Never trust forwarding headers. Only a real TLS socket qualifies in this local-only phase.
  if (!loopback(req.socket.localAddress) || !loopback(req.socket.remoteAddress) || !(req.socket as { encrypted?: boolean }).encrypted || req.headers.origin !== trustedOrigin() || req.headers['x-vantara-guest'] !== '1' ||
      !canonicalRoute(req) || req.originalUrl.includes('?') || req.headers.authorization || req.headers['content-encoding'] ||
      (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')) deny();
  if (req.method !== 'GET' && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) deny();
  cookies(req, GUEST_COOKIE); // Reject duplicates even during exchange.
  cookies(req, 'vantara_session'); // No ambiguous staff identity on bootstrap issuance.
}
@Injectable()
export class GuestTransportGuard implements CanActivate {
  canActivate(context: ExecutionContext) { requireGuestTransport(context.switchToHttp().getRequest()); return true; }
}
export function guestCookie(secret: string, expiresAt: number) {
  // Absolute Expires avoids extending an expired session on delayed delivery.
  return `${GUEST_COOKIE}=${secret}; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
}
export function clearGuestCookie() { return `${GUEST_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`; }
export function boundaryPath(url: string) { return url.startsWith('/api/guest-connect') || /^\/api\/connect-admin\/reservations\/[^/?]+\/bootstrap(?:\?|$)/.test(url); }
export class GuestRateLimit {
  private readonly entries = new Map<string, { count: number; until: number }>();
  take(key: string, now = Date.now()) {
    for (const [k, v] of this.entries) if (v.until <= now) this.entries.delete(k);
    const row = this.entries.get(key) ?? { count: 0, until: now + 60000 };
    if (!this.entries.has(key) && this.entries.size >= 1000) return false;
    row.count++; this.entries.set(key, row); return row.count <= 120;
  }
}
// Register before Nest initializes its default parsers, in main and the real HTTPS harness.
export function configureGuestHttp(app: NestExpressApplication) {
  const limit = new GuestRateLimit();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!boundaryPath(req.originalUrl)) return next();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    try {
      requireGuestTransport(req);
      const path = req.originalUrl;
      if (!limit.take(`${req.socket.remoteAddress}:${req.method}:${path.includes('connect-admin') ? 'bootstrap' : path}`)) return res.status(429).set('Retry-After', '60').json({ message: 'Guest rate limit.' });
      next();
    } catch (error) { res.status(error instanceof NotFoundException ? 404 : 403).json({ message: 'Guest boundary unavailable.' }); }
  });
  app.useBodyParser('json', { limit: 1024, inflate: false, type: (req: Request) => req.originalUrl === '/api/guest-connect/session' });
  app.useBodyParser('json', { limit: 8192, inflate: false, type: (req: Request) => boundaryPath(req.originalUrl) && req.originalUrl !== '/api/guest-connect/session' });
  // Explicit fallback is required: registering a conditional jsonParser suppresses Nest's default one.
  app.useBodyParser('json', { limit: '100kb', type: (req: Request) => !boundaryPath(req.originalUrl) });
  app.use((error: { status?: number }, req: Request, res: Response, next: NextFunction) => {
    if (!boundaryPath(req.originalUrl)) return next(error);
    res.status(error.status === 413 ? 413 : 400).json({ message: 'Invalid guest body.' });
  });
}
