-- PURPOSE: Начисления Ozon (/v1/finance/accrual/*) — замена отключённого
-- /v3/finance/transaction/list. Идемпотентный миррор drizzle/0016_ozon_accruals.sql
-- (IF NOT EXISTS / проверка pg_constraint). Безопасно применять повторно и на БД,
-- где 0016 уже накатан через `pnpm db:migrate`.
--
-- Каноничный путь применения — `pnpm db:migrate` (0016). Этот файл — ручная
-- альтернатива: docker exec -i openfinance-postgres psql -U openfinance_user \
--   -d openfinance_dev < drizzle/init/20-ozon-accruals.sql
--
-- Что делает:
--   1. ozon_accrual_types — справочник типов начислений по аккаунту
--      (uniq account_id × type_id); заменит словарь классификации слоя метрик;
--   2. ozon_accruals — строки начислений by-day: итог начисления (line_kind
--      'total') и его разбивка по товарам/сборам/услугам. Сумма — копейки со
--      знаком, как у Ozon. Устойчивый id начисления — accrual_id (у каждой
--      строки начисления); синк всё равно заменяет окно «аккаунт × день»
--      целиком; uniq (account_id, accrual_date, seq, line_no) — целостность
--      внутри окна.
-- ozon_transactions НЕ меняется: остаётся историей до сентября 2026.

CREATE TABLE IF NOT EXISTS "ozon_accrual_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "type_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ozon_accruals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "accrual_date" date NOT NULL,
  "seq" integer NOT NULL,
  "line_no" integer NOT NULL,
  "line_kind" varchar(32) NOT NULL,
  "accrual_type_id" integer NOT NULL,
  "accrual_id" bigint,
  "fee_type_id" integer,
  "accrued_category" varchar(64),
  "unit_number" varchar(100),
  "posting_number" varchar(100),
  "sku" varchar(200),
  "offer_id" varchar(200),
  "qty" integer,
  "amount_kopecks" bigint NOT NULL,
  "currency" varchar(8),
  "ozon_date" varchar(40),
  "delivery_schema" varchar(32),
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "ozon_accruals" ADD COLUMN IF NOT EXISTS "accrual_id" bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ozon_accrual_types_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "ozon_accrual_types" ADD CONSTRAINT "ozon_accrual_types_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ozon_accrual_types_account_id_marketplace_accounts_id_fk') THEN
    ALTER TABLE "ozon_accrual_types" ADD CONSTRAINT "ozon_accrual_types_account_id_marketplace_accounts_id_fk"
      FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ozon_accruals_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "ozon_accruals" ADD CONSTRAINT "ozon_accruals_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ozon_accruals_account_id_marketplace_accounts_id_fk') THEN
    ALTER TABLE "ozon_accruals" ADD CONSTRAINT "ozon_accruals_account_id_marketplace_accounts_id_fk"
      FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ozon_accrual_types_tenant_idx"
  ON "ozon_accrual_types" USING btree ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ozon_accrual_types_account_type_idx"
  ON "ozon_accrual_types" USING btree ("account_id", "type_id");
CREATE INDEX IF NOT EXISTS "ozon_accruals_tenant_idx"
  ON "ozon_accruals" USING btree ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ozon_accruals_account_day_line_idx"
  ON "ozon_accruals" USING btree ("account_id", "accrual_date", "seq", "line_no");
CREATE INDEX IF NOT EXISTS "ozon_accruals_account_sku_idx"
  ON "ozon_accruals" USING btree ("account_id", "sku");
CREATE INDEX IF NOT EXISTS "ozon_accruals_account_accrual_idx"
  ON "ozon_accruals" USING btree ("account_id", "accrual_id");
-- Чтение — всегда с фильтром line_kind (итог и разбивка в одной колонке).
CREATE INDEX IF NOT EXISTS "ozon_accruals_account_day_kind_idx"
  ON "ozon_accruals" USING btree ("account_id", "accrual_date", "line_kind");
