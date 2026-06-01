// PURPOSE: Общая визуализация карточки инсайта Ozon — единый вид для
// rule-based авто-инсайтов и ИИ-сгенерированных отчётов.
'use client';

import { useState } from 'react';
import { AlertTriangle, ShoppingBag, TrendingUp, Info, ChevronDown, ChevronRight } from 'lucide-react';
import type { InsightType } from '@/lib/blocks/catalog/unit-ozon-ai-insights-types';
import { renderInlineMd } from '@/components/unit-economics/inline-md';

/**
 * Минимальный структурный тип данных для карточки. И ozon `Insight`, и
 * `SectionInsight` ему соответствуют — карточка переиспользуется в обоих ИИ-UI.
 */
export interface InsightCardData {
  type: InsightType;
  title: string;
  description?: string;
  metric?: string;
  tags?: string[];
  recommendation?: { action: string; basis: string; expectedEffect: string };
}

export const INSIGHT_STYLES: Record<
  InsightType,
  { icon: typeof TrendingUp; cls: string; metricCls: string }
> = {
  positive: {
    icon: TrendingUp,
    cls: 'border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/40',
    metricCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  },
  warning: {
    icon: AlertTriangle,
    cls: 'border-amber-300/50 bg-amber-50 dark:bg-amber-950/40',
    metricCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  },
  danger: {
    icon: AlertTriangle,
    cls: 'border-rose-300/50 bg-rose-50 dark:bg-rose-950/40',
    metricCls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  },
  info: {
    icon: ShoppingBag,
    cls: 'border-border/60 bg-muted/30',
    metricCls: 'bg-muted text-muted-foreground',
  },
};

export function InsightCard({
  insight,
  defaultOpen = false,
}: {
  insight: InsightCardData;
  defaultOpen?: boolean;
}) {
  const style = INSIGHT_STYLES[insight.type] ?? INSIGHT_STYLES.info;
  const Icon = style.icon;
  const hasBody = Boolean(insight.description || insight.recommendation);
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={'rounded-md border ' + style.cls}>
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className={
          'flex w-full items-start gap-2 p-2 text-left ' +
          (hasBody ? 'cursor-pointer' : 'cursor-default')
        }
      >
        {hasBody ? (
          open ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
          )
        ) : (
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium">
              {hasBody && <Icon className="h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 break-words">{renderInlineMd(insight.title)}</span>
            </div>
            {insight.metric && (
              <span
                className={
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ' +
                  style.metricCls
                }
              >
                {insight.metric}
              </span>
            )}
          </div>
          {insight.tags && insight.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {insight.tags.map((tag, i) => (
                <span
                  key={i}
                  className="rounded bg-background/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground ring-1 ring-border/50"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {!open && insight.description && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
              {renderInlineMd(insight.description)}
            </div>
          )}
        </div>
      </button>
      {open && hasBody && (
        <div className="space-y-1.5 px-2 pb-2 pl-7">
          {insight.description && (
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              {renderInlineMd(insight.description)}
            </div>
          )}
          {insight.recommendation && (
            <div className="space-y-1 rounded-md border border-border/50 bg-background/60 p-2">
              <div className="text-[11px] font-medium text-foreground">
                {renderInlineMd(insight.recommendation.action)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground/80">Основание:</span>{' '}
                {renderInlineMd(insight.recommendation.basis)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground/80">Ожидаемый эффект:</span>{' '}
                {renderInlineMd(insight.recommendation.expectedEffect)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { Info as InsightInfoIcon };
