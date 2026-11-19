CREATE TABLE "ozon_accrual_types" (
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
--> statement-breakpoint
CREATE TABLE "ozon_accruals" (
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
--> statement-breakpoint
ALTER TABLE "ozon_accrual_types" ADD CONSTRAINT "ozon_accrual_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_accrual_types" ADD CONSTRAINT "ozon_accrual_types_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_accruals" ADD CONSTRAINT "ozon_accruals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_accruals" ADD CONSTRAINT "ozon_accruals_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ozon_accrual_types_tenant_idx" ON "ozon_accrual_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_accrual_types_account_type_idx" ON "ozon_accrual_types" USING btree ("account_id","type_id");--> statement-breakpoint
CREATE INDEX "ozon_accruals_tenant_idx" ON "ozon_accruals" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_accruals_account_day_line_idx" ON "ozon_accruals" USING btree ("account_id","accrual_date","seq","line_no");--> statement-breakpoint
CREATE INDEX "ozon_accruals_account_sku_idx" ON "ozon_accruals" USING btree ("account_id","sku");--> statement-breakpoint
CREATE INDEX "ozon_accruals_account_accrual_idx" ON "ozon_accruals" USING btree ("account_id","accrual_id");--> statement-breakpoint
CREATE INDEX "ozon_accruals_account_day_kind_idx" ON "ozon_accruals" USING btree ("account_id","accrual_date","line_kind");