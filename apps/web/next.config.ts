import type { NextConfig } from 'next';
import { configuration } from '../../infra/staging/showroom-policy.cjs';
import { webTransport } from './transport-config';

const showroom = configuration(process.env);
if (showroom && !Reflect.get(globalThis, Symbol.for('vantara.showroom.raw-ingress'))) {
  throw new Error('SHOWROOM_WEB_ENTRY_REQUIRED');
}

const { upstream } = webTransport(process.env);
const config: NextConfig = {
  // Legacy guest access is a bearer in the path. Keep it out of dev access logs.
  logging: { incomingRequests: showroom ? false : { ignore: [/^\/connect\//, /^\/api\/connect\//] } },
  async rewrites() {
    return showroom ? [] : [{ source: '/api/:path*', destination: `${upstream}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ] }, { source: '/connect/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] }];
  },
};
export default config;
