-- PURPOSE: Модуль «Склад», Релиз 1 — источник себестоимости карточки.
-- Идемпотентный миррор drizzle/0014_unit_products_cost_source.sql.
-- Безопасно применять повторно и на БД, где 0014 уже накатан через `pnpm db:migrate`.
--
-- Каноничный путь применения — `pnpm db:migrate` (0014). Этот файл — ручная
-- альтернатива: docker exec -i openfinance-postgres psql -U openfinance_user \
--   -d openfinance_dev < drizzle/init/19-unit-products-cost-source.sql
--
-- Канон: docs/STOCK_MODULE_DESIGN.md §2.10 и шапка src/lib/stock/writeback.ts.
--
-- ПОЧЕМУ ДЕФОЛТ 'manual': сразу после миграции поведение НЕ меняется ни у кого —
-- writeback склада переписывает cost_kopecks только там, где пользователь сам
-- переключил карточку диалогом «Перевести себестоимость на склад» (§6.1).
-- Количества (stock_marketplace / stock_own) остаются территорией синка Ozon
-- (src/lib/marketplaces/ozon/upsert.ts) — writeback их не трогает никогда.

ALTER TABLE "unit_products"
  ADD COLUMN IF NOT EXISTS "cost_source" varchar(16) DEFAULT 'manual' NOT NULL;

ALTER TABLE "unit_products"
  ADD COLUMN IF NOT EXISTS "cost_updated_at" timestamp;
