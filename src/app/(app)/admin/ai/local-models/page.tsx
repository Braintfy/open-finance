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
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import AiProvidersPage from '../providers/page';
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
  category:
    | 'chat-tiny'
    | 'chat-light'
    | 'chat-medium'
    | 'chat-heavy'
    | 'code'
    | 'vision'
    | 'embedding';
  description: string;
  goodFor: string[];
  recommended?: boolean;
  vision?: boolean;
  toolCalling?: boolean;
};

const CATEGORY_LABELS: Record<CatalogModel['category'], string> = {
  'chat-tiny': 'Ультра-лёгкие (для слабых машин)',
  'chat-light': 'Лёгкие (быстрые)',
  'chat-medium': 'Средние (баланс)',
  'chat-heavy': 'Тяжёлые (макс. качество)',
  code: 'Для кода',
  vision: 'С распознаванием изображений',
  embedding: 'Embeddings (RAG)',
};

const CATEGORY_ORDER: CatalogModel['category'][] = [
  'chat-tiny',
  'chat-light',
  'chat-medium',
  'chat-heavy',
  'vision',
  'code',
  'embedding',
];

type ApiResponse = {
  ok: boolean;
  ollamaAvailable: boolean;
  installed: Installed[];
  catalog: CatalogModel[];
  defaultModel?: string | null;
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
  const [activeTab, setActiveTab] = useState<'local' | 'providers'>('local');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [running, setRunning] = useState<RunningModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<Record<string, { status: string; percent?: number; error?: boolean }>>({});
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState<{ name: string; info: Record<string, unknown> } | null>(
    null
  );
  const [hfInput, setHfInput] = useState('');
  const [hfPreview, setHfPreview] = useState<{ ollamaTag: string; user: string; repo: string; quantization?: string } | null>(null);
  const [hfError, setHfError] = useState<string | null>(null);

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
    if (new URLSearchParams(window.location.search).get('tab') === 'providers') {
      setActiveTab('providers');
    }
    refresh();
    const iv = setInterval(() => {
      fetch('/api/admin/ai/local-models/ps')
        .then((r) => r.json() as Promise<PsResponse>)
        .then((d) => setRunning(d.running ?? []))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  function switchTab(tab: 'local' | 'providers') {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === 'providers') {
      url.searchParams.set('tab', 'providers');
    } else {
      url.searchParams.delete('tab');
    }
    window.history.replaceState(null, '', url);
  }

  async function pull(modelId: string) {
    setPulling((p) => ({ ...p, [modelId]: { status: 'starting…' } }));
    try {
      const res = await fetch('/api/admin/ai/local-models/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('Пустой ответ от сервера загрузки');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const ev = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
        if (ev.error) throw new Error(ev.error);
        const percent =
          ev.total && ev.completed ? Math.round((ev.completed / ev.total) * 100) : undefined;
        setPulling((p) => ({
          ...p,
          [modelId]: { status: ev.status ?? '', percent },
        }));
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          try {
            handleLine(line);
          } catch (e) {
            throw new Error(e instanceof Error ? e.message : 'Ошибка чтения прогресса Ollama');
          }
        }
      }
      if (buf.trim()) handleLine(buf);
      setPulling((p) => {
        const copy = { ...p };
        delete copy[modelId];
        return copy;
      });
      await refresh();
    } catch (e) {
      setPulling((p) => ({
        ...p,
        [modelId]: { status: e instanceof Error ? e.message : 'Ошибка загрузки', error: true },
      }));
      setTimeout(() => {
        setPulling((p) => {
          const copy = { ...p };
          delete copy[modelId];
          return copy;
        });
      }, 8000);
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

  async function makeDefaultModel(name: string) {
    setSettingDefault(name);
    try {
      const res = await fetch('/api/admin/ai/local-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModel: name }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        alert(json.error ?? 'Не удалось выбрать основную модель');
        return;
      }
      await refresh();
    } finally {
      setSettingDefault(null);
    }
  }

  async function openInfo(name: string) {
    const res = await fetch(`/api/admin/ai/local-models/${encodeURIComponent(name)}/show`);
    const info = await res.json();
    setShowInfo({ name, info });
  }

  async function parseHf() {
    setHfError(null);
    setHfPreview(null);
    if (!hfInput.trim()) return;
    try {
      const res = await fetch('/api/admin/ai/local-models/hf-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: hfInput.trim() }),
      });
      const data = (await res.json()) as
        | { ok: true; ollamaTag: string; user: string; repo: string; quantization?: string }
        | { ok: false; error: string };
      if (!data.ok) {
        setHfError(data.error);
        return;
      }
      setHfPreview({ ollamaTag: data.ollamaTag, user: data.user, repo: data.repo, quantization: data.quantization });
    } catch (e) {
      setHfError(e instanceof Error ? e.message : 'Ошибка проверки');
    }
  }

  const installedSet = new Set((data?.installed ?? []).map((m) => m.name));
  const runningSet = new Set(running.map((m) => m.name));
  const defaultModel = data?.defaultModel ?? null;

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">AI модели</h1>
          <p className="text-xs text-muted-foreground">
            Локальные Ollama-модели, внешние API, VPN-прокси и диагностика
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Обновить
        </Button>
      </div>

      <div className="inline-flex rounded-lg border bg-muted/30 p-1">
        <button
          type="button"
          onClick={() => switchTab('local')}
          className={activeTab === 'local' ? 'rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm' : 'rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground'}
        >
          Локальные модели
        </button>
        <button
          type="button"
          onClick={() => switchTab('providers')}
          className={activeTab === 'providers' ? 'rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm' : 'rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground'}
        >
          Внешние API + VPN
        </button>
      </div>

      {activeTab === 'providers' ? (
        <AiProvidersPage embedded />
      ) : (
        <>

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
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Установленные ({data?.installed.length ?? 0})</span>
          {defaultModel && (
            <span className="normal-case tracking-normal text-primary">Основная: {defaultModel}</span>
          )}
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
                        {defaultModel === m.name && (
                          <span className="inline-flex h-4 items-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                            основная
                          </span>
                        )}
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
                <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-0">
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    <span>Размер: {formatBytes(m.size)}</span>
                    {m.details?.parameter_size && <span>Параметры: {m.details.parameter_size}</span>}
                    {m.details?.quantization_level && <span>Q: {m.details.quantization_level}</span>}
                  </div>
                  <Button
                    variant={defaultModel === m.name ? 'outline' : 'ghost'}
                    size="xs"
                    onClick={() => makeDefaultModel(m.name)}
                    disabled={settingDefault === m.name || defaultModel === m.name}
                  >
                    <Star className={defaultModel === m.name ? 'fill-primary text-primary' : ''} />
                    {defaultModel === m.name ? 'Основная' : 'Сделать основной'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Каталог */}
      {/* Загрузка с HuggingFace */}
      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Download className="h-3 w-3" />
          Загрузить с HuggingFace
        </div>
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-[11px] text-muted-foreground">
              Вставьте ссылку с{' '}
              <a
                href="https://huggingface.co/models?library=gguf&sort=trending"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                huggingface.co
              </a>{' '}
              (только GGUF-репозитории). Пример:{' '}
              <code className="rounded bg-muted px-1 text-[10px]">
                bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M
              </code>
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={hfInput}
                onChange={(e) => {
                  setHfInput(e.target.value);
                  setHfPreview(null);
                  setHfError(null);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') await parseHf();
                }}
                placeholder="huggingface.co/user/repo:Q4_K_M или user/repo"
                className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={!data?.ollamaAvailable}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={parseHf}
                disabled={!hfInput.trim() || !data?.ollamaAvailable}
              >
                Проверить
              </Button>
            </div>
            {hfError && (
              <Alert variant="warning">
                <AlertCircle />
                <AlertDescription className="text-xs">{hfError}</AlertDescription>
              </Alert>
            )}
            {hfPreview && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="text-xs">
                  <div className="text-muted-foreground">Будет загружено как Ollama tag:</div>
                  <code className="font-mono text-sm">{hfPreview.ollamaTag}</code>
                </div>
                <div className="flex gap-3 text-[11px] text-muted-foreground">
                  <span>Автор: {hfPreview.user}</span>
                  <span>Репо: {hfPreview.repo}</span>
                  {hfPreview.quantization && <span>Квантизация: {hfPreview.quantization}</span>}
                </div>
                {pulling[hfPreview.ollamaTag] ? (
                  <div className="space-y-1">
                    <div className={pulling[hfPreview.ollamaTag].error ? 'flex justify-between text-[11px] text-red-600' : 'flex justify-between text-[11px]'}>
                      <span>{pulling[hfPreview.ollamaTag].status}</span>
                      {pulling[hfPreview.ollamaTag].percent !== undefined && (
                        <span>{pulling[hfPreview.ollamaTag].percent}%</span>
                      )}
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${pulling[hfPreview.ollamaTag].percent ?? 0}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <Button size="sm" onClick={() => pull(hfPreview.ollamaTag)}>
                    <Download /> Скачать модель
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Каталог рекомендованных — сгруппированный */}
      {CATEGORY_ORDER.map((cat) => {
        const models = data?.catalog.filter((c) => c.category === cat) ?? [];
        if (models.length === 0) return null;
        return (
          <section key={cat}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABELS[cat]} ({models.length})
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {models.map((c) => {
                const isInstalled = installedSet.has(c.id);
                const progress = pulling[c.id];
                return (
                  <Card key={c.id} className={c.recommended ? 'border-primary/40' : ''}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className="truncate">{c.displayName}</span>
                            {c.recommended && (
                              <span className="inline-flex h-4 items-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                                ★ рекомендуется
                              </span>
                            )}
                            {c.vision && (
                              <span className="inline-flex h-4 items-center rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                                vision
                              </span>
                            )}
                            {c.toolCalling && (
                              <span className="inline-flex h-4 items-center rounded-full bg-emerald-100 px-1.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                                tools
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
                          <div className={progress.error ? 'flex justify-between text-[11px] text-red-600' : 'flex justify-between text-[11px]'}>
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
        );
      })}

      <Alert>
        <AlertDescription className="text-xs">
          Любая модель из ollama.com:{' '}
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
        </>
      )}
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
