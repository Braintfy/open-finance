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

// CSP (I2, вторая половина к HSTS). Только в проде: в dev мешает HMR/react-refresh
// ('unsafe-eval', ws:). Нюансы:
// - script-src 'unsafe-inline' нужен Next.js App Router (inline bootstrap-скрипты);
//   nonce-based CSP — отдельная задача (middleware + nonce).
// - домены Yandex SmartCaptcha (I6) — скрипт/iframe/XHR виджета.
// - img-src https: — картинки писем (sandbox <iframe srcdoc> НАСЛЕДУЕТ CSP родителя)
//   и товарные картинки маркетплейсов (внешние CDN).
// - frame-ancestors НЕ ставим намеренно: кликджекинг уже закрыт X-Frame-Options,
//   а наследование в srcdoc-iframe (письма Inbox) в части движков ломает рендер.
const CAPTCHA_HOSTS = 'https://smartcaptcha.cloud.yandex.ru https://smartcaptcha.yandexcloud.net';
const CSP_PROD = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${CAPTCHA_HOSTS}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  `connect-src 'self' ${CAPTCHA_HOSTS}`,
  `frame-src ${CAPTCHA_HOSTS}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

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
  // /app-префикс: старые пути (закладки, внешние ссылки) форвардим на /app/*.
  // redirects() выполняется ДО middleware → неавторизованный заход на старый путь
  // сначала форвардится на /app/*, затем middleware уводит на /login?next=/app/*.
  // auth-страницы (/login,/register,...), лендинг / и /api/* НЕ редиректим (external/public).
  async redirects() {
    const pages = ['dashboard', 'cashflow', 'inbox', 'unit-economics', 'marketplace', 'onboarding'];
    return [
      ...pages.map((p) => ({ source: `/${p}`, destination: `/app/${p}`, permanent: false })),
      { source: '/boards', destination: '/app/boards', permanent: false },
      { source: '/boards/:path*', destination: '/app/boards/:path*', permanent: false },
      { source: '/marketplaces/:path*', destination: '/app/marketplaces/:path*', permanent: false },
      { source: '/settings', destination: '/app/settings', permanent: false },
      { source: '/settings/:path*', destination: '/app/settings/:path*', permanent: false },
      { source: '/admin', destination: '/app/admin', permanent: false },
      { source: '/admin/:path*', destination: '/app/admin/:path*', permanent: false },
    ];
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
          // HSTS (I2): браузеры применяют только по HTTPS, по HTTP игнорируется.
          // 1 год + субдомены. preload не включаем (требует submit в hstspreload.org).
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // CSP (I2): только прод — см. CSP_PROD выше.
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Content-Security-Policy', value: CSP_PROD }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
