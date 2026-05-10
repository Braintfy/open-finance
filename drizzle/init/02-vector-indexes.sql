-- PURPOSE: Индексы которые drizzle-kit не умеет генерировать
-- Применять ВРУЧНУЮ после `pnpm db:push`:
--   docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/02-vector-indexes.sql

-- HNSW индекс для AI memory (cosine similarity)
-- Параметры m=16, ef_construction=64 — sweet spot для до 1M векторов
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'memory_chunks') THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw
      ON memory_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    ';
    RAISE NOTICE 'HNSW index on memory_chunks.embedding created.';
  ELSE
    RAISE NOTICE 'Skipped: memory_chunks table not found. Run db:push first.';
  END IF;
END $$;

-- GIN индекс для русского полнотекстового поиска
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_chunks' AND column_name = 'content') THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS memory_chunks_content_fts
      ON memory_chunks
      USING gin (to_tsvector(''russian'', content))
    ';
    RAISE NOTICE 'GIN FTS index on memory_chunks.content created.';
  END IF;
END $$;

-- Trigram индекс на описании транзакций (fuzzy search контрагентов)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'counterparty') THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS transactions_counterparty_trgm
      ON transactions
      USING gin (counterparty gin_trgm_ops)
    ';
    RAISE NOTICE 'Trigram index on transactions.counterparty created.';
  END IF;
END $$;
