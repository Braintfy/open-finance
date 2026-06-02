// PURPOSE: Модалка «Анализ всех блоков» — быстрый прогон: для каждого значимого
// блока раздела запускает /api/ai/analyze-block с дефолтным промптом блока и
// сохраняет отчёт в блок (overwrite самого старого). Показывает прогресс и
// краткое резюме по каждому блоку. Снапшот блоков берётся из page-snapshot.
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Loader2,
  Check,
  X,
  CircleDashed,
  Square,
  ListChecks,
} from 'lucide-react';
import { getPageSnapshot } from '@/lib/blocks/page-snapshot';
import { extractSectionReport, type SectionBlockSnapshot } from '@/lib/ai/section-insights';

type AnalyzeAllBlocksDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageKey: string;
  pageLabel?: string;
};

type ItemStatus = 'pending' | 'running' | 'done' | 'error';

type Item = {
  blockId: string;
  title: string;
  type: string;
  snapshot: SectionBlockSnapshot;
  status: ItemStatus;
  summary?: string;
  insightsCount?: number;
  error?: string;
};

const SKIP_TYPES = new Set(['ai.micro-agent', 'navigate.card']);
const CONCURRENCY = 3;

/** Значимый блок: есть контекст для ИИ / значения / config. */
function isEligible(b: SectionBlockSnapshot): boolean {
  if (SKIP_TYPES.has(b.type)) return false;
  const hasAi = !!(b.aiContext && b.aiContext.trim());
  const hasOutput =
    !!b.output &&
    Object.entries(b.output).some(
      ([k, v]) => !k.startsWith('__') && v !== null && v !== '',
    );
  const hasConfig = !!b.config && Object.keys(b.config).length > 0;
  return hasAi || hasOutput || hasConfig;
}

export function AnalyzeAllBlocksDialog({
  open,
  onOpenChange,
  pageKey,
  pageLabel,
}: AnalyzeAllBlocksDialogProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Собрать список блоков при открытии.
  useEffect(() => {
    if (!open) return;
    const snapshot = getPageSnapshot(pageKey);
    const eligible = snapshot.filter(isEligible);
    setItems(
      eligible.map((b) => ({
        blockId: b.blockId,
        title: b.title,
        type: b.type,
        snapshot: b,
        status: 'pending' as ItemStatus,
      })),
    );
    setRunning(false);
    setDone(false);
  }, [open, pageKey]);

  const updateItem = useCallback((blockId: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.blockId === blockId ? { ...it, ...patch } : it)));
  }, []);

  /** Анализ одного блока + сохранение отчёта. */
  const analyzeOne = useCallback(
    async (item: Item, signal: AbortSignal) => {
      updateItem(item.blockId, { status: 'running', error: undefined });
      try {
        const res = await fetch('/api/ai/analyze-block', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            pageKey,
            blockId: item.blockId,
            blockType: item.type,
            blockTitle: item.title,
            snapshot: item.snapshot,
            includeLastReport: false,
          }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';
        let model: string | null = null;

        while (true) {
          const { done: rdone, value } = await reader.read();
          if (rdone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const evt = JSON.parse(trimmed) as {
                type: string;
                delta?: string;
                content?: string;
                model?: string;
                error?: string;
              };
              if (evt.type === 'start' && evt.model) model = evt.model;
              if (evt.type === 'token' && evt.delta) full += evt.delta;
              if (evt.type === 'done') full = evt.content || full;
              if (evt.type === 'error') throw new Error(evt.error ?? 'AI error');
            } catch {
              /* skip */
            }
          }
        }

        const report = extractSectionReport(full);
        if (!report) throw new Error('Не удалось разобрать ответ ИИ');

        await fetch('/api/ai/block-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageKey,
            blockId: item.blockId,
            blockType: item.type,
            blockTitle: item.title,
            model,
            summary: report.summary,
            insights: report.insights,
            meta: { blocks: 1 },
            overwriteOldest: true,
          }),
        });

        updateItem(item.blockId, {
          status: 'done',
          summary: report.summary,
          insightsCount: report.insights.length,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        updateItem(item.blockId, {
          status: 'error',
          error: e instanceof Error ? e.message : 'Ошибка',
        });
      }
    },
    [pageKey, updateItem],
  );

  const runAll = useCallback(async () => {
    if (running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setDone(false);

    // Пул с ограничением конкуренции.
    const queue = [...items];
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length && !ctrl.signal.aborted) {
        const item = queue[cursor++];
        await analyzeOne(item, ctrl.signal);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    if (!ctrl.signal.aborted) setDone(true);
    setRunning(false);
    abortRef.current = null;
  }, [items, running, analyzeOne]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  function handleClose(v: boolean) {
    if (!v && running) stop();
    onOpenChange(v);
  }

  const doneCount = items.filter((i) => i.status === 'done').length;
  const errorCount = items.filter((i) => i.status === 'error').length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[600px]">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4 text-primary" />
            Анализ всех блоков{pageLabel ? ` · ${pageLabel}` : ''}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Быстрый прогон: каждый блок анализируется со своим дефолтным промптом, отчёт сохраняется в блок.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {items.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              Нет блоков с данными для анализа.
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map((it) => (
                <div
                  key={it.blockId}
                  className="flex items-start gap-2.5 rounded-md border border-border/60 px-2.5 py-2"
                >
                  <span className="mt-0.5 shrink-0">
                    {it.status === 'pending' && <CircleDashed className="h-4 w-4 text-muted-foreground" />}
                    {it.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    {it.status === 'done' && <Check className="h-4 w-4 text-emerald-600" />}
                    {it.status === 'error' && <X className="h-4 w-4 text-destructive" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] font-medium">
                      <span className="truncate">{it.title}</span>
                      {it.insightsCount !== undefined && (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {it.insightsCount} инс.
                        </span>
                      )}
                    </div>
                    {it.status === 'done' && it.summary && (
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                        {it.summary}
                      </div>
                    )}
                    {it.status === 'error' && (
                      <div className="mt-0.5 text-[10px] text-destructive">{it.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {doneCount}/{items.length} готово
            {errorCount > 0 ? ` · ${errorCount} ошибок` : ''}
            {done ? ' · завершено' : ''}
          </span>
          <div className="flex gap-2">
            {running ? (
              <Button size="sm" variant="destructive" onClick={stop}>
                <Square className="h-3.5 w-3.5" /> Стоп
              </Button>
            ) : (
              <Button size="sm" onClick={() => void runAll()} disabled={items.length === 0}>
                <Sparkles className="h-3.5 w-3.5" />
                {done ? 'Запустить снова' : 'Запустить'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
