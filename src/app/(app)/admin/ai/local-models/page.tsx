// PURPOSE: Менеджер локальных AI-моделей (Ollama) — как LM Studio
'use client';

import { useEffect, useState } from 'react';
import { Download, Trash2, Check, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type Installed = {
  name: string;
  size: number;
  modified_at: string;
  details?: { parameter_size?: string; quantization_level?: string };
};

type CatalogModel = {
  id: string;
  displayName: string;
  family: string;
  size: string;
  ramRequired: string;
  description: string;
  goodFor: string[];
  recommended?: boolean;
};

type ApiResponse = {
  ok: boolean;
  ollamaAvailable: boolean;
  installed: Installed[];
  catalog: CatalogModel[];
  hint?: string;
};

function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function LocalModelsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<Record<string, { status: string; percent?: number }>>({});

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/ai/local-models');
      const json: ApiResponse = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function pull(modelId: string) {
    setPulling((p) => ({ ...p, [modelId]: { status: 'starting…' } }));
    try {
      const res = await fetch('/api/admin/ai/local-models/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

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
            const percent =
              ev.total && ev.completed ? Math.round((ev.completed / ev.total) * 100) : undefined;
            setPulling((p) => ({
              ...p,
              [modelId]: { status: ev.status ?? '', percent },
            }));
          } catch {
            // ignore
          }
        }
      }

      setPulling((p) => {
        const copy = { ...p };
        delete copy[modelId];
        return copy;
      });
      await refresh();
    } catch (e) {
      setPulling((p) => ({
        ...p,
        [modelId]: { status: e instanceof Error ? e.message : 'Ошибка' },
      }));
      setTimeout(() => {
        setPulling((p) => {
          const copy = { ...p };
          delete copy[modelId];
          return copy;
        });
      }, 3000);
    }
  }

  async function remove(name: string) {
    if (!confirm(`Удалить модель ${name}?`)) return;
    await fetch(`/api/admin/ai/local-models/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await refresh();
  }

  const installedSet = new Set((data?.installed ?? []).map((m) => m.name));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Локальные AI-модели</h1>
          <p className="text-sm text-muted-foreground">
            Управление моделями Ollama — установка, проверка и удаление
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Обновить
        </Button>
      </div>

      {data && !data.ollamaAvailable && (
        <Alert variant="warning">
          <AlertCircle />
          <AlertTitle>Ollama не запущена</AlertTitle>
          <AlertDescription>
            <p className="mb-2">{data.hint ?? 'Установите и запустите Ollama чтобы продолжить.'}</p>
            <pre className="rounded bg-muted/50 p-2 text-xs">
              {`brew install ollama
brew services start ollama
ollama pull qwen2.5:7b`}
            </pre>
            <p className="mt-2">
              Подробнее:{' '}
              <a className="underline" href="/docs/LOCAL_AI.md">
                docs/LOCAL_AI.md
              </a>
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Установленные */}
      <section>
        <h2 className="mb-3 text-lg font-medium">Установленные ({data?.installed.length ?? 0})</h2>
        {data?.installed.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Пока нет установленных моделей. Выберите ниже из каталога.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data?.installed.map((m) => (
              <Card key={m.name}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{m.name}</CardTitle>
                    <Button variant="ghost" size="icon" onClick={() => remove(m.name)}>
                      <Trash2 className="text-red-600" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <div>Размер: {formatBytes(m.size)}</div>
                  {m.details?.parameter_size && (
                    <div>Параметры: {m.details.parameter_size}</div>
                  )}
                  {m.details?.quantization_level && (
                    <div>Квантизация: {m.details.quantization_level}</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Каталог */}
      <section>
        <h2 className="mb-3 text-lg font-medium">Рекомендованные модели</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {data?.catalog.map((c) => {
            const isInstalled = installedSet.has(c.id);
            const progress = pulling[c.id];
            return (
              <Card key={c.id} className={c.recommended ? 'border-primary/50' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {c.displayName}
                        {c.recommended && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                            рекомендуется
                          </span>
                        )}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.family} · {c.size} · нужно RAM ~{c.ramRequired}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">{c.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {c.goodFor.map((g) => (
                      <span
                        key={g}
                        className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                  {progress ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>{progress.status}</span>
                        {progress.percent !== undefined && <span>{progress.percent}%</span>}
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${progress.percent ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ) : isInstalled ? (
                    <Button variant="outline" disabled className="w-full">
                      <Check /> Установлено
                    </Button>
                  ) : (
                    <Button
                      onClick={() => pull(c.id)}
                      className="w-full"
                      disabled={!data?.ollamaAvailable}
                    >
                      <Download /> Загрузить
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Alert>
        <AlertDescription>
          Хотите модель не из списка? Установите её в терминале:{' '}
          <code className="rounded bg-muted px-1">ollama pull имя_модели</code>. После этого она
          появится в разделе «Установленные» при обновлении страницы.
        </AlertDescription>
      </Alert>
    </div>
  );
}
