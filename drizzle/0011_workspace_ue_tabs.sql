-- PURPOSE: Вкладки юнит-экономики per-workspace — надстройка Этапа 3 LK_V2_PLAN.md.
-- Продолжение 0010: там workspace_id у unit_economics_tabs был nullable (бэкфилл
-- только для пар со строками в block_layouts). Здесь: добиваем бэкфилл (в т.ч.
-- для пар без раскладок), делаем колонку NOT NULL и меняем уникальность с
-- (tenant_id, user_id, page_key) на (workspace_id, page_key) — иначе дефолтные
-- вкладки ('unit-economics-ozon' и т.п.) нельзя засидить во ВТОРОМ кабинете
-- того же пользователя.
--
-- Файл отредактирован вручную относительно drizzle-kit generate (добавлены
-- фазы 1-2 бэкфилла; generate писал только DROP INDEX / SET NOT NULL / CREATE INDEX).

-- === Фаза 0: снять старый уникальный индекс (мешает бэкфиллу и новой модели) ===
DROP INDEX "unit_economics_tabs_tenant_user_page_idx";--> statement-breakpoint

-- === Фаза 1: default-кабинет для пар (tenant,user), у которых есть вкладки,
-- но не было раскладок (их 0010 не создал) ===
INSERT INTO "workspaces" ("tenant_id", "user_id", "name", "slug", "template", "is_default", "sort_order")
SELECT DISTINCT uet."tenant_id", uet."user_id", 'Кабинет 1', 'workspace-1', 'seller-ozon', true, 0
FROM "unit_economics_tabs" uet
WHERE uet."workspace_id" IS NULL
ON CONFLICT ("tenant_id", "user_id", "slug") DO NOTHING;--> statement-breakpoint

-- === Фаза 2: бэкфилл оставшихся NULL-строк на default-кабинет их пары ===
UPDATE "unit_economics_tabs" uet
SET "workspace_id" = w."id"
FROM "workspaces" w
WHERE w."tenant_id" = uet."tenant_id"
  AND w."user_id" = uet."user_id"
  AND w."slug" = 'workspace-1'
  AND uet."workspace_id" IS NULL;--> statement-breakpoint

-- === Фаза 3: NOT NULL + новый уникальный индекс ===
ALTER TABLE "unit_economics_tabs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_economics_tabs_workspace_page_idx" ON "unit_economics_tabs" USING btree ("workspace_id","page_key");
