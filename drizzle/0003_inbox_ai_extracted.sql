-- Migration: добавляет AI vision колонки в inbox_messages для хранения
-- результатов распознавания чеков/счетов/договоров.

ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "ai_extracted" jsonb;
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "ai_provider" varchar(20);
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "ai_extracted_at" timestamp;
