-- PURPOSE: FBS-остатки в ozon_warehouse_stocks — Этап 2b LK_V2_PLAN.md.
-- Идемпотентный миррор drizzle/0012_ozon_fbs_stocks.sql (IF EXISTS /
-- IF NOT EXISTS). Безопасно применять повторно и на БД, где 0012 уже накатан
-- через `pnpm db:migrate`.
--
-- Каноничный путь применения — `pnpm db:migrate` (0012). Этот файл — ручная
-- альтернатива: docker exec -i openfinance-postgres psql -U openfinance_user \
--   -d openfinance_dev < drizzle/init/17-ozon-fbs-stocks.sql
--
-- Что делает:
--   1. source ('FBO'|'FBS') — источник остатка. DEFAULT 'FBO' закрывает все
--      строки, созданные до Этапа 2b (других источников тогда не было),
--      поэтому бэкфилл не нужен;
--   2. warehouse_id / warehouse_type — метаданные склада продавца из
--      Seller API /v1/warehouse/list (у FBO остаются NULL);
--   3. уникальный индекс расширяется полем source: один SKU может лежать
--      и на складе Ozon, и на одноимённом складе продавца.

ALTER TABLE ozon_warehouse_stocks
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'FBO';
ALTER TABLE ozon_warehouse_stocks
  ADD COLUMN IF NOT EXISTS warehouse_id bigint;
ALTER TABLE ozon_warehouse_stocks
  ADD COLUMN IF NOT EXISTS warehouse_type text;

-- Старый индекс (account_id, sku, warehouse_name) не даёт хранить FBO и FBS
-- одновременно — заменяем на версию с source.
DROP INDEX IF EXISTS ozon_warehouse_stocks_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS ozon_warehouse_stocks_uniq
  ON ozon_warehouse_stocks(account_id, sku, warehouse_name, source);

CREATE INDEX IF NOT EXISTS ozon_warehouse_stocks_account_source_idx
  ON ozon_warehouse_stocks(account_id, source);
