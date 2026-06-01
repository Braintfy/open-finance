// PURPOSE: Общая визуализация карточки инсайта Ozon — единый вид для
// rule-based авто-инсайтов и ИИ-сгенерированных отчётов.
'use client';

import { AlertTriangle, ShoppingBag, TrendingUp, Info } from 'lucide-react';
import type { Insight, InsightType } from '@/lib/blocks/catalog/unit-ozon-ai-insights-types';

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

export function InsightCard({ insight }: { insight: Insight }) {
  const style = INSIGHT_STYLES[insight.type] ?? INSIGHT_STYLES.info;
  const Icon = style.icon;
  return (
    <div className={'rounded-md border p-2 ' + style.cls}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[12px] font-medium">{insight.title}</div>
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
          <div className="text-[11px] text-muted-foreground">{insight.description}</div>
        </div>
      </div>
    </div>
  );
}

export { Info as InsightInfoIcon };
