// PURPOSE: UI для настройки `SourceBinding` (empty / global / block).
// Используется в общей секции «Источник данных» BlockSettingsDialog
// для всех cashflow-консьюмеров (stat.*, top-categories, chart.cashflow,
// kpi.grid).
//
// API:
//   <SourceBindingPicker
//     value={cfg.sourceBinding}
//     onChange={(b) => onChange({ ...cfg, sourceBinding: b })}
//     selfBlockId={instance.id}
//     allBlocks={pageBlocks}
//     pageKey={currentPageKey}      // для cross-page bindings (опц.)
//     blockLabels={pageBlockLabels} // для красивого UI
//   />
'use client';

import { useMemo } from 'react';
import { CircleSlash, Globe, Link2, ListTree } from 'lucide-react';
import { Label } from '@/components/ui/label';
import type { BlockInstance, SourceBinding } from '@/lib/blocks/types';
import { TX_BLOCK_TYPE } from '@/lib/blocks/source-binding';
import { cn } from '@/lib/utils';

const MODES: Array<{
  id: SourceBinding['mode'];
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'empty',
    label: 'Не привязан',
    hint: 'Блок ничего не показывает, пока не выбран источник.',
    icon: CircleSlash,
  },
  {
    id: 'global',
    label: 'Глобально',
    hint: 'Тенант-уровень: фильтры берутся из page-level period/source.',
    icon: Globe,
  },
  {
    id: 'block',
    label: 'Из блока',
    hint: 'Использовать конкретный «Список операций» как источник.',
    icon: Link2,
  },
];

export function SourceBindingPicker({
  value,
  onChange,
  selfBlockId,
  allBlocks,
  pageKey,
  blockLabels,
  /** Если true — добавляет кнопку «Сбросить override» (для per-cell в kpi.grid). */
  showResetToInherit,
  onResetToInherit,
  inheritedLabel,
}: {
  value: SourceBinding;
  onChange: (next: SourceBinding) => void;
  selfBlockId?: string;
  allBlocks?: BlockInstance[];
  /** Ключ текущей страницы (для аннотации pageKey в binding). */
  pageKey?: string;
  blockLabels?: Record<string, string>;
  showResetToInherit?: boolean;
  onResetToInherit?: () => void;
  inheritedLabel?: string;
}) {
  // Кандидаты на привязку: все cashflow.transactions блоки на той же странице,
  // кроме самого себя (защита от циклов — а tx-блок и сам не bound).
  const candidates = useMemo<BlockInstance[]>(() => {
    if (!allBlocks) return [];
    return allBlocks.filter(
      (b) => b.type === TX_BLOCK_TYPE && b.id !== selfBlockId,
    );
  }, [allBlocks, selfBlockId]);

  const selectedBlockId =
    value.mode === 'block' ? value.blockId : undefined;
  const selectedExists =
    selectedBlockId !== undefined &&
    candidates.some((b) => b.id === selectedBlockId);

  function setMode(mode: SourceBinding['mode']) {
    if (mode === value.mode) return;
    if (mode === 'empty') {
      onChange({ mode: 'empty' });
    } else if (mode === 'global') {
      onChange({ mode: 'global' });
    } else {
      const first = candidates[0];
      if (first) {
        onChange({ mode: 'block', blockId: first.id, pageKey });
      } else {
        onChange({ mode: 'empty' });
      }
    }
  }

  return (
    <div className="space-y-2.5 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Источник данных
        </Label>
        {showResetToInherit && onResetToInherit && (
          <button
            type="button"
            onClick={onResetToInherit}
            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            title={inheritedLabel ? `Сбросить и наследовать: ${inheritedLabel}` : 'Сбросить override'}
          >
            ← Наследовать {inheritedLabel ? `(${inheritedLabel})` : ''}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => {
          const active = value.mode === m.id;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-background text-muted-foreground ring-1 ring-border hover:bg-accent hover:text-foreground',
              )}
              title={m.hint}
            >
              <Icon className="h-3 w-3" />
              {m.label}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        {MODES.find((m) => m.id === value.mode)?.hint}
      </p>

      {value.mode === 'block' && (
        <div className="space-y-1.5 pt-1">
          <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Блок-источник
          </Label>
          {candidates.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              На этой странице нет блоков «Список операций». Добавьте такой блок
              или используйте режим «Глобально».
            </div>
          ) : (
            <select
              value={selectedExists ? selectedBlockId : ''}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                onChange({ mode: 'block', blockId: id, pageKey });
              }}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px]"
            >
              {!selectedExists && (
                <option value="">
                  {selectedBlockId
                    ? `[удалён] ${selectedBlockId}`
                    : 'Выберите источник'}
                </option>
              )}
              {candidates.map((c) => {
                const label =
                  blockLabels?.[c.id] ??
                  c.appearance?.title ??
                  `Список операций (${c.id.slice(0, 6)})`;
                return (
                  <option key={c.id} value={c.id}>
                    {label}
                  </option>
                );
              })}
            </select>
          )}
          {value.mode === 'block' && !selectedExists && selectedBlockId && (
            <div className="flex items-start gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              <ListTree className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Привязанный блок не найден на текущей странице — возможно, он
                удалён или находится на другой странице (cross-page binding
                поддерживается отдельно).
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
