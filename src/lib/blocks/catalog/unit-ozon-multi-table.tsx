// PURPOSE: Ozon multi-article unit-economics table — таблица товаров с расчётом
// юнит-экономики. Sticky шапка глобальных параметров, sticky левые колонки
// #/Артикул/Название, ввод параметров и результаты расчёта в одной строке.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  RotateCcw,
  Upload,
  Table as TableIcon,
  AlertTriangle,
  CheckCircle2,
  GripVertical,
  MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { z } from 'zod';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BlockDef, BlockRenderProps } from '../types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LinkableNumberCell } from '@/components/unit-economics/linkable-number-cell';
import { DropdownSelect } from '@/components/unit-economics/dropdown-select';
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { resolveBindingValue } from '@/lib/unit-economics/bindings';
import type {
  UnitCellBinding,
  OzonInputs,
  OzonResults,
  TaxMode,
  OzonFbsDropoffPoint,
  OzonFbsShipmentSpeed,
  OzonFbsClusterShare,
} from '@/lib/unit-economics/types';
import { calculateOzon, OZON_DEFAULT_INPUTS } from '@/lib/unit-economics/ozon/calculate';
import {
  OZON_TARIFF_VERSION,
  FBS_DROPOFF_LABELS,
  FBS_SHIPMENT_SPEED_LABELS,
  FBS_CLUSTER_BY_KEY,
} from '@/lib/unit-economics/ozon/tariffs-2026-04-07';
import { migrateOzonRaw } from '@/lib/unit-economics/ozon/migrate';
import { ClusterSelector } from '@/components/unit-economics/cluster-selector';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { rublesToKopecks } from '@/lib/unit-economics/types';

const RowSchema = z.object({
  id: z.string(),
  productId: z.string().optional().nullable(),
  article: z.string().default(''),
  name: z.string().default(''),
  inputs: z.record(z.string(), z.unknown()).default({}),
  bindings: z.record(z.string(), z.unknown()).default({}),
});

type Row = z.infer<typeof RowSchema>;

const ClusterShareSchema = z.object({
  key: z.string(),
  sharePct: z.number(),
});

const GlobalParamsSchema = z.object({
  mode: z.enum(['fbo', 'fbs']).default('fbo'),
  highVolumeDiscount: z.boolean().default(false),
  isLocalCluster: z.boolean().default(true),
  acquiringPct: z.number().default(1.5),
  deliveryPvzPct: z.number().default(4),
  deliveryPvzCap: z.number().default(25),
  taxMode: z.enum(['usn_income', 'usn_income_minus', 'osno', 'none']).default('usn_income'),
  taxRatePct: z.number().default(6),
  documentedExpensesMonth: z.number().default(0),
  vatPct: z.number().default(0),
  // Возвраты / соинвест / приёмка
  returnsPct: z.number().default(5),
  cancelPct: z.number().default(5),
  coInvestPct: z.number().default(0),
  freeAcceptance: z.boolean().default(true),
  // Оборачиваемость
  supplyLeadWeeks: z.number().default(4),
  indirectExpensesMonth: z.number().default(0),
  // FBS-only — глобальные для всех строк блока
  fbsDropoffPoint: z.enum(['sorting_center', 'pickup_point']).default('sorting_center'),
  fbsShipmentSpeed: z.enum(['fast', 'standard', 'slow']).default('standard'),
  fbsClusters: z.array(ClusterShareSchema).default([]),
});

type GlobalParams = z.infer<typeof GlobalParamsSchema>;

const ColumnOrderSchema = z
  .object({
    inputs: z.array(z.string()).optional(),
    results: z.array(z.string()).optional(),
  })
  .optional();

const ConfigSchema = z.object({
  title: z.string().default('Юнит-экономика Ozon'),
  global: GlobalParamsSchema.default(GlobalParamsSchema.parse({})),
  rows: z.array(RowSchema).default([]),
  columnOrder: ColumnOrderSchema,
});

type Config = z.infer<typeof ConfigSchema>;

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}_${crypto.randomUUID().slice(0, 8)}`
    : `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function emptyRow(article = '', name = ''): Row {
  return {
    id: makeId('r'),
    article,
    name,
    inputs: {},
    bindings: {},
  };
}

function parseConfig(raw: unknown): Config {
  // Backward-compat миграция «global» (fbsWarehouse → fbsClusters,
  // taxMode 'nds' → 'osno', taxDeductExpenses → documentedExpensesMonth=0).
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  const migratedRaw = {
    ...rawObj,
    global:
      typeof rawObj.global === 'object' && rawObj.global !== null
        ? migrateOzonRaw(rawObj.global as Record<string, unknown>)
        : rawObj.global,
  };
  const parsed = ConfigSchema.safeParse(migratedRaw);
  if (parsed.success) return parsed.data;
  return ConfigSchema.parse({});
}

const ROW_INPUT_FIELDS = [
  'price',
  'discountPct',
  'cost',
  'crossDockingCost',
  'volumeL',
  'commissionPct',
  'extraCommissionPct',
  'buyoutPct',
  'returnProcessing',
  'drrPct',
  'salesPerMonth',
  'batchSize',
  'stock',
  'overheadPerUnit',
] as const;

type RowInputKey = (typeof ROW_INPUT_FIELDS)[number];

const FIELD_META: Record<
  RowInputKey,
  { label: string; unit?: string; money?: boolean; w?: number; min?: number; max?: number; default?: number }
> = {
  price: { label: 'Цена', unit: '₽', money: true, w: 96 },
  discountPct: { label: 'Скидка', unit: '%', w: 70, max: 100 },
  cost: { label: 'Себест.', unit: '₽', money: true, w: 90 },
  crossDockingCost: { label: 'Кросс-докинг', unit: '₽', money: true, w: 90 },
  volumeL: { label: 'Объём', unit: 'л', w: 70, default: 1 },
  commissionPct: { label: 'Комиссия', unit: '%', w: 80, default: 16 },
  extraCommissionPct: { label: 'Доп. комис.', unit: '%', w: 80 },
  buyoutPct: { label: 'Выкуп', unit: '%', w: 70, default: 90, max: 100, min: 1 },
  returnProcessing: { label: 'Возвр.', unit: '₽', w: 70, default: 25 },
  drrPct: { label: 'ДРР', unit: '%', w: 70, default: 5 },
  salesPerMonth: { label: 'Продаж/мес', unit: 'шт', w: 90 },
  batchSize: { label: 'Партия', unit: 'шт', w: 80 },
  stock: { label: 'Остаток', unit: 'шт', money: false, w: 80 },
  overheadPerUnit: { label: 'Прочие', unit: '₽', money: true, w: 80 },
};

type ResultColumn = {
  key: keyof OzonResults;
  label: string;
  format: 'money' | 'pct' | 'number' | 'weeks';
  positive?: boolean;
  w?: number;
};

const RESULT_COLUMNS: ResultColumn[] = [
  { key: 'buyerPrice', label: 'Цена покуп.', format: 'money', w: 100 },
  { key: 'commission', label: 'Комиссия', format: 'money', w: 90 },
  { key: 'acquiring', label: 'Эквайринг', format: 'money', w: 90 },
  { key: 'logistics', label: 'Логистика', format: 'money', w: 90 },
  { key: 'deliveryPvz', label: 'ПВЗ', format: 'money', w: 80 },
  { key: 'returns', label: 'Возвраты', format: 'money', w: 90 },
  { key: 'ads', label: 'Реклама', format: 'money', w: 90 },
  { key: 'vat', label: 'НДС', format: 'money', w: 80 },
  { key: 'tax', label: 'Налог', format: 'money', w: 90 },
  { key: 'profitPerUnit', label: 'Прибыль/ед', format: 'money', positive: true, w: 110 },
  { key: 'marginPct', label: 'Маржа', format: 'pct', positive: true, w: 80 },
  { key: 'roiPct', label: 'ROI', format: 'pct', positive: true, w: 80 },
  { key: 'profitPerMonth', label: 'Прибыль/мес', format: 'money', positive: true, w: 120 },
  { key: 'turnoverWeeks', label: 'Оборот, нед.', format: 'weeks', w: 100 },
  { key: 'moneyInStock', label: 'Деньги в товаре', format: 'money', w: 130 },
];

const STICKY_INDEX_W = 32;
const STICKY_ARTICLE_W = 110;
const STICKY_NAME_W = 220;
const ACTIONS_W = 80;
const STICKY_ARTICLE_LEFT = STICKY_INDEX_W;
const STICKY_NAME_LEFT = STICKY_INDEX_W + STICKY_ARTICLE_W;
const STICKY_GROUP_W = STICKY_INDEX_W + STICKY_ARTICLE_W + STICKY_NAME_W;
const HEADER_H = 42;
const ROW_H = 30;
const TAX_MODE_LABELS: Record<TaxMode, string> = {
  usn_income: 'УСН Доходы',
  usn_income_minus: 'УСН Д-Р',
  osno: 'ОСНО (НДС)',
  none: 'Без налога',
};

function summarizeClusters(clusters: OzonFbsClusterShare[] | undefined): string {
  if (!clusters || clusters.length === 0) return '—';
  const sorted = [...clusters].sort((a, b) => b.sharePct - a.sharePct);
  const top = sorted.slice(0, 2).map((c) => {
    const label = FBS_CLUSTER_BY_KEY[c.key]?.label ?? c.key;
    return `${label} ${c.sharePct}%`;
  });
  if (sorted.length > 2) top.push(`+${sorted.length - 2}`);
  return top.join(', ');
}

function formatNumber(value: number, format: ResultColumn['format'], showKopecks: boolean): string {
  if (!Number.isFinite(value)) return '—';
  if (format === 'money') {
    return formatRublesWithSettings(rublesToKopecks(value), showKopecks);
  }
  if (format === 'pct') {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}%`;
  }
  if (format === 'weeks') {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}`;
  }
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function buildInputsForRow(
  row: Row,
  global: GlobalParams,
  liveValues: Record<string, number | string | null>,
): OzonInputs {
  const merged: Partial<OzonInputs> = { ...OZON_DEFAULT_INPUTS };
  merged.mode = global.mode;
  merged.highVolumeDiscount = global.highVolumeDiscount;
  merged.isLocalCluster = global.isLocalCluster;
  merged.acquiringPct = global.acquiringPct;
  merged.deliveryPvzPct = global.deliveryPvzPct;
  merged.deliveryPvzCap = global.deliveryPvzCap;
  merged.taxMode = global.taxMode as TaxMode;
  merged.taxRatePct = global.taxRatePct;
  merged.documentedExpensesMonth = global.documentedExpensesMonth;
  merged.vatPct = global.vatPct;
  merged.returnsPct = global.returnsPct;
  merged.cancelPct = global.cancelPct;
  merged.coInvestPct = global.coInvestPct;
  merged.freeAcceptance = global.freeAcceptance;
  merged.supplyLeadWeeks = global.supplyLeadWeeks;
  merged.indirectExpensesMonth = global.indirectExpensesMonth;
  merged.commissionMode = 'manual';
  merged.fbsDropoffPoint = global.fbsDropoffPoint;
  merged.fbsShipmentSpeed = global.fbsShipmentSpeed;
  merged.fbsClusters = global.fbsClusters;

  for (const field of ROW_INPUT_FIELDS) {
    const binding = row.bindings[field] as UnitCellBinding | undefined;
    const manualRaw = row.inputs[field];
    const manual = typeof manualRaw === 'number' ? manualRaw : Number(manualRaw ?? FIELD_META[field].default ?? 0);
    if (binding && binding.mode === 'block_ref') {
      const resolved = resolveBindingValue(binding, liveValues);
      (merged as Record<string, unknown>)[field] = resolved !== null ? resolved : manual;
    } else {
      (merged as Record<string, unknown>)[field] = Number.isFinite(manual)
        ? manual
        : FIELD_META[field].default ?? 0;
    }
  }
  return merged as OzonInputs;
}

/**
 * Сливает сохранённый порядок колонок с дефолтным: уважает порядок из конфига,
 * добавляет новые/неизвестные колонки в конец, выкидывает удалённые/невалидные.
 */
function resolveColumnOrder<T extends string>(saved: string[] | undefined, defaultOrder: readonly T[]): T[] {
  const set = new Set<string>(defaultOrder);
  const result: T[] = [];
  if (saved) {
    for (const id of saved) {
      if (set.has(id)) {
        result.push(id as T);
        set.delete(id);
      }
    }
  }
  for (const id of defaultOrder) {
    if (set.has(id)) result.push(id);
  }
  return result;
}

function RenderOzonMultiTable({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const liveValues = useAllBlockValuesFlat();
  const { settings } = useFormatSettings();
  const showKopecks = settings.showKopecks;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const persist = useCallback(
    (patch: Partial<Config>) => {
      onConfigChange?.({ ...config, ...patch } as unknown as Record<string, unknown>);
    },
    [config, onConfigChange],
  );

  const updateGlobal = useCallback(
    <K extends keyof GlobalParams>(key: K, value: GlobalParams[K]) => {
      persist({ global: { ...config.global, [key]: value } });
    },
    [config.global, persist],
  );

  const updateRow = useCallback(
    (rowId: string, patch: Partial<Row>) => {
      persist({ rows: config.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) });
    },
    [config.rows, persist],
  );

  const updateRowField = useCallback(
    (rowId: string, field: RowInputKey, value: number) => {
      const row = config.rows.find((r) => r.id === rowId);
      if (!row) return;
      updateRow(rowId, { inputs: { ...row.inputs, [field]: value } });
    },
    [config.rows, updateRow],
  );

  const updateRowBinding = useCallback(
    (rowId: string, field: RowInputKey, binding: UnitCellBinding | undefined) => {
      const row = config.rows.find((r) => r.id === rowId);
      if (!row) return;
      const nextBindings = { ...row.bindings };
      if (binding) nextBindings[field] = binding;
      else delete nextBindings[field];
      updateRow(rowId, { bindings: nextBindings });
    },
    [config.rows, updateRow],
  );

  const addRows = useCallback(
    (count: number) => {
      const additions = Array.from({ length: count }, () => emptyRow());
      persist({ rows: [...config.rows, ...additions] });
    },
    [config.rows, persist],
  );

  const removeRow = useCallback(
    (rowId: string) => {
      persist({ rows: config.rows.filter((r) => r.id !== rowId) });
    },
    [config.rows, persist],
  );

  const duplicateRow = useCallback(
    (rowId: string) => {
      const idx = config.rows.findIndex((r) => r.id === rowId);
      if (idx < 0) return;
      const copy: Row = { ...config.rows[idx], id: makeId('r'), bindings: { ...config.rows[idx].bindings } };
      const next = [...config.rows];
      next.splice(idx + 1, 0, copy);
      persist({ rows: next });
    },
    [config.rows, persist],
  );

  const resetBindings = useCallback(
    (rowId: string) => {
      updateRow(rowId, { bindings: {} });
    },
    [updateRow],
  );

  /**
   * Массовое заполнение колонки одинаковым значением.
   * Привязанные ячейки (`row.bindings[field]`) пропускаем — связь не ломаем.
   * Возвращаем счётчик применённых/пропущенных строк, чтобы header показал
   * inline-сообщение пользователю.
   */
  const bulkFillField = useCallback(
    (field: RowInputKey, value: number): { applied: number; skipped: number } => {
      let applied = 0;
      let skipped = 0;
      const nextRows = config.rows.map((r) => {
        if (r.bindings[field]) {
          skipped += 1;
          return r;
        }
        applied += 1;
        return { ...r, inputs: { ...r.inputs, [field]: value } };
      });
      persist({ rows: nextRows });
      return { applied, skipped };
    },
    [config.rows, persist],
  );

  // ----- Column order (DnD) -----
  const inputOrder = useMemo(
    () => resolveColumnOrder<RowInputKey>(config.columnOrder?.inputs, ROW_INPUT_FIELDS),
    [config.columnOrder?.inputs],
  );
  const resultOrder = useMemo(
    () =>
      resolveColumnOrder<keyof OzonResults>(
        config.columnOrder?.results,
        RESULT_COLUMNS.map((c) => c.key),
      ),
    [config.columnOrder?.results],
  );
  const resultColumnsOrdered = useMemo(() => {
    const map = new Map(RESULT_COLUMNS.map((c) => [c.key, c]));
    return resultOrder.map((k) => map.get(k)!).filter(Boolean);
  }, [resultOrder]);

  const persistInputOrder = useCallback(
    (next: RowInputKey[]) => {
      persist({
        columnOrder: {
          inputs: next,
          results: config.columnOrder?.results,
        },
      });
    },
    [config.columnOrder?.results, persist],
  );
  const persistResultOrder = useCallback(
    (next: Array<keyof OzonResults>) => {
      persist({
        columnOrder: {
          inputs: config.columnOrder?.inputs,
          results: next as string[],
        },
      });
    },
    [config.columnOrder?.inputs, persist],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleInputDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldIndex = inputOrder.indexOf(active.id as RowInputKey);
      const newIndex = inputOrder.indexOf(over.id as RowInputKey);
      if (oldIndex < 0 || newIndex < 0) return;
      persistInputOrder(arrayMove(inputOrder, oldIndex, newIndex));
    },
    [inputOrder, persistInputOrder],
  );
  const handleResultDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldIndex = resultOrder.indexOf(active.id as keyof OzonResults);
      const newIndex = resultOrder.indexOf(over.id as keyof OzonResults);
      if (oldIndex < 0 || newIndex < 0) return;
      persistResultOrder(arrayMove(resultOrder, oldIndex, newIndex));
    },
    [resultOrder, persistResultOrder],
  );

  const computed = useMemo(() => {
    return config.rows.map((row) => {
      const inputs = buildInputsForRow(row, config.global, liveValues);
      const results = calculateOzon(inputs);
      return { row, inputs, results };
    });
  }, [config.rows, config.global, liveValues]);

  const totals = useMemo(() => {
    let totalProfitMonth = 0;
    let totalStockValue = 0;
    let totalMoneyInGoods = 0;
    let profitable = 0;
    let lossy = 0;
    let marginSum = 0;
    let roiSum = 0;
    for (const { results } of computed) {
      totalProfitMonth += results.profitPerMonth;
      totalStockValue += results.cogs * Math.max(0, Number(results.cogs > 0));
      totalMoneyInGoods += results.moneyInStock;
      marginSum += results.marginPct;
      roiSum += results.roiPct;
      if (results.profitPerUnit > 0) profitable += 1;
      else if (results.profitPerUnit < 0) lossy += 1;
    }
    const count = computed.length || 1;
    return {
      rowsCount: computed.length,
      avgMargin: marginSum / count,
      avgRoi: roiSum / count,
      totalProfitMonth,
      totalStockValue,
      totalMoneyInGoods,
      profitable,
      lossy,
    };
  }, [computed]);

  useBlockValuePublisher(instance.id, {
    rowsCount: totals.rowsCount,
    avgMargin: totals.avgMargin,
    avgRoi: totals.avgRoi,
    totalProfitMonth: rublesToKopecks(totals.totalProfitMonth),
    totalStockValue: rublesToKopecks(totals.totalStockValue),
    totalMoneyInGoods: rublesToKopecks(totals.totalMoneyInGoods),
    profitableCount: totals.profitable,
    lossCount: totals.lossy,
    label: instance.appearance?.title ?? config.title,
    __money: 'totalProfitMonth,totalStockValue,totalMoneyInGoods',
    __labels:
      'rowsCount=Товаров,avgMargin=Средняя маржа,avgRoi=Средний ROI,' +
      'totalProfitMonth=Прибыль / мес,totalStockValue=Себестоимость остатка,' +
      'totalMoneyInGoods=Деньги в товаре,profitableCount=Прибыльных,lossCount=Убыточных',
  });

  // ----- Import -----
  async function onImportFile(file: File, commit: boolean) {
    setImporting(true);
    setImportMessage(null);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('commit', commit ? 'true' : 'false');
      const res = await fetch('/api/unit-economics/import/ozon-prices', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok) {
        setImportError(data.error ?? 'Не удалось распарсить файл');
        return;
      }
      if (commit) {
        setImportMessage(`Импортировано: ${data.inserted} из ${data.totalRows}`);
        await loadProductsAndPopulate();
      } else {
        setImportMessage(`Найдено товаров: ${data.totalRows}. Распознано колонок: ${
          Object.keys(data.recognizedColumns ?? {}).length
        }. Нажмите «Применить» чтобы сохранить.`);
        // remember preview by creating ephemeral file in a re-trigger: simplest approach — just trust user to re-pick file.
      }
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function loadProductsAndPopulate() {
    try {
      const res = await fetch('/api/unit-economics/products?marketplace=ozon');
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.products)) return;
      const newRows: Row[] = data.products.slice(0, 200).map((p: {
        id: string;
        article: string | null;
        name: string;
        priceKopecks: number;
        costKopecks: number;
        stockMarketplace: number;
        stockOwn: number;
        volumeL: number;
      }) => ({
        id: makeId('r'),
        productId: p.id,
        article: p.article ?? '',
        name: p.name ?? '',
        inputs: {
          price: p.priceKopecks / 100,
          cost: p.costKopecks / 100,
          stock: (p.stockMarketplace ?? 0) + (p.stockOwn ?? 0),
          volumeL: (p.volumeL ?? 0) / 100,
        },
        bindings: {},
      }));
      if (newRows.length === 0) return;
      persist({ rows: newRows });
    } catch {
      // ignore
    }
  }

  // ----- Render -----
  const totalRowWidth =
    STICKY_GROUP_W +
    inputOrder.reduce((acc, f) => acc + (FIELD_META[f].w ?? 80), 0) +
    resultColumnsOrdered.reduce((acc, c) => acc + (c.w ?? 90), 0) +
    ACTIONS_W;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <TableIcon className="h-4 w-4 text-muted-foreground" />
          <Input
            value={config.title}
            onChange={(e) => persist({ title: e.target.value })}
            className="h-7 w-64 border-0 bg-transparent px-0 text-sm font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          <span
            className={
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ' +
              (config.global.mode === 'fbo'
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300')
            }
            title="Текущая схема отгрузки"
          >
            {config.global.mode}
          </span>
          {config.global.mode === 'fbs' && (
            <span
              className="inline-flex max-w-[420px] items-center truncate rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
              title={`Точка сдачи · ${FBS_DROPOFF_LABELS[config.global.fbsDropoffPoint]}, скорость · ${FBS_SHIPMENT_SPEED_LABELS[config.global.fbsShipmentSpeed]}, кластеры (${config.global.fbsClusters.length}) · ${summarizeClusters(config.global.fbsClusters)}`}
            >
              <span className="truncate">
                {FBS_DROPOFF_LABELS[config.global.fbsDropoffPoint]} ·{' '}
                {FBS_SHIPMENT_SPEED_LABELS[config.global.fbsShipmentSpeed]} ·{' '}
                {summarizeClusters(config.global.fbsClusters)}
              </span>
            </span>
          )}
          {config.global.vatPct > 0 && (
            <span className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              НДС {config.global.vatPct}%
            </span>
          )}
          <span className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Налог: {TAX_MODE_LABELS[config.global.taxMode]} {config.global.taxRatePct}%
          </span>
          <span className="text-[10px] text-muted-foreground">v{OZON_TARIFF_VERSION}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f, true);
              e.target.value = '';
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <Upload /> Импорт XLSX
          </Button>
          <Button variant="outline" size="sm" onClick={() => addRows(1)}>
            <Plus /> 1
          </Button>
          <Button variant="outline" size="sm" onClick={() => addRows(5)}>
            <Plus /> 5
          </Button>
          <Button variant="outline" size="sm" onClick={() => addRows(10)}>
            <Plus /> 10
          </Button>
        </div>
      </div>

      {importMessage && (
        <div className="flex items-start gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{importMessage}</span>
        </div>
      )}
      {importError && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{importError}</span>
        </div>
      )}

      <GlobalParamsBar
        global={config.global}
        onChange={updateGlobal}
      />

      <div className="flex-1 overflow-auto">
        {computed.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center text-xs text-muted-foreground">
            <p>Здесь будут товары и расчёт юнит-экономики.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => addRows(1)}>
                <Plus /> Добавить товар
              </Button>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload /> Импорт XLSX
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-full text-[11px]" style={{ minWidth: `${totalRowWidth}px` }}>
            {/* Header */}
            <div className="sticky top-0 z-40 flex border-b border-border/70 bg-card">
              <HeaderCell width={STICKY_INDEX_W} sticky stickyLeft={0} className="text-center font-semibold text-muted-foreground">
                #
              </HeaderCell>
              <HeaderCell width={STICKY_ARTICLE_W} sticky stickyLeft={STICKY_ARTICLE_LEFT} className="font-semibold">
                Артикул
              </HeaderCell>
              <HeaderCell width={STICKY_NAME_W} sticky stickyLeft={STICKY_NAME_LEFT} stickyEdge className="font-semibold">
                Название товара
              </HeaderCell>
              <DndContext
                id={`${instance.id}-ozon-input-columns`}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleInputDragEnd}
              >
                <SortableContext items={inputOrder as string[]} strategy={horizontalListSortingStrategy}>
                  {inputOrder.map((f) => (
                    <SortableHeaderCell
                      key={f}
                      id={f}
                      width={FIELD_META[f].w ?? 80}
                      className="font-semibold text-foreground"
                      bulkFill={{
                        label: FIELD_META[f].label,
                        unit: FIELD_META[f].unit,
                        onApply: (val) => bulkFillField(f, val),
                      }}
                    >
                      <span className="block truncate">{FIELD_META[f].label}</span>
                      {FIELD_META[f].unit && (
                        <span className="block text-[9px] font-normal text-muted-foreground">
                          {FIELD_META[f].unit}
                        </span>
                      )}
                    </SortableHeaderCell>
                  ))}
                </SortableContext>
              </DndContext>
              <DndContext
                id={`${instance.id}-ozon-result-columns`}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleResultDragEnd}
              >
                <SortableContext
                  items={resultOrder as string[]}
                  strategy={horizontalListSortingStrategy}
                >
                  {resultColumnsOrdered.map((c) => (
                    <SortableHeaderCell
                      key={c.key}
                      id={c.key as string}
                      width={c.w ?? 90}
                      className="font-semibold text-foreground"
                    >
                      <span className="block truncate">{c.label}</span>
                    </SortableHeaderCell>
                  ))}
                </SortableContext>
              </DndContext>
              <HeaderCell width={ACTIONS_W} className="text-center font-semibold text-muted-foreground">
                Действия
              </HeaderCell>
            </div>

            {computed.map(({ row, results }, idx) => (
              <div
                key={row.id}
                className="group flex border-b border-border/40 transition-colors hover:bg-accent/5"
              >
                <BodyCell width={STICKY_INDEX_W} sticky stickyLeft={0} className="justify-center text-center text-muted-foreground tabular-nums">
                  {idx + 1}
                </BodyCell>
                <BodyCell width={STICKY_ARTICLE_W} sticky stickyLeft={STICKY_ARTICLE_LEFT}>
                  <input
                    type="text"
                    value={row.article}
                    onChange={(e) => updateRow(row.id, { article: e.target.value })}
                    placeholder="Артикул"
                    className="h-full w-full min-w-0 truncate border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
                  />
                </BodyCell>
                <BodyCell width={STICKY_NAME_W} sticky stickyLeft={STICKY_NAME_LEFT} stickyEdge>
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    placeholder="Название товара"
                    className="h-full w-full min-w-0 truncate border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
                  />
                </BodyCell>
                {inputOrder.map((field) => {
                  const meta = FIELD_META[field];
                  const value = Number(row.inputs[field] ?? meta.default ?? 0);
                  const binding = row.bindings[field] as UnitCellBinding | undefined;
                  return (
                    <BodyCell key={field} width={meta.w ?? 80} className="p-0.5">
                      <LinkableNumberCell
                        selfBlockId={instance.id}
                        fieldLabel={meta.label}
                        value={Number.isFinite(value) ? value : 0}
                        onValueChange={(v) => updateRowField(row.id, field, v)}
                        binding={binding}
                        onBindingChange={(b) => updateRowBinding(row.id, field, b)}
                        unit={meta.unit}
                        money={meta.money}
                        min={meta.min}
                        max={meta.max}
                        className="h-full"
                      />
                    </BodyCell>
                  );
                })}
                {resultColumnsOrdered.map((col) => {
                  const value = results[col.key] as number;
                  const positive = col.positive && value > 0;
                  const negative = col.positive && value < 0;
                  return (
                    <BodyCell key={col.key} width={col.w ?? 90} className="justify-end px-1.5 tabular-nums">
                      <span
                        className={
                          positive
                            ? 'truncate text-emerald-600 dark:text-emerald-400'
                            : negative
                              ? 'truncate text-red-600 dark:text-red-400'
                              : 'truncate'
                        }
                      >
                        {formatNumber(value, col.format, showKopecks)}
                      </span>
                    </BodyCell>
                  );
                })}
                <BodyCell width={ACTIONS_W} className="justify-center">
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => duplicateRow(row.id)}
                      title="Дублировать строку"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => resetBindings(row.id)}
                      title="Сбросить привязки строки"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-red-600 hover:text-red-700"
                      onClick={() => removeRow(row.id)}
                      title="Удалить строку"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </BodyCell>
              </div>
            ))}

            {/* Totals row */}
            <div className="sticky bottom-0 z-[35] flex border-t border-border/70 bg-card text-[11px] font-semibold">
              <BodyCell width={STICKY_GROUP_W} sticky stickyLeft={0} stickyEdge zIndex={36} className="justify-end px-3 text-muted-foreground">
                Итого по {totals.rowsCount} товарам · прибыль/мес
              </BodyCell>
              {inputOrder.map((f) => (
                <BodyCell key={f} width={FIELD_META[f].w ?? 80} className="px-1.5" />
              ))}
              {resultColumnsOrdered.map((col) => {
                if (col.key === 'profitPerMonth') {
                  return (
                    <BodyCell key={col.key} width={col.w ?? 90} className="justify-end px-1.5 tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatNumber(totals.totalProfitMonth, 'money', showKopecks)}
                    </BodyCell>
                  );
                }
                if (col.key === 'moneyInStock') {
                  return (
                    <BodyCell key={col.key} width={col.w ?? 90} className="justify-end px-1.5 tabular-nums text-foreground">
                      {formatNumber(totals.totalMoneyInGoods, 'money', showKopecks)}
                    </BodyCell>
                  );
                }
                if (col.key === 'marginPct') {
                  return (
                    <BodyCell key={col.key} width={col.w ?? 90} className="justify-end px-1.5 tabular-nums text-muted-foreground">
                      {formatNumber(totals.avgMargin, 'pct', showKopecks)}
                    </BodyCell>
                  );
                }
                if (col.key === 'roiPct') {
                  return (
                    <BodyCell key={col.key} width={col.w ?? 90} className="justify-end px-1.5 tabular-nums text-muted-foreground">
                      {formatNumber(totals.avgRoi, 'pct', showKopecks)}
                    </BodyCell>
                  );
                }
                return <BodyCell key={col.key} width={col.w ?? 90} className="px-1.5" />;
              })}
              <BodyCell width={ACTIONS_W} className="justify-end px-2 text-[10px] text-muted-foreground">
                +{totals.profitable} / −{totals.lossy}
              </BodyCell>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function HeaderCell({
  width,
  sticky,
  stickyLeft,
  stickyEdge,
  zIndex,
  className,
  children,
}: {
  width: number;
  sticky?: boolean;
  stickyLeft?: number;
  /** Последняя колонка sticky-группы — даёт тень-разделитель справа */
  stickyEdge?: boolean;
  zIndex?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-sticky={sticky ? '' : undefined}
      className={
        'flex shrink-0 flex-col justify-center overflow-hidden border-r border-border/40 px-1.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground ' +
        (sticky ? 'isolate bg-card ' : '') +
        (className ?? '')
      }
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        height: HEADER_H,
        boxSizing: 'border-box',
        position: sticky ? 'sticky' : undefined,
        left: sticky ? stickyLeft : undefined,
        zIndex: sticky ? zIndex ?? 45 : zIndex,
        boxShadow: stickyEdge ? '1px 0 0 0 var(--border)' : undefined,
      }}
    >
      {children}
    </div>
  );
}

function BodyCell({
  width,
  sticky,
  stickyLeft,
  stickyEdge,
  zIndex,
  className,
  children,
}: {
  width: number;
  sticky?: boolean;
  stickyLeft?: number;
  /** Последняя колонка sticky-группы — даёт тень-разделитель справа */
  stickyEdge?: boolean;
  zIndex?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-sticky={sticky ? '' : undefined}
      className={
        'flex shrink-0 items-center overflow-hidden border-r border-border/30 ' +
        (sticky ? 'isolate bg-card ' : '') +
        (className ?? '')
      }
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        height: ROW_H,
        boxSizing: 'border-box',
        position: sticky ? 'sticky' : undefined,
        left: sticky ? stickyLeft : undefined,
        zIndex: sticky ? zIndex ?? 30 : zIndex,
        boxShadow: stickyEdge ? '1px 0 0 0 var(--border)' : undefined,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Header-ячейка с поддержкой drag-n-drop через @dnd-kit/sortable.
 * Использует solid `bg-card`, чтобы во время перетаскивания через scrollable
 * область контент под ячейкой не просвечивал.
 */
type BulkFillSpec = {
  label: string;
  unit?: string;
  onApply: (value: number) => { applied: number; skipped: number };
};

function SortableHeaderCell({
  id,
  width,
  className,
  children,
  bulkFill,
}: {
  id: string;
  width: number;
  className?: string;
  children?: React.ReactNode;
  bulkFill?: BulkFillSpec;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    width,
    minWidth: width,
    maxWidth: width,
    height: HEADER_H,
    boxSizing: 'border-box',
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        'group/h relative flex shrink-0 flex-col justify-center overflow-hidden border-r border-border/40 bg-card px-1.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground ' +
        (className ?? '')
      }
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute left-0.5 top-1/2 -translate-y-1/2 cursor-grab opacity-0 transition-opacity group-hover/h:opacity-60 hover:opacity-100 active:cursor-grabbing"
        title="Перетащите, чтобы изменить порядок"
        aria-label="Перетащить колонку"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <div className="pl-2 pr-3">{children}</div>
      {bulkFill && <BulkFillMenu spec={bulkFill} />}
    </div>
  );
}

function BulkFillMenu({ spec }: { spec: BulkFillSpec }) {
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleApply() {
    const num = Number(draft.replace(',', '.'));
    if (!Number.isFinite(num)) {
      setFeedback('Введите число');
      return;
    }
    const { applied, skipped } = spec.onApply(num);
    setFeedback(
      skipped > 0
        ? `Применено к ${applied} · пропущено ${skipped} (привязки сохранены)`
        : `Применено к ${applied}`,
    );
    setTimeout(() => setFeedback(null), 2200);
    setDraft('');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/h:opacity-70"
          title="Массовое заполнение колонки"
          aria-label="Массовое заполнение колонки"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-60 p-2">
        <div className="space-y-2 text-xs">
          <div className="font-semibold normal-case text-foreground">Заполнить колонку</div>
          <div className="text-[11px] normal-case text-muted-foreground">
            Применит «{spec.label}» ко всем строкам. Привязанные ячейки будут пропущены.
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleApply();
                }
              }}
              placeholder="Значение"
              className="h-7 flex-1 rounded border border-border/60 bg-background px-2 text-[12px] tabular-nums focus:border-primary focus:outline-none"
            />
            {spec.unit && <span className="text-[11px] text-muted-foreground">{spec.unit}</span>}
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={handleApply}
              disabled={draft.trim().length === 0}
            >
              Применить
            </Button>
          </div>
          {feedback && (
            <div className="rounded bg-accent/50 px-2 py-1 text-[11px] normal-case text-foreground">
              {feedback}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GlobalParamsBar({
  global,
  onChange,
}: {
  global: GlobalParams;
  onChange: <K extends keyof GlobalParams>(key: K, value: GlobalParams[K]) => void;
}) {
  const isFbs = global.mode === 'fbs';
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/20 px-3 py-2 text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Схема:</span>
        <div className="flex overflow-hidden rounded border border-border/60">
          {(['fbo', 'fbs'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange('mode', mode)}
              className={
                'px-2 py-0.5 text-[11px] uppercase transition-colors ' +
                (global.mode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent')
              }
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      {isFbs && (
        <>
          <DropdownSelect
            label="Точка сдачи"
            value={global.fbsDropoffPoint}
            options={Object.entries(FBS_DROPOFF_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange('fbsDropoffPoint', v as OzonFbsDropoffPoint)}
          />
          <DropdownSelect
            label="Скорость отгрузки"
            value={global.fbsShipmentSpeed}
            options={Object.entries(FBS_SHIPMENT_SPEED_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange('fbsShipmentSpeed', v as OzonFbsShipmentSpeed)}
          />
          <ClusterSelector
            label="Кластеры FBS"
            value={global.fbsClusters}
            onChange={(next) => onChange('fbsClusters', next)}
          />
          <ToggleParam
            label="Бесплатная приёмка"
            value={global.freeAcceptance}
            onChange={(v) => onChange('freeAcceptance', v)}
          />
        </>
      )}
      <ToggleParam
        label=">50 заказов FBO"
        value={global.highVolumeDiscount}
        onChange={(v) => onChange('highVolumeDiscount', v)}
        disabled={global.mode !== 'fbo'}
      />
      <ToggleParam
        label="Локальный кластер"
        value={global.isLocalCluster}
        onChange={(v) => onChange('isLocalCluster', v)}
      />
      <NumberParam
        label="Эквайринг"
        value={global.acquiringPct}
        unit="%"
        step={0.1}
        onChange={(v) => onChange('acquiringPct', v)}
      />
      <NumberParam
        label="Доставка ПВЗ"
        value={global.deliveryPvzPct}
        unit="%"
        step={0.1}
        onChange={(v) => onChange('deliveryPvzPct', v)}
        disabled={global.mode !== 'fbo'}
      />
      <NumberParam
        label="Лимит ПВЗ"
        value={global.deliveryPvzCap}
        unit="₽"
        step={5}
        onChange={(v) => onChange('deliveryPvzCap', v)}
        disabled={global.mode !== 'fbo'}
      />
      <NumberParam
        label="% возвратов"
        value={global.returnsPct}
        unit="%"
        step={0.5}
        onChange={(v) => onChange('returnsPct', v)}
      />
      <NumberParam
        label="% отмен"
        value={global.cancelPct}
        unit="%"
        step={0.5}
        onChange={(v) => onChange('cancelPct', v)}
      />
      <NumberParam
        label="Соинвест"
        value={global.coInvestPct}
        unit="%"
        step={1}
        onChange={(v) => onChange('coInvestPct', v)}
      />
      <NumberParam
        label="Косвенные"
        value={global.indirectExpensesMonth}
        unit="₽/мес"
        step={1000}
        onChange={(v) => onChange('indirectExpensesMonth', v)}
      />
      <NumberParam
        label="НДС"
        value={global.vatPct}
        unit="%"
        step={1}
        onChange={(v) => onChange('vatPct', v)}
      />
      <DropdownSelect
        label="Налог"
        value={global.taxMode}
        options={[
          { value: 'usn_income', label: 'УСН Доходы' },
          { value: 'usn_income_minus', label: 'УСН Д-Р' },
          { value: 'osno', label: 'ОСНО (НДС)' },
          { value: 'none', label: 'Без налога' },
        ]}
        onChange={(v) => onChange('taxMode', v as GlobalParams['taxMode'])}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Ставка:</span>
        <input
          type="number"
          value={global.taxRatePct}
          onChange={(e) => onChange('taxRatePct', Number(e.target.value))}
          className="h-6 w-14 rounded border border-border/60 bg-background px-1 text-right text-[11px] tabular-nums"
        />
        <span className="text-muted-foreground">%</span>
      </div>
      {global.taxMode === 'usn_income_minus' && (
        <NumberParam
          label="Док. расходы"
          value={global.documentedExpensesMonth}
          unit="₽/мес"
          step={1000}
          onChange={(v) => onChange('documentedExpensesMonth', v)}
        />
      )}
    </div>
  );
}

function ToggleParam({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors ' +
        (value
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border/60 bg-background text-muted-foreground hover:text-foreground') +
        (disabled ? ' opacity-40' : '')
      }
    >
      <span className="h-2 w-2 rounded-full" style={{ background: value ? 'currentColor' : '#d1d5db' }} />
      <span>{label}</span>
    </button>
  );
}

function NumberParam({
  label,
  value,
  unit,
  step,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  // Use a draft so user can clear input freely while typing
  const [draft, setDraft] = useState<string>(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <div className={'flex items-center gap-1.5 ' + (disabled ? 'opacity-40' : '')}>
      <span className="text-muted-foreground">{label}:</span>
      <input
        type="number"
        value={draft}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          const num = Number(e.target.value);
          if (Number.isFinite(num)) onChange(num);
        }}
        className="h-6 w-16 rounded border border-border/60 bg-background px-1 text-right text-[11px] tabular-nums"
      />
      {unit && <span className="text-muted-foreground">{unit}</span>}
    </div>
  );
}

export const UnitOzonMultiTableBlock: BlockDef = {
  type: 'unit.ozon-multi-table',
  displayName: 'Ozon · Юнит-таблица',
  description: 'Таблица товаров с расчётом юнит-экономики Ozon (FBO/FBS) и привязками ячеек.',
  category: 'tables',
  icon: TableIcon,
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 6, h: 5 },
  minContentSize: { w: 480, h: 240 },
  pages: ['unit-economics-ozon-multi'],
  configSchema: ConfigSchema,
  defaultConfig: () => ConfigSchema.parse({}),
  Render: RenderOzonMultiTable,
};

// re-export for typing convenience (used by other modules)
export type { OzonResults };
