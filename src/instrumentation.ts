// PURPOSE: Next.js server startup hook. Фейл-фаст валидация прод-секретов (I5).
// register() вызывается один раз при старте сервера (runtime), НЕ во время
// `next build` — поэтому build не требует прод-секретов. В dev проверка пропускается.
export async function register() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NODE_ENV !== 'production') return;
  // nodejs-only (crypto/env). Edge-рантайм инструментации не трогаем.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertProductionSecrets } = await import('@/lib/security/assert-secrets');
  assertProductionSecrets();
}
