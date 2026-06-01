CREATE TABLE "ozon_ai_insight_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"block_id" varchar(64) NOT NULL,
	"account_id" varchar(64),
	"period_key" varchar(64),
	"model" varchar(120),
	"summary" text DEFAULT '' NOT NULL,
	"insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ozon_ai_insight_reports" ADD CONSTRAINT "ozon_ai_insight_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_ai_insight_reports" ADD CONSTRAINT "ozon_ai_insight_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ozon_ai_insight_reports_block_idx" ON "ozon_ai_insight_reports" USING btree ("tenant_id","user_id","block_id","created_at");