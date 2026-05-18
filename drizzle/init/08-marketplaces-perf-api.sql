-- PURPOSE: Расширение схемы для Ozon Performance API (v0.18.0).
-- Применить ВРУЧНУЮ через psql/pgAdmin или `pnpm db:push` если используется Drizzle push.
-- Если работаете через миграции — это уже описано в Drizzle schema
-- (см. src/lib/db/schema/marketplaces.ts), сгенерируйте через:
--   pnpm db:generate
--   pnpm db:migrate

-- 1. marketplace_accounts: новые опциональные поля для Performance API.
ALTER TABLE marketplace_accounts
  ADD COLUMN IF NOT EXISTS perf_client_id varchar(200),
  ADD COLUMN IF NOT EXISTS perf_client_secret_enc text,
  ADD COLUMN IF NOT EXISTS perf_status varchar(20),
  ADD COLUMN IF NOT EXISTS perf_last_sync_at timestamp,
  ADD COLUMN IF NOT EXISTS perf_last_sync_error text;

-- 2. ozon_perf_campaigns: список рекламных кампаний из Performance API.
CREATE TABLE IF NOT EXISTS ozon_perf_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  campaign_id varchar(50) NOT NULL,
  title varchar(300),
  state varchar(50),
  adv_object_type varchar(20),
  payment_type varchar(20),
  daily_budget_kopecks bigint,
  budget_kopecks bigint,
  start_date date,
  end_date date,
  raw jsonb NOT NULL DEFAULT '{}',
  synced_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ozon_perf_campaigns_tenant_idx ON ozon_perf_campaigns(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS ozon_perf_campaigns_account_campaign_idx
  ON ozon_perf_campaigns(account_id, campaign_id);

-- 3. ozon_perf_sku_stats: SKU-статистика рекламы по дням.
CREATE TABLE IF NOT EXISTS ozon_perf_sku_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  date date NOT NULL,
  sku varchar(200) NOT NULL,
  campaign_id varchar(50),
  views integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  cart_adds integer NOT NULL DEFAULT 0,
  orders integer NOT NULL DEFAULT 0,
  orders_kopecks bigint NOT NULL DEFAULT 0,
  expense_kopecks bigint NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ozon_perf_sku_stats_uniq
  ON ozon_perf_sku_stats(account_id, date, sku, campaign_id);
CREATE INDEX IF NOT EXISTS ozon_perf_sku_stats_tenant_date_idx
  ON ozon_perf_sku_stats(tenant_id, date);
CREATE INDEX IF NOT EXISTS ozon_perf_sku_stats_account_date_idx
  ON ozon_perf_sku_stats(account_id, date);

-- 4. ozon_perf_phrases: статистика поисковых фраз.
CREATE TABLE IF NOT EXISTS ozon_perf_phrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  date date NOT NULL,
  phrase varchar(500) NOT NULL,
  sku varchar(200),
  campaign_id varchar(50),
  views integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  orders integer NOT NULL DEFAULT 0,
  expense_kopecks bigint NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ozon_perf_phrases_tenant_idx
  ON ozon_perf_phrases(tenant_id);
CREATE INDEX IF NOT EXISTS ozon_perf_phrases_account_date_idx
  ON ozon_perf_phrases(account_id, date);
CREATE INDEX IF NOT EXISTS ozon_perf_phrases_phrase_idx
  ON ozon_perf_phrases(account_id, phrase);
