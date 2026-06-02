-- PURPOSE: Хранилище ИИ-отчётов «AI Анализ блока» (точечный анализ одного блока).
-- История per-user × pageKey × blockId (лимит 10 на блок enforced в коде).
CREATE TABLE IF NOT EXISTS block_ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_key VARCHAR(64) NOT NULL,
  block_id VARCHAR(64) NOT NULL,
  block_type VARCHAR(80),
  block_title VARCHAR(200),
  model VARCHAR(120),
  summary TEXT NOT NULL DEFAULT '',
  insights JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS block_ai_reports_block_idx
  ON block_ai_reports(tenant_id, user_id, page_key, block_id, created_at);
