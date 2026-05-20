CREATE TABLE "ozon_analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sku" varchar(200) NOT NULL,
	"revenue_kopecks" bigint DEFAULT 0 NOT NULL,
	"ordered_units" integer DEFAULT 0 NOT NULL,
	"delivered_units" integer DEFAULT 0 NOT NULL,
	"cancellations" integer DEFAULT 0 NOT NULL,
	"returns" integer DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"cluster_id" varchar(50) NOT NULL,
	"cluster_name" varchar(200) NOT NULL,
	"cluster_type" varchar(40),
	"warehouse_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_perf_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"campaign_id" varchar(50) NOT NULL,
	"title" varchar(300),
	"state" varchar(50),
	"adv_object_type" varchar(20),
	"payment_type" varchar(20),
	"daily_budget_kopecks" bigint,
	"budget_kopecks" bigint,
	"start_date" date,
	"end_date" date,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_perf_cpo_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"expense_kopecks" bigint DEFAULT 0 NOT NULL,
	"sales_search_kopecks" bigint DEFAULT 0 NOT NULL,
	"sales_reco_kopecks" bigint DEFAULT 0 NOT NULL,
	"orders_search" integer DEFAULT 0 NOT NULL,
	"orders_reco" integer DEFAULT 0 NOT NULL,
	"promotion_status" varchar(50),
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_perf_expense_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"campaign_id" varchar(50) NOT NULL,
	"adv_object_type" varchar(20),
	"money_spent_kopecks" bigint DEFAULT 0 NOT NULL,
	"bonus_spent_kopecks" bigint DEFAULT 0 NOT NULL,
	"total_spent_kopecks" bigint DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_perf_phrases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"phrase" varchar(500) NOT NULL,
	"sku" varchar(200),
	"campaign_id" varchar(50),
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"expense_kopecks" bigint DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_perf_sku_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sku" varchar(200) NOT NULL,
	"campaign_id" varchar(50),
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cart_adds" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"orders_kopecks" bigint DEFAULT 0 NOT NULL,
	"expense_kopecks" bigint DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ozon_warehouse_stocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"sku" varchar(200) NOT NULL,
	"offer_id" varchar(200),
	"warehouse_name" varchar(200) NOT NULL,
	"cluster_id" varchar(50),
	"cluster_name" varchar(200),
	"cluster_type" varchar(40),
	"free_to_sell_amount" integer DEFAULT 0 NOT NULL,
	"promised_amount" integer DEFAULT 0 NOT NULL,
	"reserved_amount" integer DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_accounts" ADD COLUMN "perf_client_id" varchar(200);--> statement-breakpoint
ALTER TABLE "marketplace_accounts" ADD COLUMN "perf_client_secret_enc" text;--> statement-breakpoint
ALTER TABLE "marketplace_accounts" ADD COLUMN "perf_status" varchar(20);--> statement-breakpoint
ALTER TABLE "marketplace_accounts" ADD COLUMN "perf_last_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "marketplace_accounts" ADD COLUMN "perf_last_sync_error" text;--> statement-breakpoint
ALTER TABLE "ozon_analytics_daily" ADD CONSTRAINT "ozon_analytics_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_analytics_daily" ADD CONSTRAINT "ozon_analytics_daily_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_clusters" ADD CONSTRAINT "ozon_clusters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_clusters" ADD CONSTRAINT "ozon_clusters_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_campaigns" ADD CONSTRAINT "ozon_perf_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_campaigns" ADD CONSTRAINT "ozon_perf_campaigns_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_cpo_daily" ADD CONSTRAINT "ozon_perf_cpo_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_cpo_daily" ADD CONSTRAINT "ozon_perf_cpo_daily_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_expense_daily" ADD CONSTRAINT "ozon_perf_expense_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_expense_daily" ADD CONSTRAINT "ozon_perf_expense_daily_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_phrases" ADD CONSTRAINT "ozon_perf_phrases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_phrases" ADD CONSTRAINT "ozon_perf_phrases_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_sku_stats" ADD CONSTRAINT "ozon_perf_sku_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_perf_sku_stats" ADD CONSTRAINT "ozon_perf_sku_stats_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_warehouse_stocks" ADD CONSTRAINT "ozon_warehouse_stocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_warehouse_stocks" ADD CONSTRAINT "ozon_warehouse_stocks_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_analytics_daily_uniq" ON "ozon_analytics_daily" USING btree ("account_id","date","sku");--> statement-breakpoint
CREATE INDEX "ozon_analytics_daily_tenant_date_idx" ON "ozon_analytics_daily" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "ozon_analytics_daily_account_date_idx" ON "ozon_analytics_daily" USING btree ("account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_clusters_account_cluster_idx" ON "ozon_clusters" USING btree ("account_id","cluster_id");--> statement-breakpoint
CREATE INDEX "ozon_clusters_tenant_idx" ON "ozon_clusters" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ozon_perf_campaigns_tenant_idx" ON "ozon_perf_campaigns" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_perf_campaigns_account_campaign_idx" ON "ozon_perf_campaigns" USING btree ("account_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_perf_cpo_daily_uniq" ON "ozon_perf_cpo_daily" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "ozon_perf_cpo_daily_tenant_date_idx" ON "ozon_perf_cpo_daily" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_perf_expense_daily_uniq" ON "ozon_perf_expense_daily" USING btree ("account_id","date","campaign_id");--> statement-breakpoint
CREATE INDEX "ozon_perf_expense_daily_tenant_date_idx" ON "ozon_perf_expense_daily" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "ozon_perf_expense_daily_account_date_idx" ON "ozon_perf_expense_daily" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "ozon_perf_phrases_tenant_idx" ON "ozon_perf_phrases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ozon_perf_phrases_account_date_idx" ON "ozon_perf_phrases" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "ozon_perf_phrases_phrase_idx" ON "ozon_perf_phrases" USING btree ("account_id","phrase");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_perf_sku_stats_uniq" ON "ozon_perf_sku_stats" USING btree ("account_id","date","sku","campaign_id");--> statement-breakpoint
CREATE INDEX "ozon_perf_sku_stats_tenant_date_idx" ON "ozon_perf_sku_stats" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "ozon_perf_sku_stats_account_date_idx" ON "ozon_perf_sku_stats" USING btree ("account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_warehouse_stocks_uniq" ON "ozon_warehouse_stocks" USING btree ("account_id","sku","warehouse_name");--> statement-breakpoint
CREATE INDEX "ozon_warehouse_stocks_tenant_idx" ON "ozon_warehouse_stocks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ozon_warehouse_stocks_account_cluster_idx" ON "ozon_warehouse_stocks" USING btree ("account_id","cluster_id");