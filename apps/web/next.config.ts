import type { NextConfig } from 'next';
import { webTransport } from './transport-config';

const { upstream } = webTransport(process.env);
const config: NextConfig = {
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
