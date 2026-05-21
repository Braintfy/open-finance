// PURPOSE: UI для выбора блоков-источников (Excel-style cell picker).
// Используется в settings computed-блоков (sum/avg/formula/AI) для настройки зависимостей.
'use client';

import { AlertTriangle, ArrowRight, Check, Link2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useAvailableBlockSources } from '@/lib/blocks/values';
import type { BlockRef, BlockDependencies, BlockInstance } from '@/lib/blocks/types';
import { buildDependencyGraph, wouldCreateCycle, findCyclicBlocks } from '@/lib/blocks/graph';
import { useMemo, useState } from 'react';

type Props = {
  /** Текущие зависимости (могут быть undefined) */
  value: BlockDependencies | undefined;
  config?: Record<string, unknown>;
  /** ID блока, который НЕ должен быть в списке источников (сам себя нельзя брать) */
  selfBlockId?: string;
  /** Все блоки на текущей странице — для cycle detection */
  allBlocks?: BlockInstance[];
  /** Map blockId → human label (для красивого UI). Если не передано — показываем blockId */
  blockLabels?: Record<string, string>;
  onChange: (deps: BlockDependencies) => void;
};

const AGGREGATIONS: Array<{ value: BlockDependencies['aggregation']; label: string; hint: string }> = [
  { value: 'sum', label: 'Сумма', hint: 'Складывает значения всех источников' },
  { value: 'avg', label: 'Среднее', hint: 'Среднее арифметическое' },
  { value: 'min', label: 'Минимум', hint: 'Наименьшее из значений' },
  { value: 'max', label: 'Максимум', hint: 'Наибольшее из значений' },
  { value: 'count', label: 'Количество', hint: 'Сколько источников имеют значение' },
  { value: 'median', label: 'Медиана', hint: 'Центральное значение в отсортированном массиве' },
  { value: 'variance', label: 'Дисперсия', hint: 'Меру разброса значений вокруг среднего' },
  { value: 'first', label: 'Первое', hint: 'Первый не-null источник по порядку' },
  { value: 'last', label: 'Последнее', hint: 'Последний не-null источник по порядку' },
  { value: 'formula', label: 'Формула', hint: 'Произвольная формула (a, b, c, ... = источники)' },
  { value: 'ai', label: 'AI-агент', hint: 'AI-микроагент собирает данные (планируется)' },
];

export function BlockReferencePicker({ value, config, selfBlockId, allBlocks, blockLabels, onChange }: Props) {
  const available = useAvailableBlockSources();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  const sources: BlockRef[] = value?.sources ?? [];
  const aggregation: BlockDependencies['aggregation'] = value?.aggregation ?? 'sum';

  // Граф зависимостей для cycle detection
  const graph = useMemo(
    () => (allBlocks ? buildDependencyGraph(allBlocks) : new Map<string, Set<string>>()),
    [allBlocks]
  );
  const cyclicBlocks = useMemo(() => findCyclicBlocks(graph), [graph]);

  const formulaLinks = useMemo(() => collectFormulaLinks(config), [config]);

  const candidateSources = available.filter((a) => a.blockId !== selfBlockId);

  const filtered = candidateSources.filter((a) => {
    if (!search) return true;
    const label = blockLabels?.[a.blockId] ?? a.blockId;
    return `${label} ${a.fields.join(' ')}`.toLowerCase().includes(search.toLowerCase());
  });

  function addSource(blockId: string, field = 'value') {
    // Cycle detection: если добавление создаст цикл — блокируем
    if (selfBlockId && wouldCreateCycle(graph, selfBlockId, blockId)) {
      return; // UI уже помечает кнопку как disabled
    }
    if (sources.some((s) => s.blockId === blockId && (s.field ?? 'value') === field)) {
      return;
    }
    const next: BlockDependencies = {
      sources: [...sources, { blockId, field, label: blockLabels?.[blockId] }],
      aggregation,
    };
    onChange(next);
    setSearch('');
    setSearchOpen(false);
  }

  function removeSource(blockId: string, field?: string) {
    onChange({
      sources: sources.filter((s) => !(s.blockId === blockId && (s.field ?? 'value') === (field ?? 'value'))),
      aggregation,
    });
  }

  function changeAggregation(agg: BlockDependencies['aggregation']) {
    onChange({ sources, aggregation: agg });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Тип вычисления</Label>
        <div className="flex flex-wrap gap-1">
          {AGGREGATIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => changeAggregation(a.value)}
              className={
                'inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors ' +
                (aggregation === a.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent')
              }
              title={a.hint}
              disabled={a.value === 'formula' || a.value === 'ai'}
            >
              {aggregation === a.value && <Check className="h-3 w-3" />}
              {a.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {AGGREGATIONS.find((a) => a.value === aggregation)?.hint}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Связи ({sources.length + formulaLinks.length})</Label>
        {formulaLinks.length > 0 && (
          <div className="space-y-1">
            {formulaLinks.map((link) => (
              <div
                key={`${link.target}:${link.ref}`}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                  <Link2 className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium">{link.target}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate font-medium">{describeFormulaRef(link.ref, blockLabels)}</span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{link.formula}</div>
                </div>
                <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                  формула
                </span>
              </div>
            ))}
          </div>
        )}

        {sources.length === 0 && formulaLinks.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Связей пока нет. Добавьте блок, поле или ячейку, от которых должен зависеть этот блок.
          </p>
        ) : sources.length > 0 ? (
          <div className="space-y-1">
            {sources.map((src) => {
              const label =
                src.label ?? blockLabels?.[src.blockId] ?? `Блок ${src.blockId.slice(0, 8)}`;
              const field = src.field ?? 'value';
              return (
                <div
                  key={`${src.blockId}:${field}`}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Link2 className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="rounded bg-background px-1.5 py-0.5 font-medium">блок</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="truncate font-medium">{label}</span>
                      <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {field}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      Используется в типе вычисления «{AGGREGATIONS.find((a) => a.value === aggregation)?.label}»
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-red-600 hover:bg-red-50"
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

        {searchOpen ? (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-background p-2">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск блока, поля или ячейки…"
              className="h-7"
            />
            {filtered.length === 0 ? (
              <p className="px-1 text-[11px] text-muted-foreground">
                {candidateSources.length === 0
                  ? 'Нет других блоков на странице'
                  : 'Ничего не найдено'}
              </p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {filtered.map((cand) => {
                  const label = blockLabels?.[cand.blockId] ?? `Блок ${cand.blockId.slice(0, 8)}`;
                  const createsCycle = !!selfBlockId && wouldCreateCycle(graph, selfBlockId, cand.blockId);
                  const isCyclic = cyclicBlocks.has(cand.blockId);
                  return (
                    <div
                      key={cand.blockId}
                      className="rounded-md border border-border/50 p-2"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1 truncate font-medium">
                        {(createsCycle || isCyclic) && (
                          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                        )}
                        {label}
                      </span>
                        {createsCycle && <span className="shrink-0 text-[10px] text-amber-600">цикл</span>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {cand.fields.map((field) => {
                          const alreadyAdded = sources.some((s) => s.blockId === cand.blockId && (s.field ?? 'value') === field);
                          return (
                            <button
                              key={field}
                              type="button"
                              onClick={() => addSource(cand.blockId, field)}
                              disabled={createsCycle || alreadyAdded}
                              className={
                                'rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition ' +
                                (createsCycle || alreadyAdded
                                  ? 'cursor-not-allowed bg-muted/40 text-muted-foreground opacity-60'
                                  : 'bg-background hover:bg-primary/10 hover:text-primary hover:ring-primary/40')
                              }
                              title={createsCycle ? 'Добавление создаст циклическую зависимость' : undefined}
                            >
                              {field}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setSearchOpen(false);
                setSearch('');
              }}
            >
              Закрыть
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setSearchOpen(true)}
            disabled={candidateSources.length === 0}
          >
            <Plus className="h-3.5 w-3.5" /> Добавить связь
          </Button>
        )}
      </div>
    </div>
  );
}

function collectFormulaLinks(config: Record<string, unknown> | undefined): Array<{ target: string; ref: string; formula: string }> {
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

function describeFormulaRef(ref: string, blockLabels?: Record<string, string>): string {
  const parts = ref.split(':');
  const scoped = parts.length > 1;
  const source = scoped ? parts.slice(1).join(':') : ref;
  const dot = source.lastIndexOf('.');
  const blockId = dot >= 0 ? source.slice(0, dot) : source;
  const field = dot >= 0 ? source.slice(dot + 1) : 'value';
  const label = blockLabels?.[blockId] ?? `Блок ${blockId.slice(0, 8)}`;
  return `${scoped ? `${parts[0]} · ` : ''}${label} · ${field}`;
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
