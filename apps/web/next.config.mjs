/** @type {import('next').NextConfig} */
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@wiki/shared'],
  // In der Entwicklung leitet Next.js /api und die OAuth-Metadaten an die API weiter; in Produktion übernimmt das Caddy
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/.well-known/oauth-authorization-server', destination: `${apiUrl}/api/v1/.well-known/oauth-authorization-server` },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: `${apiUrl}/api/v1/.well-known/oauth-protected-resource/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
