-- v0.18.15: Дневной агрегат CPO кампаний (Оплата за заказ / all_sku_promo).
-- Endpoint: GET /api/client/statistics/all_sku_promo/products/generate.
-- Без SKU — отчёт агрегирован по магазину per-day.

CREATE TABLE IF NOT EXISTS ozon_perf_cpo_daily (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  expense_kopecks BIGINT NOT NULL DEFAULT 0,
  sales_search_kopecks BIGINT NOT NULL DEFAULT 0,
  sales_reco_kopecks BIGINT NOT NULL DEFAULT 0,
  orders_search INTEGER NOT NULL DEFAULT 0,
  orders_reco INTEGER NOT NULL DEFAULT 0,
  promotion_status VARCHAR(50),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ozon_perf_cpo_daily_uniq
  ON ozon_perf_cpo_daily (account_id, date);

CREATE INDEX IF NOT EXISTS ozon_perf_cpo_daily_tenant_date_idx
  ON ozon_perf_cpo_daily (tenant_id, date);
