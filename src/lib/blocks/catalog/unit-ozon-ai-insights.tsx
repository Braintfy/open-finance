// PURPOSE: Блок «Ozon · AI инсайты» — генерирует короткий список действенных
// рекомендаций по аккаунту на основе snapshot KPI + аналитики per-product.
//
// На MVP — rule-based инсайты (нет внешнего AI-вызова), но контракт
// совместим с будущим переходом на ai.micro-agent (`onRefresh` сможет вызвать
// chat-API с тем же payload).

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Sparkles, AlertTriangle, TrendingUp, ShoppingBag, Lock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  PeriodPicker,
  resolvePeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type { OzonKpiResponse } from '@/app/api/marketplaces/ozon/kpi/route';
import type { OzonAnalyticsResponse } from '@/app/api/marketplaces/analytics/ozon/route';

export const OzonAiInsightsBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
});

function parseConfig(raw: unknown) {
  return OzonAiInsightsBlockConfigSchema.parse(raw ?? {});
}

export type Insight = {
  type: 'positive' | 'warning' | 'danger' | 'info';
  title: string;
  description: string;
};

/**
 * Pure-функция: генерация инсайтов из snapshot. Можно протестировать.
 */
export function generateInsights(
  kpi: OzonKpiResponse,
  analytics: OzonAnalyticsResponse,
): Insight[] {
  const insights: Insight[] = [];

  // 1. Тренд выручки.
  if (kpi.previous.revenueRub > 0) {
    const delta = ((kpi.current.revenueRub - kpi.previous.revenueRub) / kpi.previous.revenueRub) * 100;
    if (delta > 15) {
      insights.push({
        type: 'positive',
        title: 'Выручка растёт',
        description: `+${delta.toFixed(1)}% vs предыдущий период. Тренд позитивный.`,
      });
    } else if (delta < -15) {
      insights.push({
        type: 'warning',
        title: 'Выручка падает',
        description: `${delta.toFixed(1)}% vs предыдущий период. Проверьте остатки и рекламу.`,
      });
    }
  }

  // 2. Высокий ДРР.
  if (kpi.current.drrPct !== null && kpi.current.drrPct > 25) {
    insights.push({
      type: 'danger',
      title: 'ДРР выше 25%',
      description: `Текущий ДРР: ${kpi.current.drrPct.toFixed(1)}%. Цель ≤ 20%. Пересмотрите рекламу: убыточные кампании или товары с низкой маржой.`,
    });
  }

  // 3. Реклама без продаж.
  const adsNoOrders = analytics.rows.filter((r) => r.adsRub > 0 && r.delivered === 0);
  if (adsNoOrders.length > 0) {
    insights.push({
      type: 'danger',
      title: `${adsNoOrders.length} ${pluralize(adsNoOrders.length, ['товар', 'товара', 'товаров'])} сжигают рекламу без продаж`,
      description: `Расход: ${Math.round(adsNoOrders.reduce((s, r) => s + r.adsRub, 0)).toLocaleString('ru-RU')} ₽. Рассмотрите отключение кампаний на эти SKU.`,
    });
  }

  // 4. Мало остатков с продажами (OOS-риск).
  const lowStock = analytics.rows.filter(
    (r) => r.delivered > 0 && (r.daysOfStock ?? Infinity) < 14,
  );
  if (lowStock.length >= 3) {
    insights.push({
      type: 'warning',
      title: `${lowStock.length} ходовых SKU с остатком <14 дней`,
      description: `Срочно докупите: ${lowStock
        .slice(0, 3)
        .map((r) => r.article ?? r.name)
        .join(', ')}${lowStock.length > 3 ? '…' : ''}.`,
    });
  }

  // 5. Нет остатков но раньше продавалось.
  const oos = analytics.rows.filter(
    (r) => r.stockMarketplace + r.stockOwn === 0 && r.delivered === 0 && r.priceRub > 0,
  );
  if (oos.length >= 5) {
    insights.push({
      type: 'info',
      title: `${oos.length} SKU без остатка и без заказов`,
      description: 'Возможно, эти товары не активны или сняты с производства. Рассмотрите архивирование.',
    });
  }

  // 6. Топ-сейлер.
  const topSellers = [...analytics.rows].sort((a, b) => b.revenueRub - a.revenueRub).slice(0, 3);
  if (topSellers.length > 0 && topSellers[0].revenueRub > 0) {
    insights.push({
      type: 'positive',
      title: 'Топ-3 по выручке',
      description: topSellers
        .map(
          (r) =>
            `${r.article ?? r.name}: ${Math.round(r.revenueRub).toLocaleString('ru-RU')} ₽`,
        )
        .join(' · '),
    });
  }

  return insights;
}

function pluralize(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

const INSIGHT_STYLES: Record<Insight['type'], { icon: typeof Sparkles; cls: string }> = {
  positive: {
    icon: TrendingUp,
    cls: 'border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/40',
  },
  warning: {
    icon: AlertTriangle,
    cls: 'border-amber-300/50 bg-amber-50 dark:bg-amber-950/40',
  },
  danger: {
    icon: AlertTriangle,
    cls: 'border-rose-300/50 bg-rose-50 dark:bg-rose-950/40',
  },
  info: {
    icon: ShoppingBag,
    cls: 'border-border/60 bg-muted/30',
  },
};

function RenderOzonAiInsights({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const {
    period,
    setOverride: setPeriodOverride,
    resetToGlobal: resetPeriodToGlobal,
    isOverride: isPeriodOverride,
  } = useBlockPeriod({
    instanceId: instance.id,
    configOverride:
      config.periodPreset !== '30d' || config.customFrom || config.customTo
        ? {
            preset: config.periodPreset,
            customFrom: config.customFrom,
            customTo: config.customTo,
          }
        : null,
    defaultMode: 'global',
  });
  const setPeriod = useCallback(
    (next: PeriodValue) =>
      setPeriodOverride({
        preset: next.preset,
        customFrom: next.customFrom ?? null,
        customTo: next.customTo ?? null,
      }),
    [setPeriodOverride],
  );
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!config.accountId) {
      setError('Подключите Ozon-магазин в настройках блока.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const range = resolvePeriod(period.preset, period.customFrom, period.customTo);
      const params = new URLSearchParams({
        accountId: config.accountId,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      });
      const [kpiRes, analyticsRes] = await Promise.all([
        fetch(`/api/marketplaces/ozon/kpi?${params}`),
        fetch(`/api/marketplaces/analytics/ozon?${params}`),
      ]);
      const kpi = (await kpiRes.json()) as OzonKpiResponse | { ok: false; error: string };
      const analytics = (await analyticsRes.json()) as
        | OzonAnalyticsResponse
        | { ok: false; error: string };
      if (!mountedRef.current) return;
      if (!('ok' in kpi) || !kpi.ok) {
        setError(('error' in kpi ? kpi.error : 'KPI error') ?? 'KPI error');
        return;
      }
      if (!('ok' in analytics) || !analytics.ok) {
        setError(('error' in analytics ? analytics.error : 'Analytics error') ?? 'Analytics error');
        return;
      }
      const list = generateInsights(kpi, analytics);
      setInsights(list);
      setLastUpdate(new Date());
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [config.accountId, period.preset, period.customFrom, period.customTo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Cell-binding: счётчик инсайтов + критических для дашбордов.
  // Insight.type = 'danger' считается «критическим».
  const totalCount = insights?.length ?? 0;
  const criticalCount = insights?.filter((i) => i.type === 'danger').length ?? 0;
  useBlockValuePublisher(instance.id, {
    value: totalCount,
    criticalCount,
    __labels: 'value=Инсайтов,criticalCount=Критических',
  });

  return (
    <Card className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI инсайты</span>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker
            value={{ preset: period.preset as PeriodPreset, customFrom: period.customFrom, customTo: period.customTo }}
            onChange={setPeriod}
            compact
          />
          {isPeriodOverride && (
            <button
              type="button"
              onClick={resetPeriodToGlobal}
              className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900"
              title="Локальный период этого блока. Клик — вернуться к периоду страницы."
            >
              <Lock className="h-2.5 w-2.5" />
              свой
            </button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={loading}
            title="Обновить"
          >
            <RefreshCw className={'h-3 w-3 ' + (loading ? 'animate-spin' : '')} />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {error}
          </div>
        ) : !insights ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            {loading ? 'Анализ…' : 'Нажмите «обновить» чтобы получить инсайты.'}
          </div>
        ) : insights.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            Всё стабильно. Аномалий не найдено.
          </div>
        ) : (
          <div className="space-y-2">
            {insights.map((ins, i) => {
              const style = INSIGHT_STYLES[ins.type];
              const Icon = style.icon;
              return (
                <div
                  key={i}
                  className={'rounded-md border p-2 ' + style.cls}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium">{ins.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {ins.description}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {lastUpdate && (
              <div className="text-[10px] text-muted-foreground">
                Обновлено: {lastUpdate.toLocaleString('ru-RU')}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  return (
    <div className="space-y-4">
      <OzonAccountSelector
        value={parsed.accountId}
        onChange={(id) =>
          onChange({ ...parsed, accountId: id } as unknown as Record<string, unknown>)
        }
        showPerfStatus
      />
      <PeriodPicker
        value={{
          preset: parsed.periodPreset as PeriodPreset,
          customFrom: parsed.customFrom,
          customTo: parsed.customTo,
        }}
        onChange={(v) =>
          onChange({
            ...parsed,
            periodPreset: v.preset,
            customFrom: v.customFrom ?? null,
            customTo: v.customTo ?? null,
          } as unknown as Record<string, unknown>)
        }
      />
    </div>
  );
}

export const UnitOzonAiInsightsBlock: BlockDef = {
  type: 'unit.ozon-ai-insights',
  displayName: 'Ozon · AI инсайты',
  description:
    'Автоматический анализ Ozon-метрик: тренд, аномалии, рекомендации по рекламе и остаткам.',
  category: 'custom',
  icon: Sparkles,
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 4 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonAiInsightsBlockConfigSchema,
  defaultConfig: () => OzonAiInsightsBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonAiInsights,
};
