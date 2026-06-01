// PURPOSE: Мини-модалка выбора кросс-раздельного контекста для «AI Анализ раздела».
// Показывает список разделов пользователя (текущий + другие): для каждого — config
// блоков и/или последний ИИ-отчёт, превью токенов/символов и Switch для включения
// в контекст. Умный режим: есть отчёт → подмешиваем отчёт, иначе config блоков.
'use client';

import { useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Sparkles, Layers, Loader2, Hash, Info } from 'lucide-react';
import { useTokenizer } from '@/lib/ai/tokenizer';
import {
  buildExternalSourcesContext,
  type ExternalSourceContext,
  type ExternalSourceSelection,
  type SectionContextSourceDto,
} from '@/lib/ai/section-insights';

type SectionContextDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: SectionContextSourceDto[];
  loading: boolean;
  error: string | null;
  selected: ExternalSourceSelection[];
  onChange: (next: ExternalSourceSelection[]) => void;
};

/** Умный режим источника: текущий раздел / есть отчёт → report; иначе blocks. */
function resolveMode(s: SectionContextSourceDto): 'report' | 'blocks' {
  if (s.isCurrent) return 'report';
  return s.lastReport ? 'report' : 'blocks';
}

/** Собрать контекст одного источника (или null, если включать нечего). */
function sourceToContext(s: SectionContextSourceDto): ExternalSourceContext | null {
  const mode = resolveMode(s);
  if (mode === 'report') {
    if (!s.lastReport) return null;
    return {
      label: s.label,
      mode: 'report',
      report: {
        createdAt: s.lastReport.createdAt,
        summary: s.lastReport.summary,
        insights: s.lastReport.insights,
      },
    };
  }
  if (s.blocks.length === 0) return null;
  return { label: s.label, mode: 'blocks', blocks: s.blocks };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
}

export function SectionContextDialog({
  open,
  onOpenChange,
  sources,
  loading,
  error,
  selected,
  onChange,
}: SectionContextDialogProps) {
  const { count } = useTokenizer();

  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.pageKey)), [selected]);

  // Превью токенов на источник.
  const perSourceTokens = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sources) {
      const ctx = sourceToContext(s);
      if (!ctx) continue;
      map.set(s.pageKey, count(buildExternalSourcesContext([ctx])).tokens);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  // Итог по выбранным.
  const selectedTotals = useMemo(() => {
    const ctxs: ExternalSourceContext[] = [];
    for (const s of sources) {
      if (!selectedKeys.has(s.pageKey)) continue;
      const ctx = sourceToContext(s);
      if (ctx) ctxs.push(ctx);
    }
    if (ctxs.length === 0) return { tokens: 0, chars: 0 };
    const t = count(buildExternalSourcesContext(ctxs));
    return { tokens: t.tokens, chars: t.chars };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, selectedKeys]);

  const toggle = useCallback(
    (s: SectionContextSourceDto, on: boolean) => {
      const mode = resolveMode(s);
      const next = selected.filter((x) => x.pageKey !== s.pageKey);
      if (on) next.push({ pageKey: s.pageKey, mode });
      onChange(next);
    },
    [selected, onChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-primary" />
            Контекст из разделов
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Подмешать в анализ данные других разделов: есть ИИ-отчёт — берём его, иначе блоки раздела.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка разделов…
            </div>
          ) : error ? (
            <div className="py-10 text-center text-[12px] text-destructive">{error}</div>
          ) : sources.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              Нет доступных разделов-источников.
            </div>
          ) : (
            <div className="space-y-1.5">
              {sources.map((s) => {
                const mode = resolveMode(s);
                const ctx = sourceToContext(s);
                const disabled = ctx === null;
                const on = selectedKeys.has(s.pageKey);
                const tokens = perSourceTokens.get(s.pageKey);
                const sub =
                  mode === 'report'
                    ? s.lastReport
                      ? `Отчёт от ${fmtDate(s.lastReport.createdAt)} · ${s.lastReport.insights.length} инсайтов`
                      : 'Нет сохранённого отчёта'
                    : `${s.blocks.length} блоков (без отчёта)`;
                return (
                  <div
                    key={s.pageKey}
                    className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 ${disabled ? 'opacity-50' : 'border-border/60'}`}
                  >
                    {mode === 'report' ? (
                      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-[12px] font-medium">
                        {s.label}
                        {s.isCurrent && (
                          <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-normal text-muted-foreground">
                            текущий
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {sub}
                        {tokens !== undefined && !disabled && (
                          <span className="ml-1 tabular-nums">· ~{tokens.toLocaleString('ru-RU')} т.</span>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={on}
                      disabled={disabled}
                      onCheckedChange={(v) => toggle(s, v)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <Hash className="h-3 w-3" />
            {selected.length} выбрано · ~{selectedTotals.tokens.toLocaleString('ru-RU')} токенов ·{' '}
            {selectedTotals.chars.toLocaleString('ru-RU')} симв.
          </span>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </div>

        {!loading && !error && sources.length > 0 && (
          <div className="flex items-start gap-1.5 border-t px-4 py-2 text-[10px] text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" />
            Live-значения блоков доступны только для текущего раздела. Другие разделы
            подмешиваются по их последнему ИИ-отчёту (или структуре блоков).
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
