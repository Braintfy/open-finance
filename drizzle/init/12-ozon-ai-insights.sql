-- PURPOSE: Хранилище ИИ-сгенерированных отчётов блока «Ozon · AI инсайты».
-- История генераций per-user × block (лимит 10 на блок enforced в коде).
CREATE TABLE IF NOT EXISTS ozon_ai_insight_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  block_id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64),
  period_key VARCHAR(64),
  model VARCHAR(120),
  summary TEXT NOT NULL DEFAULT '',
  insights JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ozon_ai_insight_reports_block_idx
  ON ozon_ai_insight_reports(tenant_id, user_id, block_id, created_at);
