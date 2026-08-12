-- PURPOSE: FBS-остатки в ozon_warehouse_stocks — Этап 2b LK_V2_PLAN.md.
-- До этой миграции таблица держала ТОЛЬКО фулфилмент Ozon
-- (`/v2/analytics/stock_on_warehouses`). Теперь в неё же пишет стейдж
-- `fbsWarehouseStocks` (собственные склады продавца), поэтому:
--   * `source` ('FBO'|'FBS') — чей это остаток. DEFAULT 'FBO' закрывает все
--     существующие строки: других источников до сих пор не было, отдельный
--     бэкфилл не нужен;
--   * `warehouse_id` / `warehouse_type` — метаданные склада из
--     `/v1/warehouse/list` (у FBO остаются NULL: Ozon их не отдаёт);
--   * уникальность расширена полем `source` — один и тот же SKU может лежать
--     и на складе Ozon, и на одноимённом складе продавца.
--
-- Файл отредактирован вручную относительно drizzle-kit generate: добавлены
-- IF EXISTS / IF NOT EXISTS (таблица маленькая, CONCURRENTLY не нужен) и
-- комментарии. Применяет пользователь: `pnpm db:migrate`.

DROP INDEX IF EXISTS "ozon_warehouse_stocks_uniq";--> statement-breakpoint
ALTER TABLE "ozon_warehouse_stocks" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'FBO' NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_warehouse_stocks" ADD COLUMN IF NOT EXISTS "warehouse_id" bigint;--> statement-breakpoint
ALTER TABLE "ozon_warehouse_stocks" ADD COLUMN IF NOT EXISTS "warehouse_type" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ozon_warehouse_stocks_account_source_idx" ON "ozon_warehouse_stocks" USING btree ("account_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ozon_warehouse_stocks_uniq" ON "ozon_warehouse_stocks" USING btree ("account_id","sku","warehouse_name","source");
