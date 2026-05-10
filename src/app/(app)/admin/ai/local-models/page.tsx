// PURPOSE: Менеджер локальных AI-моделей (Ollama) — как LM Studio, compact Linear-style
'use client';

import { useEffect, useState } from 'react';
import {
  Download,
  Trash2,
  Check,
  RefreshCw,
  AlertCircle,
  Info,
  Power,
  MemoryStick,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Installed = {
  name: string;
  size: number;
  modified_at: string;
  details?: { parameter_size?: string; quantization_level?: string };
};

type RunningModel = {
  name: string;
  model: string;
  size: number;
  size_vram?: number;
  expires_at?: string;
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

type PsResponse = {
  ok: boolean;
  ollamaAvailable: boolean;
  running: RunningModel[];
};

function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatExpires(iso?: string): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'истекает';
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  return `${h} ч ${min % 60} м`;
}

export default function LocalModelsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [running, setRunning] = useState<RunningModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<Record<string, { status: string; percent?: number }>>({});
  const [showInfo, setShowInfo] = useState<{ name: string; info: Record<string, unknown> } | null>(
    null
  );

  async function refresh() {
    setLoading(true);
    try {
      const [modelsRes, psRes] = await Promise.all([
        fetch('/api/admin/ai/local-models').then((r) => r.json() as Promise<ApiResponse>),
        fetch('/api/admin/ai/local-models/ps').then((r) => r.json() as Promise<PsResponse>),
      ]);
      setData(modelsRes);
      setRunning(psRes.running ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const iv = setInterval(() => {
      fetch('/api/admin/ai/local-models/ps')
        .then((r) => r.json() as Promise<PsResponse>)
        .then((d) => setRunning(d.running ?? []))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
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

  async function unload(name: string) {
    await fetch(`/api/admin/ai/local-models/${encodeURIComponent(name)}/unload`, {
      method: 'POST',
    });
    setTimeout(refresh, 300);
  }

  async function openInfo(name: string) {
    const res = await fetch(`/api/admin/ai/local-models/${encodeURIComponent(name)}/show`);
    const info = await res.json();
    setShowInfo({ name, info });
  }

  const installedSet = new Set((data?.installed ?? []).map((m) => m.name));
  const runningSet = new Set(running.map((m) => m.name));

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">Локальные AI-модели</h1>
          <p className="text-xs text-muted-foreground">
            Ollama — установка, выгрузка из памяти, детали модели
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Обновить
        </Button>
      </div>

      {data && !data.ollamaAvailable && (
        <Alert variant="warning">
          <AlertCircle />
          <AlertTitle>Ollama не запущена</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              {data.hint ?? 'Установите и запустите Ollama чтобы продолжить.'}
            </p>
            <pre className="rounded bg-muted/50 p-2 text-[11px]">
              {`brew install ollama
brew services start ollama
ollama pull qwen2.5:7b`}
            </pre>
          </AlertDescription>
        </Alert>
      )}

      {/* В памяти */}
      {running.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MemoryStick className="h-3 w-3" />
            В памяти ({running.length})
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {running.map((m) => (
              <Card key={m.name}>
                <CardContent className="flex items-center justify-between p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{m.name}</div>
                    <div className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                      <span>RAM: {formatBytes(m.size)}</span>
                      {m.size_vram ? <span>VRAM: {formatBytes(m.size_vram)}</span> : null}
                      {m.expires_at ? <span>Держится ещё {formatExpires(m.expires_at)}</span> : null}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => unload(m.name)}
                    className="text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                  >
                    <Power /> Выгрузить
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Установленные */}
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Установленные ({data?.installed.length ?? 0})
        </div>
        {data?.installed.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-xs text-muted-foreground">
              Пока нет установленных моделей. Выберите ниже из каталога.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {data?.installed.map((m) => (
              <Card key={m.name}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <span className="truncate">{m.name}</span>
                        {runningSet.has(m.name) && (
                          <span className="inline-flex h-4 items-center rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-800">
                            loaded
                          </span>
                        )}
                      </CardTitle>
                    </div>
                    <div className="flex gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openInfo(m.name)}
                        aria-label="Детали"
                      >
                        <Info />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => remove(m.name)}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        aria-label="Удалить"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex gap-3 pt-0 text-[11px] text-muted-foreground">
                  <span>Размер: {formatBytes(m.size)}</span>
                  {m.details?.parameter_size && <span>Параметры: {m.details.parameter_size}</span>}
                  {m.details?.quantization_level && <span>Q: {m.details.quantization_level}</span>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Каталог */}
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Рекомендованные модели
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {data?.catalog.map((c) => {
            const isInstalled = installedSet.has(c.id);
            const progress = pulling[c.id];
            return (
              <Card key={c.id} className={c.recommended ? 'border-primary/40' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <span className="truncate">{c.displayName}</span>
                        {c.recommended && (
                          <span className="inline-flex h-4 items-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                            рекомендуется
                          </span>
                        )}
                      </CardTitle>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {c.family} · {c.size} · RAM ~{c.ramRequired}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  <p className="text-xs">{c.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {c.goodFor.map((g) => (
                      <span
                        key={g}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                  {progress ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span>{progress.status}</span>
                        {progress.percent !== undefined && <span>{progress.percent}%</span>}
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${progress.percent ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ) : isInstalled ? (
                    <Button variant="outline" size="sm" disabled className="w-full">
                      <Check /> Установлено
                    </Button>
                  ) : (
                    <Button
                      size="sm"
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
        <AlertDescription className="text-xs">
          Модель не из списка:{' '}
          <code className="rounded bg-muted px-1 text-[11px]">ollama pull имя_модели</code> в
          терминале, затем «Обновить».
        </AlertDescription>
      </Alert>

      <Dialog open={showInfo !== null} onOpenChange={(o) => !o && setShowInfo(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Детали модели: {showInfo?.name}</DialogTitle>
            <DialogDescription>Modelfile, параметры, system prompt, лицензия</DialogDescription>
          </DialogHeader>
          {showInfo && <ModelInfoView info={showInfo.info} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelInfoView({ info }: { info: Record<string, unknown> }) {
  const sections: Array<{ key: string; label: string }> = [
    { key: 'modelfile', label: 'Modelfile' },
    { key: 'parameters', label: 'Parameters' },
    { key: 'template', label: 'Template' },
    { key: 'system', label: 'System prompt' },
    { key: 'license', label: 'License' },
  ];

  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto">
      {sections.map((s) => {
        const v = info[s.key];
        if (!v || typeof v !== 'string') return null;
        return (
          <div key={s.key}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {s.label}
            </div>
            <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-2 text-[11px]">
              {v.trim()}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
