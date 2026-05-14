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
} from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps } from '../types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LinkableNumberCell } from '@/components/unit-economics/linkable-number-cell';
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { resolveBindingValue } from '@/lib/unit-economics/bindings';
import type { UnitCellBinding, OzonInputs, OzonResults, TaxMode } from '@/lib/unit-economics/types';
import { calculateOzon, OZON_DEFAULT_INPUTS } from '@/lib/unit-economics/ozon/calculate';
import { OZON_TARIFF_VERSION } from '@/lib/unit-economics/ozon/tariffs-2026-04-07';
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

const GlobalParamsSchema = z.object({
  mode: z.enum(['fbo', 'fbs']).default('fbo'),
  highVolumeDiscount: z.boolean().default(false),
  isLocalCluster: z.boolean().default(true),
  acquiringPct: z.number().default(1.5),
  deliveryPvzPct: z.number().default(4),
  deliveryPvzCap: z.number().default(25),
  taxMode: z.enum(['usn_income', 'usn_income_minus', 'osno', 'nds', 'none']).default('usn_income'),
  taxRatePct: z.number().default(6),
  taxDeductExpenses: z.boolean().default(false),
  vatPct: z.number().default(0),
});

type GlobalParams = z.infer<typeof GlobalParamsSchema>;

const ConfigSchema = z.object({
  title: z.string().default('Юнит-экономика Ozon'),
  global: GlobalParamsSchema.default(GlobalParamsSchema.parse({})),
  rows: z.array(RowSchema).default([]),
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
  const parsed = ConfigSchema.safeParse(raw ?? {});
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
  merged.taxDeductExpenses = global.taxDeductExpenses;
  merged.vatPct = global.vatPct;
  merged.commissionMode = 'manual';

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
    220 + ROW_INPUT_FIELDS.reduce((acc, f) => acc + (FIELD_META[f].w ?? 80), 0) +
    RESULT_COLUMNS.reduce((acc, c) => acc + (c.w ?? 90), 0) + 80;

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
          {config.global.vatPct > 0 && (
            <span className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              НДС {config.global.vatPct}%
            </span>
          )}
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
            <div className="sticky top-0 z-30 flex border-b border-border/70 bg-card/95 backdrop-blur">
              <HeaderCell width={32} sticky stickyLeft={0} className="text-center font-semibold text-muted-foreground">
                #
              </HeaderCell>
              <HeaderCell width={110} sticky stickyLeft={32} className="font-semibold">
                Артикул
              </HeaderCell>
              <HeaderCell width={220} sticky stickyLeft={142} stickyEdge className="font-semibold">
                Название товара
              </HeaderCell>
              {ROW_INPUT_FIELDS.map((f) => (
                <HeaderCell key={f} width={FIELD_META[f].w ?? 80} className="font-semibold text-foreground">
                  <span className="block truncate">{FIELD_META[f].label}</span>
                  {FIELD_META[f].unit && (
                    <span className="block text-[9px] font-normal text-muted-foreground">
                      {FIELD_META[f].unit}
                    </span>
                  )}
                </HeaderCell>
              ))}
              {RESULT_COLUMNS.map((c) => (
                <HeaderCell key={c.key} width={c.w ?? 90} className="font-semibold text-foreground">
                  <span className="block truncate">{c.label}</span>
                </HeaderCell>
              ))}
              <HeaderCell width={80} className="text-center font-semibold text-muted-foreground">
                Действия
              </HeaderCell>
            </div>

            {computed.map(({ row, results }, idx) => (
              <div
                key={row.id}
                className="group flex border-b border-border/40 transition-colors hover:bg-accent/10 [&:hover_[data-sticky]]:bg-accent/10"
              >
                <BodyCell width={32} sticky stickyLeft={0} className="justify-center text-center text-muted-foreground tabular-nums">
                  {idx + 1}
                </BodyCell>
                <BodyCell width={110} sticky stickyLeft={32}>
                  <input
                    type="text"
                    value={row.article}
                    onChange={(e) => updateRow(row.id, { article: e.target.value })}
                    placeholder="Артикул"
                    className="h-full w-full min-w-0 border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
                  />
                </BodyCell>
                <BodyCell width={220} sticky stickyLeft={142} stickyEdge>
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    placeholder="Название товара"
                    className="h-full w-full min-w-0 border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
                  />
                </BodyCell>
                {ROW_INPUT_FIELDS.map((field) => {
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
                {RESULT_COLUMNS.map((col) => {
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
                <BodyCell width={80} className="justify-center">
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
            <div className="sticky bottom-0 z-[25] flex border-t border-border/70 bg-card/95 text-[11px] font-semibold backdrop-blur">
              <BodyCell width={32 + 110 + 220} sticky stickyLeft={0} stickyEdge className="justify-end px-3 text-muted-foreground">
                Итого по {totals.rowsCount} товарам · прибыль/мес
              </BodyCell>
              {ROW_INPUT_FIELDS.map((f) => (
                <BodyCell key={f} width={FIELD_META[f].w ?? 80} className="px-1.5" />
              ))}
              {RESULT_COLUMNS.map((col) => {
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
              <BodyCell width={80} className="justify-end px-2 text-[10px] text-muted-foreground">
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
  className,
  children,
}: {
  width: number;
  sticky?: boolean;
  stickyLeft?: number;
  /** Последняя колонка sticky-группы — даёт тень-разделитель справа */
  stickyEdge?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-sticky={sticky ? '' : undefined}
      className={
        'flex shrink-0 flex-col justify-center border-r border-border/40 px-1.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground ' +
        (sticky ? 'bg-card ' : '') +
        (className ?? '')
      }
      style={{
        width,
        position: sticky ? 'sticky' : undefined,
        left: sticky ? stickyLeft : undefined,
        zIndex: sticky ? 35 : undefined,
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
  className,
  children,
}: {
  width: number;
  sticky?: boolean;
  stickyLeft?: number;
  /** Последняя колонка sticky-группы — даёт тень-разделитель справа */
  stickyEdge?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-sticky={sticky ? '' : undefined}
      className={
        'flex shrink-0 items-center border-r border-border/30 ' +
        (sticky ? 'bg-card ' : '') +
        (className ?? '')
      }
      style={{
        width,
        height: 30,
        position: sticky ? 'sticky' : undefined,
        left: sticky ? stickyLeft : undefined,
        zIndex: sticky ? 20 : undefined,
        boxShadow: stickyEdge ? '1px 0 0 0 var(--border)' : undefined,
      }}
    >
      {children}
    </div>
  );
}

function GlobalParamsBar({
  global,
  onChange,
}: {
  global: GlobalParams;
  onChange: <K extends keyof GlobalParams>(key: K, value: GlobalParams[K]) => void;
}) {
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
        label="НДС"
        value={global.vatPct}
        unit="%"
        step={1}
        onChange={(v) => onChange('vatPct', v)}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Налог:</span>
        <select
          value={global.taxMode}
          onChange={(e) => onChange('taxMode', e.target.value as GlobalParams['taxMode'])}
          className="h-6 rounded border border-border/60 bg-background px-1 text-[11px]"
        >
          <option value="usn_income">УСН Доходы</option>
          <option value="usn_income_minus">УСН Д-Р</option>
          <option value="osno">ОСНО</option>
          <option value="nds">Только НДС</option>
          <option value="none">Без налога</option>
        </select>
        <input
          type="number"
          value={global.taxRatePct}
          onChange={(e) => onChange('taxRatePct', Number(e.target.value))}
          className="h-6 w-12 rounded border border-border/60 bg-background px-1 text-right text-[11px] tabular-nums"
        />
        <span className="text-muted-foreground">%</span>
      </div>
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
