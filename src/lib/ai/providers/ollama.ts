// PURPOSE: Клиент к локальной Ollama (http://localhost:11434).
// Поддержка: список установленных моделей, pull (с прогрессом), генерация.

import { env } from '@/lib/env';

const BASE = env.OLLAMA_BASE_URL;

export type OllamaModel = {
  name: string;
  size: number; // bytes
  modified_at: string;
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
    format?: string;
  };
};

/**
 * Эвристика: модель способна вести chat (поддерживает /api/chat)?
 * Исключает embedding/clip/reranker модели.
 *
 * Embedding модели в Ollama не поддерживают /api/chat и возвращают 400.
 * Типичные признаки:
 *  - family: bert | nomic-bert | mxbai | clip
 *  - имя содержит: embed | embedding | bge- | gte- | e5- | all-minilm | rerank
 */
const EMBEDDING_NAME_PATTERNS = [
  /embed/i,
  /embedding/i,
  /^bge[-:]/i,
  /^gte[-:]/i,
  /^e5[-:]/i,
  /all-minilm/i,
  /rerank/i,
  /^clip/i,
  /sentence-transformer/i,
];

const EMBEDDING_FAMILIES = new Set(['bert', 'nomic-bert', 'mxbai', 'clip', 'jina-bert']);

export function isChatCapableModel(m: { name: string; details?: OllamaModel['details'] }): boolean {
  const family = m.details?.family?.toLowerCase();
  const families = (m.details?.families ?? []).map((f) => f.toLowerCase());

  if (family && EMBEDDING_FAMILIES.has(family)) return false;
  if (families.some((f) => EMBEDDING_FAMILIES.has(f))) return false;
  if (EMBEDDING_NAME_PATTERNS.some((re) => re.test(m.name))) return false;

  return true;
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listInstalledModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${BASE}/api/tags`);
  if (!res.ok) throw new Error(`Ollama API ${res.status}`);
  const data = (await res.json()) as { models?: OllamaModel[] };
  return data.models ?? [];
}

export async function pullModel(name: string, onProgress?: (status: string, percent?: number) => void): Promise<void> {
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as { status?: string; total?: number; completed?: number };
        const percent = ev.total && ev.completed ? Math.round((ev.completed / ev.total) * 100) : undefined;
        onProgress?.(ev.status ?? '', percent);
      } catch {
        // ignore non-json lines
      }
    }
  }
}

export async function deleteModel(name: string): Promise<void> {
  const res = await fetch(`${BASE}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export type RunningModel = {
  name: string;
  model: string;
  size: number;
  size_vram?: number;
  digest?: string;
  details?: OllamaModel['details'];
  expires_at?: string;
};

/** GET /api/ps — модели, загруженные в память */
export async function listRunningModels(): Promise<RunningModel[]> {
  const res = await fetch(`${BASE}/api/ps`);
  if (!res.ok) throw new Error(`Ollama API ${res.status}`);
  const data = (await res.json()) as { models?: RunningModel[] };
  return data.models ?? [];
}

/** POST /api/show — полные детали модели (modelfile, parameters, license, template) */
export async function showModel(name: string): Promise<{
  license?: string;
  modelfile?: string;
  parameters?: string;
  template?: string;
  system?: string;
  details?: OllamaModel['details'];
  model_info?: Record<string, unknown>;
}> {
  const res = await fetch(`${BASE}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Show failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Выгрузить модель из памяти (Ollama: generate с keep_alive=0) */
export async function unloadModel(name: string): Promise<void> {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, keep_alive: 0 }),
  });
  if (!res.ok) throw new Error(`Unload failed: ${res.status}`);
}

export async function generate(input: { model: string; prompt: string; system?: string }): Promise<string> {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      system: input.system,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Generate failed: ${res.status}`);
  const data = (await res.json()) as { response: string };
  return data.response;
}
