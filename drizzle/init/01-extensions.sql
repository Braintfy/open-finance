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

-- Снятие диакритики и нормализация (русская/латинская)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Нормализатор поискового текста (как в braint): lower + unaccent + ё→е + dashes/dots → space
CREATE OR REPLACE FUNCTION normalize_search_text(input_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        unaccent(input_text),
        'ё', 'е', 'g'
      ),
      '[\-_/.,]+', ' ', 'g'
    )
  );
$$;

-- Лог инициализации
DO $$
BEGIN
  RAISE NOTICE 'Open Finance database initialized.';
  RAISE NOTICE 'Extensions: vector, uuid-ossp, pgcrypto, pg_trgm, unaccent.';
  RAISE NOTICE 'NOTE: HNSW индекс на memory_chunks.embedding нужно создать после первой миграции (см. drizzle/init/02-vector-indexes.sql).';
END $$;
