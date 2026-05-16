-- PURPOSE: Таблицы модуля «Интеграции маркетплейсов» (Ozon Seller API и др.).
--   marketplace_accounts — подключённые магазины (Client-Id + Api-Key зашифрованный AES-256-GCM)
--   ozon_sync_jobs       — история ручных/cron синхронизаций
--   ozon_orders          — выгруженные заказы FBO/FBS (для salesPerMonth/returnsPct)
--   ozon_realization     — отчёт о реализации (комиссии/логистика/реклама агрегированно)
--   ozon_transactions    — детальные финансовые транзакции
-- Также добавляем nullable-колонку unit_products.marketplace_account_id.

CREATE TABLE IF NOT EXISTS "marketplace_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "marketplace" varchar(20) NOT NULL,
  "name" varchar(200) NOT NULL DEFAULT '',
  "client_id" varchar(200) NOT NULL,
  "api_key_enc" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "sync_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "company_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_sync_at" timestamp,
  "last_sync_status" varchar(20),
  "last_sync_error" text,
  "last_sync_summary" jsonb DEFAULT '{"stages":{}}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "marketplace_accounts_tenant_idx"
  ON "marketplace_accounts" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_accounts_tenant_mp_client_idx"
  ON "marketplace_accounts" ("tenant_id", "marketplace", "client_id");

CREATE TABLE IF NOT EXISTS "ozon_sync_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "marketplace_accounts"("id") ON DELETE cascade,
  "kind" varchar(20) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "started_at" timestamp,
  "finished_at" timestamp,
  "items_processed" integer NOT NULL DEFAULT 0,
  "items_total" integer NOT NULL DEFAULT 0,
  "stages" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ozon_sync_jobs_tenant_idx"
  ON "ozon_sync_jobs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ozon_sync_jobs_account_idx"
  ON "ozon_sync_jobs" ("account_id");
CREATE INDEX IF NOT EXISTS "ozon_sync_jobs_account_created_idx"
  ON "ozon_sync_jobs" ("account_id", "created_at");

CREATE TABLE IF NOT EXISTS "ozon_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "marketplace_accounts"("id") ON DELETE cascade,
  "posting_number" varchar(100) NOT NULL,
  "scheme" varchar(10) NOT NULL,
  "status" varchar(60) NOT NULL,
  "order_created_at" timestamp,
  "delivered_at" timestamp,
  "cancelled_at" timestamp,
  "returned_at" timestamp,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ozon_orders_tenant_idx"
  ON "ozon_orders" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ozon_orders_account_idx"
  ON "ozon_orders" ("account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ozon_orders_account_posting_idx"
  ON "ozon_orders" ("account_id", "posting_number");
CREATE INDEX IF NOT EXISTS "ozon_orders_account_created_idx"
  ON "ozon_orders" ("account_id", "order_created_at");

CREATE TABLE IF NOT EXISTS "ozon_realization" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "marketplace_accounts"("id") ON DELETE cascade,
  "period_from" timestamp NOT NULL,
  "period_to" timestamp NOT NULL,
  "sku" varchar(200),
  "offer_id" varchar(200),
  "qty" integer NOT NULL DEFAULT 0,
  "gross_kopecks" bigint NOT NULL DEFAULT 0,
  "commission_kopecks" bigint NOT NULL DEFAULT 0,
  "logistics_kopecks" bigint NOT NULL DEFAULT 0,
  "ads_kopecks" bigint NOT NULL DEFAULT 0,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ozon_realization_tenant_idx"
  ON "ozon_realization" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ozon_realization_account_idx"
  ON "ozon_realization" ("account_id");
CREATE INDEX IF NOT EXISTS "ozon_realization_account_period_sku_idx"
  ON "ozon_realization" ("account_id", "period_from", "sku");

CREATE TABLE IF NOT EXISTS "ozon_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "marketplace_accounts"("id") ON DELETE cascade,
  "transaction_id" bigint NOT NULL,
  "operation_type" varchar(80),
  "operation_date" timestamp,
  "amount_kopecks" bigint NOT NULL DEFAULT 0,
  "posting_number" varchar(100),
  "sku" varchar(200),
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ozon_transactions_tenant_idx"
  ON "ozon_transactions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ozon_transactions_account_idx"
  ON "ozon_transactions" ("account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ozon_transactions_account_tx_idx"
  ON "ozon_transactions" ("account_id", "transaction_id");
CREATE INDEX IF NOT EXISTS "ozon_transactions_account_date_idx"
  ON "ozon_transactions" ("account_id", "operation_date");

-- Ссылка из unit_products на источник синхронизации
ALTER TABLE "unit_products"
  ADD COLUMN IF NOT EXISTS "marketplace_account_id" uuid
  REFERENCES "marketplace_accounts"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "unit_products_marketplace_account_idx"
  ON "unit_products" ("marketplace_account_id");
