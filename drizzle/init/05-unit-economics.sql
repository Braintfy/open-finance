-- PURPOSE: Таблицы модуля «Юнит-экономика» (товары, расчёты, импорты).

CREATE TABLE IF NOT EXISTS "unit_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "marketplace" varchar(20) NOT NULL,
  "article" varchar(200),
  "sku" varchar(200),
  "barcode" varchar(200),
  "name" varchar(500) DEFAULT '' NOT NULL,
  "status" varchar(80),
  "visibility" varchar(80),
  "stock_marketplace" integer DEFAULT 0 NOT NULL,
  "stock_own" integer DEFAULT 0 NOT NULL,
  "price_kopecks" integer DEFAULT 0 NOT NULL,
  "cost_kopecks" integer DEFAULT 0 NOT NULL,
  "volume_l_x100" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "unit_products_tenant_idx"
  ON "unit_products" ("tenant_id");
CREATE INDEX IF NOT EXISTS "unit_products_tenant_marketplace_idx"
  ON "unit_products" ("tenant_id", "marketplace");
CREATE UNIQUE INDEX IF NOT EXISTS "unit_products_tenant_mp_article_idx"
  ON "unit_products" ("tenant_id", "marketplace", "article");

CREATE TABLE IF NOT EXISTS "unit_calculations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "product_id" uuid REFERENCES "unit_products"("id") ON DELETE SET NULL,
  "marketplace" varchar(20) NOT NULL,
  "mode" varchar(30) NOT NULL,
  "tariff_version" varchar(60) NOT NULL,
  "inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "bindings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "results" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "unit_calculations_tenant_idx"
  ON "unit_calculations" ("tenant_id");
CREATE INDEX IF NOT EXISTS "unit_calculations_tenant_marketplace_idx"
  ON "unit_calculations" ("tenant_id", "marketplace");
CREATE INDEX IF NOT EXISTS "unit_calculations_product_idx"
  ON "unit_calculations" ("product_id");

CREATE TABLE IF NOT EXISTS "unit_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "source" varchar(80) NOT NULL,
  "filename" varchar(500),
  "rows_total" integer DEFAULT 0 NOT NULL,
  "rows_imported" integer DEFAULT 0 NOT NULL,
  "errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "unit_imports_tenant_idx"
  ON "unit_imports" ("tenant_id");
CREATE INDEX IF NOT EXISTS "unit_imports_tenant_created_idx"
  ON "unit_imports" ("tenant_id", "created_at");
