ALTER TABLE "unit_products" ADD COLUMN "cost_source" varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_products" ADD COLUMN "cost_updated_at" timestamp;