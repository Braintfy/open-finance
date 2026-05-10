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
  // Поддержка Tauri (output: export для desktop).
  // ВНИМАНИЕ: с output:'export' middleware и API routes НЕ работают.
  // Для Tauri-сборки нужно: либо SPA-only часть UI без middleware/API, либо отдельный сервер для API.
  // План: Tauri-версия будет ходить на тот же SaaS API (offline-режим — позже через локальный SQLite).
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
