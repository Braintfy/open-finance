-- PURPOSE: Backfill `unit_products.sku` для legacy Ozon-товаров —
-- пересчитать на «реальный Ozon SKU» из `metadata.ozonSku`.
--
-- Контекст:
--   До v0.18.11 `unit_products.sku` = `String(info.id)` (product_id ~ 800M+).
--   С v0.18.11 — sku = real Ozon SKU из v3 (число типа 1275993197).
--   В таблице `ozon_perf_sku_stats.sku` — реальный Ozon SKU, поэтому
--   legacy-записи (где `unit_products.sku = product_id`) не находят рекламу
--   через прямой join.
--
-- Решение:
--   Пересчитать `unit_products.sku = metadata->>'ozonSku'` для всех Ozon-товаров,
--   у которых `metadata.ozonSku` есть и отличается от текущего `sku`.
--
-- Запуск (manual, на свой страх и риск):
--
--   docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev \
--     < drizzle/init/11-marketplaces-sku-backfill.sql
--
-- Если нужно проверить ДО запуска — раскомментировать SELECT-блок ниже,
-- закомментировать UPDATE.

BEGIN;

-- ---- DIAGNOSTICS (раскомментировать для preview) ------------------------
-- SELECT
--   tenant_id,
--   account_id,
--   id,
--   article,
--   sku AS current_sku,
--   (metadata->>'ozonSku') AS proposed_sku,
--   (metadata->>'productId') AS product_id,
--   name
-- FROM unit_products
-- WHERE marketplace = 'ozon'
--   AND metadata->>'ozonSku' IS NOT NULL
--   AND metadata->>'ozonSku' <> ''
--   AND (sku IS NULL OR sku <> metadata->>'ozonSku')
-- ORDER BY tenant_id, account_id, article
-- LIMIT 50;

-- ---- ACTUAL UPDATE -----------------------------------------------------
UPDATE unit_products
SET
  sku = metadata->>'ozonSku',
  updated_at = now()
WHERE marketplace = 'ozon'
  AND metadata->>'ozonSku' IS NOT NULL
  AND metadata->>'ozonSku' <> ''
  AND (sku IS NULL OR sku <> metadata->>'ozonSku');

-- Сколько строк затронуто (для логов):
-- (psql покажет автоматически: UPDATE <count>)

COMMIT;
