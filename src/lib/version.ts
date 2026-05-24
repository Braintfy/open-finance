// PURPOSE: Единственный источник версии приложения для UI.
// Значение инжектируется из CHANGELOG.md в build-time через
// `next.config.mjs` → `env.NEXT_PUBLIC_APP_VERSION`. См. MEMORY.md
// («Источник правды версии — CHANGELOG.md»).
//
// Использование (server и client components):
//   import { APP_VERSION } from '@/lib/version';
//   <span>v{APP_VERSION}</span>

export const APP_VERSION: string =
  process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
