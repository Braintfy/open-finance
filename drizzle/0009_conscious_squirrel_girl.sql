CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"tenant_id" uuid,
	"email" varchar(255) NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_by" uuid,
	"processed_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "consent_version" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_idx" ON "account_deletion_requests" USING btree ("status","requested_at");