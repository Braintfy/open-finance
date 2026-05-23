// PURPOSE: Plug-in placeholder для cashflow-блоков в режиме `sourceBinding.mode === 'empty'`.
// Универсальный UI: иконка Link + title + опц. subtitle + CTA «Выбрать источник».
//
// Используется в stat.income/expense/balance/custom, cashflow.top-categories,
// chart.cashflow, kpi.grid (ячейки и full-block).
//
// v0.22.1: разделение `title` (короткое название блока, truncate) и `subtitle`
// (статус «источник не привязан», text-muted, line-clamp-1). Compact-вариант
// дополнительно скрывает subtitle и сжимает иконку — placeholder влезает в
// блок размером 2×2.
'use client';

import { Link2, Settings } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function EmptySourcePlaceholder({
  title,
  subtitle,
  description,
  onOpenSettings,
  compact,
  variant = 'full',
}: {
  /** Короткое название блока (например, «Поступления»). Truncate в одну строку. */
  title?: string;
  /** Статус (например, «источник не привязан»). Line-clamp-1, muted. */
  subtitle?: string;
  /** Большой пояснительный текст. Скрывается в compact-режиме. */
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
        'flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-1 text-center ' +
        (compact ? 'p-1.5' : 'p-2.5')
      }
    >
      <div
        className={
          'flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ' +
          (compact ? 'h-6 w-6' : 'h-9 w-9')
        }
      >
        <Link2 className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      </div>
      {title && (
        <div
          className={
            (compact ? 'text-[11px]' : 'text-xs') +
            ' w-full truncate font-medium text-foreground'
          }
          title={title}
        >
          {title}
        </div>
      )}
      {subtitle && (
        <div
          className={
            (compact ? 'text-[10px]' : 'text-[11px]') +
            ' line-clamp-1 w-full text-muted-foreground'
          }
          title={subtitle}
        >
          {subtitle}
        </div>
      )}
      {!compact && description && (
        <div className="line-clamp-2 max-w-[220px] text-[10px] leading-snug text-muted-foreground">
          {description}
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
            'mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-0.5 font-medium text-primary transition hover:bg-primary/10 ' +
            (compact ? 'text-[10px]' : 'text-[11px]')
          }
          title="Выбрать источник данных"
        >
          <Settings className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
          <span>Источник</span>
        </button>
      )}
    </div>
  );

  if (variant === 'inner') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-dashed border-border bg-muted/30">
        {inner}
      </div>
    );
  }
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden border-dashed">
      {inner}
    </Card>
  );
}
