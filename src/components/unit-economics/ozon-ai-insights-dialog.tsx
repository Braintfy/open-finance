// PURPOSE: Модалка «ИИ Анализ» для блока Ozon · AI инсайты. Стримит анализ
// (NDJSON), парсит строгий JSON (summary + insights), показывает превью и
// сохраняет отчёт в БД. При лимите 10 — AlertDialog с подтверждением
// перезаписи самого старого отчёта.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Square, RefreshCw, Loader2, Save } from 'lucide-react';
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
import { InsightCard } from '@/components/unit-economics/ozon-insight-card';
import { renderInlineMd } from '@/components/unit-economics/inline-md';
import {
  parseAiInsightsReport,
  type ParsedAiReport,
} from '@/lib/blocks/catalog/unit-ozon-ai-insights-types';

type StreamEvent =
  | { type: 'start'; model?: string }
  | { type: 'token'; delta: string; total?: number }
  | { type: 'done'; content: string; model?: string }
  | { type: 'error'; error: string }
  | { type: 'aborted' };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: string;
  accountId: string | null;
  periodKey: string | null;
  periodLabel?: string;
  /** Готовый markdown-контекст для ИИ (KPI + аналитика + авто-инсайты). */
  buildContext: () => string;
  /** Вызывается после успешного сохранения отчёта — блок рефетчит историю. */
  onSaved: () => void;
};

export function OzonAiInsightsDialog({
  open,
  onOpenChange,
  blockId,
  accountId,
  periodKey,
  periodLabel,
  buildContext,
  onSaved,
}: Props) {
  const [query, setQuery] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedAiReport | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState<{ oldestAt: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setStreaming(false);
  }, []);

  // Очистка отложенного кадра авто-скролла при размонтировании.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/marketplaces/ozon/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: buildContext(),
          userQuery: query.trim() || undefined,
          periodLabel,
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
            // Один отложенный кадр авто-скролла за раз — без дёрганья layout.
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
            const p = parseAiInsightsReport(full);
            if (p) setParsed(p);
            else setError('Не удалось разобрать ответ ИИ. Попробуйте ещё раз.');
            setStreaming(false);
          }
          if (evt.type === 'error') {
            setError(evt.error);
            setStreaming(false);
          }
          if (evt.type === 'aborted') {
            setStreaming(false);
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') setError(e.message);
      setStreaming(false);
    }
  }, [streaming, stop, buildContext, query, periodLabel]);

  const persist = useCallback(
    async (overwriteOldest: boolean) => {
      if (!parsed) return;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch('/api/marketplaces/ozon/ai-insights/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blockId,
            accountId,
            periodKey,
            model,
            summary: parsed.summary,
            insights: parsed.insights,
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
        setConfirmOverwrite(null);
        onSaved();
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка сохранения');
        setSaving(false);
      }
    },
    [parsed, blockId, accountId, periodKey, model, onSaved, onOpenChange],
  );

  function handleClose(v: boolean) {
    if (!v && streaming) stop();
    onOpenChange(v);
  }

  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="shrink-0 border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              ИИ Анализ Ozon
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              ИИ проанализирует метрики и аналитику за период и составит отчёт с инсайтами.
              {periodLabel ? ` Период: ${periodLabel}.` : ''}
            </DialogDescription>
          </DialogHeader>

          {/* transform:translateZ(0) — собственный GPU-слой: без него внутренний
              скролл внутри fixed+translate(-50%) Radix-диалога даёт repaint-flash
              контента при прокрутке на macOS (Chromium/WebKit). */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 [transform:translateZ(0)]">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Фокус анализа (необязательно)
              </label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                rows={2}
                placeholder="На чём сделать акцент? Например: «почему растёт ДРР» или оставьте пустым…"
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={streaming}
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            {/* Превью результата: распарсенные карточки или стриминговый сырой текст */}
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
                {parsed.insights.map((ins, i) => (
                  <InsightCard key={i} insight={ins} />
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
              <p className="text-[10px] text-muted-foreground">Модель: {model}</p>
            )}
          </div>

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
                <Button size="sm" onClick={() => void persist(false)} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Сохранить отчёт
                </Button>
              )}
              <Button
                size="sm"
                variant={streaming ? 'destructive' : 'outline'}
                onClick={analyze}
                disabled={saving}
              >
                {streaming ? (
                  <>
                    <Square className="h-3.5 w-3.5" /> Стоп
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" /> {parsed || raw ? 'Заново' : 'Анализировать'}
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
