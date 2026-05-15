// PURPOSE: Блок «Мой магазин» — кастомизируемая таблица товаров с
// настраиваемыми колонками (число/процент/деньги/текст/формула),
// привязками через LinkableNumberCell и формулами с защитой от циклов.
// Базируется на структуре unit.ozon-multi-table (sticky шапка/колонки/итоги).
'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  RotateCcw,
  Store,
  Settings2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps } from '../types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LinkableNumberCell } from '@/components/unit-economics/linkable-number-cell';
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { resolveBindingValue } from '@/lib/unit-economics/bindings';
import type { UnitCellBinding } from '@/lib/unit-economics/types';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { evalRowFormulas } from '@/lib/unit-economics/store-formula';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const ColumnTypeEnum = z.enum(['number', 'percent', 'money', 'text', 'formula']);
type ColumnType = z.infer<typeof ColumnTypeEnum>;

const ColumnSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: ColumnTypeEnum.default('number'),
  unit: z.string().optional(),
  default: z.union([z.number(), z.string()]).optional(),
  width: z.number().int().positive().optional(),
  formula: z.string().optional(),
  positive: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

type Column = z.infer<typeof ColumnSchema>;

const RowSchema = z.object({
  id: z.string(),
  article: z.string().default(''),
  name: z.string().default(''),
  values: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
  bindings: z.record(z.string(), z.unknown()).default({}),
});

type Row = z.infer<typeof RowSchema>;

const GlobalSchema = z.object({
  vatPct: z.number().default(0),
  taxRatePct: z.number().default(6),
});
type GlobalParams = z.infer<typeof GlobalSchema>;

function defaultColumns(): Column[] {
  return [
    { id: 'cost', label: 'Себестоимость', type: 'money', unit: '₽', width: 110 },
    { id: 'packaging', label: 'Упаковка', type: 'money', unit: '₽', width: 90 },
    { id: 'delivery', label: 'Доставка', type: 'money', unit: '₽', width: 90 },
    { id: 'priceRetail', label: 'Розница', type: 'money', unit: '₽', width: 100 },
    { id: 'priceWholesale', label: 'Опт', type: 'money', unit: '₽', width: 100 },
    {
      id: 'marginRetail',
      label: 'Маржа розница',
      type: 'formula',
      unit: '₽',
      width: 110,
      positive: true,
      formula: '=priceRetail - cost - packaging - delivery',
    },
    {
      id: 'marginWholesale',
      label: 'Маржа опт',
      type: 'formula',
      unit: '₽',
      width: 110,
      positive: true,
      formula: '=priceWholesale - cost - packaging - delivery',
    },
    { id: 'salesPerMonth', label: 'Продаж/мес', type: 'number', unit: 'шт', width: 90 },
    { id: 'stock', label: 'Остаток', type: 'number', unit: 'шт', width: 80 },
    {
      id: 'revenueMonth',
      label: 'Выручка/мес',
      type: 'formula',
      unit: '₽',
      width: 120,
      positive: true,
      formula: '=priceRetail * salesPerMonth',
    },
    {
      id: 'profitMonth',
      label: 'Прибыль/мес',
      type: 'formula',
      unit: '₽',
      width: 120,
      positive: true,
      formula: '=marginRetail * salesPerMonth',
    },
  ];
}

const ConfigSchema = z.object({
  title: z.string().default('Мой магазин'),
  global: GlobalSchema.default(GlobalSchema.parse({})),
  columns: z.array(ColumnSchema).default([]),
  rows: z.array(RowSchema).default([]),
});

type Config = z.infer<typeof ConfigSchema>;

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}_${crypto.randomUUID().slice(0, 8)}`
    : `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function emptyRow(): Row {
  return { id: makeId('r'), article: '', name: '', values: {}, bindings: {} };
}

function parseConfig(raw: unknown): Config {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  const cfg = parsed.success ? parsed.data : ConfigSchema.parse({});
  if (cfg.columns.length === 0) cfg.columns = defaultColumns();
  return cfg;
}

function isMoneyCol(col: Column): boolean {
  return col.type === 'money' || (col.type === 'formula' && (col.unit === '₽' || /руб|rub/i.test(col.unit ?? '')));
}

function formatNumber(value: number, col: Column, showKopecks: boolean): string {
  if (!Number.isFinite(value)) return '—';
  if (isMoneyCol(col)) return formatRublesWithSettings(rublesToKopecks(value), showKopecks);
  if (col.type === 'percent') return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}%`;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function RenderMyStoreTable({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const liveValues = useAllBlockValuesFlat();
  const { settings } = useFormatSettings();
  const showKopecks = settings.showKopecks;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingCol, setEditingCol] = useState<string | null>(null);

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

  const updateColumn = useCallback(
    (colId: string, patch: Partial<Column>) => {
      persist({
        columns: config.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)),
      });
    },
    [config.columns, persist],
  );

  const removeColumn = useCallback(
    (colId: string) => {
      persist({ columns: config.columns.filter((c) => c.id !== colId) });
    },
    [config.columns, persist],
  );

  const addColumn = useCallback(() => {
    const id = makeId('c');
    const next: Column = {
      id,
      label: 'Новая колонка',
      type: 'number',
      width: 96,
    };
    persist({ columns: [...config.columns, next] });
    setEditingCol(id);
  }, [config.columns, persist]);

  const updateRow = useCallback(
    (rowId: string, patch: Partial<Row>) => {
      persist({ rows: config.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) });
    },
    [config.rows, persist],
  );

  const updateRowValue = useCallback(
    (rowId: string, colId: string, value: number | string) => {
      const row = config.rows.find((r) => r.id === rowId);
      if (!row) return;
      updateRow(rowId, { values: { ...row.values, [colId]: value } });
    },
    [config.rows, updateRow],
  );

  const updateRowBinding = useCallback(
    (rowId: string, colId: string, binding: UnitCellBinding | undefined) => {
      const row = config.rows.find((r) => r.id === rowId);
      if (!row) return;
      const next = { ...row.bindings };
      if (binding) next[colId] = binding;
      else delete next[colId];
      updateRow(rowId, { bindings: next });
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
      const copy: Row = {
        ...config.rows[idx],
        id: makeId('r'),
        values: { ...config.rows[idx].values },
        bindings: { ...config.rows[idx].bindings },
      };
      const next = [...config.rows];
      next.splice(idx + 1, 0, copy);
      persist({ rows: next });
    },
    [config.rows, persist],
  );

  const resetBindings = useCallback(
    (rowId: string) => updateRow(rowId, { bindings: {} }),
    [updateRow],
  );

  const visibleColumns = useMemo(
    () => config.columns.filter((c) => !c.hidden),
    [config.columns],
  );

  const formulasMap = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const c of config.columns) if (c.type === 'formula') m[c.id] = c.formula;
    return m;
  }, [config.columns]);

  const computedRows = useMemo(() => {
    return config.rows.map((row) => {
      const manual: Record<string, number | string> = {
        vatPct: config.global.vatPct,
        taxRatePct: config.global.taxRatePct,
      };
      for (const col of config.columns) {
        if (col.type === 'formula') continue;
        const binding = row.bindings[col.id] as UnitCellBinding | undefined;
        if (binding && binding.mode === 'block_ref') {
          const resolved = resolveBindingValue(binding, liveValues);
          if (resolved !== null) {
            manual[col.id] = resolved;
            continue;
          }
        }
        const raw = row.values[col.id];
        if (raw === undefined || raw === null || raw === '') {
          manual[col.id] = (col.default as number | string | undefined) ?? (col.type === 'text' ? '' : 0);
        } else {
          manual[col.id] = raw;
        }
      }
      const computed = evalRowFormulas(manual, formulasMap);
      const merged: Record<string, number | string> = { ...manual };
      for (const [k, v] of Object.entries(computed)) {
        if (v === '#CYCLE' || v === '#ERR') merged[k] = v;
        else merged[k] = v;
      }
      return { row, values: merged };
    });
  }, [config.rows, config.columns, config.global.vatPct, config.global.taxRatePct, liveValues, formulasMap]);

  const totals = useMemo(() => {
    let totalRevenue = 0;
    let totalProfit = 0;
    let marginSum = 0;
    let marginCount = 0;
    let stockTotal = 0;
    for (const { values } of computedRows) {
      const rev = Number(values['revenueMonth']);
      const prof = Number(values['profitMonth']);
      const marg = Number(values['marginRetail']);
      const stock = Number(values['stock']);
      if (Number.isFinite(rev)) totalRevenue += rev;
      if (Number.isFinite(prof)) totalProfit += prof;
      if (Number.isFinite(marg)) {
        marginSum += marg;
        marginCount += 1;
      }
      if (Number.isFinite(stock)) stockTotal += stock;
    }
    return {
      rowsCount: computedRows.length,
      totalRevenue,
      totalProfit,
      avgMargin: marginCount > 0 ? marginSum / marginCount : 0,
      stockTotal,
    };
  }, [computedRows]);

  useBlockValuePublisher(instance.id, {
    rowsCount: totals.rowsCount,
    totalRevenue: rublesToKopecks(totals.totalRevenue),
    totalProfit: rublesToKopecks(totals.totalProfit),
    avgMargin: totals.avgMargin,
    stockTotal: totals.stockTotal,
    label: instance.appearance?.title ?? config.title,
    __money: 'totalRevenue,totalProfit',
  });

  const editingColumn = editingCol ? config.columns.find((c) => c.id === editingCol) ?? null : null;

  const totalRowWidth =
    32 + 110 + 220 + visibleColumns.reduce((acc, c) => acc + (c.width ?? 96), 0) + 80;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-muted-foreground" />
          <Input
            value={config.title}
            onChange={(e) => persist({ title: e.target.value })}
            className="h-7 w-64 border-0 bg-transparent px-0 text-sm font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          {config.global.vatPct > 0 && (
            <span className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              НДС {config.global.vatPct}%
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled
          />
          <Button variant="outline" size="sm" onClick={() => addColumn()}>
            <Plus /> Колонка
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

      {/* Global params */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/20 px-3 py-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">НДС:</span>
          <input
            type="number"
            value={config.global.vatPct}
            step={1}
            onChange={(e) => updateGlobal('vatPct', Number(e.target.value))}
            className="h-6 w-16 rounded border border-border/60 bg-background px-1 text-right text-[11px] tabular-nums"
          />
          <span className="text-muted-foreground">%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Налог:</span>
          <input
            type="number"
            value={config.global.taxRatePct}
            step={1}
            onChange={(e) => updateGlobal('taxRatePct', Number(e.target.value))}
            className="h-6 w-16 rounded border border-border/60 bg-background px-1 text-right text-[11px] tabular-nums"
          />
          <span className="text-muted-foreground">%</span>
        </div>
        <span className="ml-auto text-[10px] text-muted-foreground">
          Колонок: {config.columns.length} ({config.columns.filter((c) => c.hidden).length} скрыто)
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {computedRows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center text-xs text-muted-foreground">
            <p>Здесь будут товары вашего магазина с настраиваемыми формулами.</p>
            <Button size="sm" onClick={() => addRows(1)}>
              <Plus /> Добавить товар
            </Button>
          </div>
        ) : (
          <div className="min-w-full text-[11px]" style={{ minWidth: `${totalRowWidth}px` }}>
            {/* Header row */}
            <div className="sticky top-0 z-40 flex border-b border-border/70 bg-card">
              <HeaderCell width={32} sticky stickyLeft={0} className="text-center font-semibold text-muted-foreground">
                #
              </HeaderCell>
              <HeaderCell width={110} sticky stickyLeft={32} className="font-semibold">
                Артикул
              </HeaderCell>
              <HeaderCell width={220} sticky stickyLeft={142} stickyEdge className="font-semibold">
                Название товара
              </HeaderCell>
              {visibleColumns.map((col) => (
                <HeaderCell key={col.id} width={col.width ?? 96} className="font-semibold text-foreground">
                  <div className="flex items-center justify-between gap-1">
                    <span className="block truncate" title={col.label}>
                      {col.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingCol(col.id)}
                      className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
                      title="Настроить колонку"
                    >
                      <Settings2 className="h-3 w-3" />
                    </button>
                  </div>
                  {(col.unit || col.type === 'formula') && (
                    <span className="block text-[9px] font-normal text-muted-foreground">
                      {col.type === 'formula' ? 'fx' : col.unit}
                    </span>
                  )}
                </HeaderCell>
              ))}
              <HeaderCell width={80} className="text-center font-semibold text-muted-foreground">
                Действия
              </HeaderCell>
            </div>

            {computedRows.map(({ row, values }, idx) => (
              <div
                key={row.id}
                className="group flex border-b border-border/40 transition-colors hover:bg-accent/5 [&:hover_[data-sticky]]:bg-accent/5"
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
                    className="h-full w-full min-w-0 truncate border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
                  />
                </BodyCell>
                <BodyCell width={220} sticky stickyLeft={142} stickyEdge>
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    placeholder="Название товара"
                    className="h-full w-full min-w-0 truncate border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
                  />
                </BodyCell>
                {visibleColumns.map((col) => {
                  const raw = values[col.id];
                  if (col.type === 'formula') {
                    const isErr = raw === '#CYCLE' || raw === '#ERR';
                    const num = Number(raw);
                    const positive = col.positive && num > 0;
                    const negative = col.positive && num < 0;
                    return (
                      <BodyCell
                        key={col.id}
                        width={col.width ?? 96}
                        className="justify-end px-1.5 tabular-nums"
                      >
                        {isErr ? (
                          <span className="truncate text-amber-600 dark:text-amber-400" title={String(raw)}>
                            {String(raw)}
                          </span>
                        ) : (
                          <span
                            className={
                              positive
                                ? 'truncate text-emerald-600 dark:text-emerald-400'
                                : negative
                                  ? 'truncate text-red-600 dark:text-red-400'
                                  : 'truncate'
                            }
                          >
                            {formatNumber(num, col, showKopecks)}
                          </span>
                        )}
                      </BodyCell>
                    );
                  }
                  if (col.type === 'text') {
                    const text = typeof raw === 'string' ? raw : String(raw ?? '');
                    return (
                      <BodyCell key={col.id} width={col.width ?? 96} className="p-0">
                        <input
                          type="text"
                          value={text}
                          onChange={(e) => updateRowValue(row.id, col.id, e.target.value)}
                          placeholder={col.label}
                          className="h-full w-full min-w-0 border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
                        />
                      </BodyCell>
                    );
                  }
                  const num = Number(raw);
                  const binding = row.bindings[col.id] as UnitCellBinding | undefined;
                  return (
                    <BodyCell key={col.id} width={col.width ?? 96} className="p-0.5">
                      <LinkableNumberCell
                        selfBlockId={instance.id}
                        fieldLabel={col.label}
                        value={Number.isFinite(num) ? num : 0}
                        onValueChange={(v) => updateRowValue(row.id, col.id, v)}
                        binding={binding}
                        onBindingChange={(b) => updateRowBinding(row.id, col.id, b)}
                        unit={col.unit}
                        money={isMoneyCol(col)}
                        className="h-full"
                      />
                    </BodyCell>
                  );
                })}
                <BodyCell width={80} className="justify-center">
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => duplicateRow(row.id)} title="Дублировать">
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => resetBindings(row.id)} title="Сбросить привязки">
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-red-600 hover:text-red-700"
                      onClick={() => removeRow(row.id)}
                      title="Удалить"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </BodyCell>
              </div>
            ))}

            {/* Totals */}
            <div className="sticky bottom-0 z-[35] flex border-t border-border/70 bg-card text-[11px] font-semibold">
              <BodyCell width={32 + 110 + 220} sticky stickyLeft={0} stickyEdge className="justify-end px-3 text-muted-foreground">
                Итого по {totals.rowsCount} товарам
              </BodyCell>
              {visibleColumns.map((col) => {
                if (col.id === 'revenueMonth') {
                  return (
                    <BodyCell key={col.id} width={col.width ?? 96} className="justify-end px-1.5 tabular-nums text-foreground">
                      {formatNumber(totals.totalRevenue, col, showKopecks)}
                    </BodyCell>
                  );
                }
                if (col.id === 'profitMonth') {
                  return (
                    <BodyCell key={col.id} width={col.width ?? 96} className="justify-end px-1.5 tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatNumber(totals.totalProfit, col, showKopecks)}
                    </BodyCell>
                  );
                }
                if (col.id === 'stock') {
                  return (
                    <BodyCell key={col.id} width={col.width ?? 96} className="justify-end px-1.5 tabular-nums text-muted-foreground">
                      {new Intl.NumberFormat('ru-RU').format(totals.stockTotal)}
                    </BodyCell>
                  );
                }
                if (col.id === 'marginRetail') {
                  return (
                    <BodyCell key={col.id} width={col.width ?? 96} className="justify-end px-1.5 tabular-nums text-muted-foreground">
                      {formatNumber(totals.avgMargin, col, showKopecks)}
                    </BodyCell>
                  );
                }
                return <BodyCell key={col.id} width={col.width ?? 96} className="px-1.5" />;
              })}
              <BodyCell width={80} className="px-1.5" />
            </div>
          </div>
        )}
      </div>

      {editingColumn && (
        <ColumnEditDialog
          column={editingColumn}
          onClose={() => setEditingCol(null)}
          onSave={(patch) => updateColumn(editingColumn.id, patch)}
          onDelete={() => {
            removeColumn(editingColumn.id);
            setEditingCol(null);
          }}
          onToggleHidden={() => updateColumn(editingColumn.id, { hidden: !editingColumn.hidden })}
        />
      )}
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
  stickyEdge?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-sticky={sticky ? '' : undefined}
      className={
        'group/header flex shrink-0 flex-col justify-center overflow-hidden border-r border-border/40 px-1.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground ' +
        (sticky ? 'isolate bg-card ' : '') +
        (className ?? '')
      }
      style={{
        width,
        position: sticky ? 'sticky' : undefined,
        left: sticky ? stickyLeft : undefined,
        zIndex: sticky ? 45 : undefined,
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
  stickyEdge?: boolean;
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
        height: 30,
        position: sticky ? 'sticky' : undefined,
        left: sticky ? stickyLeft : undefined,
        zIndex: sticky ? 30 : undefined,
        boxShadow: stickyEdge ? '1px 0 0 0 var(--border)' : undefined,
      }}
    >
      {children}
    </div>
  );
}

function ColumnEditDialog({
  column,
  onClose,
  onSave,
  onDelete,
  onToggleHidden,
}: {
  column: Column;
  onClose: () => void;
  onSave: (patch: Partial<Column>) => void;
  onDelete: () => void;
  onToggleHidden: () => void;
}) {
  const [draft, setDraft] = useState<Column>({ ...column });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Колонка «{column.label}»</DialogTitle>
          <DialogDescription>Имя, тип, формула и ширина. Удаление — справа внизу.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Field label="Название">
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </Field>
          <Field label="Тип">
            <select
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as ColumnType })}
              className="h-9 w-full rounded border border-border/60 bg-background px-2 text-sm"
            >
              <option value="number">Число</option>
              <option value="percent">Процент</option>
              <option value="money">Деньги</option>
              <option value="text">Текст</option>
              <option value="formula">Формула</option>
            </select>
          </Field>
          <Field label="Единица (опц.)">
            <Input
              value={draft.unit ?? ''}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value || undefined })}
              placeholder="₽, %, шт."
            />
          </Field>
          {draft.type === 'formula' && (
            <Field label="Формула">
              <Input
                value={draft.formula ?? ''}
                onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
                placeholder="=priceRetail - cost"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Доступны id колонок (например <code>priceRetail</code>) и глобальные переменные{' '}
                <code>vatPct</code>, <code>taxRatePct</code>.
              </p>
            </Field>
          )}
          <Field label="Ширина, px">
            <Input
              type="number"
              value={draft.width ?? 96}
              onChange={(e) => setDraft({ ...draft, width: Math.max(40, Number(e.target.value) || 96) })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!draft.positive}
              onChange={(e) => setDraft({ ...draft, positive: e.target.checked })}
            />
            Подсвечивать +/−
          </label>
        </div>
        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onToggleHidden}>
              {column.hidden ? <Eye /> : <EyeOff />}
              {column.hidden ? 'Показать' : 'Скрыть'}
            </Button>
            <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={onDelete}>
              <Trash2 /> Удалить
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onSave(draft);
                onClose();
              }}
            >
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

export const UnitMyStoreTableBlock: BlockDef = {
  type: 'unit.my-store-table',
  displayName: 'Мой магазин · таблица',
  description: 'Кастомизируемая таблица товаров: настраиваемые колонки, формулы, привязки.',
  category: 'tables',
  icon: Store,
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 6, h: 5 },
  minContentSize: { w: 480, h: 240 },
  pages: ['unit-economics-my-store'],
  configSchema: ConfigSchema,
  defaultConfig: () => {
    const cfg = ConfigSchema.parse({});
    cfg.columns = defaultColumns();
    return cfg;
  },
  Render: RenderMyStoreTable,
};
