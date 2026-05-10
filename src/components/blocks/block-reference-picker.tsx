// PURPOSE: UI для выбора блоков-источников (Excel-style cell picker).
// Используется в settings computed-блоков (sum/avg/formula/AI) для настройки зависимостей.
'use client';

import { Check, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useAvailableBlockSources } from '@/lib/blocks/values';
import type { BlockRef, BlockDependencies } from '@/lib/blocks/types';
import { useState } from 'react';

type Props = {
  /** Текущие зависимости (могут быть undefined) */
  value: BlockDependencies | undefined;
  /** ID блока, который НЕ должен быть в списке источников (сам себя нельзя брать) */
  selfBlockId?: string;
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
  { value: 'formula', label: 'Формула', hint: 'Произвольная формула (планируется)' },
  { value: 'ai', label: 'AI-агент', hint: 'AI-микроагент собирает данные (планируется)' },
];

export function BlockReferencePicker({ value, selfBlockId, blockLabels, onChange }: Props) {
  const available = useAvailableBlockSources();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  const sources: BlockRef[] = value?.sources ?? [];
  const aggregation: BlockDependencies['aggregation'] = value?.aggregation ?? 'sum';

  const candidateSources = available.filter(
    (a) =>
      a.blockId !== selfBlockId && // не показываем сам блок
      !sources.some((s) => s.blockId === a.blockId) // и уже добавленные
  );

  const filtered = candidateSources.filter((a) => {
    if (!search) return true;
    const label = blockLabels?.[a.blockId] ?? a.blockId;
    return label.toLowerCase().includes(search.toLowerCase());
  });

  function addSource(blockId: string) {
    const next: BlockDependencies = {
      sources: [...sources, { blockId, field: 'value' }],
      aggregation,
    };
    onChange(next);
    setSearch('');
    setSearchOpen(false);
  }

  function removeSource(blockId: string) {
    onChange({
      sources: sources.filter((s) => s.blockId !== blockId),
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
        <Label>Источники ({sources.length})</Label>
        {sources.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-center text-xs text-muted-foreground">
            Нет источников. Добавьте блоки, значения которых нужно агрегировать.
          </p>
        ) : (
          <div className="space-y-1">
            {sources.map((src) => {
              const label =
                src.label ?? blockLabels?.[src.blockId] ?? `Блок ${src.blockId.slice(0, 8)}`;
              return (
                <div
                  key={src.blockId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1"
                >
                  <span className="truncate text-xs font-medium">{label}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-red-600 hover:bg-red-50"
                    onClick={() => removeSource(src.blockId)}
                    aria-label="Удалить источник"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {searchOpen ? (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-background p-2">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск блоков на странице…"
              className="h-7"
            />
            {filtered.length === 0 ? (
              <p className="px-1 text-[11px] text-muted-foreground">
                {candidateSources.length === 0
                  ? 'Нет других блоков на странице'
                  : 'Ничего не найдено'}
              </p>
            ) : (
              <div className="max-h-40 space-y-0.5 overflow-y-auto">
                {filtered.map((cand) => {
                  const label = blockLabels?.[cand.blockId] ?? `Блок ${cand.blockId.slice(0, 8)}`;
                  return (
                    <button
                      key={cand.blockId}
                      type="button"
                      onClick={() => addSource(cand.blockId)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                    >
                      <span className="truncate">{label}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {cand.fields.join(', ')}
                      </span>
                    </button>
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
            <Plus className="h-3.5 w-3.5" /> Добавить источник
          </Button>
        )}
      </div>
    </div>
  );
}
