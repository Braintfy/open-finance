// PURPOSE: Типы, конфиг-схема и pure-логика для блока unit.ozon-ai-insights.
// Выделено в отдельный (НЕ 'use client') файл, чтобы server-side (DB schema,
// queries, API route) и client-блок импортировали общие типы и rule-based
// генераторы без циклической зависимости с React-компонентом.

import { z } from 'zod';
import type { OzonKpiResponse } from '@/app/api/marketplaces/ozon/kpi/route';
import type { OzonAnalyticsResponse } from '@/app/api/marketplaces/analytics/ozon/route';

export type InsightType = 'positive' | 'warning' | 'danger' | 'info';

export type InsightCategory =
  | 'revenue'
  | 'ads'
  | 'products'
  | 'stock'
  | 'returns'
  | 'general';

export type Insight = {
  type: InsightType;
  /** Категория для группировки в раскрываемые модули. */
  category: InsightCategory;
  title: string;
  description: string;
  /** Короткая метрика-бейдж, напр. «ДРР 34%». */
  metric?: string;
  /** Приоритет: 1 — высокий, 3 — низкий. Используется для сортировки. */
  priority?: 1 | 2 | 3;
};

/** Один ИИ-сгенерированный отчёт (хранится в БД). */
export type AiInsightReport = {
  id: string;
  /** ISO-строка момента генерации. */
  createdAt: string;
  periodKey: string | null;
  model: string | null;
  /** Executive summary (2-4 предложения). */
  summary: string;
  insights: Insight[];
};

export type MetricTone = 'good' | 'warning' | 'danger' | 'neutral';

/** Числовой показатель для секции «Показатели». */
export type InsightMetric = {
  key: string;
  label: string;
  /** Уже отформатированное значение. */
  value: string;
  tone?: MetricTone;
  hint?: string;
};

export const INSIGHT_CATEGORY_META: Record<
  InsightCategory,
  { label: string; order: number }
> = {
  revenue: { label: 'Выручка', order: 1 },
  ads: { label: 'Реклама', order: 2 },
  products: { label: 'Товары', order: 3 },
  stock: { label: 'Остатки', order: 4 },
  returns: { label: 'Возвраты', order: 5 },
  general: { label: 'Общее', order: 6 },
};

export const OZON_AI_INSIGHTS_MAX_REPORTS = 10;

export const OzonAiInsightsBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  /** Показывать секцию числовых показателей. */
  showMetrics: z.boolean().default(true),
  /** Состояние раскрытия модулей (ключ → открыт). Persist per-user. */
  expandedModules: z.record(z.string(), z.boolean()).default({}),
});

export type OzonAiInsightsBlockConfig = z.infer<typeof OzonAiInsightsBlockConfigSchema>;

export function parseOzonAiInsightsConfig(raw: unknown): OzonAiInsightsBlockConfig {
  return OzonAiInsightsBlockConfigSchema.parse(raw ?? {});
}

/** Русская плюрализация (1 товар / 2 товара / 5 товаров). */
export function pluralize(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

function fmtRub(value: number): string {
  return Math.round(value).toLocaleString('ru-RU') + ' ₽';
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString('ru-RU');
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(value >= 100 ? 0 : 1) + '%';
}

/**
 * Сводка по аналитике для метрик и ИИ-промпта. Pure — тестируемо.
 */
export function summarizeAnalytics(analytics: OzonAnalyticsResponse) {
  const rows = analytics.rows;
  let totalCogs = 0;
  let stockUnits = 0;
  let stockValueRub = 0;
  let frozenStockValueRub = 0; // остаток без продаж
  let withSales = 0;
  let noStock = 0;
  let negMargin = 0;
  let buyoutSum = 0;
  let buyoutCount = 0;

  for (const r of rows) {
    const units = r.stockMarketplace + r.stockOwn;
    totalCogs += r.costRub * r.qtyDelivered;
    stockUnits += units;
    stockValueRub += r.costRub * units;
    if (r.delivered === 0 && units > 0) frozenStockValueRub += r.costRub * units;
    if (r.delivered > 0) withSales += 1;
    if (units === 0) noStock += 1;
    if (r.costRub > 0 && r.priceRub - r.costRub <= 0) negMargin += 1;
    if (r.buyoutPct !== null && Number.isFinite(r.buyoutPct)) {
      buyoutSum += r.buyoutPct;
      buyoutCount += 1;
    }
  }

  const revenueRub = analytics.totals.revenueRub;
  const totalProfitRub = revenueRub - totalCogs;

  // Топ-3 концентрация выручки.
  const byRevenue = [...rows].sort((a, b) => b.revenueRub - a.revenueRub);
  const top3Revenue = byRevenue.slice(0, 3).reduce((s, r) => s + r.revenueRub, 0);
  const top3SharePct = revenueRub > 0 ? (top3Revenue / revenueRub) * 100 : 0;

  return {
    rowsCount: rows.length,
    revenueRub,
    totalCogs,
    totalProfitRub,
    marginPct: revenueRub > 0 ? (totalProfitRub / revenueRub) * 100 : null,
    stockUnits,
    stockValueRub,
    frozenStockValueRub,
    withSales,
    noStock,
    negMargin,
    avgBuyoutPct: buyoutCount > 0 ? buyoutSum / buyoutCount : null,
    top3SharePct,
    topSellers: byRevenue.slice(0, 3),
  };
}

/** Метрик-обзор для секции «Показатели» блока. */
export function computeInsightMetrics(
  kpi: OzonKpiResponse,
  analytics: OzonAnalyticsResponse,
): InsightMetric[] {
  const s = summarizeAnalytics(analytics);
  const revDelta =
    kpi.previous.revenueRub > 0
      ? ((kpi.current.revenueRub - kpi.previous.revenueRub) / kpi.previous.revenueRub) * 100
      : null;
  const ordDelta =
    kpi.previous.orders > 0
      ? ((kpi.current.orders - kpi.previous.orders) / kpi.previous.orders) * 100
      : null;
  const totalOrders = analytics.totals.delivered + analytics.totals.cancelled + analytics.totals.returned;
  const cancelPct = totalOrders > 0 ? (analytics.totals.cancelled / totalOrders) * 100 : null;
  const returnPct =
    analytics.totals.delivered + analytics.totals.returned > 0
      ? (analytics.totals.returned / (analytics.totals.delivered + analytics.totals.returned)) * 100
      : null;

  const metrics: InsightMetric[] = [
    {
      key: 'revenue',
      label: 'Выручка',
      value: fmtRub(kpi.current.revenueRub),
      tone: revDelta !== null && revDelta < -15 ? 'warning' : 'neutral',
      hint: revDelta !== null ? `${revDelta >= 0 ? '+' : ''}${revDelta.toFixed(1)}% vs ${kpi.compareLabel.toLowerCase()}` : undefined,
    },
    {
      key: 'profit',
      label: 'Прибыль (выр−себест)',
      value: fmtRub(s.totalProfitRub),
      tone: s.totalProfitRub < 0 ? 'danger' : 'good',
      hint: s.marginPct !== null ? `Маржа ${s.marginPct.toFixed(1)}%` : undefined,
    },
    {
      key: 'drr',
      label: 'ДРР',
      value: fmtPct(kpi.current.drrPct),
      tone:
        kpi.current.drrPct === null
          ? 'neutral'
          : kpi.current.drrPct > 25
            ? 'danger'
            : kpi.current.drrPct > 20
              ? 'warning'
              : 'good',
      hint: 'Цель ≤ 20%',
    },
    {
      key: 'ads',
      label: 'Расход на рекламу',
      value: fmtRub(kpi.current.adsRub),
    },
    {
      key: 'orders',
      label: 'Заказы',
      value: fmtInt(kpi.current.orders),
      hint: ordDelta !== null ? `${ordDelta >= 0 ? '+' : ''}${ordDelta.toFixed(1)}% vs ${kpi.compareLabel.toLowerCase()}` : undefined,
    },
    {
      key: 'aov',
      label: 'Средний чек',
      value: kpi.current.aovRub !== null ? fmtRub(kpi.current.aovRub) : '—',
    },
    {
      key: 'cpo',
      label: 'CPO (реклама/заказ)',
      value: kpi.current.cpoRub !== null ? fmtRub(kpi.current.cpoRub) : '—',
    },
    {
      key: 'returnPct',
      label: '% возвратов',
      value: fmtPct(returnPct),
      tone: returnPct !== null && returnPct > 10 ? 'warning' : 'neutral',
    },
    {
      key: 'cancelPct',
      label: '% отмен',
      value: fmtPct(cancelPct),
      tone: cancelPct !== null && cancelPct > 15 ? 'warning' : 'neutral',
    },
    {
      key: 'buyout',
      label: 'Средний выкуп',
      value: fmtPct(s.avgBuyoutPct),
      tone: s.avgBuyoutPct !== null && s.avgBuyoutPct < 70 ? 'warning' : 'neutral',
    },
    {
      key: 'skuSales',
      label: 'SKU с продажами',
      value: `${s.withSales} / ${s.rowsCount}`,
    },
    {
      key: 'stockValue',
      label: 'Стоимость остатков',
      value: fmtRub(s.stockValueRub),
      hint: `${fmtInt(s.stockUnits)} шт`,
    },
  ];
  return metrics;
}

/**
 * Pure-функция: rule-based генерация инсайтов из snapshot KPI + аналитики.
 * Каждый инсайт имеет category (для группировки в модули) и priority.
 */
export function generateInsights(
  kpi: OzonKpiResponse,
  analytics: OzonAnalyticsResponse,
): Insight[] {
  const insights: Insight[] = [];
  const s = summarizeAnalytics(analytics);
  const rows = analytics.rows;

  // 1. Тренд выручки.
  if (kpi.previous.revenueRub > 0) {
    const delta = ((kpi.current.revenueRub - kpi.previous.revenueRub) / kpi.previous.revenueRub) * 100;
    if (delta > 15) {
      insights.push({
        type: 'positive',
        category: 'revenue',
        priority: 2,
        title: 'Выручка растёт',
        description: `+${delta.toFixed(1)}% vs ${kpi.compareLabel.toLowerCase()}. Тренд позитивный.`,
        metric: `+${delta.toFixed(0)}%`,
      });
    } else if (delta < -15) {
      insights.push({
        type: 'warning',
        category: 'revenue',
        priority: 1,
        title: 'Выручка падает',
        description: `${delta.toFixed(1)}% vs ${kpi.compareLabel.toLowerCase()}. Проверьте остатки и рекламу.`,
        metric: `${delta.toFixed(0)}%`,
      });
    }
  }

  // 2. Рост/падение заказов отдельно от выручки.
  if (kpi.previous.orders > 0) {
    const od = ((kpi.current.orders - kpi.previous.orders) / kpi.previous.orders) * 100;
    if (od < -20) {
      insights.push({
        type: 'warning',
        category: 'general',
        priority: 2,
        title: 'Заказы снижаются',
        description: `Число заказов ${od.toFixed(1)}% vs ${kpi.compareLabel.toLowerCase()}. Возможна потеря видимости в выдаче.`,
        metric: `${od.toFixed(0)}%`,
      });
    }
  }

  // 3. Высокий ДРР.
  if (kpi.current.drrPct !== null && kpi.current.drrPct > 25) {
    insights.push({
      type: 'danger',
      category: 'ads',
      priority: 1,
      title: 'ДРР выше 25%',
      description: `Текущий ДРР: ${kpi.current.drrPct.toFixed(1)}%. Цель ≤ 20%. Пересмотрите рекламу: убыточные кампании или товары с низкой маржой.`,
      metric: `ДРР ${kpi.current.drrPct.toFixed(0)}%`,
    });
  }

  // 4. Реклама без продаж.
  const adsNoOrders = rows.filter((r) => r.adsRub > 0 && r.delivered === 0);
  if (adsNoOrders.length > 0) {
    const burn = adsNoOrders.reduce((sum, r) => sum + r.adsRub, 0);
    insights.push({
      type: 'danger',
      category: 'ads',
      priority: 1,
      title: `${adsNoOrders.length} ${pluralize(adsNoOrders.length, ['товар', 'товара', 'товаров'])} сжигают рекламу без продаж`,
      description: `Расход: ${fmtRub(burn)}. Рассмотрите отключение кампаний на эти SKU.`,
      metric: fmtRub(burn),
    });
  }

  // 5. Мало остатков с продажами (OOS-риск).
  const lowStock = rows.filter((r) => r.delivered > 0 && (r.daysOfStock ?? Infinity) < 14);
  if (lowStock.length >= 3) {
    insights.push({
      type: 'warning',
      category: 'stock',
      priority: 1,
      title: `${lowStock.length} ходовых SKU с остатком <14 дней`,
      description: `Срочно докупите: ${lowStock
        .slice(0, 3)
        .map((r) => r.article ?? r.name)
        .join(', ')}${lowStock.length > 3 ? '…' : ''}.`,
    });
  }

  // 6. Замороженный капитал в остатках без продаж.
  if (s.frozenStockValueRub > 0 && s.frozenStockValueRub >= s.stockValueRub * 0.2 && s.stockValueRub > 0) {
    insights.push({
      type: 'warning',
      category: 'stock',
      priority: 2,
      title: 'Заморожен капитал в неликвиде',
      description: `${fmtRub(s.frozenStockValueRub)} в остатках товаров без продаж за период (${((s.frozenStockValueRub / s.stockValueRub) * 100).toFixed(0)}% склада). Рассмотрите акции/уценку.`,
      metric: fmtRub(s.frozenStockValueRub),
    });
  }

  // 7. Нет остатков но раньше продавалось.
  const oos = rows.filter(
    (r) => r.stockMarketplace + r.stockOwn === 0 && r.delivered === 0 && r.priceRub > 0,
  );
  if (oos.length >= 5) {
    insights.push({
      type: 'info',
      category: 'stock',
      priority: 3,
      title: `${oos.length} SKU без остатка и без заказов`,
      description: 'Возможно, товары неактивны или сняты с производства. Рассмотрите архивирование.',
    });
  }

  // 8. Товары с маржой ≤ 0.
  if (s.negMargin > 0) {
    insights.push({
      type: 'danger',
      category: 'products',
      priority: 1,
      title: `${s.negMargin} ${pluralize(s.negMargin, ['товар', 'товара', 'товаров'])} с нулевой/отрицательной маржой`,
      description: 'Цена ≤ себестоимости. Поднимите цену или уберите из рекламы — каждая продажа в минус.',
      metric: `${s.negMargin} шт`,
    });
  }

  // 9. Высокая концентрация выручки (ABC).
  if (s.top3SharePct >= 60 && rows.length >= 5) {
    insights.push({
      type: 'info',
      category: 'products',
      priority: 2,
      title: 'Высокая концентрация выручки',
      description: `Топ-3 SKU дают ${s.top3SharePct.toFixed(0)}% выручки. Риск зависимости — развивайте ассортимент.`,
      metric: `${s.top3SharePct.toFixed(0)}%`,
    });
  }

  // 10. Высокий % возвратов.
  const returnDenom = analytics.totals.delivered + analytics.totals.returned;
  const returnPct = returnDenom > 0 ? (analytics.totals.returned / returnDenom) * 100 : 0;
  if (returnPct > 10) {
    insights.push({
      type: 'warning',
      category: 'returns',
      priority: 2,
      title: `Высокий % возвратов: ${returnPct.toFixed(1)}%`,
      description: 'Проверьте качество, описание и размерную сетку проблемных товаров.',
      metric: `${returnPct.toFixed(0)}%`,
    });
  }

  // 11. Низкий средний выкуп.
  if (s.avgBuyoutPct !== null && s.avgBuyoutPct < 70 && s.withSales >= 3) {
    insights.push({
      type: 'warning',
      category: 'returns',
      priority: 3,
      title: `Низкий выкуп: ${s.avgBuyoutPct.toFixed(0)}%`,
      description: 'Покупатели часто не забирают заказы. Для FBS — пересмотрите упаковку/сроки, для рекламы — таргетинг.',
      metric: `${s.avgBuyoutPct.toFixed(0)}%`,
    });
  }

  // 12. Топ-сейлеры.
  if (s.topSellers.length > 0 && s.topSellers[0].revenueRub > 0) {
    insights.push({
      type: 'positive',
      category: 'products',
      priority: 3,
      title: 'Топ-3 по выручке',
      description: s.topSellers
        .map((r) => `${r.article ?? r.name}: ${fmtRub(r.revenueRub)}`)
        .join(' · '),
    });
  }

  // Сортировка по приоритету (1 → 3), стабильно.
  return insights.sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
}

/** Группировка инсайтов по категории (для раскрываемых модулей). */
export function groupInsightsByCategory(
  insights: Insight[],
): Array<{ category: InsightCategory; label: string; items: Insight[] }> {
  const map = new Map<InsightCategory, Insight[]>();
  for (const ins of insights) {
    const arr = map.get(ins.category) ?? [];
    arr.push(ins);
    map.set(ins.category, arr);
  }
  return Array.from(map.entries())
    .map(([category, items]) => ({
      category,
      label: INSIGHT_CATEGORY_META[category].label,
      items,
    }))
    .sort((a, b) => INSIGHT_CATEGORY_META[a.category].order - INSIGHT_CATEGORY_META[b.category].order);
}
