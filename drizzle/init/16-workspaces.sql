-- PURPOSE: Воркспейсы («кабинеты») — Этап 3 LK_V2_PLAN.md.
-- Идемпотентный миррор drizzle/0010_workspaces.sql (IF NOT EXISTS / ON CONFLICT /
-- WHERE ... IS NULL). Безопасно применять повторно и на БД, где 0010 уже накатан
-- через `pnpm db:migrate`. Двухфазность: nullable → бэкфилл → NOT NULL + swap индекса.
--
-- Каноничный путь применения — `pnpm db:migrate` (0010). Этот файл — ручная
-- альтернатива: docker exec -i openfinance-postgres psql -U openfinance_user \
--   -d openfinance_dev < drizzle/init/16-workspaces.sql

-- === Фаза 1: таблица workspaces ===
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL,
  template VARCHAR(32) NOT NULL DEFAULT 'seller-ozon',
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_tenant_user_slug_idx
  ON workspaces(tenant_id, user_id, slug);

-- === Фаза 2: nullable workspace_id + users.settings ===
ALTER TABLE block_layouts       ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE unit_economics_tabs ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE block_ai_reports    ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE section_ai_reports  ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE users               ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;

-- FK-констрейнты (идемпотентно через duplicate_object).
DO $$ BEGIN
  ALTER TABLE block_layouts ADD CONSTRAINT block_layouts_workspace_id_workspaces_id_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE unit_economics_tabs ADD CONSTRAINT unit_economics_tabs_workspace_id_workspaces_id_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE block_ai_reports ADD CONSTRAINT block_ai_reports_workspace_id_workspaces_id_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE section_ai_reports ADD CONSTRAINT section_ai_reports_workspace_id_workspaces_id_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- === Фаза 3: бэкфилл ===
-- Один default-кабинет «Кабинет 1» на каждую пару (tenant,user) со строками в block_layouts.
INSERT INTO workspaces (tenant_id, user_id, name, slug, template, is_default, sort_order)
SELECT DISTINCT bl.tenant_id, bl.user_id, 'Кабинет 1', 'workspace-1', 'seller-ozon', true, 0
FROM block_layouts bl
ON CONFLICT (tenant_id, user_id, slug) DO NOTHING;

UPDATE block_layouts bl
SET workspace_id = w.id
FROM workspaces w
WHERE w.tenant_id = bl.tenant_id
  AND w.user_id = bl.user_id
  AND w.slug = 'workspace-1'
  AND bl.workspace_id IS NULL;

UPDATE unit_economics_tabs uet
SET workspace_id = w.id
FROM workspaces w
WHERE w.tenant_id = uet.tenant_id
  AND w.user_id = uet.user_id
  AND w.slug = 'workspace-1'
  AND uet.workspace_id IS NULL;

-- === Фаза 4: block_layouts.workspace_id → NOT NULL + swap уникального индекса ===
ALTER TABLE block_layouts ALTER COLUMN workspace_id SET NOT NULL;
DROP INDEX IF EXISTS block_layouts_tenant_user_page_idx;
CREATE UNIQUE INDEX IF NOT EXISTS block_layouts_workspace_page_idx
  ON block_layouts(workspace_id, page_key);

-- === Фаза 5 (миррор 0011): вкладки юнит-экономики per-workspace ===
-- Старый уникальный индекс (tenant,user,page_key) мешает второму кабинету
-- засидить дефолтные вкладки — меняем на (workspace_id, page_key).
DROP INDEX IF EXISTS unit_economics_tabs_tenant_user_page_idx;

-- Пары (tenant,user) со вкладками, но без раскладок — им кабинет ещё не создан.
INSERT INTO workspaces (tenant_id, user_id, name, slug, template, is_default, sort_order)
SELECT DISTINCT uet.tenant_id, uet.user_id, 'Кабинет 1', 'workspace-1', 'seller-ozon', true, 0
FROM unit_economics_tabs uet
WHERE uet.workspace_id IS NULL
ON CONFLICT (tenant_id, user_id, slug) DO NOTHING;

UPDATE unit_economics_tabs uet
SET workspace_id = w.id
FROM workspaces w
WHERE w.tenant_id = uet.tenant_id
  AND w.user_id = uet.user_id
  AND w.slug = 'workspace-1'
  AND uet.workspace_id IS NULL;

ALTER TABLE unit_economics_tabs ALTER COLUMN workspace_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unit_economics_tabs_workspace_page_idx
  ON unit_economics_tabs(workspace_id, page_key);
