import type { NextConfig } from 'next';
import { webTransport } from './transport-config';

const { upstream } = webTransport(process.env);
const config: NextConfig = {
  // Legacy guest access is a bearer in the path. Keep it out of dev access logs.
  logging: { incomingRequests: { ignore: [/^\/connect\//, /^\/api\/connect\//] } },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${upstream}/api/:path*` }];
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
