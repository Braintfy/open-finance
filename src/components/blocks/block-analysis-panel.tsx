// PURPOSE: Панель «Анализ» внутри модалки блока (ИИ Микроагент). Точечный анализ
// одного блока: собирает live-снапшот блока из page-snapshot, считает токены
// (js-tiktoken), стримит строгий JSON (summary + insights) через /api/ai/analyze-block,
// рендерит резюме + карточки, сохраняет отчёты в БД (лимит 10) и позволяет
// подмешать в контекст другие блоки проекта + прошлый отчёт самого блока.
'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
import {
  Sparkles,
  Square,
  RefreshCw,
  Loader2,
  Save,
  Trash2,
  Hash,
  Layers,
  History,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { InsightCard } from '@/components/unit-economics/ozon-insight-card';
import { renderInlineMd } from '@/components/unit-economics/inline-md';
import { useTokenizer } from '@/lib/ai/tokenizer';
import { getPageSnapshot, subscribePageSnapshot } from '@/lib/blocks/page-snapshot';
import { BlockContextDialog } from './block-context-dialog';
import {
  BLOCK_ANALYSIS_TEMPLATES,
  assembleBlockContext,
  extractSectionReport,
  type BlockContextSelection,
  type BlockContextSourceDto,
  type ExternalSourceContext,
  type SectionBlockSnapshot,
  type SectionInsight,
  type SectionInsightKind,
  type SectionReport,
} from '@/lib/ai/section-insights';

type BlockAnalysisPanelProps = {
  open: boolean;
  pageKey: string;
  blockId: string;
  blockType?: string;
  blockTitle?: string;
  /** Fallback config, если блок не публикует снапшот в page-snapshot. */
  blockData?: Record<string, unknown>;
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

function ReportBody({ report }: { report: { summary: string; insights: SectionInsight[] } }) {
  return (
    <>
      {report.summary && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] leading-relaxed">
          {renderInlineMd(report.summary)}
        </div>
      )}
      {report.insights.map((ins, i) => (
        <InsightCard key={`${ins.category ?? ''}-${i}`} insight={ins} />
      ))}
    </>
  );
}

export function BlockAnalysisPanel({
  open,
  pageKey,
  blockId,
  blockType,
  blockTitle,
  blockData,
}: BlockAnalysisPanelProps) {
  const [query, setQuery] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<SectionReport | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | SectionInsightKind>('all');

  const [pageBlocks, setPageBlocks] = useState<SectionBlockSnapshot[]>([]);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [openReports, setOpenReports] = useState<Set<string>>(new Set());
  const [includeLastReport, setIncludeLastReport] = useState(true);

  // Контекст из других блоков (мини-модалка).
  const [selections, setSelections] = useState<BlockContextSelection[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextSources, setContextSources] = useState<BlockContextSourceDto[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState<{ oldestAt: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const { count, ready } = useTokenizer();

  // Снапшот блоков страницы (для целевого блока + live-контекста).
  useEffect(() => {
    if (!open) return;
    setPageBlocks(getPageSnapshot(pageKey));
    const unsub = subscribePageSnapshot(pageKey, () => setPageBlocks(getPageSnapshot(pageKey)));
    return unsub;
  }, [open, pageKey]);

  // Целевой блок: из снапшота или fallback на config.
  const targetSnapshot = useMemo<SectionBlockSnapshot>(() => {
    const found = pageBlocks.find((b) => b.blockId === blockId);
    if (found) return found;
    return {
      blockId,
      type: blockType ?? 'unknown',
      title: blockTitle ?? blockType ?? 'Блок',
      config: blockData,
    };
  }, [pageBlocks, blockId, blockType, blockTitle, blockData]);

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/ai/block-reports?pageKey=${encodeURIComponent(pageKey)}&blockId=${encodeURIComponent(blockId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { reports?: SavedReport[] };
      setReports(data.reports ?? []);
    } catch {
      /* ignore */
    }
  }, [pageKey, blockId]);

  useEffect(() => {
    if (open) void loadReports();
  }, [open, loadReports]);

  useEffect(() => {
    if (reports.length > 0) {
      setOpenReports((prev) => (prev.size === 0 ? new Set([reports[0].id]) : prev));
    }
  }, [reports]);

  // Дерево блоков проекта для пикера контекста.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setContextLoading(true);
    setContextError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/ai/block-context-sources?pageKey=${encodeURIComponent(pageKey)}`);
        const data = (await res.json()) as {
          ok?: boolean;
          sources?: BlockContextSourceDto[];
          error?: string;
        };
        if (!active) return;
        if (!res.ok || !data.ok) {
          setContextError(data.error ?? `HTTP ${res.status}`);
          setContextSources([]);
        } else {
          setContextSources(data.sources ?? []);
        }
      } catch (e) {
        if (active) setContextError(e instanceof Error ? e.message : 'Ошибка загрузки');
      } finally {
        if (active) setContextLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, pageKey]);

  // Сброс результата при смене блока / переоткрытии.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setStreaming(false);
    }
  }, [open]);

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

  const liveMap = useMemo(
    () => new Map(pageBlocks.map((b) => [b.blockId, b])),
    [pageBlocks],
  );

  // Индекс блоков-источников по ключу pageKey::blockId.
  const sourceIndex = useMemo(() => {
    const map = new Map<
      string,
      { source: BlockContextSourceDto; block: BlockContextSourceDto['blocks'][number] }
    >();
    for (const s of contextSources) {
      for (const b of s.blocks) map.set(`${s.pageKey}::${b.blockId}`, { source: s, block: b });
    }
    return map;
  }, [contextSources]);

  /** ExternalSourceContext[] из выбранных блоков (для счётчика и отображения). */
  const extraBlocks = useMemo<ExternalSourceContext[]>(() => {
    const out: ExternalSourceContext[] = [];
    for (const sel of selections) {
      const entry = sourceIndex.get(`${sel.pageKey}::${sel.blockId}`);
      if (!entry) continue;
      const { source, block } = entry;
      if (sel.mode === 'report' && block.lastReport) {
        out.push({
          label: `${source.label} · ${block.title}`,
          mode: 'report',
          report: {
            createdAt: block.lastReport.createdAt,
            summary: block.lastReport.summary,
            insights: block.lastReport.insights,
          },
        });
      } else {
        const snap: SectionBlockSnapshot | undefined = source.isCurrent
          ? liveMap.get(block.blockId)
          : { blockId: block.blockId, type: block.type, title: block.title, config: block.config };
        if (snap) out.push({ label: `${source.label} · ${block.title}`, mode: 'blocks', blocks: [snap] });
      }
    }
    return out;
  }, [selections, sourceIndex, liveMap]);

  const lastReportForContext = useMemo(
    () =>
      includeLastReport && reports[0]
        ? {
            createdAt: reports[0].createdAt,
            summary: reports[0].summary,
            insights: reports[0].insights,
          }
        : null,
    [includeLastReport, reports],
  );

  const contextText = useMemo(
    () =>
      assembleBlockContext({
        snapshot: targetSnapshot,
        lastReport: lastReportForContext,
        extraBlocks,
        userQuery: query.trim() || undefined,
      }),
    [targetSnapshot, lastReportForContext, extraBlocks, query],
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

    // Разделяем выбор: live-блоки текущего раздела vs ref-ы других разделов.
    const liveContextBlocks: SectionBlockSnapshot[] = [];
    const externalBlocks: BlockContextSelection[] = [];
    for (const sel of selections) {
      const entry = sourceIndex.get(`${sel.pageKey}::${sel.blockId}`);
      if (!entry) continue;
      if (entry.source.isCurrent && sel.mode === 'data') {
        const snap = liveMap.get(sel.blockId);
        if (snap) liveContextBlocks.push(snap);
      } else {
        externalBlocks.push(sel);
      }
    }

    try {
      const res = await fetch('/api/ai/analyze-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageKey,
          blockId,
          blockType,
          blockTitle: targetSnapshot.title,
          snapshot: targetSnapshot,
          userQuery: query.trim() || undefined,
          liveContextBlocks: liveContextBlocks.length > 0 ? liveContextBlocks : undefined,
          externalBlocks: externalBlocks.length > 0 ? externalBlocks : undefined,
          includeLastReport,
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
  }, [
    streaming,
    stop,
    pageKey,
    blockId,
    blockType,
    targetSnapshot,
    query,
    selections,
    sourceIndex,
    liveMap,
    includeLastReport,
  ]);

  const persist = useCallback(
    async (overwriteOldest: boolean) => {
      if (!parsed) return;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch('/api/ai/block-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageKey,
            blockId,
            blockType: blockType ?? null,
            blockTitle: targetSnapshot.title,
            model,
            summary: parsed.summary,
            insights: parsed.insights,
            meta: { tokens: tokenInfo.tokens, chars: tokenInfo.chars },
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
    [parsed, pageKey, blockId, blockType, targetSnapshot, model, tokenInfo, loadReports],
  );

  const deleteReport = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/ai/block-reports/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setReports((prev) => prev.filter((r) => r.id !== id));
        setOpenReports((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleReportOpen = useCallback((id: string) => {
    setOpenReports((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const applyTemplate = useCallback((id: string, prompt: string) => {
    setActiveTemplate(id);
    setQuery(prompt);
  }, []);

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

  const overBudget = tokenInfo.tokens > 20000;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        {/* Контекст + счётчик токенов */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setContextOpen(true)}
              className="gap-1.5"
            >
              <Layers className="h-3.5 w-3.5" />
              Контекст
              {selections.length > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums">
                  {selections.length}
                </span>
              )}
            </Button>
            {reports.length > 0 && (
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Switch checked={includeLastReport} onCheckedChange={setIncludeLastReport} />
                Прошлый отчёт
              </label>
            )}
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums ${overBudget ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-muted text-muted-foreground'}`}
            title="Оценка размера контекста, который уйдёт в модель"
          >
            <Hash className="h-3 w-3" />
            {tokenInfo.exact ? '' : '≈'}
            {tokenInfo.tokens.toLocaleString('ru-RU')} токенов ·{' '}
            {tokenInfo.chars.toLocaleString('ru-RU')} символов
            {selections.length > 0 ? ` +${selections.length} бл.` : ''}
          </span>
        </div>

        {/* Шаблоны */}
        <div className="flex flex-wrap gap-1">
          {BLOCK_ANALYSIS_TEMPLATES.map((t) => (
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
            placeholder="Что проанализировать в блоке? Выберите шаблон выше или оставьте пустым…"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={streaming}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Результат */}
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
              className="max-h-[260px] min-h-[80px] overflow-y-auto overscroll-contain rounded-md border bg-muted/30 p-3 text-[12px] leading-relaxed"
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

        {/* История отчётов блока */}
        {reports.length > 0 && (
          <div className="rounded-md border border-border/60">
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left"
            >
              {historyOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                ИИ-отчёты блока
              </span>
              <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {reports.length}
              </span>
            </button>
            {historyOpen && (
              <div className="space-y-1 border-t border-border/60 p-2">
                {reports.map((r) => {
                  const rOpen = openReports.has(r.id);
                  return (
                    <div key={r.id} className="rounded-md border border-border/50">
                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleReportOpen(r.id)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          {rOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate text-[11px] font-medium">{fmtDate(r.createdAt)}</span>
                          {r.model && (
                            <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">
                              {r.model}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                            {r.insights.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteReport(r.id)}
                          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title="Удалить отчёт"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {rOpen && (
                        <div className="space-y-2 border-t border-border/50 p-2">
                          <ReportBody report={r} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
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
                {parsed || raw ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                {parsed || raw ? 'Заново' : 'Анализировать'}
              </>
            )}
          </Button>
        </div>
      </div>

      <BlockContextDialog
        open={contextOpen}
        onOpenChange={setContextOpen}
        sources={contextSources}
        liveBlocks={pageBlocks}
        currentBlockId={blockId}
        loading={contextLoading}
        error={contextError}
        selected={selections}
        onChange={setSelections}
      />

      <AlertDialog
        open={confirmOverwrite !== null}
        onOpenChange={(v) => !v && setConfirmOverwrite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Уже 10 отчётов</AlertDialogTitle>
            <AlertDialogDescription>
              Достигнут лимит истории (10 на блок). Перезаписать самый старый отчёт
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
