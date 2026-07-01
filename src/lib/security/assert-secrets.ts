// PURPOSE: Фейл-фаст проверка обязательных секретов в проде (I5). Вызывается из
// src/instrumentation.ts при старте сервера (НЕ в build-фазе). Дополняет ленивые
// проверки в session.ts/inbox-crypto.ts: падаем сразу на деплое, а не на первом
// запросе. Не логируем сами значения — только имена отсутствующих переменных.
import { env } from '@/lib/env';

export function assertProductionSecrets(): void {
  const errors: string[] = [];

  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32) {
    errors.push('NEXTAUTH_SECRET — задайте значение не короче 32 символов');
  }
  if (!env.INBOX_SECRET_KEY) {
    errors.push('INBOX_SECRET_KEY — обязателен для шифрования секретов интеграций');
  }

  if (errors.length > 0) {
    throw new Error(
      '[security] Небезопасная конфигурация прод-секретов:\n  - ' +
        errors.join('\n  - ') +
        '\nСгенерировать секрет: openssl rand -base64 48',
    );
  }
}
