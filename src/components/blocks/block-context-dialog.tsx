// PURPOSE: Мини-модалка выбора контекста для «AI Анализ блока». Дерево блоков
// всего проекта (текущий раздел + другие): для каждого блока — последний ИИ-отчёт
// или его данные, превью токенов и Switch. Умный режим: есть отчёт блока →
// подмешиваем отчёт, иначе данные/config блока. Live-значения доступны только для
// блоков текущего раздела (берутся из page-snapshot), другие — резолв из БД.
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
  type BlockContextBlockDto,
  type BlockContextSelection,
  type BlockContextSourceDto,
  type ExternalSourceContext,
  type SectionBlockSnapshot,
} from '@/lib/ai/section-insights';

type BlockContextDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: BlockContextSourceDto[];
  /** Live-снапшот блоков текущего раздела (для превью токенов и тела). */
  liveBlocks: SectionBlockSnapshot[];
  /** Целевой блок — исключается из пикера. */
  currentBlockId: string;
  loading: boolean;
  error: string | null;
  selected: BlockContextSelection[];
  onChange: (next: BlockContextSelection[]) => void;
};

/** Умный режим: есть отчёт блока → report, иначе data. */
function resolveBlockMode(b: BlockContextBlockDto): 'report' | 'data' {
  return b.lastReport ? 'report' : 'data';
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
}

export function BlockContextDialog({
  open,
  onOpenChange,
  sources,
  liveBlocks,
  currentBlockId,
  loading,
  error,
  selected,
  onChange,
}: BlockContextDialogProps) {
  const { count } = useTokenizer();

  const liveMap = useMemo(
    () => new Map(liveBlocks.map((b) => [b.blockId, b])),
    [liveBlocks],
  );

  const selectedKeys = useMemo(
    () => new Set(selected.map((s) => `${s.pageKey}::${s.blockId}`)),
    [selected],
  );

  /** Собрать ExternalSourceContext для блока (или null). */
  const blockToContext = useCallback(
    (
      source: BlockContextSourceDto,
      b: BlockContextBlockDto,
    ): ExternalSourceContext | null => {
      const mode = resolveBlockMode(b);
      const label = `${source.label} · ${b.title}`;
      if (mode === 'report') {
        if (!b.lastReport) return null;
        return {
          label,
          mode: 'report',
          report: {
            createdAt: b.lastReport.createdAt,
            summary: b.lastReport.summary,
            insights: b.lastReport.insights,
          },
        };
      }
      // data: live для текущего раздела, иначе config из DTO.
      const snapshot: SectionBlockSnapshot | undefined = source.isCurrent
        ? liveMap.get(b.blockId)
        : { blockId: b.blockId, type: b.type, title: b.title, config: b.config };
      if (!snapshot) return null;
      return { label, mode: 'blocks', blocks: [snapshot] };
    },
    [liveMap],
  );

  // Превью токенов на блок (ключ pageKey::blockId).
  const perBlockTokens = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sources) {
      for (const b of s.blocks) {
        const ctx = blockToContext(s, b);
        if (!ctx) continue;
        map.set(`${s.pageKey}::${b.blockId}`, count(buildExternalSourcesContext([ctx])).tokens);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, blockToContext]);

  const selectedTotals = useMemo(() => {
    const ctxs: ExternalSourceContext[] = [];
    for (const s of sources) {
      for (const b of s.blocks) {
        if (!selectedKeys.has(`${s.pageKey}::${b.blockId}`)) continue;
        const ctx = blockToContext(s, b);
        if (ctx) ctxs.push(ctx);
      }
    }
    if (ctxs.length === 0) return { tokens: 0, chars: 0 };
    const t = count(buildExternalSourcesContext(ctxs));
    return { tokens: t.tokens, chars: t.chars };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, selectedKeys, blockToContext]);

  const toggle = useCallback(
    (source: BlockContextSourceDto, b: BlockContextBlockDto, on: boolean) => {
      const mode = resolveBlockMode(b);
      const next = selected.filter(
        (x) => !(x.pageKey === source.pageKey && x.blockId === b.blockId),
      );
      if (on) next.push({ pageKey: source.pageKey, blockId: b.blockId, mode });
      onChange(next);
    },
    [selected, onChange],
  );

  // Источники с отфильтрованными блоками (исключаем целевой блок).
  const visibleSources = useMemo(
    () =>
      sources
        .map((s) => ({
          ...s,
          blocks: s.blocks.filter((b) => b.blockId !== currentBlockId),
        }))
        .filter((s) => s.blocks.length > 0),
    [sources, currentBlockId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-[580px]">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-primary" />
            Контекст из блоков
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Подмешать в анализ другие блоки проекта: есть ИИ-отчёт блока — берём его, иначе его данные.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка блоков…
            </div>
          ) : error ? (
            <div className="py-10 text-center text-[12px] text-destructive">{error}</div>
          ) : visibleSources.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              Нет других блоков для контекста.
            </div>
          ) : (
            <div className="space-y-3">
              {visibleSources.map((s) => (
                <div key={s.pageKey} className="space-y-1.5">
                  <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.label}
                    {s.isCurrent && (
                      <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-normal normal-case">
                        текущий
                      </span>
                    )}
                  </div>
                  {s.blocks.map((b) => {
                    const mode = resolveBlockMode(b);
                    const ctx = blockToContext(s, b);
                    const disabled = ctx === null;
                    const key = `${s.pageKey}::${b.blockId}`;
                    const on = selectedKeys.has(key);
                    const tokens = perBlockTokens.get(key);
                    const sub =
                      mode === 'report' && b.lastReport
                        ? `Отчёт от ${fmtDate(b.lastReport.createdAt)} · ${b.lastReport.insights.length} инсайтов`
                        : `Данные блока (${b.type})`;
                    return (
                      <div
                        key={b.blockId}
                        className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 ${disabled ? 'opacity-50' : 'border-border/60'}`}
                      >
                        {mode === 'report' ? (
                          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                        ) : (
                          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-medium">{b.title}</div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {sub}
                            {tokens !== undefined && !disabled && (
                              <span className="ml-1 tabular-nums">
                                · ~{tokens.toLocaleString('ru-RU')} т.
                              </span>
                            )}
                          </div>
                        </div>
                        <Switch
                          checked={on}
                          disabled={disabled}
                          onCheckedChange={(v) => toggle(s, b, v)}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
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

        {!loading && !error && visibleSources.length > 0 && (
          <div className="flex items-start gap-1.5 border-t px-4 py-2 text-[10px] text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" />
            Блоки других разделов подмешиваются по их последнему ИИ-отчёту или структуре данных из БД.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
