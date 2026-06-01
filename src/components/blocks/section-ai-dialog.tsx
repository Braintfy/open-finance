// PURPOSE: Диалог «AI Анализ раздела». Собирает снапшот блоков страницы
// (config + live-значения + __aiContext) из page-snapshot store, показывает
// счётчик токенов/символов (js-tiktoken), стримит строгий JSON (summary +
// insights), рендерит резюме + раскрываемые карточки, сохраняет отчёты в БД
// (лимит 10 + перезапись) и позволяет подмешать прошлые отчёты в контекст.
'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Square, RefreshCw, Loader2, Save, Trash2, Hash } from 'lucide-react';
import { InsightCard } from '@/components/unit-economics/ozon-insight-card';
import { renderInlineMd } from '@/components/unit-economics/inline-md';
import { useTokenizer } from '@/lib/ai/tokenizer';
import { getPageSnapshot, subscribePageSnapshot } from '@/lib/blocks/page-snapshot';
import {
  SECTION_TEMPLATES,
  assembleSectionContext,
  extractSectionReport,
  filterSubgraph,
  type SectionBlockSnapshot,
  type SectionInsight,
  type SectionInsightKind,
  type SectionReport,
} from '@/lib/ai/section-insights';

type SectionAiScope = 'all' | 'subgraph';

type SectionAiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageKey: string;
  pageLabel?: string;
};

type StreamEvent =
  | { type: 'start'; model?: string }
  | { type: 'token'; delta: string; total?: number }
  | { type: 'done'; content: string; model?: string }
  | { type: 'error'; error: string }
  | { type: 'aborted' };

type SavedReport = {
  id: string;
  createdAt: string;
  model: string | null;
  summary: string;
  insights: SectionInsight[];
  meta: { tokens?: number; chars?: number; blocks?: number } | null;
};

const KIND_TABS: Array<{ key: 'all' | SectionInsightKind; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'action', label: 'Действие' },
  { key: 'observation', label: 'Наблюдение' },
  { key: 'opportunity', label: 'Возможности' },
  { key: 'info', label: 'Инфо' },
];

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU');
}

export function SectionAiDialog({
  open,
  onOpenChange,
  pageKey,
  pageLabel,
}: SectionAiDialogProps) {
  const [query, setQuery] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [scope, setScope] = useState<SectionAiScope>('all');
  const [streaming, setStreaming] = useState(false);
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<SectionReport | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | SectionInsightKind>('all');

  const [snapshot, setSnapshot] = useState<SectionBlockSnapshot[]>([]);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState<{ oldestAt: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const { count, ready } = useTokenizer();

  // Снапшот блоков страницы — читаем при открытии и держим в синхроне.
  useEffect(() => {
    if (!open) return;
    setSnapshot(getPageSnapshot(pageKey));
    const unsub = subscribePageSnapshot(pageKey, () => setSnapshot(getPageSnapshot(pageKey)));
    return unsub;
  }, [open, pageKey]);

  // Загрузка истории отчётов раздела.
  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/section-reports?pageKey=${encodeURIComponent(pageKey)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { reports?: SavedReport[] };
      setReports(data.reports ?? []);
    } catch {
      /* ignore */
    }
  }, [pageKey]);

  useEffect(() => {
    if (open) void loadReports();
  }, [open, loadReports]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setStreaming(false);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const scopedBlocks = useMemo(
    () => (scope === 'subgraph' ? filterSubgraph(snapshot) : snapshot),
    [scope, snapshot],
  );

  const selectedReports = useMemo(
    () =>
      reports
        .filter((r) => selectedReportIds.has(r.id))
        .map((r) => ({ createdAt: r.createdAt, summary: r.summary, insights: r.insights })),
    [reports, selectedReportIds],
  );

  // Контекст, который реально уйдёт в модель (та же сборка, что на сервере).
  const contextText = useMemo(
    () =>
      assembleSectionContext({
        pageLabel,
        blocks: scopedBlocks,
        reports: selectedReports,
        userQuery: query.trim() || undefined,
      }),
    [pageLabel, scopedBlocks, selectedReports, query],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tokenInfo = useMemo(() => count(contextText), [contextText, ready]);

  const analyze = useCallback(async () => {
    if (streaming) {
      stop();
      return;
    }
    setStreaming(true);
    setRaw('');
    setParsed(null);
    setError(null);
    setModel(null);
    setSaved(false);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/ai/analyze-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageKey,
          pageLabel,
          blocks: scopedBlocks,
          userQuery: query.trim() || undefined,
          includeReportIds: selectedReportIds.size > 0 ? Array.from(selectedReportIds) : undefined,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? `HTTP ${res.status}`);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(trimmed) as StreamEvent;
          } catch {
            continue;
          }
          if (evt.type === 'start' && evt.model) setModel(evt.model);
          if (evt.type === 'token' && evt.delta) {
            full += evt.delta;
            setRaw(full);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
              const el = resultRef.current;
              if (el) el.scrollTop = el.scrollHeight;
              rafRef.current = null;
            });
          }
          if (evt.type === 'done') {
            full = evt.content || full;
            setRaw(full);
            const p = extractSectionReport(full);
            if (p) setParsed(p);
            else setError('Не удалось разобрать ответ ИИ. Попробуйте ещё раз.');
            setStreaming(false);
          }
          if (evt.type === 'error') {
            setError(evt.error);
            setStreaming(false);
          }
          if (evt.type === 'aborted') setStreaming(false);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') setError(e.message);
      setStreaming(false);
    }
  }, [streaming, stop, pageKey, pageLabel, scopedBlocks, query, selectedReportIds]);

  const persist = useCallback(
    async (overwriteOldest: boolean) => {
      if (!parsed) return;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch('/api/ai/section-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageKey,
            pageLabel,
            model,
            summary: parsed.summary,
            insights: parsed.insights,
            meta: { tokens: tokenInfo.tokens, chars: tokenInfo.chars, blocks: scopedBlocks.length },
            overwriteOldest,
          }),
        });
        if (res.status === 409) {
          const data = (await res.json()) as { oldest?: { createdAt?: string } };
          setConfirmOverwrite({ oldestAt: data.oldest?.createdAt ?? '' });
          setSaving(false);
          return;
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error ?? `HTTP ${res.status}`);
          setSaving(false);
          return;
        }
        setSaving(false);
        setSaved(true);
        setConfirmOverwrite(null);
        void loadReports();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка сохранения');
        setSaving(false);
      }
    },
    [parsed, pageKey, pageLabel, model, tokenInfo, scopedBlocks.length, loadReports],
  );

  const deleteReport = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/ai/section-reports/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setReports((prev) => prev.filter((r) => r.id !== id));
          setSelectedReportIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const applyTemplate = useCallback((id: string, prompt: string) => {
    setActiveTemplate(id);
    setQuery(prompt);
  }, []);

  function handleClose(v: boolean) {
    if (!v && streaming) stop();
    onOpenChange(v);
  }

  const visibleInsights = useMemo(() => {
    if (!parsed) return [];
    if (kindFilter === 'all') return parsed.insights;
    return parsed.insights.filter((i) => (i.kind ?? 'info') === kindFilter);
  }, [parsed, kindFilter]);

  const kindTabs = useMemo(() => {
    if (!parsed) return [];
    return KIND_TABS.filter(
      (t) => t.key === 'all' || parsed.insights.some((i) => (i.kind ?? 'info') === t.key),
    ).map((t) => ({
      ...t,
      count:
        t.key === 'all'
          ? parsed.insights.length
          : parsed.insights.filter((i) => (i.kind ?? 'info') === t.key).length,
    }));
  }, [parsed]);

  const sectionTitle = pageLabel ?? pageKey;
  const overBudget = tokenInfo.tokens > 24000;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-[720px]">
          <DialogHeader className="shrink-0 border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Анализ · {sectionTitle}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              ИИ проанализирует содержимое блоков раздела и составит отчёт с инсайтами.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
            {/* Scope + счётчик токенов */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Контекст:</span>
                <div className="flex rounded-md border text-[11px]">
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`px-2.5 py-1 transition-colors ${scope === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Все блоки
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('subgraph')}
                    className={`border-l px-2.5 py-1 transition-colors ${scope === 'subgraph' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Только связанные
                  </button>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums ${overBudget ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-muted text-muted-foreground'}`}
                title="Оценка размера контекста, который уйдёт в модель"
              >
                <Hash className="h-3 w-3" />
                {tokenInfo.exact ? '' : '≈'}
                {tokenInfo.tokens.toLocaleString('ru-RU')} токенов ·{' '}
                {tokenInfo.chars.toLocaleString('ru-RU')} символов · {scopedBlocks.length} бл.
              </span>
            </div>

            {/* Шаблоны */}
            <div className="flex flex-wrap gap-1">
              {SECTION_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id, t.prompt)}
                  disabled={streaming}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${activeTemplate === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Поле ввода */}
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Фокус анализа (необязательно)
              </label>
              <textarea
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveTemplate(null);
                }}
                rows={2}
                placeholder="Что анализировать? Выберите шаблон выше или оставьте пустым для общего анализа…"
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={streaming}
              />
            </div>

            {/* История отчётов раздела + чекбоксы «в контекст» */}
            {reports.length > 0 && (
              <div className="space-y-1 rounded-md border border-border/60 p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Сохранённые отчёты ({reports.length}/10) — отметьте для добавления в контекст
                </div>
                <div className="max-h-[140px] space-y-1 overflow-y-auto overscroll-contain">
                  {reports.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-[11px]">
                      <input
                        type="checkbox"
                        checked={selectedReportIds.has(r.id)}
                        onChange={(e) => {
                          setSelectedReportIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                        className="h-3.5 w-3.5 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {fmtDate(r.createdAt)} · {r.insights.length} инсайтов
                      </span>
                      <button
                        type="button"
                        onClick={() => void deleteReport(r.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title="Удалить отчёт"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            {/* Результат: карточки или сырой стрим */}
            {parsed ? (
              <div className="space-y-2">
                {parsed.summary && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-[12px] leading-relaxed">
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Резюме
                    </div>
                    {renderInlineMd(parsed.summary)}
                  </div>
                )}
                {kindTabs.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {kindTabs.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setKindFilter(t.key)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${kindFilter === t.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                      >
                        {t.label} {t.count}
                      </button>
                    ))}
                  </div>
                )}
                {visibleInsights.map((ins, i) => (
                  <InsightCard key={`${ins.category ?? ''}-${i}`} insight={ins} />
                ))}
              </div>
            ) : (
              (streaming || raw) && (
                <div
                  ref={resultRef}
                  className="max-h-[280px] min-h-[80px] overflow-y-auto overscroll-contain rounded-md border bg-muted/30 p-3 text-[12px] leading-relaxed"
                >
                  <div className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                    {raw}
                    {streaming && (
                      <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-foreground align-middle opacity-70" />
                    )}
                  </div>
                </div>
              )
            )}

            {model && !streaming && (
              <p className="text-[10px] text-muted-foreground">
                Модель: {model}
                {saved ? ' · отчёт сохранён' : ''}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {streaming && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Анализирую…
                </>
              )}
            </span>
            <div className="flex gap-2">
              {parsed && !streaming && (
                <Button size="sm" onClick={() => void persist(false)} disabled={saving || saved}>
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {saved ? 'Сохранено' : 'Сохранить отчёт'}
                </Button>
              )}
              <Button
                size="sm"
                variant={streaming ? 'destructive' : 'default'}
                onClick={analyze}
                disabled={saving}
              >
                {streaming ? (
                  <>
                    <Square className="h-3.5 w-3.5" /> Стоп
                  </>
                ) : (
                  <>
                    {parsed || raw ? (
                      <RefreshCw className="h-3.5 w-3.5" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {parsed || raw ? 'Заново' : 'Анализировать'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmOverwrite !== null}
        onOpenChange={(v) => !v && setConfirmOverwrite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Уже 10 отчётов</AlertDialogTitle>
            <AlertDialogDescription>
              Достигнут лимит истории (10 на раздел). Перезаписать самый старый отчёт
              {confirmOverwrite?.oldestAt ? ` от ${fmtDate(confirmOverwrite.oldestAt)}` : ''}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void persist(true)} disabled={saving}>
              {saving ? 'Сохраняю…' : 'Перезаписать старый'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
