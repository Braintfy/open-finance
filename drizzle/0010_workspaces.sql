-- PURPOSE: Воркспейсы («кабинеты») — Этап 3 LK_V2_PLAN.md.
-- ДВУХФАЗНАЯ миграция с бэкфиллом (drizzle-kit generate НЕ пишет бэкфилл —
-- этот файл отредактирован вручную относительно авто-генерации).
--
-- Порядок: (1) создать workspaces + индекс; (2) добавить nullable workspace_id
-- всем таблицам; (3) бэкфилл — по одному default-кабинету на пару (tenant,user)
-- со строками в block_layouts, проставить block_layouts/unit_economics_tabs;
-- (4) block_layouts.workspace_id → NOT NULL + swap уникального индекса.
-- block_ai_reports / section_ai_reports остаются nullable (без бэкфилла).

-- === Фаза 1: таблица workspaces ===
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(140) NOT NULL,
	"template" varchar(32) DEFAULT 'seller-ozon' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_tenant_user_slug_idx" ON "workspaces" USING btree ("tenant_id","user_id","slug");--> statement-breakpoint

-- === Фаза 2: nullable workspace_id + users.settings ===
ALTER TABLE "block_ai_reports" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "block_layouts" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "unit_economics_tabs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "section_ai_reports" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "block_ai_reports" ADD CONSTRAINT "block_ai_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_layouts" ADD CONSTRAINT "block_layouts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_economics_tabs" ADD CONSTRAINT "unit_economics_tabs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_ai_reports" ADD CONSTRAINT "section_ai_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- === Фаза 3: бэкфилл ===
-- Один default-кабинет «Кабинет 1» на каждую пару (tenant,user), у которой есть раскладки.
INSERT INTO "workspaces" ("tenant_id", "user_id", "name", "slug", "template", "is_default", "sort_order")
SELECT DISTINCT bl."tenant_id", bl."user_id", 'Кабинет 1', 'workspace-1', 'seller-ozon', true, 0
FROM "block_layouts" bl
ON CONFLICT ("tenant_id", "user_id", "slug") DO NOTHING;--> statement-breakpoint
-- Привязать все существующие раскладки к default-кабинету их пары.
UPDATE "block_layouts" bl
SET "workspace_id" = w."id"
FROM "workspaces" w
WHERE w."tenant_id" = bl."tenant_id"
  AND w."user_id" = bl."user_id"
  AND w."slug" = 'workspace-1'
  AND bl."workspace_id" IS NULL;--> statement-breakpoint
-- Привязать существующие вкладки юнит-экономики к тому же default-кабинету.
UPDATE "unit_economics_tabs" uet
SET "workspace_id" = w."id"
FROM "workspaces" w
WHERE w."tenant_id" = uet."tenant_id"
  AND w."user_id" = uet."user_id"
  AND w."slug" = 'workspace-1'
  AND uet."workspace_id" IS NULL;--> statement-breakpoint

-- === Фаза 4: block_layouts.workspace_id → NOT NULL + swap уникального индекса ===
ALTER TABLE "block_layouts" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "block_layouts_tenant_user_page_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "block_layouts_workspace_page_idx" ON "block_layouts" USING btree ("workspace_id","page_key");
