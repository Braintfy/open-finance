// PURPOSE: Next.js 15 config — App Router, RSC, Tauri-friendly
// typedRoutes отключён при Turbopack (несовместимы в 15.x). Используйте `pnpm dev` для типизированных роутов.
const isTurbo = process.env.NEXT_TURBO === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isTurbo
    ? {}
    : {
        experimental: {
          typedRoutes: true,
        },
      }),
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
