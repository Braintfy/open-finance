-- PURPOSE: Дневной агрегат продаж по SKU из Seller API /v1/analytics/data (v0.18.13).
-- Применить ВРУЧНУЮ через psql/pgAdmin или `pnpm db:push`:
--   psql "$DATABASE_URL" -f drizzle/init/09-marketplaces-analytics.sql
-- См. src/lib/db/schema/marketplaces.ts → ozonAnalyticsDaily.
--
-- Эта таблица — primary source для блока Ozon Аналитика. Без неё API
-- падает обратно на ozon_orders (как до v0.18.13).

CREATE TABLE IF NOT EXISTS ozon_analytics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  date date NOT NULL,
  sku varchar(200) NOT NULL,
  -- Метрики из /v1/analytics/data (Seller API).
  revenue_kopecks bigint NOT NULL DEFAULT 0,
  ordered_units integer NOT NULL DEFAULT 0,
  -- Premium Plus метрики; для basic-аккаунтов остаются 0.
  delivered_units integer NOT NULL DEFAULT 0,
  cancellations integer NOT NULL DEFAULT 0,
  returns integer NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ozon_analytics_daily_uniq
  ON ozon_analytics_daily(account_id, date, sku);
CREATE INDEX IF NOT EXISTS ozon_analytics_daily_tenant_date_idx
  ON ozon_analytics_daily(tenant_id, date);
CREATE INDEX IF NOT EXISTS ozon_analytics_daily_account_date_idx
  ON ozon_analytics_daily(account_id, date);
