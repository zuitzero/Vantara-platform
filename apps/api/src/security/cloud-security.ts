import { SESSION_COOKIE } from '../auth/auth.constants';
import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

type Environment = Record<string, string | undefined>;

// An unrecognized/missing runtime is never a local-development escape hatch.
export function isLocal(env: Environment = process.env): boolean {
  return ['development', 'test'].includes(env.NODE_ENV ?? '') &&
    (!env.VANTARA_ENV || env.VANTARA_ENV === 'local');
}

export function webOrigin(env: Environment = process.env): string {
  const value = env.WEB_ORIGIN ?? (isLocal(env) ? 'http://localhost:3000' : '');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('WEB_ORIGIN must be an exact origin.'); }
  if (url.origin !== value || url.username || url.password ||
      (!isLocal(env) && (url.protocol !== 'https:' || isLoopback(url.hostname))) ||
      !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('WEB_ORIGIN must be an exact trusted HTTPS origin outside local development.');
  }
  return value;
}

function isLoopback(host: string) {
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host) || host === '0.0.0.0';
}

export function validateCloudEnvironment(env: Environment = process.env): void {
  if (env.VANTARA_ENV && !['local', 'staging', 'production'].includes(env.VANTARA_ENV)) {
    throw new Error('Invalid VANTARA_ENV.');
  }
  if (env.VANTARA_ENV === 'local' && !isLocal(env)) throw new Error('Local mode requires development or test NODE_ENV.');
  webOrigin(env);
  if (!isLocal(env)) {
    if (env.NODE_ENV !== 'production') throw new Error('Cloud requires NODE_ENV=production.');
    if (env.ALLOW_LOCAL_WORKSPACE_SIGNUP !== undefined && env.ALLOW_LOCAL_WORKSPACE_SIGNUP !== 'false') {
      throw new Error('Local workspace signup cannot be enabled in Cloud.');
    }
    let db: URL;
    try { db = new URL(env.DATABASE_URL ?? ''); } catch { throw new Error('Cloud requires an explicit PostgreSQL URL.'); }
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname || isLoopback(db.hostname)) {
      throw new Error('Cloud PostgreSQL cannot use a loopback host.');
    }
  }
}

export function assertLocalWorkspaceSignup(env: Environment = process.env): void {
  if (!isLocal(env) || env.ALLOW_LOCAL_WORKSPACE_SIGNUP !== 'true') {
    throw new ForbiddenException('Public hotel registration is disabled. Contact your operator.');
  }
}

export function allowedOrigin(origin: unknown, env: Environment = process.env): boolean {
  try { return typeof origin === 'string' && origin === webOrigin(env); } catch { return false; }
}

export function sessionCookie(value: string, maxAge: number, env: Environment = process.env): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${isLocal(env) ? '' : '; Secure'}`;
}

export function securityMiddleware(request: Request, response: Response, next: NextFunction): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Frame-Options', 'DENY');
  // Stripe authenticates machine callbacks using its raw-body signature, not browser cookies.
  const webhook = request.path === '/api/billing/webhooks/stripe';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !webhook &&
      !(isLocal() && request.headers.origin === undefined) && !allowedOrigin(request.headers.origin)) {
    response.status(403).json({ statusCode: 403, message: 'Trusted request origin required.' });
    return;
  }
  next();
}
