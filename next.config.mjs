// PURPOSE: Next.js 15 config — App Router, RSC, Tauri-friendly
// typedRoutes отключён при Turbopack (несовместимы в 15.x). Используйте `pnpm dev` для типизированных роутов.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const isTurbo = process.env.NEXT_TURBO === '1';

// v0.23.3: парсим CHANGELOG.md в build-time, инжектим в NEXT_PUBLIC_APP_VERSION.
// Источник правды версии — CHANGELOG.md (см. MEMORY.md). package.json `version`
// исторически устарел (0.5.0) и не используется.
const __dirname = dirname(fileURLToPath(import.meta.url));
function readAppVersion() {
  try {
    const changelog = readFileSync(join(__dirname, 'CHANGELOG.md'), 'utf8');
    const m = changelog.match(/^##\s*\[?([0-9]+\.[0-9]+\.[0-9]+)\]?/m);
    return m ? m[1] : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const APP_VERSION = readAppVersion();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
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
