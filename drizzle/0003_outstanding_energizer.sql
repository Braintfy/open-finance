CREATE TABLE IF NOT EXISTS "unit_economics_tabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"page_key" varchar(96) NOT NULL,
	"label" varchar(80) NOT NULL,
	"icon" varchar(40),
	"order" integer DEFAULT 0 NOT NULL,
	"kind" varchar(16) DEFAULT 'custom' NOT NULL,
	"default_key" varchar(32),
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "ai_extracted" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "ai_provider" varchar(20);--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "ai_extracted_at" timestamp;--> statement-breakpoint
ALTER TABLE "unit_economics_tabs" ADD CONSTRAINT "unit_economics_tabs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_economics_tabs" ADD CONSTRAINT "unit_economics_tabs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_economics_tabs_tenant_user_page_idx" ON "unit_economics_tabs" USING btree ("tenant_id","user_id","page_key");