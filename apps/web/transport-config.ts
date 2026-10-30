type Environment = Record<string, string | undefined>;

function exactOrigin(value: string, https: boolean): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('An explicit transport origin is required.'); }
  if (url.origin !== value || url.username || url.password || !['http:', 'https:'].includes(url.protocol) ||
      (https && (url.protocol !== 'https:' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || /^127\./.test(url.hostname) || ['[::1]', '0.0.0.0'].includes(url.hostname)))) {
    throw new Error('Transport URLs must be exact origins; Cloud public origins must use HTTPS.');
  }
  return url;
}

export function webTransport(env: Environment) {
  const cloud = env.NODE_ENV === 'production' || (env.VANTARA_ENV !== undefined && env.VANTARA_ENV !== 'local');
  const upstream = env.API_INTERNAL_URL ?? (cloud ? '' : 'http://localhost:3001');
  const internal = exactOrigin(upstream, false);
  if (cloud) {
    const publicOrigin = exactOrigin(env.WEB_ORIGIN ?? '', true).origin;
    if (env.NEXT_PUBLIC_API_URL && env.NEXT_PUBLIC_API_URL !== '/api') throw new Error('Cloud HTTP must use /api.');
    if (env.NEXT_PUBLIC_REALTIME_URL && env.NEXT_PUBLIC_REALTIME_URL !== publicOrigin) throw new Error('Cloud realtime must use the public same origin.');
    if (['localhost', '[::1]', '0.0.0.0'].includes(internal.hostname) || internal.hostname.endsWith('.localhost') || /^127\./.test(internal.hostname)) throw new Error('Cloud upstream cannot use loopback.');
  }
  return { upstream: internal.origin };
}

// HTTP /api is a prefix. Socket.IO uses an origin, namespace /realtime and path /socket.io.
export function realtimeUrl(override: string | undefined, production: boolean, browserOrigin: string): string {
  const origin = override ?? (production ? browserOrigin : 'http://localhost:3001');
  exactOrigin(origin, production);
  if (production && origin !== browserOrigin) throw new Error('Realtime requires the browser same origin.');
  return `${origin}/realtime`;
}
