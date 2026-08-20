// PURPOSE: Блок «Склад · Документы» (stock.docs) — журнал операций склада
// (docs/STOCK_MODULE_DESIGN.md §7 блок 2): лента с фильтрами тип/статус/период,
// создание поставки и списания, проводка черновика и сторно проведённого.
//
// ЧТО ЗДЕСЬ ПРИНЦИПИАЛЬНО:
//   • Удалить можно ТОЛЬКО черновик. Проведённый документ сторнируется (§1.4) —
//     поэтому у него в меню «Сторнировать», а не «Удалить», и подтверждение
//     идёт через AlertDialog (нативный confirm() в проекте запрещён).
//   • Сторно объясняется словами: пользователь должен понимать, что появится
//     ВТОРОЙ документ, а не исчезнет первый.
//   • Блок с периодом: useBlockPeriod + публикация __periodKey (docs/PAGE_PERIODS.md).
//     `periodOverride` в config НЕнулевой только когда пользователь выбрал свой
//     период: seed из непустого config означал бы, что блок стартует в
//     override-режиме и панель периода страницы на него не действует.
//   • Границы периода берутся строками из resolveOzonPeriod (MSC), а не через
//     локальные геттеры Date: фильтр документов работает по календарю Москвы,
//     и docDate новых документов тоже проставляется по MSC.
//   • «Закуплено за период» публикуется в копейках с маркером __money.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ClipboardList,
  Loader2,
  Lock,
  PackageMinus,
  PackagePlus,
  RefreshCw,
  Undo2,
  Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PeriodPicker,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { resolveOzonPeriod } from '@/lib/blocks/period-resolver';
import { shiftIsoDate } from '@/lib/marketplaces/ozon/sync/perf-period';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import {
  emitStockChanged,
  useStockChangedListener,
} from '@/lib/blocks/use-stock-changed';
import {
  KopecksRow,
  SettingsSection,
  SettingsToggleRow,
} from '@/components/blocks/settings';
import { useFormatSettings } from '@/lib/format-settings';
import { formatPeriodKey, useBlockValuePublisher } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import {
  StockDocDialog,
  type StockDocKindUi,
} from '@/components/stock/stock-doc-dialog';
import { formatMoney, stockFetch } from '@/components/stock/stock-api';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';

export const StockDocsConfigSchema = z.object({
  kind: z
    .enum([
      'all',
      'opening',
      'purchase',
      'transfer',
      'accept',
      'writeoff',
      'adjust',
      'return_in',
      'regrade',
      'sale',
    ])
    .default('all'),
  status: z.enum(['all', 'draft', 'posted', 'void']).default('all'),
  /** tri-state: true/false — настройка блока, null — глобальная (blocks.mdc). */
  showKopecks: z.boolean().nullable().default(null),
  /** Показывать сторно-документы (по умолчанию — да, иначе исчезает объяснение). */
  showReversals: z.boolean().default(true),
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

export type StockDocsConfig = z.infer<typeof StockDocsConfigSchema>;

function parseConfig(raw: unknown): StockDocsConfig {
  return StockDocsConfigSchema.parse(raw ?? {});
}

type DocRow = {
  id: string;
  kind: string;
  status: 'draft' | 'posted' | 'void';
  number: string | null;
  docDate: string;
  supplier: string;
  docNumber: string | null;
  totalKopecks: number;
  linesCount: number;
  qtyTotal: number;
  reversesDocId: string | null;
  comment: string | null;
};

type DocsResponse = {
  rows: DocRow[];
  totals: {
    purchasesKopecks: number;
    docsCount: number;
    /** Потери периода по ленте движений: списания + недостачи маркетплейса. */
    lossKopecks: number;
    /** Из них съедено маркетплейсом при приёмке — отдельная статья (§1.8, §5). */
    mpShortageKopecks: number;
    /** Себестоимость проданного по каналам с журналом (WB/ЯМ/сайты). */
    salesCogsKopecks: number;
  };
};

const KIND_LABEL: Record<string, string> = {
  opening: 'Остатки',
  purchase: 'Поступление',
  transfer: 'Перемещение',
  accept: 'Приёмка',
  writeoff: 'Списание',
  adjust: 'Инвентаризация',
  return_in: 'Возврат',
  regrade: 'Пересорт',
  sale: 'Продажа канала',
};

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  posted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  void: 'bg-rose-50 text-rose-700 line-through dark:bg-rose-950 dark:text-rose-300',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'черновик',
  posted: 'проведён',
  void: 'сторнирован',
};

function RenderStockDocs({ instance, onConfigChange }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const { settings: globalSettings } = useFormatSettings();

  const configRef = useRef(config);
  configRef.current = config;
  const onConfigChangeRef = useRef(onConfigChange);
  onConfigChangeRef.current = onConfigChange;
  const patchConfig = useCallback((patch: Partial<StockDocsConfig>) => {
    onConfigChangeRef.current?.({
      ...configRef.current,
      ...patch,
    } as unknown as Record<string, unknown>);
  }, []);

  // Стабильная ссылка (patchConfig сам стабилен): инлайновая стрелка здесь
  // пересоздаёт setOverride/resetToGlobal каждый рендер, а на них завязана
  // useEffect-регистрация блока в PagePeriodContext.
  const syncPeriodToConfig = useCallback(
    (next: StockDocsConfig['periodOverride']) => patchConfig({ periodOverride: next }),
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

  const [data, setData] = useState<DocsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  useReportBlockLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<StockDocKindUi | null>(null);
  const [confirm, setConfirm] = useState<
    { mode: 'void' | 'delete'; doc: DocRow } | null
  >(null);
  const mountedRef = useRef(true);

  // Персист пользовательского выбора в config: голый useState сбросился бы на
  // дефолт при первом же ре-рендере грида (грабля compareMode в Ozon KPI).
  // Когда onConfigChange нет (превью в маркете блоков, свёрнутая карта связей),
  // включается локальная тень: фильтры работают, но не сохраняются. Тень НЕ
  // используется при наличии persist'а — иначе она навсегда замаскировала бы
  // внешние правки конфига (форма настроек, AI-tool update_block_config).
  const canPersist = Boolean(onConfigChange);
  const [uiKind, setUiKind] = useState<StockDocsConfig['kind'] | null>(null);
  const [uiStatus, setUiStatus] = useState<StockDocsConfig['status'] | null>(null);
  const kind = canPersist ? config.kind : (uiKind ?? config.kind);
  const status = canPersist ? config.status : (uiStatus ?? config.status);

  const setKind = useCallback(
    (next: StockDocsConfig['kind']) => {
      if (canPersist) patchConfig({ kind: next });
      else setUiKind(next);
    },
    [canPersist, patchConfig],
  );
  const setStatus = useCallback(
    (next: StockDocsConfig['status']) => {
      if (canPersist) patchConfig({ status: next });
      else setUiStatus(next);
    },
    [canPersist, patchConfig],
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
      // toDateExclusive — для SQL `< to`, а фильтр документов работает по
      // календарной дате включительно: снимаем один день.
      to: shiftIsoDate(msc.toDateExclusive, -1),
    };
  }, [period.preset, period.customFrom, period.customTo]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      limit: '200',
    });
    if (kind !== 'all') params.set('kind', kind);
    if (status !== 'all') params.set('status', status);
    const res = await stockFetch<DocsResponse>(`/api/stock/docs?${params}`);
    if (!mountedRef.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setData(res.data);
  }, [range.from, range.to, kind, status]);

  useEffect(() => {
    if (!periodReady) return;
    fetchData();
  }, [fetchData, periodReady]);

  // Документ мог появиться из соседнего блока (быстрый ввод, импорт продаж,
  // списание из сроков годности) — лента обязана его показать без F5.
  useStockChangedListener(fetchData, instance.id);

  const runAction = useCallback(
    async (docId: string, action: 'post' | 'void') => {
      setBusyId(docId);
      setError(null);
      const res = await stockFetch(`/api/stock/docs`, {
        method: 'POST',
        body: JSON.stringify({ id: docId, action }),
      });
      if (!mountedRef.current) return;
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      fetchData();
      // Проводка и сторно меняют остатки и себестоимость — это видят остальные
      // блоки страницы, а не только лента.
      emitStockChanged(instance.id);
    },
    [fetchData, instance.id],
  );

  const removeDraft = useCallback(
    async (docId: string) => {
      setBusyId(docId);
      setError(null);
      const res = await stockFetch(`/api/stock/docs?id=${docId}`, { method: 'DELETE' });
      if (!mountedRef.current) return;
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      fetchData();
    },
    [fetchData],
  );

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return config.showReversals ? all : all.filter((r) => !r.reversesDocId);
  }, [data, config.showReversals]);

  /**
   * Потери БЕЗ недостачи маркетплейса. Считается здесь, а не в SQL: недостача
   * приёмки — это нога kind='writeoff' с reason='mp_shortage', то есть
   * mpShortageKopecks ЦЕЛИКОМ входит в lossKopecks. Пока обе цифры публиковались
   * как равноправные, любой KPI-плитке хватало сложить их — и недостача
   * считалась дважды.
   */
  const otherLossKopecks = Math.max(
    0,
    (data?.totals.lossKopecks ?? 0) - (data?.totals.mpShortageKopecks ?? 0),
  );

  // Снимок для ИИ: ровно то, что блок реально знает (лента уже загружена).
  // Skill-промпт в prompts/block-skills/stock.ts обещает анализ только по этим
  // полям — обещание без данных превращает ассистента в генератор догадок.
  const aiContext = useMemo(() => {
    const bySupplier = new Map<string, { kopecks: number; docs: number }>();
    let draftsCount = 0;
    for (const row of rows) {
      if (row.status === 'draft') draftsCount += 1;
      if (row.status !== 'posted') continue;
      if (row.kind === 'purchase' || row.kind === 'opening' || row.kind === 'return_in') {
        const key = row.supplier || 'без поставщика';
        const acc = bySupplier.get(key) ?? { kopecks: 0, docs: 0 };
        acc.kopecks += row.totalKopecks;
        acc.docs += 1;
        bySupplier.set(key, acc);
      }
    }
    return JSON.stringify({
      module: 'stock',
      block: 'stock.docs',
      periodFrom: range.from,
      periodTo: range.to,
      purchasesKopecks: data?.totals.purchasesKopecks ?? 0,
      docsCount: data?.totals.docsCount ?? 0,
      draftsCount,
      // «Сумма списаний» БОЛЬШЕ не берётся из шапок документов: у списания
      // total_kopecks структурно нулевой (это не платёж, деньги живут в ленте
      // движений — costing.ts CostedDoc), и в снапшот уходил вечный ноль при
      // ненулевых потерях. Честные цифры — три ниже, из агрегата по движениям.
      //
      // mpShortage — ЧАСТЬ loss (обе ноги проводятся kind='writeoff'), поэтому
      // рядом лежит и разность: без неё ассистент складывает их в «итого потери»
      // и задваивает недостачу приёмки.
      lossKopecks: data?.totals.lossKopecks ?? 0,
      mpShortageKopecks: data?.totals.mpShortageKopecks ?? 0,
      mpShortageIsPartOfLoss: true,
      otherLossKopecks,
      salesCogsKopecks: data?.totals.salesCogsKopecks ?? 0,
      topSuppliers: Array.from(bySupplier.entries())
        .sort((a, b) => b[1].kopecks - a[1].kopecks)
        .slice(0, 5)
        .map(([supplier, v]) => ({ supplier, kopecks: v.kopecks, docs: v.docs })),
    });
  }, [rows, data, otherLossKopecks, range.from, range.to]);

  // Publisher ВЫШЕ early-returns (rules-of-hooks).
  useBlockValuePublisher(instance.id, {
    value: data?.totals.purchasesKopecks ?? 0,
    purchasesKopecks: data?.totals.purchasesKopecks ?? 0,
    docsCount: data?.totals.docsCount ?? 0,
    rowsCount: rows.length,
    // Потери держатся ОТДЕЛЬНО от закупки и от себестоимости проданного (§1.8):
    // «сколько товара съел маркетплейс» — самостоятельная строка отчёта, ради
    // которой в приёмке вообще вводится «принято фактически» (§5).
    //
    // ВНИМАНИЕ на подписи: mpShortageKopecks — ПОДМНОЖЕСТВО lossKopecks (обе
    // ноги проводятся kind='writeoff'). Складывать их нельзя, поэтому рядом
    // публикуется непересекающаяся пара «прочие потери» + «съедено
    // маркетплейсом», а в названиях стоит «в том числе».
    lossKopecks: data?.totals.lossKopecks ?? 0,
    mpShortageKopecks: data?.totals.mpShortageKopecks ?? 0,
    otherLossKopecks,
    salesCogsKopecks: data?.totals.salesCogsKopecks ?? 0,
    label: instance.appearance?.title ?? 'Склад · Документы',
    __money:
      'value,purchasesKopecks,lossKopecks,mpShortageKopecks,otherLossKopecks,salesCogsKopecks',
    __periodKey: formatPeriodKey(period),
    __labels:
      'value=Закуплено за период,purchasesKopecks=Закуплено за период,' +
      'docsCount=Приходных документов,rowsCount=Документов в ленте,' +
      'lossKopecks=Потери за период (всего),' +
      'mpShortageKopecks=в том числе съедено маркетплейсом,' +
      'otherLossKopecks=Потери без маркетплейса,' +
      'salesCogsKopecks=Себестоимость проданного (WB/ЯМ)',
    __aiContext: aiContext,
  });

  // tri-state: настройка блока перекрывает глобальную (blocks.mdc / KopecksRow).
  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;

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

        <Select value={kind} onValueChange={(v) => setKind(v as StockDocsConfig['kind'])}>
          <SelectTrigger className="h-6 w-[130px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StockDocsConfig['status'])}
        >
          <SelectTrigger className="h-6 w-[120px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любой статус</SelectItem>
            <SelectItem value="draft">Черновики</SelectItem>
            <SelectItem value="posted">Проведённые</SelectItem>
            <SelectItem value="void">Сторнированные</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="mr-1 text-[11px] tabular-nums text-muted-foreground">
            Закуплено: {formatMoney(data?.totals.purchasesKopecks ?? 0, showKopecks)} ₽
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={fetchData}>
            <RefreshCw className={'h-3 w-3' + (loading ? ' animate-spin' : '')} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={() => setCreateKind('writeoff')}
          >
            <PackageMinus className="h-3 w-3" /> Списать
          </Button>
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setCreateKind('purchase')}
          >
            <PackagePlus className="h-3 w-3" /> Поставка
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
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[12px] text-muted-foreground">
              За период документов нет. Введите первую поставку — на это уходит меньше
              минуты, и бумага для закупок больше не нужна.
            </p>
            <Button size="sm" onClick={() => setCreateKind('purchase')}>
              <PackagePlus className="h-3.5 w-3.5" /> Новая поставка
            </Button>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            {/* Sticky-заголовок: bg-card (не /50, не blur), isolate, z-45 —
                blocks.mdc §Sticky cells. На полупрозрачном фоне строки ленты
                просвечивают сквозь шапку при скролле. */}
            <thead className="sticky top-0 z-[45] isolate bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-2 py-1.5 text-left font-medium">Дата</th>
                <th className="px-2 py-1.5 text-left font-medium">Документ</th>
                <th className="px-2 py-1.5 text-left font-medium">Поставщик</th>
                <th className="px-2 py-1.5 text-right font-medium">Строк</th>
                <th className="px-2 py-1.5 text-right font-medium">Штук</th>
                <th className="px-2 py-1.5 text-right font-medium">Сумма</th>
                <th className="px-2 py-1.5 text-left font-medium">Статус</th>
                <th className="w-20 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row) => (
                <tr key={row.id} className={row.status === 'void' ? 'opacity-60' : ''}>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                    {row.docDate.split('-').reverse().join('.')}
                  </td>
                  <td className="min-w-0 px-2 py-1.5">
                    <div className="truncate">
                      {KIND_LABEL[row.kind] ?? row.kind}
                      {row.reversesDocId && ' · сторно'}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {row.number ?? '—'}
                      {row.docNumber && ` · ${row.docNumber}`}
                    </div>
                  </td>
                  <td className="min-w-0 truncate px-2 py-1.5 text-muted-foreground">
                    {row.supplier || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.linesCount}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.qtyTotal}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatMoney(row.totalKopecks, showKopecks)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={
                        'rounded px-1.5 py-0.5 text-[10px] ' +
                        (STATUS_STYLE[row.status] ?? '')
                      }
                    >
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {busyId === row.id ? (
                      <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : row.status === 'draft' ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:underline"
                          onClick={() => runAction(row.id, 'post')}
                        >
                          Провести
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground transition hover:text-destructive"
                          title="Удалить черновик"
                          onClick={() => setConfirm({ mode: 'delete', doc: row })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : row.status === 'posted' && !row.reversesDocId ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-destructive"
                        title="Сторнировать: появится обратный документ, этот останется в истории"
                        onClick={() => setConfirm({ mode: 'void', doc: row })}
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Сторно
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <StockDocDialog
        open={createKind !== null}
        kind={createKind ?? 'purchase'}
        onClose={() => setCreateKind(null)}
        onSaved={fetchData}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.mode === 'void' ? 'Сторнировать документ?' : 'Удалить черновик?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.mode === 'void' ? (
                <>
                  Документ {confirm.doc.number ?? ''} останется в истории, а рядом
                  появится обратный документ на ту же дату. Себестоимость и остатки
                  будут пересчитаны — проведённое не удаляется, иначе исчезнут движения,
                  на которых стоит вся оценка товара.
                </>
              ) : (
                <>
                  Черновик движений не создавал, поэтому удаляется бесследно. Проведённые
                  документы так удалить нельзя — только сторно.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                if (confirm.mode === 'void') runAction(confirm.doc.id, 'void');
                else removeDraft(confirm.doc.id);
                setConfirm(null);
              }}
            >
              {confirm?.mode === 'void' ? 'Сторнировать' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  const set = <K extends keyof StockDocsConfig>(key: K, value: StockDocsConfig[K]) =>
    onChange({ ...parsed, [key]: value } as unknown as Record<string, unknown>);

  return (
    <div className="space-y-4">
      <SettingsSection label="Лента">
        <SettingsToggleRow
          label="Показывать сторно"
          description="Обратные документы объясняют, почему сумма периода изменилась"
          checked={parsed.showReversals}
          onCheckedChange={(v) => set('showReversals', v)}
        />
        <KopecksRow value={parsed.showKopecks} onChange={(v) => set('showKopecks', v)} />
      </SettingsSection>
    </div>
  );
}

export const StockDocsBlock: BlockDef = {
  type: 'stock.docs',
  displayName: 'Склад · Документы',
  description:
    'Журнал операций склада: поступления, списания, инвентаризации. Фильтры по типу, статусу и периоду, создание поставки за минуту, проводка черновиков и сторно проведённых документов. Публикует «Закуплено за период».',
  category: 'tables',
  icon: ClipboardList,
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 5, h: 4 },
  minContentSize: { w: 420, h: 180 },
  pages: ['warehouse', '*'],
  usesPeriod: true,
  configSchema: StockDocsConfigSchema,
  defaultConfig: () => StockDocsConfigSchema.parse({}),
  SettingsForm,
  Render: RenderStockDocs,
};
