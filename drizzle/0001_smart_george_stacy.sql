CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(200) DEFAULT 'Новая доска' NOT NULL,
	"icon" varchar(40),
	"accent_color" varchar(40),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_rates" (
	"code" varchar(8) PRIMARY KEY NOT NULL,
	"nominal" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"rate_rub" numeric(18, 6) NOT NULL,
	"previous_rub" numeric(18, 6),
	"source" text DEFAULT 'cbr' NOT NULL,
	"source_date" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"label" varchar(120) NOT NULL,
	"status" varchar(20) DEFAULT 'disconnected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret" text,
	"total_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_id" varchar(300) NOT NULL,
	"sender_name" varchar(200),
	"sender_address" varchar(320),
	"subject" varchar(500),
	"preview" varchar(500),
	"body" text,
	"received_at" timestamp NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid,
	"marketplace" varchar(20) NOT NULL,
	"mode" varchar(30) NOT NULL,
	"tariff_version" varchar(60) NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bindings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" varchar(80) NOT NULL,
	"filename" varchar(500),
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
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
	"marketplace_account_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"marketplace" varchar(20) NOT NULL,
	"name" varchar(200) DEFAULT '' NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"api_key_enc" text NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"sync_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"company_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_status" varchar(20),
	"last_sync_error" text,
	"last_sync_summary" jsonb DEFAULT '{"stages":{}}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "ozon_realization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"period_from" timestamp NOT NULL,
	"period_to" timestamp NOT NULL,
	"sku" varchar(200),
	"offer_id" varchar(200),
	"qty" integer DEFAULT 0 NOT NULL,
	"gross_kopecks" bigint DEFAULT 0 NOT NULL,
	"commission_kopecks" bigint DEFAULT 0 NOT NULL,
	"logistics_kopecks" bigint DEFAULT 0 NOT NULL,
	"ads_kopecks" bigint DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_total" integer DEFAULT 0 NOT NULL,
	"stages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"transaction_id" bigint NOT NULL,
	"operation_type" varchar(80),
	"operation_date" timestamp,
	"amount_kopecks" bigint DEFAULT 0 NOT NULL,
	"posting_number" varchar(100),
	"sku" varchar(200),
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_channels" ADD CONSTRAINT "inbox_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_channels" ADD CONSTRAINT "inbox_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_channel_id_inbox_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."inbox_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_calculations" ADD CONSTRAINT "unit_calculations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_calculations" ADD CONSTRAINT "unit_calculations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_calculations" ADD CONSTRAINT "unit_calculations_product_id_unit_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."unit_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_imports" ADD CONSTRAINT "unit_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_imports" ADD CONSTRAINT "unit_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_products" ADD CONSTRAINT "unit_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_products" ADD CONSTRAINT "unit_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_products" ADD CONSTRAINT "unit_products_marketplace_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("marketplace_account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_accounts" ADD CONSTRAINT "marketplace_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_accounts" ADD CONSTRAINT "marketplace_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_orders" ADD CONSTRAINT "ozon_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_orders" ADD CONSTRAINT "ozon_orders_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_realization" ADD CONSTRAINT "ozon_realization_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_realization" ADD CONSTRAINT "ozon_realization_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_sync_jobs" ADD CONSTRAINT "ozon_sync_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_sync_jobs" ADD CONSTRAINT "ozon_sync_jobs_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_transactions" ADD CONSTRAINT "ozon_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_transactions" ADD CONSTRAINT "ozon_transactions_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_channels_tenant_idx" ON "inbox_channels" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inbox_channels_tenant_type_idx" ON "inbox_channels" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "inbox_messages_tenant_received_idx" ON "inbox_messages" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "inbox_messages_channel_idx" ON "inbox_messages" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_messages_channel_external_idx" ON "inbox_messages" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX "unit_calculations_tenant_idx" ON "unit_calculations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "unit_calculations_tenant_marketplace_idx" ON "unit_calculations" USING btree ("tenant_id","marketplace");--> statement-breakpoint
CREATE INDEX "unit_calculations_product_idx" ON "unit_calculations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "unit_imports_tenant_idx" ON "unit_imports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "unit_imports_tenant_created_idx" ON "unit_imports" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "unit_products_tenant_idx" ON "unit_products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "unit_products_tenant_marketplace_idx" ON "unit_products" USING btree ("tenant_id","marketplace");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_products_tenant_mp_article_idx" ON "unit_products" USING btree ("tenant_id","marketplace","article");--> statement-breakpoint
CREATE INDEX "unit_products_marketplace_account_idx" ON "unit_products" USING btree ("marketplace_account_id");--> statement-breakpoint
CREATE INDEX "marketplace_accounts_tenant_idx" ON "marketplace_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_accounts_tenant_mp_client_idx" ON "marketplace_accounts" USING btree ("tenant_id","marketplace","client_id");--> statement-breakpoint
CREATE INDEX "ozon_orders_tenant_idx" ON "ozon_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ozon_orders_account_idx" ON "ozon_orders" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_orders_account_posting_idx" ON "ozon_orders" USING btree ("account_id","posting_number");--> statement-breakpoint
CREATE INDEX "ozon_orders_account_created_idx" ON "ozon_orders" USING btree ("account_id","order_created_at");--> statement-breakpoint
CREATE INDEX "ozon_realization_tenant_idx" ON "ozon_realization" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ozon_realization_account_idx" ON "ozon_realization" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ozon_realization_account_period_sku_idx" ON "ozon_realization" USING btree ("account_id","period_from","sku");--> statement-breakpoint
CREATE INDEX "ozon_sync_jobs_tenant_idx" ON "ozon_sync_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ozon_sync_jobs_account_idx" ON "ozon_sync_jobs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ozon_sync_jobs_account_created_idx" ON "ozon_sync_jobs" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ozon_transactions_tenant_idx" ON "ozon_transactions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ozon_transactions_account_idx" ON "ozon_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_transactions_account_tx_idx" ON "ozon_transactions" USING btree ("account_id","transaction_id");--> statement-breakpoint
CREATE INDEX "ozon_transactions_account_date_idx" ON "ozon_transactions" USING btree ("account_id","operation_date");