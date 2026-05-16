// PURPOSE: Шифрование API-ключей маркетплейсов AES-256-GCM.
// Переиспользуем существующие helpers из src/lib/inbox/crypto.ts —
// они работают на ключе INBOX_SECRET_KEY и проверены в проде на inbox-каналах.
// При переходе на отдельный MARKETPLACE_SECRET_KEY достаточно перенаправить
// импорт в одном месте.

export { encryptSecret, decryptSecret, maskSecret } from '@/lib/inbox/crypto';
