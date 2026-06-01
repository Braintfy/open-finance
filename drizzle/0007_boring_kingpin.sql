CREATE TABLE "section_ai_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"page_key" varchar(64) NOT NULL,
	"page_label" varchar(120),
	"model" varchar(120),
	"summary" text DEFAULT '' NOT NULL,
	"insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "section_ai_reports" ADD CONSTRAINT "section_ai_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_ai_reports" ADD CONSTRAINT "section_ai_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "section_ai_reports_page_idx" ON "section_ai_reports" USING btree ("tenant_id","user_id","page_key","created_at");