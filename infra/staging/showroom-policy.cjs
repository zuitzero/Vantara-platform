// Shared by the offline gateway renderer and the raw Next/Nest ingress boundaries.
const { timingSafeEqual } = require('node:crypto');

const MODE = 'cloud-05a';
const MARKER = 'VANTARA_SHOWROOM_SYNTHETIC_ONLY';
const HEADER = 'x-vantara-showroom-ingress';
const KEY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const ID = 'c[a-z0-9]{24}';
const routes = [
  ['GET', '/', 'web'],
  ['GET', '/onboarding', 'web'],
  ['GET', '/connect', 'web'], // CONNECT-SEC-04 still returns 404 in staging.
  ['GET', '/_next/static/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\\.(?:js|css|woff2|png|svg)', 'web'],
  ['GET', '/api/health', 'api'],
  ['POST', '/api/auth/login', 'api'],
  ['GET', '/api/auth/me', 'api'],
  ['POST', '/api/auth/logout', 'api'],
  ['GET', '/api/reservations', 'api'],
  ['GET', '/api/reservations/' + ID, 'api'],
  ['GET', '/api/requests', 'api'],
  ['GET', '/api/requests/' + ID, 'api'],
  ['PATCH', '/api/requests/' + ID, 'api'],
  ['GET', '/api/notifications', 'api'],
  ['GET', '/api/notifications/unread', 'api'],
  ['GET', '/socket\\.io/\\?EIO=4&transport=websocket', 'socket'],
];
const compiled = routes.map(([method, pattern, service]) => [method, new RegExp('^' + pattern + '$'), service]);

function configuration(env) {
  const { SHOWROOM_MODE, SHOWROOM_DATA_MARKER, SHOWROOM_INGRESS_KEY, WEB_ORIGIN } = env;
  if (SHOWROOM_MODE === undefined && SHOWROOM_DATA_MARKER === undefined && SHOWROOM_INGRESS_KEY === undefined) return null;
  let origin;
  try { origin = new URL(WEB_ORIGIN); } catch {}
  if (SHOWROOM_MODE !== MODE || SHOWROOM_DATA_MARKER !== MARKER || !KEY.test(SHOWROOM_INGRESS_KEY ?? '') ||
      env.NODE_ENV !== 'production' || env.VANTARA_ENV !== 'staging' ||
      !origin || origin.origin !== WEB_ORIGIN || origin.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.example\.invalid$/.test(origin.hostname) ||
      (env.ALLOW_LOCAL_WORKSPACE_SIGNUP && env.ALLOW_LOCAL_WORKSPACE_SIGNUP !== 'false') ||
      Object.entries(env).some(([name, value]) => value && /^(PILOT01_|CONNECT_GUEST_|STRIPE_|OPENAI_|ANTHROPIC_)/.test(name))) {
    throw new Error('SHOWROOM_CONFIGURATION_REJECTED');
  }
  return { host: origin.host, origin: origin.origin, key: SHOWROOM_INGRESS_KEY };
}

function target(method, raw) {
  if (typeof raw !== 'string' || raw.length > 512 || /[%\\#\x00-\x20\x7f]/.test(raw)) return undefined;
  return compiled.find(([verb, pattern]) => verb === method && pattern.test(raw))?.[2];
}

function admits(config, req, service, raw = req.url) {
  if (req.headers.host !== config.host || target(req.method, raw) !== service) return false;
  const key = req.headers[HEADER];
  if (typeof key !== 'string' || !KEY.test(key) || !timingSafeEqual(Buffer.from(key), Buffer.from(config.key))) return false;
  return service !== 'socket' ||
    (req.headers.origin === config.origin && req.headers.upgrade?.toLowerCase() === 'websocket');
}

function deny(response) {
  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  });
  response.end('Not found.');
}

module.exports = { MODE, MARKER, HEADER, routes, configuration, target, admits, deny };
