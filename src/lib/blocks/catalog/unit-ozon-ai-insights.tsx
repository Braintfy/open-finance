// PURPOSE: Блок «Ozon · AI инсайты» — раскрываемые модули (Показатели,
// Авто-инсайты по категориям, ИИ-отчёты), rule-based аналитика +
// ИИ-генерация с историей отчётов в БД (лимит 10 на блок).
// Логика/типы — в unit-ozon-ai-insights-types.ts (shared с server).

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Lock,
  RefreshCw,
  Wand2,
  ChevronDown,
  ChevronRight,
  Trash2,
  Loader2,
  BarChart3,
  ListChecks,
  History,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  PeriodPicker,
  resolvePeriod,
  describePeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { useBlockValuePublisher, formatPeriodKey } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import { InsightCard } from '@/components/unit-economics/ozon-insight-card';
import { renderInlineMd } from '@/components/unit-economics/inline-md';
import { OzonAiInsightsDialog } from '@/components/unit-economics/ozon-ai-insights-dialog';
import {
  OzonAiInsightsBlockConfigSchema,
  parseOzonAiInsightsConfig,
  generateAllInsights,
  computeInsightMetrics,
  buildInsightTabs,
  filterInsightsByTab,
  summarizeAnalytics,
  type AiInsightReport,
  type InsightMetric,
  type MetricTone,
  type InsightKind,
} from './unit-ozon-ai-insights-types';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type { OzonKpiResponse } from '@/app/api/marketplaces/ozon/kpi/route';
import type { OzonAnalyticsResponse } from '@/app/api/marketplaces/analytics/ozon/route';

const METRIC_TONE_CLS: Record<MetricTone, string> = {
  good: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-rose-700 dark:text-rose-300',
  neutral: 'text-foreground',
};

/** Раскрываемый модуль внутри блока. */
function Module({
  title,
  icon: Icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: typeof BarChart3;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left hover:bg-accent/40"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium">{title}</span>
        {count !== undefined && (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </button>
      {open && <div className="space-y-2 border-t border-border/50 p-2">{children}</div>}
    </div>
  );
}

function MetricTile({ metric }: { metric: InsightMetric }) {
  return (
    <div className="rounded-md border border-border/50 bg-card px-2 py-1.5">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground" title={metric.label}>
        {metric.label}
      </div>
      <div className={'text-[14px] font-semibold tabular-nums ' + METRIC_TONE_CLS[metric.tone ?? 'neutral']}>
        {metric.value}
      </div>
      {metric.hint && (
        <div className="truncate text-[10px] text-muted-foreground/80" title={metric.hint}>
          {metric.hint}
        </div>
      )}
    </div>
  );
}

function RenderOzonAiInsights({ instance, onConfigChange }: BlockRenderProps) {
  const config = useMemo(() => parseOzonAiInsightsConfig(instance.config), [instance.config]);
  const {
    period,
    setOverride: setPeriodOverride,
    resetToGlobal: resetPeriodToGlobal,
    isOverride: isPeriodOverride,
    ready: periodReady,
  } = useBlockPeriod({
    instanceId: instance.id,
    configOverride: {
      preset: config.periodPreset,
      customFrom: config.customFrom ?? null,
      customTo: config.customTo ?? null,
    },
    defaultMode: 'global',
    onConfigChange: (next) => {
      if (next) {
        onConfigChange?.({
          ...config,
          periodPreset: next.preset,
          customFrom: next.customFrom,
          customTo: next.customTo,
        } as unknown as Record<string, unknown>);
      }
    },
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
  const [kpi, setKpi] = useState<OzonKpiResponse | null>(null);
  const [analytics, setAnalytics] = useState<OzonAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [reports, setReports] = useState<AiInsightReport[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
      setKpi(null);
      setAnalytics(null);
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
      const kpiJson = (await kpiRes.json()) as OzonKpiResponse | { ok: false; error: string };
      const analyticsJson = (await analyticsRes.json()) as
        | OzonAnalyticsResponse
        | { ok: false; error: string };
      if (!mountedRef.current) return;
      if (!('ok' in kpiJson) || !kpiJson.ok) {
        setError(('error' in kpiJson ? kpiJson.error : 'KPI error') ?? 'KPI error');
        return;
      }
      if (!('ok' in analyticsJson) || !analyticsJson.ok) {
        setError(('error' in analyticsJson ? analyticsJson.error : 'Analytics error') ?? 'Analytics error');
        return;
      }
      setKpi(kpiJson);
      setAnalytics(analyticsJson);
      setLastUpdate(new Date());
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [config.accountId, period.preset, period.customFrom, period.customTo]);

  useEffect(() => {
    if (periodReady) refresh();
  }, [refresh, periodReady]);

  // История ИИ-отчётов из БД (scoped на блок).
  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/marketplaces/ozon/ai-insights/reports?blockId=${encodeURIComponent(instance.id)}`,
      );
      const json = (await res.json()) as { ok?: boolean; reports?: AiInsightReport[] };
      if (!mountedRef.current) return;
      if (json?.ok && Array.isArray(json.reports)) setReports(json.reports);
    } catch {
      /* ignore — история не критична */
    }
  }, [instance.id]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleDeleteReport = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/marketplaces/ozon/ai-insights/reports/${id}`, {
        method: 'DELETE',
      });
      if (res.ok && mountedRef.current) setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      /* ignore */
    } finally {
      if (mountedRef.current) setDeletingId(null);
    }
  }, []);

  const insights = useMemo(
    () => (kpi && analytics ? generateAllInsights(kpi, analytics) : []),
    [kpi, analytics],
  );
  const metrics = useMemo(
    () => (kpi && analytics ? computeInsightMetrics(kpi, analytics) : []),
    [kpi, analytics],
  );
  const insightTabs = useMemo(() => buildInsightTabs(insights), [insights]);
  // Если сохранённый tab больше не содержит инсайтов — показываем «Все».
  const activeTab = insightTabs.some((t) => t.key === config.insightTab)
    ? config.insightTab
    : 'all';
  const visibleInsights = useMemo(
    () => filterInsightsByTab(insights, activeTab),
    [insights, activeTab],
  );
  const setInsightTab = useCallback(
    (tab: 'all' | InsightKind) => {
      onConfigChange?.({ ...config, insightTab: tab } as unknown as Record<string, unknown>);
    },
    [config, onConfigChange],
  );

  const periodLabel = useMemo(() => {
    try {
      const r = resolvePeriod(period.preset, period.customFrom, period.customTo);
      return describePeriod({ from: r.from, to: r.to });
    } catch {
      return undefined;
    }
  }, [period.preset, period.customFrom, period.customTo]);

  // Markdown-контекст для ИИ (KPI + аналитика + авто-инсайты).
  const buildContext = useCallback((): string => {
    if (!kpi || !analytics) return 'Нет данных.';
    const s = summarizeAnalytics(analytics);
    const rub = (v: number) => Math.round(v).toLocaleString('ru-RU') + ' ₽';
    const lines: string[] = [];
    lines.push('#### KPI');
    lines.push(`- Выручка: ${rub(kpi.current.revenueRub)} (предыдущий: ${rub(kpi.previous.revenueRub)})`);
    lines.push(`- Заказы: ${kpi.current.orders} (предыдущий: ${kpi.previous.orders})`);
    lines.push(`- Реклама: ${rub(kpi.current.adsRub)}, ДРР: ${kpi.current.drrPct?.toFixed(1) ?? '—'}%`);
    lines.push(`- Средний чек: ${kpi.current.aovRub ? rub(kpi.current.aovRub) : '—'}, CPO: ${kpi.current.cpoRub ? rub(kpi.current.cpoRub) : '—'}`);
    lines.push('');
    lines.push('#### Аналитика (итоги)');
    lines.push(`- Прибыль (выр−себест): ${rub(s.totalProfitRub)}, маржа ${s.marginPct?.toFixed(1) ?? '—'}%`);
    lines.push(`- Товаров: ${s.rowsCount}, с продажами: ${s.withSales}, без остатка: ${s.noStock}, маржа ≤0: ${s.negMargin}`);
    lines.push(`- Возвраты: ${analytics.totals.returned}, отмены: ${analytics.totals.cancelled}, средний выкуп: ${s.avgBuyoutPct?.toFixed(0) ?? '—'}%`);
    lines.push(`- Стоимость остатков: ${rub(s.stockValueRub)} (${s.stockUnits} шт), заморожено в неликвиде: ${rub(s.frozenStockValueRub)}`);
    lines.push(`- Концентрация: топ-3 SKU = ${s.top3SharePct.toFixed(0)}% выручки`);
    lines.push('');
    lines.push('#### Топ-5 SKU по выручке');
    for (const r of s.topSellers.slice(0, 5)) {
      lines.push(`- ${r.article ?? r.name}: ${rub(r.revenueRub)}, ДРР ${r.drrPct?.toFixed(0) ?? '—'}%, остаток ${r.stockMarketplace + r.stockOwn}`);
    }
    const adsNoSales = analytics.rows
      .filter((r) => r.adsRub > 0 && r.delivered === 0)
      .sort((a, b) => b.adsRub - a.adsRub)
      .slice(0, 5);
    if (adsNoSales.length) {
      lines.push('');
      lines.push('#### Реклама без продаж');
      for (const r of adsNoSales) lines.push(`- ${r.article ?? r.name}: расход ${rub(r.adsRub)}`);
    }
    const aggregateInsights = insights.filter((ins) => !ins.sku);
    if (aggregateInsights.length) {
      lines.push('');
      lines.push('#### Авто-инсайты (rule-based, как факты)');
      for (const ins of aggregateInsights)
        lines.push(`- [${ins.category}/${ins.type}] ${ins.title}: ${ins.description}`);
    }
    return lines.join('\n');
  }, [kpi, analytics, insights]);

  // Cell-binding: счётчики для дашбордов.
  const criticalCount = insights.filter((i) => i.type === 'danger').length;
  // Богатый контекст для «AI Анализ раздела» (конвенция __aiContext).
  const aiContext = useMemo(
    () => (kpi && analytics ? buildContext().slice(0, 5000) : null),
    [kpi, analytics, buildContext],
  );
  useBlockValuePublisher(instance.id, {
    value: insights.length,
    criticalCount,
    aiReports: reports.length,
    __labels: 'value=Инсайтов,criticalCount=Критических,aiReports=ИИ-отчётов',
    __periodKey: formatPeriodKey(period),
    __aiContext: aiContext,
  });

  // Модули раскрытия (состояние в config.expandedModules).
  const isModuleOpen = (key: string, def: boolean) => config.expandedModules[key] ?? def;
  const toggleModule = (key: string, def: boolean) => {
    const cur = config.expandedModules[key] ?? def;
    onConfigChange?.({
      ...config,
      expandedModules: { ...config.expandedModules, [key]: !cur },
    } as unknown as Record<string, unknown>);
  };

  const hasData = Boolean(kpi && analytics);

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
            collapsed
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
            onClick={() => setAiOpen(true)}
            disabled={!hasData}
            title={hasData ? 'Сгенерировать ИИ-анализ' : 'Нет данных для анализа'}
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">ИИ Анализ</span>
          </Button>
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
      <div className="min-h-0 flex-1 space-y-2 overflow-auto">
        {error ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {error}
          </div>
        ) : !hasData ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            {loading ? 'Анализ…' : 'Нет данных за период.'}
          </div>
        ) : (
          <>
            {config.showMetrics && metrics.length > 0 && (
              <Module
                title="Показатели"
                icon={BarChart3}
                open={isModuleOpen('metrics', true)}
                onToggle={() => toggleModule('metrics', true)}
              >
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {metrics.map((m) => (
                    <MetricTile key={m.key} metric={m} />
                  ))}
                </div>
              </Module>
            )}

            <Module
              title="Авто-инсайты"
              icon={ListChecks}
              count={insights.length}
              open={isModuleOpen('auto', true)}
              onToggle={() => toggleModule('auto', true)}
            >
              {insights.length === 0 ? (
                <div className="py-2 text-center text-[11px] text-muted-foreground">
                  Всё стабильно. Аномалий не найдено.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1">
                    {insightTabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setInsightTab(tab.key)}
                        className={
                          'rounded-full px-2 py-0.5 text-[10px] font-medium transition ' +
                          (activeTab === tab.key
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-accent')
                        }
                      >
                        {tab.label} {tab.count}
                      </button>
                    ))}
                  </div>
                  {visibleInsights.length === 0 ? (
                    <div className="py-2 text-center text-[11px] text-muted-foreground">
                      Нет инсайтов в этой категории.
                    </div>
                  ) : (
                    visibleInsights.map((ins, i) => (
                      <InsightCard key={`${ins.category}-${ins.sku ?? ''}-${i}`} insight={ins} />
                    ))
                  )}
                </>
              )}
              {lastUpdate && (
                <div className="text-[10px] text-muted-foreground">
                  Обновлено: {lastUpdate.toLocaleString('ru-RU')}
                </div>
              )}
            </Module>

            <Module
              title="ИИ-отчёты"
              icon={History}
              count={reports.length}
              open={isModuleOpen('reports', true)}
              onToggle={() => toggleModule('reports', true)}
            >
              {reports.length === 0 ? (
                <div className="py-2 text-center text-[11px] text-muted-foreground">
                  Пока нет ИИ-отчётов. Нажмите «ИИ Анализ» для генерации.
                </div>
              ) : (
                reports.map((rep) => {
                  const repKey = `report:${rep.id}`;
                  const repOpen = isModuleOpen(repKey, false);
                  const created = new Date(rep.createdAt);
                  const createdLabel = Number.isNaN(created.getTime())
                    ? ''
                    : created.toLocaleString('ru-RU');
                  return (
                    <div key={rep.id} className="rounded-md border border-border/50">
                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleModule(repKey, false)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          {repOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate text-[11px] font-medium">{createdLabel}</span>
                          {rep.model && (
                            <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">
                              {rep.model}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                            {rep.insights.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteReport(rep.id)}
                          disabled={deletingId === rep.id}
                          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          title="Удалить отчёт"
                        >
                          {deletingId === rep.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      {repOpen && (
                        <div className="space-y-2 border-t border-border/50 p-2">
                          {rep.summary && (
                            <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] leading-relaxed">
                              {renderInlineMd(rep.summary)}
                            </div>
                          )}
                          {rep.insights.map((ins, i) => (
                            <InsightCard key={i} insight={ins} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </Module>
          </>
        )}
      </div>
      <OzonAiInsightsDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        blockId={instance.id}
        accountId={config.accountId}
        periodKey={formatPeriodKey(period)}
        periodLabel={periodLabel}
        buildContext={buildContext}
        onSaved={loadReports}
      />
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseOzonAiInsightsConfig(config);
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
      <label className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2 text-[12px]">
        <span className="flex flex-col">
          <span className="font-medium">Секция «Показатели»</span>
          <span className="text-[10px] text-muted-foreground">Числовой обзор сверху блока.</span>
        </span>
        <Switch
          checked={parsed.showMetrics}
          onCheckedChange={(on) =>
            onChange({ ...parsed, showMetrics: on } as unknown as Record<string, unknown>)
          }
        />
      </label>
    </div>
  );
}

export const UnitOzonAiInsightsBlock: BlockDef = {
  type: 'unit.ozon-ai-insights',
  displayName: 'Ozon · AI инсайты',
  description:
    'Показатели, авто-инсайты по категориям и ИИ-анализ Ozon с историей отчётов: тренд, реклама, остатки, возвраты, рекомендации.',
  category: 'custom',
  icon: Sparkles,
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 4, h: 4 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonAiInsightsBlockConfigSchema,
  defaultConfig: () => OzonAiInsightsBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonAiInsights,
};
