-- PURPOSE: PostgreSQL extensions для Open Finance
-- Запускается автоматически при первом старте контейнера postgres

-- Vector similarity search (RAG-память для AI)
CREATE EXTENSION IF NOT EXISTS vector;

-- UUIDs (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Полнотекстовый поиск с русской морфологией
-- (встроен в Postgres, проверим что доступен)
SELECT 'Russian text search support: ' || (CASE WHEN EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'russian') THEN 'available' ELSE 'missing' END);

-- Trigrams для fuzzy search контрагентов и описаний
CREATE EXTENSION IF NOT EXISTS pg_trgm;
