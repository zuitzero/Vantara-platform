import type { NextConfig } from 'next';

const config: NextConfig = {
  async rewrites() {
    const origin = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${origin}/api/:path*` }];
  },
};

export default config;
