-- PURPOSE: Хранилище ИИ-отчётов «AI Анализ раздела».
-- История per-user × pageKey (лимит 10 на раздел enforced в коде).
CREATE TABLE IF NOT EXISTS section_ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_key VARCHAR(64) NOT NULL,
  page_label VARCHAR(120),
  model VARCHAR(120),
  summary TEXT NOT NULL DEFAULT '',
  insights JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS section_ai_reports_page_idx
  ON section_ai_reports(tenant_id, user_id, page_key, created_at);
