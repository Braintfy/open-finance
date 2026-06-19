// PURPOSE: Типы, конфиг-схема и pure-логика для блока unit.ozon-ai-insights.
// Выделено в отдельный (НЕ 'use client') файл, чтобы server-side (DB schema,
// queries, API route) и client-блок импортировали общие типы и rule-based
// генераторы без циклической зависимости с React-компонентом.

import { z } from 'zod';
import type { OzonKpiResponse } from '@/app/api/marketplaces/ozon/kpi/route';
import type { OzonAnalyticsResponse } from '@/app/api/marketplaces/analytics/ozon/route';
import type { OzonAnalyticsRow } from '@/lib/blocks/catalog/unit-ozon-analytics-types';

export type InsightType = 'positive' | 'warning' | 'danger' | 'info';

export type InsightCategory =
  | 'revenue'
  | 'ads'
  | 'products'
  | 'stock'
  | 'returns'
  | 'general';

/**
 * Классификация для tabs-фильтра (как в yoolip): что делать пользователю.
 * action — требует действия сейчас; observation — мониторить;
 * opportunity — точка роста; info — нейтральный факт.
 */
export type InsightKind = 'action' | 'observation' | 'opportunity' | 'info';

/** Рекомендация в стиле yoolip: что сделать + основание + ожидаемый эффект. */
export type InsightRecommendation = {
  action: string;
  basis: string;
  expectedEffect: string;
};

export type Insight = {
  type: InsightType;
  /** Категория для группировки в раскрываемые модули. */
  category: InsightCategory;
  /** Класс для tabs-фильтра. Если не задан — выводится из type. */
  kind?: InsightKind;
  title: string;
  description: string;
  /** Короткая метрика-бейдж, напр. «ДРР 34%». */
  metric?: string;
  /** Приоритет: 1 — высокий, 3 — низкий. Используется для сортировки. */
  priority?: 1 | 2 | 3;
  /** Артикул/SKU товара для per-SKU инсайтов. */
  sku?: string;
  /** Название товара для per-SKU инсайтов. */
  productName?: string;
  /** Короткие пилюли-теги, напр. «Реклама без заказов 3+ дня». */
  tags?: string[];
  /** Структурированная рекомендация (раскрывается в карточке). */
  recommendation?: InsightRecommendation;
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

export const INSIGHT_KIND_META: Record<
  InsightKind,
  { label: string; order: number }
> = {
  action: { label: 'Действие', order: 1 },
  observation: { label: 'Наблюдение', order: 2 },
  opportunity: { label: 'Возможности', order: 3 },
  info: { label: 'Инфо', order: 4 },
};

/** Класс инсайта для tabs: явный kind, иначе выводим из type. */
export function resolveInsightKind(ins: Insight): InsightKind {
  if (ins.kind) return ins.kind;
  if (ins.type === 'danger') return 'action';
  if (ins.type === 'warning') return 'observation';
  if (ins.type === 'positive') return 'opportunity';
  return 'info';
}

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
  /** Активный tab-фильтр авто-инсайтов. 'all' | InsightKind. Persist per-user. */
  insightTab: z
    .enum(['all', 'action', 'observation', 'opportunity', 'info'])
    .default('all'),
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
      kind: 'action',
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
      kind: 'opportunity',
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

  // 13. Рост ДРР по тренду (текущий vs предыдущий период).
  if (
    kpi.previous.drrPct !== null &&
    kpi.current.drrPct !== null &&
    kpi.previous.drrPct > 0 &&
    kpi.current.drrPct > 15 &&
    kpi.current.drrPct >= kpi.previous.drrPct * 1.2
  ) {
    const deltaPp = kpi.current.drrPct - kpi.previous.drrPct;
    insights.push({
      type: 'warning',
      category: 'ads',
      kind: 'observation',
      priority: 2,
      title: 'ДРР растёт по тренду',
      description: `ДРР вырос с ${kpi.previous.drrPct.toFixed(1)}% до ${kpi.current.drrPct.toFixed(1)}% (+${deltaPp.toFixed(1)} п.п.) vs ${kpi.compareLabel.toLowerCase()}. Реклама дорожает быстрее отдачи — проверьте ставки и ключевые слова.`,
      metric: `+${deltaPp.toFixed(1)} п.п.`,
    });
  }

  // 14. Расход на рекламу растёт быстрее выручки.
  if (kpi.previous.adsRub > 0 && kpi.previous.revenueRub > 0 && kpi.current.adsRub > 0) {
    const adsDelta = ((kpi.current.adsRub - kpi.previous.adsRub) / kpi.previous.adsRub) * 100;
    const revDelta = ((kpi.current.revenueRub - kpi.previous.revenueRub) / kpi.previous.revenueRub) * 100;
    if (adsDelta > 20 && adsDelta - revDelta > 25) {
      insights.push({
        type: 'danger',
        category: 'ads',
        kind: 'action',
        priority: 1,
        title: 'Расход на рекламу опережает выручку',
        description: `Реклама ${adsDelta >= 0 ? '+' : ''}${adsDelta.toFixed(0)}%, а выручка ${revDelta >= 0 ? '+' : ''}${revDelta.toFixed(0)}% vs ${kpi.compareLabel.toLowerCase()}. Бюджет растёт без пропорциональной отдачи — пересмотрите кампании.`,
        metric: `реклама ${adsDelta >= 0 ? '+' : ''}${adsDelta.toFixed(0)}%`,
      });
    }
  }

  // 15. Медленная оборачиваемость (много SKU с длинным запасом).
  const stocked = rows.filter((r) => r.stockMarketplace + r.stockOwn > 0);
  const slowMoving = stocked.filter((r) => (r.daysOfStock ?? 0) > 90);
  if (stocked.length >= 5 && slowMoving.length / stocked.length >= 0.4) {
    const sharePct = (slowMoving.length / stocked.length) * 100;
    insights.push({
      type: 'warning',
      category: 'stock',
      kind: 'observation',
      priority: 2,
      title: 'Медленная оборачиваемость склада',
      description: `${slowMoving.length} из ${stocked.length} SKU с остатком (${sharePct.toFixed(0)}%) имеют запас >90 дней. Капитал лежит в товаре — рассмотрите акции и сокращение закупок.`,
      metric: `${sharePct.toFixed(0)}% >90 дн`,
    });
  }

  // 16. Низкая конверсия в корзину (трафик есть, добавлений мало).
  const totalViews = rows.reduce((sum, r) => sum + (r.views ?? 0), 0);
  const totalCartAdds = rows.reduce((sum, r) => sum + (r.cartAdds ?? 0), 0);
  if (totalViews >= 1000) {
    const cartConv = (totalCartAdds / totalViews) * 100;
    if (cartConv < 3) {
      insights.push({
        type: 'warning',
        category: 'products',
        kind: 'observation',
        priority: 3,
        title: 'Низкая конверсия в корзину',
        description: `Из ${fmtInt(totalViews)} просмотров только ${cartConv.toFixed(1)}% дошли до корзины. Поработайте над карточками: фото, цена, отзывы, заголовки.`,
        metric: `${cartConv.toFixed(1)}% в корзину`,
      });
    }
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

function skuLabel(r: OzonAnalyticsRow): string {
  return r.article || r.name || r.sku || 'SKU';
}

/** Ранг важности для сортировки per-SKU инсайтов (меньше = важнее). */
function severityRank(type: InsightType): number {
  return type === 'danger' ? 0 : type === 'warning' ? 1 : type === 'positive' ? 2 : 3;
}

/**
 * Per-SKU анализаторы (как yoolip): инсайты по конкретным товарам с
 * рекомендацией (Действие / Основание / Ожидаемый эффект). Pure — тестируемо.
 * Возвращает топ-N по важности и влиянию (выручка/расход).
 */
export function generatePerSkuInsights(
  analytics: OzonAnalyticsResponse,
  limit = 20,
): Insight[] {
  const rows = analytics.rows;
  const out: Insight[] = [];

  // Средний % возвратов по товарам с продажами (для сравнения «в N× выше нормы»).
  let retSum = 0;
  let retCount = 0;
  for (const r of rows) {
    const denom = r.delivered + r.returned;
    if (denom >= 3) {
      retSum += (r.returned / denom) * 100;
      retCount += 1;
    }
  }
  const avgReturnPct = retCount > 0 ? retSum / retCount : null;

  for (const r of rows) {
    const label = skuLabel(r);
    const units = r.stockMarketplace + r.stockOwn;
    const marginRub = r.priceRub - r.costRub;

    // 1. Приостановить кампанию — реклама без заказов.
    if (r.adsRub > 0 && r.delivered === 0) {
      out.push({
        type: 'danger',
        category: 'ads',
        kind: 'action',
        priority: 1,
        sku: r.sku ?? r.article ?? undefined,
        productName: r.name,
        title: `Реклама без заказов: ${label}`,
        description: `Расход на рекламу ${fmtRub(r.adsRub)} при нуле доставленных заказов за период.`,
        metric: fmtRub(r.adsRub),
        tags: ['Реклама без заказов', 'Слив бюджета'],
        recommendation: {
          action: 'Приостановить или пересобрать рекламную кампанию',
          basis: `Реклама расходует ${fmtRub(r.adsRub)}, но не приносит заказов.`,
          expectedEffect: 'Прекращение слива бюджета, перераспределение на работающие SKU.',
        },
      });
      continue;
    }

    // 2. Высокий ДРР на товаре.
    if (r.drrPct !== null && r.drrPct > 30 && r.adsRub > 0 && r.delivered > 0) {
      out.push({
        type: 'warning',
        category: 'ads',
        kind: 'action',
        priority: 1,
        sku: r.sku ?? r.article ?? undefined,
        productName: r.name,
        title: `Высокий ДРР: ${label}`,
        description: `ДРР ${r.drrPct.toFixed(0)}% при расходе ${fmtRub(r.adsRub)}. Реклама съедает маржу товара.`,
        metric: `ДРР ${r.drrPct.toFixed(0)}%`,
        tags: ['Высокий ДРР', 'Реклама съедает маржу'],
        recommendation: {
          action: 'Снизить ставки или оптимизировать ключевые слова',
          basis: `ДРР ${r.drrPct.toFixed(0)}% значительно выше целевых 20%.`,
          expectedEffect: 'Снижение ДРР и рост прибыли с заказа.',
        },
      });
      continue;
    }

    // 3. Нулевые остатки при активной карточке.
    if (units === 0 && (r.delivered > 0 || r.priceRub > 0)) {
      const hadDemand = r.delivered > 0;
      out.push({
        type: hadDemand ? 'danger' : 'info',
        category: 'stock',
        kind: hadDemand ? 'action' : 'info',
        priority: hadDemand ? 1 : 3,
        sku: r.sku ?? r.article ?? undefined,
        productName: r.name,
        title: `Нет остатка: ${label}`,
        description: hadDemand
          ? `Остаток 0 при ${r.delivered} продажах за период — теряются заказы и позиции в выдаче.`
          : `Остаток 0 при активной карточке. Товар не участвует в продажах.`,
        metric: '0 шт',
        tags: hadDemand ? ['Нет в наличии', 'Был спрос'] : ['Нет в наличии'],
        recommendation: {
          action: 'Срочно пополнить остаток',
          basis: hadDemand
            ? `${r.delivered} заказов за период при нулевом остатке.`
            : 'Активная карточка без остатка.',
          expectedEffect: 'Возврат продаж и сохранение позиций в поиске.',
        },
      });
      continue;
    }

    // 4. OOS-риск — низкий остаток при продажах.
    if (r.delivered > 0 && units > 0 && r.daysOfStock !== null && r.daysOfStock < 14) {
      out.push({
        type: 'warning',
        category: 'stock',
        kind: 'action',
        priority: 1,
        sku: r.sku ?? r.article ?? undefined,
        productName: r.name,
        title: `Скоро закончится: ${label}`,
        description: `Запаса хватит на ~${r.daysOfStock.toFixed(0)} дн при текущих продажах (${r.delivered} шт за период).`,
        metric: `${r.daysOfStock.toFixed(0)} дн`,
        tags: ['Низкий остаток', `${r.daysOfStock.toFixed(0)} дн запаса`],
        recommendation: {
          action: 'Запланировать поставку',
          basis: `Остаток ${units} шт при скорости ${r.delivered} шт/период.`,
          expectedEffect: 'Избежать out-of-stock и потери оборота.',
        },
      });
      continue;
    }

    // 5. Убыточный товар — цена ≤ себестоимости.
    if (r.costRub > 0 && r.priceRub > 0 && marginRub <= 0) {
      out.push({
        type: 'danger',
        category: 'products',
        kind: 'action',
        priority: 1,
        sku: r.sku ?? r.article ?? undefined,
        productName: r.name,
        title: `Убыточный товар: ${label}`,
        description: `Цена ${fmtRub(r.priceRub)} ≤ себестоимости ${fmtRub(r.costRub)}. Каждая продажа в минус.`,
        metric: `${fmtRub(marginRub)}/шт`,
        tags: ['Убыточный товар', 'Цена ≤ себестоимости'],
        recommendation: {
          action: 'Поднять цену или убрать из рекламы',
          basis: `Маржа ${fmtRub(marginRub)} на единицу.`,
          expectedEffect: 'Выход в положительную маржу.',
        },
      });
      continue;
    }

    // 6. Высокие возвраты по товару.
    const retDenom = r.delivered + r.returned;
    if (
      r.returned >= 3 &&
      retDenom > 0 &&
      avgReturnPct !== null &&
      (r.returned / retDenom) * 100 > Math.max(avgReturnPct * 2, 10)
    ) {
      const retPct = (r.returned / retDenom) * 100;
      out.push({
        type: 'warning',
        category: 'returns',
        kind: 'observation',
        priority: 2,
        sku: r.sku ?? r.article ?? undefined,
        productName: r.name,
        title: `Высокие возвраты: ${label}`,
        description: `${retPct.toFixed(0)}% возвратов (${r.returned} шт) — заметно выше среднего ${avgReturnPct.toFixed(0)}%.`,
        metric: `${retPct.toFixed(0)}%`,
        tags: ['Возвраты выше нормы'],
        recommendation: {
          action: 'Проверить качество, описание и размерную сетку',
          basis: `Возвраты ${retPct.toFixed(0)}% против среднего ${avgReturnPct.toFixed(0)}%.`,
          expectedEffect: 'Снижение возвратов и рост чистой выручки.',
        },
      });
      continue;
    }

    // 7. Замороженный неликвид — остаток без продаж.
    if (units > 0 && r.delivered === 0 && r.costRub > 0 && r.costRub * units >= 5000) {
      out.push({
        type: 'warning',
        category: 'stock',
        kind: 'opportunity',
        priority: 2,
        sku: r.sku ?? r.article ?? undefined,
        productName: r.name,
        title: `Неликвид: ${label}`,
        description: `${units} шт на сумму ${fmtRub(r.costRub * units)} без продаж за период.`,
        metric: fmtRub(r.costRub * units),
        tags: ['Неликвид', 'Капитал заморожен'],
        recommendation: {
          action: 'Запустить акцию или уценку',
          basis: `Остаток на ${fmtRub(r.costRub * units)} не оборачивается.`,
          expectedEffect: 'Высвобождение замороженного капитала.',
        },
      });
      continue;
    }
  }

  // 8. Масштабировать лидеров — высокая выручка + хорошая маржа + низкий ДРР.
  const winners = [...rows]
    .filter(
      (r) =>
        r.revenueRub > 0 &&
        r.delivered > 0 &&
        r.costRub > 0 &&
        (r.priceRub - r.costRub) / r.priceRub > 0.2 &&
        (r.drrPct === null || r.drrPct < 15),
    )
    .sort((a, b) => b.revenueRub - a.revenueRub)
    .slice(0, 3);
  for (const r of winners) {
    out.push({
      type: 'positive',
      category: 'products',
      kind: 'opportunity',
      priority: 3,
      sku: r.sku ?? r.article ?? undefined,
      productName: r.name,
      title: `Масштабировать: ${skuLabel(r)}`,
      description: `Выручка ${fmtRub(r.revenueRub)} при хорошей марже${r.drrPct !== null ? ` и ДРР ${r.drrPct.toFixed(0)}%` : ''}. Есть запас для роста рекламы.`,
      metric: fmtRub(r.revenueRub),
      tags: ['Лидер продаж', r.drrPct !== null ? `ДРР ${r.drrPct.toFixed(0)}%` : 'Хорошая маржа'],
      recommendation: {
        action: 'Увеличить рекламный бюджет на товар',
        basis: 'Высокая выручка при хорошей марже и низком ДРР.',
        expectedEffect: 'Масштабирование прибыльных продаж.',
      },
    });
  }

  return out
    .sort((a, b) => {
      const sr = severityRank(a.type) - severityRank(b.type);
      if (sr !== 0) return sr;
      return 0;
    })
    .slice(0, limit);
}

/**
 * Объединённый список: агрегатные + per-SKU инсайты. Стабильная сортировка
 * по приоритету (агрегатные идут первыми при равном приоритете).
 */
export function generateAllInsights(
  kpi: OzonKpiResponse,
  analytics: OzonAnalyticsResponse,
): Insight[] {
  const aggregate = generateInsights(kpi, analytics);
  const perSku = generatePerSkuInsights(analytics);
  return [...aggregate, ...perSku];
}

/** Tabs-фильтр: вкладки kind со счётчиками (как yoolip). */
export function buildInsightTabs(
  insights: Insight[],
): Array<{ key: 'all' | InsightKind; label: string; count: number }> {
  const counts: Record<InsightKind, number> = {
    action: 0,
    observation: 0,
    opportunity: 0,
    info: 0,
  };
  for (const ins of insights) counts[resolveInsightKind(ins)] += 1;
  const tabs: Array<{ key: 'all' | InsightKind; label: string; count: number }> = [
    { key: 'all', label: 'Все', count: insights.length },
  ];
  (Object.keys(INSIGHT_KIND_META) as InsightKind[])
    .sort((a, b) => INSIGHT_KIND_META[a].order - INSIGHT_KIND_META[b].order)
    .forEach((k) => {
      if (counts[k] > 0) tabs.push({ key: k, label: INSIGHT_KIND_META[k].label, count: counts[k] });
    });
  return tabs;
}

/** Фильтрация инсайтов по выбранному tab. */
export function filterInsightsByTab(
  insights: Insight[],
  tab: 'all' | InsightKind,
): Insight[] {
  if (tab === 'all') return insights;
  return insights.filter((ins) => resolveInsightKind(ins) === tab);
}

// ─────────────────────────────────────────────────────────────────────────────
// Парсинг ответа ИИ (контракт — один JSON-объект { summary, insights[] }).
// Pure-функция: тестируется в scripts/test-ozon-ai-insights-parse.ts и
// используется клиентской модалкой OzonAiInsightsDialog.
// ─────────────────────────────────────────────────────────────────────────────

/** Результат парсинга ответа ИИ. */
export type ParsedAiReport = { summary: string; insights: Insight[] };

const VALID_INSIGHT_TYPES = new Set<string>(['positive', 'warning', 'danger', 'info']);
const VALID_INSIGHT_CATEGORIES = new Set<string>([
  'revenue',
  'ads',
  'products',
  'stock',
  'returns',
  'general',
]);
const VALID_INSIGHT_KINDS = new Set<string>(['action', 'observation', 'opportunity', 'info']);

function clampStr(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined;
}

function parseRecommendation(v: unknown): InsightRecommendation | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const action = clampStr(r.action, 300);
  const basis = clampStr(r.basis, 500);
  const expectedEffect = clampStr(r.expectedEffect, 500);
  if (!action && !basis && !expectedEffect) return undefined;
  return { action: action ?? '', basis: basis ?? '', expectedEffect: expectedEffect ?? '' };
}

/** Безопасный JSON.parse → объект-запись или null. */
function safeParseObj(s: string): Record<string, unknown> | null {
  try {
    const o: unknown = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Подстрока сбалансированного {…}-объекта начиная с openIdx (там должна быть `{`).
 * Уважает строки и escape. Возвращает [slice, endIndex] или null, если объект
 * не закрылся (усечённый ответ модели).
 */
function balancedObjectAt(text: string, openIdx: number): [string, number] | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return [text.slice(openIdx, i + 1), i];
    }
  }
  return null;
}

/** Все валидные top-level JSON-объекты в тексте (во вложенные не спускаемся). */
function* topLevelObjects(text: string): Generator<Record<string, unknown>> {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const bal = balancedObjectAt(text, i);
    if (!bal) continue; // от этой `{` не закрылось — пробуем следующую
    i = bal[1]; // перепрыгнуть за объект, чтобы не дублировать вложенные
    const obj = safeParseObj(bal[0]);
    if (obj) yield obj;
  }
}

/** Распарсить один инсайт из произвольного объекта. Требует непустой title. */
function parseInsight(r: Record<string, unknown>): Insight | null {
  const title = typeof r.title === 'string' ? r.title : '';
  if (!title) return null;
  const type = String(r.type ?? 'info');
  const category = String(r.category ?? 'general');
  const kind =
    typeof r.kind === 'string' && VALID_INSIGHT_KINDS.has(r.kind) ? (r.kind as InsightKind) : undefined;
  const tags = Array.isArray(r.tags)
    ? r.tags
        .filter((t): t is string => typeof t === 'string' && !!t.trim())
        .map((t) => t.slice(0, 60))
        .slice(0, 4)
    : undefined;
  return {
    type: (VALID_INSIGHT_TYPES.has(type) ? type : 'info') as InsightType,
    category: (VALID_INSIGHT_CATEGORIES.has(category) ? category : 'general') as InsightCategory,
    kind,
    title: title.slice(0, 300),
    description: typeof r.description === 'string' ? r.description.slice(0, 2000) : '',
    metric: typeof r.metric === 'string' ? r.metric.slice(0, 120) : undefined,
    priority:
      r.priority === 1 || r.priority === 2 || r.priority === 3 ? (r.priority as 1 | 2 | 3) : undefined,
    sku: clampStr(r.sku, 120),
    productName: clampStr(r.productName, 300),
    tags: tags && tags.length ? tags : undefined,
    recommendation: parseRecommendation(r.recommendation),
  };
}

/** Собрать отчёт из корневого объекта { summary, insights[] }. */
function buildReport(o: Record<string, unknown>): ParsedAiReport | null {
  const summary = typeof o.summary === 'string' ? o.summary : '';
  const rawInsights = Array.isArray(o.insights) ? o.insights : [];
  const insights: Insight[] = [];
  for (const it of rawInsights) {
    if (!it || typeof it !== 'object') continue;
    const ins = parseInsight(it as Record<string, unknown>);
    if (ins) insights.push(ins);
  }
  if (!summary && insights.length === 0) return null;
  return { summary, insights };
}

/** Достать summary регуляркой — фолбэк, когда корневой объект оборвался. */
function matchSummary(text: string): string | undefined {
  const m = text.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!m) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

/**
 * Извлечь отчёт из ответа ИИ. Терпимо к: markdown-обёртке (```json),
 * преамбуле/эпилогу с посторонними скобками (модель иногда добавляет вступление
 * вопреки инструкции — частая причина «не удалось разобрать» на первом запуске)
 * и к усечённому JSON (модель не дописала ответ). Стратегии:
 *  1) полноценный корневой объект { summary, insights } среди top-level объектов;
 *  2) спасение — каждый сбалансированный объект с title как отдельный инсайт +
 *     summary регуляркой (когда корень оборвался на полуслове).
 * Возвращает null только если не нашлось ни summary, ни одного инсайта.
 */
export function parseAiInsightsReport(raw: string): ParsedAiReport | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const objects = [...topLevelObjects(text)];

  // 1) Полноценный отчёт.
  for (const o of objects) {
    if ('summary' in o || Array.isArray(o.insights)) {
      const rep = buildReport(o);
      if (rep) return rep;
    }
  }

  // 2) Спасение из усечённого/«грязного» ответа.
  const insights: Insight[] = [];
  for (const o of objects) {
    const ins = parseInsight(o);
    if (ins) insights.push(ins);
  }
  const summary = matchSummary(text) ?? '';
  if (!summary && insights.length === 0) return null;
  return { summary, insights };
}
