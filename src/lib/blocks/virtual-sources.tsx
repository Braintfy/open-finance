// PURPOSE: Виртуальные источники для bindings — `@cashflow.kpi.{metric}.{field}`.
// Позволяет excel.cell / computed.sum / formula биндиться на cashflow KPI
// БЕЗ необходимости иметь на странице соответствующий stat.* блок.
//
// Идея:
//   - На клиенте — компонент `<VirtualSourcesBridge />` живёт под BlockValuesProvider
//     и BlockGrid, выполняет fetch /api/cashflow/kpi для income/expense/balance
//     с текущими page-level period + source и публикует значения как «обычные»
//     блоки с фиксированным blockId-prefix:
//       `__virtual:cashflow.kpi.income`
//       `__virtual:cashflow.kpi.expense`
//       `__virtual:cashflow.kpi.balance`
//     UI BlockReferencePicker через `useAvailableBlockSources` увидит их сразу.
//   - Любой блок может использовать обычные refs вида
//     `@__virtual:cashflow.kpi.income.current` — никаких изменений в формуле не нужно.
//   - Server-side resolver (для cross-page bindings) умеет распарсивать
//     `__virtual:cashflow.kpi.*` и зовёт `getCashflowKpi` напрямую (см. /api/blocks/sources).

'use client';

import { useEffect, useState } from 'react';
import { useBlockValuePublisher } from './values';
import { useEffectivePeriod } from './page-period-context';
import { useEffectiveSource } from './page-source-context';
import { type PeriodPreset } from '@/components/blocks/period-picker';

export const VIRTUAL_CASHFLOW_BLOCK_IDS = {
  income: '__virtual:cashflow.kpi.income',
  expense: '__virtual:cashflow.kpi.expense',
  balance: '__virtual:cashflow.kpi.balance',
} as const;

export type VirtualCashflowMetric = keyof typeof VIRTUAL_CASHFLOW_BLOCK_IDS;

const METRIC_LABELS: Record<VirtualCashflowMetric, string> = {
  income: 'Доходы (Cashflow)',
  expense: 'Расходы (Cashflow)',
  balance: 'Баланс (Cashflow)',
};

type Kpi = {
  current: number;
  previous: number;
  count: number;
  prevCount: number;
  deltaPct: number | null;
};

export function useCashflowKpiLite(
  metric: VirtualCashflowMetric,
  period: { preset: PeriodPreset; customFrom: string | null; customTo: string | null },
  source: string | null,
): Kpi | null {
  const [data, setData] = useState<Kpi | null>(null);
  const cacheKey = `${metric}|${period.preset}|${period.customFrom}|${period.customTo}|${source ?? ''}`;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ metric, preset: period.preset });
    if (period.customFrom) params.set('customFrom', period.customFrom);
    if (period.customTo) params.set('customTo', period.customTo);
    if (source) params.set('source', source);
    fetch(`/api/cashflow/kpi?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) {
          setData({
            current: json.current,
            previous: json.previous,
            count: json.count,
            prevCount: json.prevCount,
            deltaPct: json.deltaPct,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);
  return data;
}

function VirtualMetricPublisher({ metric }: { metric: VirtualCashflowMetric }) {
  // Используем «глобальный» (без override) period+source — виртуальный
  // источник всегда отражает page-level state.
  const { value: period } = useEffectivePeriod(`__virtual:${metric}`, null);
  const { value: source } = useEffectiveSource(`__virtual:${metric}`, undefined);
  const kpi = useCashflowKpiLite(metric, period, source);

  useBlockValuePublisher(VIRTUAL_CASHFLOW_BLOCK_IDS[metric], {
    value: kpi?.current ?? 0,
    current: kpi?.current ?? 0,
    previous: kpi?.previous ?? 0,
    count: kpi?.count ?? 0,
    prevCount: kpi?.prevCount ?? 0,
    deltaPct: kpi?.deltaPct ?? 0,
    label: METRIC_LABELS[metric],
    __money: 'value,current,previous',
    __labels: `value=Сумма,current=Сумма за период,previous=Прошлый период,count=Кол-во операций,deltaPct=Изменение %`,
  });

  return null;
}

/**
 * Bridge-компонент: рендерит публикацию всех cashflow KPI как виртуальных
 * источников для bindings. Кладите внутрь `BlockValuesProvider` на cashflow-странице.
 */
export function VirtualSourcesBridge() {
  return (
    <>
      <VirtualMetricPublisher metric="income" />
      <VirtualMetricPublisher metric="expense" />
      <VirtualMetricPublisher metric="balance" />
    </>
  );
}

/**
 * Распознаёт виртуальный blockId типа `__virtual:cashflow.kpi.{metric}`.
 */
export function parseVirtualCashflowBlockId(
  blockId: string,
): { metric: VirtualCashflowMetric } | null {
  const match = blockId.match(/^__virtual:cashflow\.kpi\.(income|expense|balance)$/);
  if (!match) return null;
  return { metric: match[1] as VirtualCashflowMetric };
}

/**
 * Извлекает все виртуальные cashflow KPI metric'и, которые используются в формуле/значении.
 * Распознаёт `@__virtual:cashflow.kpi.{metric}` (без точки в конце или с любым полем).
 */
export function extractVirtualCashflowMetrics(value: string): VirtualCashflowMetric[] {
  if (!value) return [];
  const matches = value.matchAll(/@__virtual:cashflow\.kpi\.(income|expense|balance)(?:\.[a-zA-Z]+)?/g);
  const set = new Set<VirtualCashflowMetric>();
  for (const m of matches) set.add(m[1] as VirtualCashflowMetric);
  return Array.from(set);
}
