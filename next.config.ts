import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingExcludes: { '/*': ['./.data/**/*', './.env*', './test-results/**/*', './tests/**/*'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
    ] }];
  }
};
export default config;
