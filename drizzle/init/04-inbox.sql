-- PURPOSE: Inbox channels/messages schema for the Входящие module.

CREATE TABLE IF NOT EXISTS "inbox_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
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

CREATE TABLE IF NOT EXISTS "inbox_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "channel_id" uuid NOT NULL REFERENCES "inbox_channels"("id") ON DELETE cascade,
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

CREATE INDEX IF NOT EXISTS "inbox_channels_tenant_idx"
  ON "inbox_channels" ("tenant_id");

CREATE INDEX IF NOT EXISTS "inbox_channels_tenant_type_idx"
  ON "inbox_channels" ("tenant_id", "type");

CREATE INDEX IF NOT EXISTS "inbox_messages_tenant_received_idx"
  ON "inbox_messages" ("tenant_id", "received_at");

CREATE INDEX IF NOT EXISTS "inbox_messages_channel_idx"
  ON "inbox_messages" ("channel_id");

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_messages_channel_external_idx"
  ON "inbox_messages" ("channel_id", "external_id");
