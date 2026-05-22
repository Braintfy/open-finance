// PURPOSE: Plug-in placeholder для cashflow-блоков в режиме `sourceBinding.mode === 'empty'`.
// Универсальный UI: иконка Link + текст + CTA «Выбрать источник».
//
// Используется в stat.income/expense/balance/custom, cashflow.top-categories,
// chart.cashflow, kpi.grid (ячейки и full-block).
'use client';

import { Link2, Settings } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function EmptySourcePlaceholder({
  title,
  description,
  onOpenSettings,
  compact,
  variant = 'full',
}: {
  title?: string;
  description?: string;
  /** Колбек открытия settings dialog с фокусом на секции binding. */
  onOpenSettings?: () => void;
  /** Уменьшенная версия (для xs/sm density и для ячеек kpi.grid). */
  compact?: boolean;
  /** `full` — Card-обёртка; `inner` — без Card (например, внутри ячейки kpi.grid). */
  variant?: 'full' | 'inner';
}) {
  const inner = (
    <div
      className={
        'flex h-full min-h-0 flex-col items-center justify-center gap-1.5 text-center ' +
        (compact ? 'p-2' : 'p-3')
      }
    >
      <div
        className={
          'flex items-center justify-center rounded-full bg-muted text-muted-foreground ' +
          (compact ? 'h-7 w-7' : 'h-10 w-10')
        }
      >
        <Link2 className={compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
      </div>
      <div
        className={
          (compact ? 'text-[11px]' : 'text-xs') + ' font-medium text-foreground'
        }
      >
        {title ?? 'Источник не привязан'}
      </div>
      {!compact && (
        <div className="max-w-[220px] text-[10px] leading-snug text-muted-foreground">
          {description ??
            'Выберите блок «Список операций» как источник данных, чтобы блок показывал значения.'}
        </div>
      )}
      {onOpenSettings && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings();
          }}
          className={
            'mt-0.5 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 font-medium text-primary transition hover:bg-primary/10 ' +
            (compact ? 'text-[10px]' : 'text-[11px]')
          }
        >
          <Settings className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
          Выбрать источник
        </button>
      )}
    </div>
  );

  if (variant === 'inner') {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-md border border-dashed border-border bg-muted/30">
        {inner}
      </div>
    );
  }
  return <Card className="flex h-full min-h-0 flex-col border-dashed">{inner}</Card>;
}
