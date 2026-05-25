// PURPOSE: UI для выбора блоков-источников в «Связи» tab настроек блоков.
// Используется для Агрегации (sum/avg/formula/AI) и Таблицы (sheet).
// Переписан на SourceBlockPicker — лейблы вместо UUID, period-badge, collapsible cells.
'use client';

import { ArrowRight, Link2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAvailableBlockSources } from '@/lib/blocks/values';
import type { BlockRef, BlockDependencies, BlockInstance } from '@/lib/blocks/types';
import { buildDependencyGraph, wouldCreateCycle, findCyclicBlocks } from '@/lib/blocks/graph';
import { useMemo, useState } from 'react';
import { SourceBlockPicker, useAllBlockValues } from './settings/source-block-picker';
import { sourceFieldLabel } from './settings/source-field-label';
import type { SourceBlock, SourceField } from './settings/types';
import { useFormatSettings } from '@/lib/format-settings';

type Props = {
  /** Текущие зависимости (могут быть undefined) */
  value: BlockDependencies | undefined;
  config?: Record<string, unknown>;
  /** ID блока, который НЕ должен быть в списке источников */
  selfBlockId?: string;
  /** Все блоки на текущей странице — для cycle detection */
  allBlocks?: BlockInstance[];
  /** Map blockId → human label */
  blockLabels?: Record<string, string>;
  onChange: (deps: BlockDependencies) => void;
};

const AGGREGATIONS: Array<{
  value: BlockDependencies['aggregation'];
  label: string;
  hint: string;
}> = [
  { value: 'sum', label: 'Сумма', hint: 'Складывает значения всех источников' },
  { value: 'avg', label: 'Среднее', hint: 'Среднее арифметическое' },
  { value: 'min', label: 'Минимум', hint: 'Наименьшее из значений' },
  { value: 'max', label: 'Максимум', hint: 'Наибольшее из значений' },
  { value: 'count', label: 'Количество', hint: 'Сколько источников имеют значение' },
  {
    value: 'median',
    label: 'Медиана',
    hint: 'Центральное значение в отсортированном массиве',
  },
  {
    value: 'variance',
    label: 'Дисперсия',
    hint: 'Меру разброса значений вокруг среднего',
  },
  { value: 'first', label: 'Первое', hint: 'Первый не-null источник по порядку' },
  { value: 'last', label: 'Последнее', hint: 'Последний не-null источник по порядку' },
  {
    value: 'formula',
    label: 'Формула',
    hint: 'Произвольная формула (a, b, c, ... = источники)',
  },
  { value: 'ai', label: 'AI-агент', hint: 'AI-микроагент собирает данные (планируется)' },
];

export function BlockReferencePicker({
  value,
  config,
  selfBlockId,
  allBlocks,
  blockLabels,
  onChange,
}: Props) {
  const available = useAvailableBlockSources();
  const liveValues = useAllBlockValues();
  const { settings: globalSettings } = useFormatSettings();
  const [pickerOpen, setPickerOpen] = useState(false);

  const sources: BlockRef[] = value?.sources ?? [];
  const aggregation: BlockDependencies['aggregation'] = value?.aggregation ?? 'sum';

  const graph = useMemo(
    () =>
      allBlocks ? buildDependencyGraph(allBlocks) : new Map<string, Set<string>>(),
    [allBlocks],
  );
  const cyclicBlocks = useMemo(() => findCyclicBlocks(graph), [graph]);
  const formulaLinks = useMemo(() => collectFormulaLinks(config), [config]);

  const excludeIds = useMemo(
    () => (selfBlockId ? new Set([selfBlockId]) : undefined),
    [selfBlockId],
  );
  const alreadyAdded = useMemo(
    () => sources.map((s) => ({ blockId: s.blockId, field: s.field ?? 'value' })),
    [sources],
  );
  const cycleIds = useMemo(() => {
    if (!selfBlockId) return cyclicBlocks;
    const s = new Set(cyclicBlocks);
    // Also add any block that would create a direct cycle with selfBlockId
    for (const cand of available) {
      if (wouldCreateCycle(graph, selfBlockId, cand.blockId)) s.add(cand.blockId);
    }
    return s;
  }, [available, cyclicBlocks, graph, selfBlockId]);

  function addSource(block: SourceBlock, field: SourceField) {
    if (selfBlockId && wouldCreateCycle(graph, selfBlockId, block.blockId)) return;
    const fieldName = field.name;
    if (sources.some((s) => s.blockId === block.blockId && (s.field ?? 'value') === fieldName)) return;
    const next: BlockDependencies = {
      sources: [
        ...sources,
        {
          blockId: block.blockId,
          field: fieldName,
          // Save human label for display when block isn't live (cross-page)
          label: block.label,
        },
      ],
      aggregation,
    };
    onChange(next);
    setPickerOpen(false);
  }

  function removeSource(blockId: string, field: string) {
    onChange({
      sources: sources.filter(
        (s) => !(s.blockId === blockId && (s.field ?? 'value') === field),
      ),
      aggregation,
    });
  }

  function changeAggregation(agg: BlockDependencies['aggregation']) {
    onChange({ sources, aggregation: agg });
  }

  return (
    <div className="space-y-4">
      {/* Тип вычисления */}
      <div className="space-y-1.5">
        <Label>Тип вычисления</Label>
        <div className="flex flex-wrap gap-1">
          {AGGREGATIONS.map((a) => (
            <Button
              key={a.value}
              type="button"
              size="sm"
              variant={aggregation === a.value ? 'default' : 'outline'}
              onClick={() => changeAggregation(a.value)}
              title={a.hint}
              disabled={a.value === 'ai'}
              className="h-7"
            >
              {a.label}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {AGGREGATIONS.find((a) => a.value === aggregation)?.hint}
        </p>
      </div>

      {/* Связи */}
      <div className="space-y-1.5">
        <Label>Связи ({sources.length + formulaLinks.length})</Label>

        {/* Formula links (from cells using @-refs) */}
        {formulaLinks.length > 0 && (
          <div className="space-y-1">
            {formulaLinks.map((link) => {
              const described = describeFormulaRef(link.ref, blockLabels, liveValues);
              return (
                <div
                  key={`${link.target}:${link.ref}`}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                    <Link2 className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium">
                        {link.target}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="truncate font-medium">{described}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {link.formula}
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                    формула
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Direct source links */}
        {sources.length === 0 && formulaLinks.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Связей пока нет. Добавьте блок, поле или ячейку, от которых должен зависеть
            этот блок.
          </p>
        ) : sources.length > 0 ? (
          <div className="space-y-1">
            {sources.map((src) => {
              const field = src.field ?? 'value';
              // Try to get human label from: saved label → blockLabels map → live values → fallback
              const blockLabel =
                src.label ??
                blockLabels?.[src.blockId] ??
                (String(liveValues[`${src.blockId}.label`] ?? '') ||
                  `Блок ${src.blockId.slice(0, 8)}`);
              // Resolve field label from live labels (available block sources)
              const liveSrc = available.find((a) => a.blockId === src.blockId);
              const fieldLabel = liveSrc?.labels?.[field] ?? sourceFieldLabel(field);
              const srcPeriodKey = liveSrc?.periodKey ?? null;
              return (
                <div
                  key={`${src.blockId}:${field}`}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Link2 className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium">{blockLabel}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="rounded bg-background px-1.5 py-0.5 font-medium">
                        {fieldLabel}
                      </span>
                      {srcPeriodKey && (
                        <span className="shrink-0 rounded bg-sky-50 px-1 py-0.5 text-[10px] font-medium text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                          {srcPeriodKey}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      Используется в типе вычисления «
                      {AGGREGATIONS.find((a) => a.value === aggregation)?.label}»
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeSource(src.blockId, field)}
                    aria-label="Удалить связь"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Add source — collapsible SourceBlockPicker */}
        {pickerOpen ? (
          <div className="overflow-hidden rounded-md border border-border/60">
            <SourceBlockPicker
              excludeBlockIds={excludeIds}
              alreadyAdded={alreadyAdded}
              cycleBlockIds={cycleIds}
              showKopecks={globalSettings.showKopecks}
              onPick={addSource}
              open={pickerOpen}
            />
            <div className="border-t border-border/50 px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setPickerOpen(false)}
              >
                Закрыть
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setPickerOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" /> Добавить связь
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectFormulaLinks(
  config: Record<string, unknown> | undefined,
): Array<{ target: string; ref: string; formula: string }> {
  const result: Array<{ target: string; ref: string; formula: string }> = [];
  const seen = new Set<string>();
  const addFormula = (target: string, formula: unknown) => {
    if (typeof formula !== 'string' || !formula.includes('@')) return;
    const matches = formula.matchAll(/@([A-Za-z0-9_.:-]+)/g);
    for (const match of matches) {
      const key = `${target}:${match[1]}:${formula}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ target, ref: match[1], formula });
      }
    }
  };

  addFormula('ячейка', config?.value);

  const cells = config?.cells;
  if (Array.isArray(cells)) {
    cells.forEach((row, r) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, c) => addFormula(cellAddress(r, c), cell));
    });
  }

  const headerCells = config?.headerCells;
  if (Array.isArray(headerCells)) {
    headerCells.forEach((cell) => {
      if (typeof cell !== 'object' || cell === null) return;
      const obj = cell as { label?: unknown; value?: unknown };
      addFormula(typeof obj.label === 'string' ? obj.label : 'header', obj.value);
    });
  }

  return result;
}

/** Describe a @-ref formula reference with human labels from blockLabels + live values. */
function describeFormulaRef(
  ref: string,
  blockLabels: Record<string, string> | undefined,
  liveValues: Record<string, number | string | null>,
): string {
  const parts = ref.split(':');
  const scoped = parts.length > 1;
  const source = scoped ? parts.slice(1).join(':') : ref;
  const dot = source.lastIndexOf('.');
  const blockId = dot >= 0 ? source.slice(0, dot) : source;
  const field = dot >= 0 ? source.slice(dot + 1) : 'value';
  const blockName =
    blockLabels?.[blockId] ??
    (String(liveValues[`${blockId}.label`] ?? '') ||
      `Блок ${blockId.slice(0, 8)}`);
  const fieldName = sourceFieldLabel(field);
  return `${scoped ? `${parts[0]} · ` : ''}${blockName} · ${fieldName}`;
}

function colLabel(i: number): string {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function cellAddress(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`;
}
