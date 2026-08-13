CREATE TABLE "stock_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"scope_key" varchar(64) DEFAULT '-' NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"external_sku" varchar(200),
	"qty_per_unit" integer DEFAULT 1 NOT NULL,
	"unit_product_id" uuid,
	"account_id" uuid,
	"match_source" varchar(16) DEFAULT 'manual' NOT NULL,
	"match_confidence" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sku" varchar(80) NOT NULL,
	"name" varchar(500) DEFAULT '' NOT NULL,
	"brand" varchar(120),
	"category" varchar(160),
	"unit" varchar(16) DEFAULT 'шт' NOT NULL,
	"barcode" varchar(200),
	"expiry_control" boolean DEFAULT true NOT NULL,
	"shelf_life_days" integer,
	"qty_pool" integer DEFAULT 0 NOT NULL,
	"value_pool_kopecks" bigint DEFAULT 0 NOT NULL,
	"avg_cost_kopecks" bigint DEFAULT 0 NOT NULL,
	"last_cost_kopecks" bigint DEFAULT 0 NOT NULL,
	"cost_basis" varchar(5) DEFAULT 'gross' NOT NULL,
	"cost_basis_mixed" boolean DEFAULT false NOT NULL,
	"cost_override_kopecks" bigint,
	"cost_updated_at" timestamp with time zone,
	"min_qty" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(200) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"authority" varchar(10) DEFAULT 'ledger' NOT NULL,
	"account_id" uuid,
	"external_source" varchar(8),
	"cluster_id" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"doc_id" uuid,
	"line_id" uuid,
	"lot_no" varchar(40),
	"batch_number" varchar(64),
	"supplier" varchar(200) DEFAULT '' NOT NULL,
	"received_at" date NOT NULL,
	"expires_at" date,
	"qty_in" integer NOT NULL,
	"qty_left" integer NOT NULL,
	"unit_cost_kopecks" bigint DEFAULT 0 NOT NULL,
	"value_in_kopecks" bigint DEFAULT 0 NOT NULL,
	"vat_kopecks" bigint DEFAULT 0 NOT NULL,
	"cost_basis" varchar(5) DEFAULT 'gross' NOT NULL,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_doc_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"direction" varchar(3) NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_kopecks" bigint DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"vat_kopecks" bigint DEFAULT 0 NOT NULL,
	"extra_alloc_kopecks" bigint DEFAULT 0 NOT NULL,
	"value_kopecks" bigint DEFAULT 0 NOT NULL,
	"batch_number" varchar(64),
	"expires_at" date,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"counted_qty" integer,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "stock_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"status" varchar(8) DEFAULT 'draft' NOT NULL,
	"number" varchar(40),
	"doc_date" date NOT NULL,
	"posted_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"from_place_id" uuid,
	"to_place_id" uuid,
	"supplier" varchar(200) DEFAULT '' NOT NULL,
	"supplier_inn" varchar(12),
	"doc_number" varchar(80),
	"currency" varchar(3) DEFAULT 'RUB' NOT NULL,
	"fx_rate" numeric(18, 6),
	"amount_orig_minor" bigint DEFAULT 0 NOT NULL,
	"price_includes_vat" boolean DEFAULT true NOT NULL,
	"cost_basis" varchar(5) DEFAULT 'gross' NOT NULL,
	"extra_cost_kopecks" bigint DEFAULT 0 NOT NULL,
	"extra_alloc" varchar(10) DEFAULT 'by_value' NOT NULL,
	"total_kopecks" bigint DEFAULT 0 NOT NULL,
	"vat_total_kopecks" bigint DEFAULT 0 NOT NULL,
	"payment_status" varchar(8) DEFAULT 'paid' NOT NULL,
	"reason" varchar(24),
	"reverses_doc_id" uuid,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"source_ref" varchar(200),
	"comment" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "stock_moves_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"doc_id" uuid NOT NULL,
	"line_id" uuid,
	"item_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"counter_place_id" uuid,
	"qty_delta" integer NOT NULL,
	"value_delta_kopecks" bigint NOT NULL,
	"unit_value_kopecks" bigint DEFAULT 0 NOT NULL,
	"uncovered_qty" integer DEFAULT 0 NOT NULL,
	"deficit_settled_kopecks" bigint DEFAULT 0 NOT NULL,
	"kind" varchar(16) NOT NULL,
	"reason" varchar(24),
	"doc_date" date NOT NULL,
	"lot_alloc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reverses_move_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_recon" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"ledger_qty" integer NOT NULL,
	"external_qty" integer NOT NULL,
	"delta_qty" integer NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"resolved_doc_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"costing_mode" varchar(8) DEFAULT 'avg' NOT NULL,
	"lot_policy" varchar(6) DEFAULT 'fefo' NOT NULL,
	"cost_basis" varchar(5) DEFAULT 'gross' NOT NULL,
	"ledger_start_date" date,
	"locked_through" date,
	"allow_negative" boolean DEFAULT true NOT NULL,
	"number_prefixes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_item_links" ADD CONSTRAINT "stock_item_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item_links" ADD CONSTRAINT "stock_item_links_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item_links" ADD CONSTRAINT "stock_item_links_unit_product_id_unit_products_id_fk" FOREIGN KEY ("unit_product_id") REFERENCES "public"."unit_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item_links" ADD CONSTRAINT "stock_item_links_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_places" ADD CONSTRAINT "stock_places_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_places" ADD CONSTRAINT "stock_places_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_doc_id_stock_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."stock_docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_line_id_stock_doc_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."stock_doc_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_doc_lines" ADD CONSTRAINT "stock_doc_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_doc_lines" ADD CONSTRAINT "stock_doc_lines_doc_id_stock_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."stock_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_doc_lines" ADD CONSTRAINT "stock_doc_lines_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_from_place_id_stock_places_id_fk" FOREIGN KEY ("from_place_id") REFERENCES "public"."stock_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_to_place_id_stock_places_id_fk" FOREIGN KEY ("to_place_id") REFERENCES "public"."stock_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_doc_id_stock_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."stock_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_line_id_stock_doc_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."stock_doc_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_place_id_stock_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."stock_places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_counter_place_id_stock_places_id_fk" FOREIGN KEY ("counter_place_id") REFERENCES "public"."stock_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recon" ADD CONSTRAINT "stock_recon_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recon" ADD CONSTRAINT "stock_recon_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recon" ADD CONSTRAINT "stock_recon_place_id_stock_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."stock_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recon" ADD CONSTRAINT "stock_recon_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_recon" ADD CONSTRAINT "stock_recon_resolved_doc_id_stock_docs_id_fk" FOREIGN KEY ("resolved_doc_id") REFERENCES "public"."stock_docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_links_uniq_idx" ON "stock_item_links" USING btree ("tenant_id","channel","scope_key","external_id");--> statement-breakpoint
CREATE INDEX "stock_links_item_idx" ON "stock_item_links" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_links_up_idx" ON "stock_item_links" USING btree ("unit_product_id");--> statement-breakpoint
CREATE INDEX "stock_links_extsku_idx" ON "stock_item_links" USING btree ("tenant_id","channel","external_sku");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_tenant_sku_idx" ON "stock_items" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "stock_items_tenant_active_idx" ON "stock_items" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "stock_items_tenant_brand_idx" ON "stock_items" USING btree ("tenant_id","brand");--> statement-breakpoint
CREATE INDEX "stock_items_tenant_barcode_idx" ON "stock_items" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_places_tenant_code_idx" ON "stock_places" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "stock_places_tenant_kind_idx" ON "stock_places" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "stock_batches_fifo_idx" ON "stock_batches" USING btree ("tenant_id","item_id","received_at","id") WHERE "qty_left" > 0;--> statement-breakpoint
CREATE INDEX "stock_batches_expiry_idx" ON "stock_batches" USING btree ("tenant_id","expires_at") WHERE "qty_left" > 0;--> statement-breakpoint
CREATE INDEX "stock_batches_doc_idx" ON "stock_batches" USING btree ("doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lines_doc_no_idx" ON "stock_doc_lines" USING btree ("doc_id","line_no");--> statement-breakpoint
CREATE INDEX "stock_lines_tenant_item_idx" ON "stock_doc_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_docs_tenant_date_idx" ON "stock_docs" USING btree ("tenant_id","doc_date");--> statement-breakpoint
CREATE INDEX "stock_docs_tenant_kind_status_idx" ON "stock_docs" USING btree ("tenant_id","kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_docs_number_idx" ON "stock_docs" USING btree ("tenant_id","number") WHERE "number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_docs_source_idx" ON "stock_docs" USING btree ("tenant_id","source","source_ref") WHERE "source_ref" is not null;--> statement-breakpoint
CREATE INDEX "stock_moves_item_date_idx" ON "stock_moves" USING btree ("tenant_id","item_id","doc_date","seq");--> statement-breakpoint
CREATE INDEX "stock_moves_place_idx" ON "stock_moves" USING btree ("tenant_id","place_id");--> statement-breakpoint
CREATE INDEX "stock_moves_doc_idx" ON "stock_moves" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "stock_moves_kind_date_idx" ON "stock_moves" USING btree ("tenant_id","kind","doc_date");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_recon_uniq_idx" ON "stock_recon" USING btree ("tenant_id","account_id","item_id","place_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "stock_recon_open_idx" ON "stock_recon" USING btree ("tenant_id","status") WHERE "status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "stock_settings_tenant_idx" ON "stock_settings" USING btree ("tenant_id");