// PURPOSE: Блок «Склад · Пробелы» (stock.gaps) — единый экран того, что прямо
// сейчас тихо искажает себестоимость и прибыль (docs/STOCK_MODULE_DESIGN.md §7
// блок 6, инвариант §1.10 «молчаливого нуля не бывает»).
//
// ЧТО ЗДЕСЬ ПРИНЦИПИАЛЬНО:
//   • Это НЕ список ошибок системы, а список работы для человека, и у каждой
//     строки есть цена. Поэтому у каждой секции первым делом — ПОСЛЕДСТВИЕ
//     одной строкой («валовая прибыль завышена»), а уже потом цифры: без
//     последствия пользователь читает экран как технический лог и закрывает.
//   • Продажа без сшивки или без себестоимости НЕ считается «COGS = 0» (§1.10),
//     она попадает сюда с суммой выручки — «Выручка мимо себестоимости» в шапке
//     это цена бездействия за период.
//   • Блок с периодом: useBlockPeriod + публикация __periodKey (docs/PAGE_PERIODS.md).
//     `periodOverride` в config НЕнулевой только когда пользователь выбрал свой
//     период: seed из непустого config означал бы, что блок стартует в
//     override-режиме и панель периода страницы на него не действует.
//   • Границы периода берутся строками из resolveOzonPeriod (MSC), а не через
//     локальные геттеры Date: роут /api/stock/gaps считает по календарю Москвы.
//   • Раскрытие секций персистится в config (collapsedSections): голый useState
//     сбрасывается на дефолт при ре-рендере грида (грабля compareMode в Ozon KPI).
//   • Секция «Расхождения сверки» показывается только при reconOpenCount > 0 —
//     stock_recon наполняется отдельной кнопкой, которой в этом релизе нет, и
//     вечный ноль в списке работы обесценивает весь экран.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { AlertTriangle, CheckCircle2, ChevronRight, Link2, Lock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  PeriodPicker,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { resolveOzonPeriod } from '@/lib/blocks/period-resolver';
import { shiftIsoDate } from '@/lib/marketplaces/ozon/sync/perf-period';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import { KopecksRow, SettingsSection } from '@/components/blocks/settings';
import { useFormatSettings } from '@/lib/format-settings';
import { formatPeriodKey, useBlockValuePublisher } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import {
  emitStockChanged,
  useStockChangedListener,
} from '@/lib/blocks/use-stock-changed';
import { MatchingDialog } from '@/components/stock/matching-dialog';
import { formatMoney, stockFetch } from '@/components/stock/stock-api';
import { cn } from '@/lib/utils';
import type { StockGapsResponse } from '@/app/api/stock/gaps/route';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';

export const StockGapsConfigSchema = z.object({
  /** tri-state: true/false — настройка блока, null — глобальная (blocks.mdc). */
  showKopecks: z.boolean().nullable().default(null),
  /**
   * Ключи СХЛОПНУТЫХ секций. Хранится именно «схлопнутое», а не «раскрытое»:
   * дефолт для непустой секции — раскрыта, и пустой массив не должен прятать
   * работу от человека.
   */
  collapsedSections: z.array(z.string()).default([]),
  /**
   * Свой период блока. `null` = наследовать период страницы (канон
   * docs/PAGE_PERIODS.md). Непустой seed заставлял бы useBlockPeriod стартовать
   * в override-режиме, и PagePeriodHeader молча переставал бы влиять на блок.
   */
  periodOverride: z
    .object({
      preset: z.enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom']),
      customFrom: z.string().nullable().default(null),
      customTo: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
});

export type StockGapsConfig = z.infer<typeof StockGapsConfigSchema>;

function parseConfig(raw: unknown): StockGapsConfig {
  return StockGapsConfigSchema.parse(raw ?? {});
}

// --- Форма ответа GET /api/stock/gaps ---------------------------------------
// Тип берётся ИЗ РОУТА через `import type`. Он стирается компилятором и
// серверный модуль в клиентский бандл НЕ тянет (так же сделаны все unit-ozon-*
// блоки) — прежняя локальная копия типов молча расходилась бы с API при первой
// же правке роута, а «поле есть, но undefined» здесь означает потерянные деньги.
type GapsResponse = Omit<StockGapsResponse, 'ok'>;

/** Сколько строк секции показываем, не превращая экран в дамп. */
const MAX_ROWS = 50;

const TONE_BADGE: Record<'danger' | 'warn' | 'info', string> = {
  danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900',
  warn: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900',
};

function formatQty(qty: number): string {
  return Number.isFinite(qty) ? qty.toLocaleString('ru-RU') : '0';
}

/**
 * Секция-аккордеон. Пустая — приглушена и не раскрывается: в списке работы
 * пустая строка не должна выглядеть кликабельной задачей.
 */
function GapSection({
  title,
  consequence,
  count,
  tone,
  moneyKopecks,
  showKopecks,
  open,
  onToggle,
  action,
  children,
}: {
  title: string;
  consequence: string;
  count: number;
  tone: 'danger' | 'warn' | 'info';
  moneyKopecks?: number;
  showKopecks: boolean;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  const empty = count === 0;
  return (
    <div className={cn('min-w-0 border-b border-border/40', empty && 'opacity-50')}>
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          onClick={empty ? undefined : onToggle}
          disabled={empty}
          aria-expanded={open && !empty}
          className={cn(
            'flex min-w-0 flex-1 items-start gap-1.5 px-2.5 py-2 text-left transition',
            !empty && 'hover:bg-muted/40',
          )}
        >
          <ChevronRight
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              open && !empty && 'rotate-90',
              empty && 'opacity-0',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[12px] font-medium">{title}</span>
              <span
                className={cn(
                  'rounded px-1.5 text-[10px] font-medium tabular-nums ring-1',
                  empty
                    ? 'bg-muted text-muted-foreground ring-transparent'
                    : TONE_BADGE[tone],
                )}
              >
                {formatQty(count)}
              </span>
              {moneyKopecks != null && count > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {formatMoney(moneyKopecks, showKopecks)} ₽
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              {empty ? 'чисто' : consequence}
            </span>
          </span>
        </button>
        {!empty && action && <div className="shrink-0 py-2 pr-2.5">{action}</div>}
      </div>
      {open && !empty && <div className="min-w-0 px-2.5 pb-2">{children}</div>}
    </div>
  );
}

/** Строка списка: слева название + артикул, справа 1–2 числа. */
function GapRow({
  title,
  subtitle,
  right,
  rightHint,
}: {
  title: string;
  subtitle?: string | null;
  right: string;
  rightHint?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-t border-border/30 py-1 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px]">{title}</div>
        {subtitle && (
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[12px] tabular-nums">{right}</div>
        {rightHint && (
          <div className="text-[10px] tabular-nums text-muted-foreground">{rightHint}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Сколько строк скрыто. `total` — ЧЕСТНЫЙ счётчик из totals (агрегат по всему
 * набору), а не длина пришедшего массива: сам массив тоже усечён лимитом роута,
 * и раньше подсказка сравнивала обрезанное с обрезанным и молчала.
 */
function MoreHint({
  shown,
  total,
  serverTruncated,
}: {
  shown: number;
  total: number;
  serverTruncated?: boolean;
}) {
  if (total <= shown) return null;
  return (
    <div className="pt-1 text-[10px] text-muted-foreground">
      Показаны первые {shown} из {formatQty(total)} —{' '}
      {serverTruncated
        ? 'список длиннее, чем сервер отдаёт за раз: разберите эти, остальные подтянутся.'
        : 'остальные закроются вместе с этими.'}
    </div>
  );
}

function RenderStockGaps({ instance, onConfigChange }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const { settings: globalSettings } = useFormatSettings();

  const configRef = useRef(config);
  configRef.current = config;
  const onConfigChangeRef = useRef(onConfigChange);
  onConfigChangeRef.current = onConfigChange;
  const patchConfig = useCallback((patch: Partial<StockGapsConfig>) => {
    onConfigChangeRef.current?.({
      ...configRef.current,
      ...patch,
    } as unknown as Record<string, unknown>);
  }, []);

  // Стабильная ссылка (patchConfig сам стабилен): инлайновая стрелка здесь
  // пересоздаёт setOverride/resetToGlobal каждый рендер, а на них завязана
  // useEffect-регистрация блока в PagePeriodContext.
  const syncPeriodToConfig = useCallback(
    (next: StockGapsConfig['periodOverride']) => patchConfig({ periodOverride: next }),
    [patchConfig],
  );

  const {
    period,
    setOverride: setPeriodOverride,
    resetToGlobal: resetPeriodToGlobal,
    isOverride: isPeriodOverride,
    ready: periodReady,
  } = useBlockPeriod({
    instanceId: instance.id,
    configOverride: config.periodOverride,
    // Свой период виден другим пользователям дашборда — синхронизируем в config.
    onConfigChange: syncPeriodToConfig,
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

  const [data, setData] = useState<GapsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  useReportBlockLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [matchingOpen, setMatchingOpen] = useState(false);
  const mountedRef = useRef(true);

  // Раскрытие секций персистится в config. Когда onConfigChange нет (превью в
  // маркете блоков, свёрнутая карта связей), включается локальная тень: секции
  // раскрываются, но не сохраняются. Тень НЕ используется при наличии
  // persist'а — иначе она навсегда замаскировала бы внешние правки конфига.
  const canPersist = Boolean(onConfigChange);
  const [uiCollapsed, setUiCollapsed] = useState<string[] | null>(null);
  const collapsed = canPersist
    ? config.collapsedSections
    : (uiCollapsed ?? config.collapsedSections);
  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);

  const toggleSection = useCallback(
    (key: string) => {
      const current = canPersist
        ? configRef.current.collapsedSections
        : (uiCollapsed ?? configRef.current.collapsedSections);
      const next = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key];
      if (canPersist) patchConfig({ collapsedSections: next });
      else setUiCollapsed(next);
    },
    [canPersist, patchConfig, uiCollapsed],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // MSC-строки как есть: resolveOzonPeriod уже вернул календарные дни Москвы,
  // и переводить их в Date, чтобы прочитать локальными геттерами, значило бы
  // сдвинуть границы на сутки у любого пользователя западнее UTC.
  const range = useMemo(() => {
    const msc = resolveOzonPeriod(
      period.preset as PeriodPreset,
      period.customFrom,
      period.customTo,
    );
    return {
      from: msc.fromDate,
      // toDateExclusive — для SQL `< to`, а роут /api/stock/gaps ждёт
      // календарную дату включительно: снимаем один день.
      to: shiftIsoDate(msc.toDateExclusive, -1),
    };
  }, [period.preset, period.customFrom, period.customTo]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    const res = await stockFetch<GapsResponse>(`/api/stock/gaps?${params}`);
    if (!mountedRef.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setData(res.data);
  }, [range.from, range.to]);

  useEffect(() => {
    if (!periodReady) return;
    fetchData();
  }, [fetchData, periodReady]);

  // Каждый проведённый документ и каждая сшивка убирают строки отсюда —
  // «Пробелы» обязаны перечитаться, а не показывать уже сделанную работу.
  useStockChangedListener(fetchData, instance.id);

  /** Сопоставление меняет и остатки, и карантин — сообщаем всей странице. */
  const onMatchingDone = useCallback(() => {
    fetchData();
    emitStockChanged(instance.id);
  }, [fetchData, instance.id]);

  const totals = data?.totals;

  // Снимок для ИИ: ровно то, что блок реально знает. Топ-5 позиций без сшивки
  // по выручке — это ответ на «с чего начать», а не украшение.
  const aiContext = useMemo(() => {
    const topUnlinked = [...(data?.unlinkedSales ?? [])]
      .sort((a, b) => b.revenueKopecks - a.revenueKopecks)
      .slice(0, 5)
      .map((r) => ({
        externalId: r.externalId,
        name: r.name,
        qty: r.qty,
        revenueKopecks: r.revenueKopecks,
      }));
    return JSON.stringify({
      module: 'stock',
      block: 'stock.gaps',
      periodFrom: range.from,
      periodTo: range.to,
      quarantineRevenueKopecks: totals?.quarantineRevenueKopecks ?? 0,
      unlinkedRevenueKopecks: totals?.unlinkedRevenueKopecks ?? 0,
      withoutCostRevenueKopecks: totals?.withoutCostRevenueKopecks ?? 0,
      unlinkedCount: totals?.unlinkedCount ?? 0,
      withoutCostCount: totals?.withoutCostCount ?? 0,
      unmatchedCount: totals?.unmatchedCount ?? 0,
      noCostItemsCount: totals?.noCostItemsCount ?? 0,
      negativeCount: totals?.negativeCount ?? 0,
      uncoveredCount: totals?.uncoveredCount ?? 0,
      uncoveredQty: totals?.uncoveredQty ?? 0,
      gapsCount: totals?.gapsCount ?? 0,
      reconOpenCount: data?.reconOpenCount ?? 0,
      // Счётчики и суммы выше — ПОЛНЫЕ (агрегаты в SQL). Усечены только списки,
      // и ассистент обязан знать, где именно, чтобы не выдавать топ-5 за «всё».
      listsTruncated: data?.truncated ?? null,
      topUnlinkedByRevenue: topUnlinked,
    });
  }, [data, totals, range.from, range.to]);

  // Publisher ВЫШЕ early-returns (rules-of-hooks).
  useBlockValuePublisher(instance.id, {
    value: totals?.quarantineRevenueKopecks ?? 0,
    quarantineRevenueKopecks: totals?.quarantineRevenueKopecks ?? 0,
    unlinkedRevenueKopecks: totals?.unlinkedRevenueKopecks ?? 0,
    withoutCostRevenueKopecks: totals?.withoutCostRevenueKopecks ?? 0,
    gapsCount: totals?.gapsCount ?? 0,
    unmatchedCount: totals?.unmatchedCount ?? 0,
    noCostItemsCount: totals?.noCostItemsCount ?? 0,
    negativeCount: totals?.negativeCount ?? 0,
    uncoveredCount: totals?.uncoveredCount ?? 0,
    uncoveredQty: totals?.uncoveredQty ?? 0,
    label: instance.appearance?.title ?? 'Склад · Пробелы',
    __money:
      'value,quarantineRevenueKopecks,unlinkedRevenueKopecks,withoutCostRevenueKopecks',
    __periodKey: formatPeriodKey(period),
    __labels:
      'value=Выручка мимо себестоимости,quarantineRevenueKopecks=Выручка мимо себестоимости,' +
      'unlinkedRevenueKopecks=Выручка продаж без сшивки,' +
      'withoutCostRevenueKopecks=Выручка продаж без себестоимости,' +
      'gapsCount=Всего пробелов,unmatchedCount=Позиций канала без товара,' +
      'noCostItemsCount=Товаров без себестоимости,negativeCount=Отрицательных остатков,' +
      'uncoveredCount=Движений без покрытия,uncoveredQty=Штук без покрытия',
    __aiContext: aiContext,
  });

  // tri-state: настройка блока перекрывает глобальную (blocks.mdc / KopecksRow).
  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;

  const isOpen = (key: string) => !collapsedSet.has(key);
  const nothingToDo =
    data != null && (totals?.gapsCount ?? 0) === 0 && (data.reconOpenCount ?? 0) === 0;

  const matchButton = (
    <Button
      size="sm"
      variant="outline"
      className="h-6 px-2 text-[11px]"
      onClick={() => setMatchingOpen(true)}
    >
      <Link2 className="h-3 w-3" /> Сопоставить
    </Button>
  );

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden p-0">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-2">
        <PeriodPicker
          value={{
            preset: period.preset as PeriodPreset,
            customFrom: period.customFrom,
            customTo: period.customTo,
          }}
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
            <Lock className="h-2.5 w-2.5" /> свой
          </button>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span
            className="text-[11px] tabular-nums text-muted-foreground"
            title="Выручка за период, которая сейчас идёт мимо себестоимости: продажи без сшивки плюс продажи без цены закупки"
          >
            Выручка мимо себестоимости:{' '}
            <span
              className={cn(
                'tabular-nums',
                (totals?.quarantineRevenueKopecks ?? 0) > 0 &&
                  'font-medium text-rose-600 dark:text-rose-400',
              )}
            >
              {formatMoney(totals?.quarantineRevenueKopecks ?? 0, showKopecks)} ₽
            </span>
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={fetchData}>
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-border/40 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {!data ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            {loading ? 'Загрузка…' : 'Нет данных'}
          </div>
        ) : nothingToDo ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
              Пробелов нет: каждая продажа сшита и оценена
            </p>
            <p className="text-[11px] text-muted-foreground">
              За период {range.from.split('-').reverse().join('.')} —{' '}
              {range.to.split('-').reverse().join('.')} себестоимость посчитана целиком,
              валовая прибыль не завышена.
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <GapSection
              title="Продажи без сшивки"
              consequence="эти продажи не попадут в себестоимость — валовая прибыль завышена"
              count={totals?.unlinkedCount ?? 0}
              tone="danger"
              moneyKopecks={totals?.unlinkedRevenueKopecks ?? 0}
              showKopecks={showKopecks}
              open={isOpen('unlinked')}
              onToggle={() => toggleSection('unlinked')}
              action={matchButton}
            >
              {data.unlinkedSales.slice(0, MAX_ROWS).map((row) => (
                <GapRow
                  key={row.externalId}
                  title={row.name ?? row.externalId}
                  subtitle={row.externalSku ?? row.externalId}
                  right={`${formatMoney(row.revenueKopecks, showKopecks)} ₽`}
                  rightHint={`${formatQty(row.qty)} шт`}
                />
              ))}
              <MoreHint
                shown={Math.min(MAX_ROWS, data.unlinkedSales.length)}
                total={totals?.unlinkedCount ?? 0}
                serverTruncated={data.truncated.sales}
              />
            </GapSection>

            <GapSection
              title="Продажи без себестоимости"
              consequence="товар сшит, но цена закупки неизвестна — прибыль по нему считается как вся выручка"
              count={totals?.withoutCostCount ?? 0}
              tone="danger"
              moneyKopecks={totals?.withoutCostRevenueKopecks ?? 0}
              showKopecks={showKopecks}
              open={isOpen('withoutCost')}
              onToggle={() => toggleSection('withoutCost')}
            >
              {data.salesWithoutCost.slice(0, MAX_ROWS).map((row) => (
                <GapRow
                  key={row.externalId}
                  title={row.itemName ?? row.name ?? row.externalId}
                  subtitle={row.externalSku ?? row.externalId}
                  right={`${formatMoney(row.revenueKopecks, showKopecks)} ₽`}
                  rightHint={`${formatQty(row.qty)} шт`}
                />
              ))}
              <MoreHint
                shown={Math.min(MAX_ROWS, data.salesWithoutCost.length)}
                total={totals?.withoutCostCount ?? 0}
                serverTruncated={data.truncated.sales}
              />
            </GapSection>

            <GapSection
              title="Позиции канала без товара"
              consequence="остаток на маркетплейсе висит вне вашей номенклатуры — деньги в товаре видны не полностью"
              count={totals?.unmatchedCount ?? 0}
              tone="warn"
              showKopecks={showKopecks}
              open={isOpen('unmatched')}
              onToggle={() => toggleSection('unmatched')}
              action={matchButton}
            >
              {data.unmatched.slice(0, MAX_ROWS).map((row) => (
                <GapRow
                  key={`${row.channel}:${row.accountId ?? '-'}:${row.externalId}`}
                  title={row.name ?? row.externalId}
                  subtitle={row.externalSku ?? row.externalId}
                  right={`${formatQty(row.qty)} шт`}
                  rightHint={row.channel}
                />
              ))}
              <MoreHint
                shown={Math.min(MAX_ROWS, data.unmatched.length)}
                total={totals?.unmatchedCount ?? 0}
                serverTruncated={data.truncated.unmatched}
              />
            </GapSection>

            <GapSection
              title="Товары без себестоимости"
              consequence="остаток есть, цены нет — стоимость склада занижена, а будущие продажи попадут сюда же"
              count={totals?.noCostItemsCount ?? 0}
              tone="warn"
              showKopecks={showKopecks}
              open={isOpen('noCost')}
              onToggle={() => toggleSection('noCost')}
            >
              {data.itemsWithoutCost.slice(0, MAX_ROWS).map((row) => (
                <GapRow
                  key={row.itemId}
                  title={row.name || row.sku}
                  subtitle={row.sku}
                  right={`${formatQty(row.qtyPool)} шт`}
                  rightHint="нужна цена закупки"
                />
              ))}
              <MoreHint
                shown={Math.min(MAX_ROWS, data.itemsWithoutCost.length)}
                total={totals?.noCostItemsCount ?? 0}
                serverTruncated={data.truncated.noCostItems}
              />
            </GapSection>

            <GapSection
              title="Отрицательные остатки"
              consequence="продали больше, чем оприходовали — скорее всего забыта поставка, и себестоимость этих продаж занижена"
              count={totals?.negativeCount ?? 0}
              tone="warn"
              showKopecks={showKopecks}
              open={isOpen('negative')}
              onToggle={() => toggleSection('negative')}
            >
              {data.negativePools.slice(0, MAX_ROWS).map((row) => (
                <GapRow
                  key={row.itemId}
                  title={row.name || row.sku}
                  subtitle={row.sku}
                  right={`${formatQty(row.qtyPool)} шт`}
                  rightHint="введите недостающий приход"
                />
              ))}
              <MoreHint
                shown={Math.min(MAX_ROWS, data.negativePools.length)}
                total={totals?.negativeCount ?? 0}
                serverTruncated={data.truncated.negative}
              />
            </GapSection>

            <GapSection
              title="Движения без покрытия"
              consequence="списание не нашло партии — эти штуки ушли со склада по нулевой стоимости"
              count={totals?.uncoveredCount ?? 0}
              tone="warn"
              showKopecks={showKopecks}
              open={isOpen('uncovered')}
              onToggle={() => toggleSection('uncovered')}
            >
              {data.uncoveredMoves.slice(0, MAX_ROWS).map((row) => (
                <GapRow
                  key={`${row.itemId}:${row.docId}`}
                  title={row.name || row.sku}
                  subtitle={`${row.sku} · ${row.docDate.split('-').reverse().join('.')}`}
                  right={`${formatQty(row.uncoveredQty)} шт`}
                  rightHint="без стоимости"
                />
              ))}
              <MoreHint
                shown={Math.min(MAX_ROWS, data.uncoveredMoves.length)}
                total={totals?.uncoveredCount ?? 0}
                serverTruncated={data.truncated.uncovered}
              />
            </GapSection>

            {data.reconOpenCount > 0 && (
              <GapSection
                title="Расхождения сверки"
                consequence="наш остаток не сходится с маркетплейсом — часть товара потеряна или не отражена"
                count={data.reconOpenCount}
                tone="info"
                showKopecks={showKopecks}
                open={isOpen('recon')}
                onToggle={() => toggleSection('recon')}
              >
                <div className="border-t border-border/30 py-1 text-[11px] leading-snug text-muted-foreground">
                  Открытых расхождений: {formatQty(data.reconOpenCount)}. Список сверки
                  наполняется отдельной кнопкой сравнения с маркетплейсом — в этом релизе
                  она ещё не реализована, поэтому здесь виден только счётчик.
                </div>
              </GapSection>
            )}
          </div>
        )}
      </div>

      <MatchingDialog
        open={matchingOpen}
        onClose={() => setMatchingOpen(false)}
        onDone={onMatchingDone}
      />
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  const set = <K extends keyof StockGapsConfig>(key: K, value: StockGapsConfig[K]) =>
    onChange({ ...parsed, [key]: value } as unknown as Record<string, unknown>);

  return (
    <div className="space-y-4">
      <SettingsSection label="Суммы">
        <KopecksRow value={parsed.showKopecks} onChange={(v) => set('showKopecks', v)} />
      </SettingsSection>
    </div>
  );
}

export const StockGapsBlock: BlockDef = {
  type: 'stock.gaps',
  displayName: 'Склад · Пробелы',
  description:
    'Единый список того, что прямо сейчас тихо искажает себестоимость: продажи без сшивки и без цены закупки (с суммой выручки), позиции канала без товара, товары без себестоимости, отрицательные остатки и движения без покрытия. У каждой секции — последствие для прибыли и кнопка сопоставления. Публикует «Выручку мимо себестоимости» за период.',
  category: 'tables',
  icon: AlertTriangle,
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 4, h: 4 },
  minContentSize: { w: 380, h: 180 },
  pages: ['warehouse', '*'],
  usesPeriod: true,
  configSchema: StockGapsConfigSchema,
  defaultConfig: () => StockGapsConfigSchema.parse({}),
  SettingsForm,
  Render: RenderStockGaps,
};
