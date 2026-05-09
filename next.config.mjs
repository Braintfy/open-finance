// PURPOSE: Next.js 15 config — App Router, RSC, Tauri-friendly
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Поддержка Tauri (output: export для desktop)
  output: process.env.TAURI_BUILD ? 'export' : undefined,
  images: {
    unoptimized: !!process.env.TAURI_BUILD,
  },
  // Headers для безопасности
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
