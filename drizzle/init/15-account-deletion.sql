-- PURPOSE: 152-ФЗ — согласие на обработку ПДн + заявки на удаление аккаунта.
-- Idempotent (IF NOT EXISTS) — безопасно применять повторно на свежей БД.
-- Соответствует drizzle/0009_conscious_squirrel_girl.sql.

-- Согласие с политикой конфиденциальности (фиксируем версию + момент).
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP;

-- Заявки на удаление аккаунта. FK = SET NULL + email-снапшот:
-- строка-аудит переживает физическое удаление user/tenant (доказательство обработки).
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  note TEXT
);

CREATE INDEX IF NOT EXISTS account_deletion_requests_status_idx
  ON account_deletion_requests(status, requested_at);
