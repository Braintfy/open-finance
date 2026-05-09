// PURPOSE: Hybrid search в RAG-памяти (semantic + full-text + RRF слияние)
// TODO: реализация на Этапе 4 PLAN.md
import { db } from '@/lib/db/client';
import { memoryChunks } from '@/lib/db/schema/ai';

export type SearchOptions = {
  topK?: number;
  source?: string; // фильтр: 'transaction' | 'block' | 'document' | ...
  minSimilarity?: number; // 0..1
};

/**
 * Гибридный поиск: семантический (pgvector cosine) + full-text (tsvector)
 * Слияние через Reciprocal Rank Fusion (RRF).
 */
export async function searchMemory(
  tenantId: string,
  query: string,
  opts: SearchOptions = {},
): Promise<unknown[]> {
  // 1. Получить embedding для query через embedder
  // const queryEmbedding = await embed(query);

  // 2. Семантический поиск:
  // SELECT id, content, 1 - (embedding <=> :query_embedding) as similarity
  // FROM memory_chunks WHERE tenant_id = :tenant_id
  // ORDER BY embedding <=> :query_embedding LIMIT :top_k

  // 3. Full-text поиск:
  // SELECT id, content, ts_rank_cd(to_tsvector('russian', content), plainto_tsquery(:query)) as rank
  // FROM memory_chunks WHERE tenant_id = :tenant_id

  // 4. RRF: 1/(60 + rank_semantic) + 1/(60 + rank_fulltext)
  // ORDER BY combined_score DESC LIMIT :top_k

  return [];
}
