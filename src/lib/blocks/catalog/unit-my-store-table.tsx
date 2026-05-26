// PURPOSE: Блок «Мой магазин» — кастомизируемая таблица товаров с
// настраиваемыми колонками (число/процент/деньги/текст/формула),
// привязками через LinkableNumberCell и формулами с защитой от циклов.
// Базируется на структуре unit.ozon-multi-table (sticky шапка/колонки/итоги).
'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  RotateCcw,
  Store,
  Settings2,
  Eye,
  EyeOff,
  Download,
  GripVertical,
  ArrowUp,
  ArrowDown,
  ArrowDownUp,
  Pin,
  PinOff,
} from 'lucide-react';
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
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { resolveBindingValue } from '@/lib/unit-economics/bindings';
import type { UnitCellBinding } from '@/lib/unit-economics/types';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { evalRowFormulas } from '@/lib/unit-economics/store-formula';
import {
  OzonImportFromAnalyticsDialog,
  type OzonImportSettings,
} from '@/components/unit-economics/ozon-import-from-analytics-dialog';
import {
  OZON_TO_MY_STORE_COLUMN_MAP,
  extractOzonValue,
} from '@/lib/unit-economics/ozon-to-my-store';
import type { OzonAnalyticsRow } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import type { TableColumnKey } from '@/components/unit-economics/ozon-analytics-table';
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

/** Конфиг импорта из Ozon Аналитика (v0.22.0). */
const ImportSourceSchema = z.object({
  blockId: z.string(),
  pageKey: z.string(),
  columns: z.array(z.string()).default([]),
  matchBy: z.enum(['article', 'sku']).default('article'),
  mode: z.enum(['merge', 'replace']).default('merge'),
  syncOnMount: z.boolean().default(false),
  lastImportedAt: z.string().optional(),
});

const ConfigSchema = z.object({
  title: z.string().default('Мой магазин'),
  global: GlobalSchema.default(GlobalSchema.parse({})),
  columns: z.array(ColumnSchema).default([]),
  rows: z.array(RowSchema).default([]),
  importSource: ImportSourceSchema.optional(),
  /**
   * id динамических колонок, закреплённых слева (sticky) — отображаются
   * сразу за фиксированными #/Артикул/Название и не участвуют в DnD-сортировке.
   */
  pinnedColumns: z.array(z.string()).default([]),
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

const STICKY_INDEX_W = 32;
const STICKY_ARTICLE_W = 110;
const STICKY_NAME_W = 220;
const ACTIONS_W = 80;
const STICKY_ARTICLE_LEFT = STICKY_INDEX_W;
const STICKY_NAME_LEFT = STICKY_INDEX_W + STICKY_ARTICLE_W;
const STICKY_GROUP_W = STICKY_INDEX_W + STICKY_ARTICLE_W + STICKY_NAME_W;
const HEADER_H = 32;
const ROW_H = 30;
const PIN_SHADOW = '2px 0 4px -2px rgba(0,0,0,0.08)';

/** Sticky-сортируемый ключ: `null` (без сортировки) → `desc` → `asc` → `null`. */
type SortDir = 'asc' | 'desc';
type SortState = { key: string; dir: SortDir } | null;

function nextSortState(prev: SortState, key: string): SortState {
  if (!prev || prev.key !== key) return { key, dir: 'desc' };
  if (prev.dir === 'desc') return { key, dir: 'asc' };
  return null;
}

/** Стабильный slug из article для per-row publish-ключей. */
function articleSlug(article: string, fallbackIdx: number): string {
  const cleaned = article
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_а-яё]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || `idx${fallbackIdx}`;
}

function RenderMyStoreTable({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const liveValues = useAllBlockValuesFlat();
  const { settings } = useFormatSettings();
  const showKopecks = settings.showKopecks;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importInProgress, setImportInProgress] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const lastSyncRef = useRef<number>(0);
  /** Локальный transient sort state — НЕ персистится в config. */
  const [sort, setSort] = useState<SortState>(null);
  /**
   * Локальный overlay ширин на время drag-resize. Базовый источник —
   * `Column.width` из config. После mouseup overrides записываются обратно
   * в config (один batched `persist`), а локальный state очищается.
   */
  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startW: number; minW: number } | null>(null);
  // Стабильный id для DndContext — `useId()` SSR-safe, предотвращает
  // hydration mismatch на ARIA-описании (DndDescribedBy-N).
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const persist = useCallback(
    (patch: Partial<Config>) => {
      onConfigChange?.({ ...config, ...patch } as unknown as Record<string, unknown>);
    },
    [config, onConfigChange],
  );

  /**
   * Merge Ozon-аналитики в текущие columns/rows.
   *  - Колонки: для каждой выбранной Ozon-колонки добавляем в config.columns
   *    запись из OZON_TO_MY_STORE_COLUMN_MAP, если её ещё нет (по id).
   *  - Строки: ключ matchBy (article|sku). Существующая строка → обновить
   *    только values[colId] для импортируемых колонок. Новая строка →
   *    добавить с article/name из Ozon. Mode='replace' → стираем все строки
   *    перед merge.
   */
  const mergeOzonRowsIntoConfig = useCallback(
    (rows: OzonAnalyticsRow[], settingsArg: OzonImportSettings) => {
      const importedKeys = settingsArg.columns.filter(
        (k): k is TableColumnKey => k in OZON_TO_MY_STORE_COLUMN_MAP,
      );

      // 1. Подготовим набор новых колонок (только тех, которых ещё нет).
      const existingIds = new Set(config.columns.map((c) => c.id));
      const newColumns: Column[] = [];
      for (const k of importedKeys) {
        const def = OZON_TO_MY_STORE_COLUMN_MAP[k];
        if (existingIds.has(def.id)) continue;
        newColumns.push({
          id: def.id,
          label: def.label,
          type: def.type,
          unit: def.unit,
          width: def.width,
        });
      }
      const nextColumns = [...config.columns, ...newColumns];

      // 2. Подготовим merge-карту: ключ → существующая строка.
      const baseRows = settingsArg.mode === 'replace' ? [] : config.rows.slice();
      const byKey = new Map<string, Row>();
      const keyOf = (article: string | null | undefined, sku: string | null | undefined) =>
        (settingsArg.matchBy === 'sku' ? sku ?? '' : article ?? '').toLowerCase().trim();
      for (const row of baseRows) {
        const k = keyOf(row.article, row.values['ozonSku'] as string | undefined);
        if (k) byKey.set(k, row);
      }

      // 3. Применяем impore.
      for (const ozon of rows) {
        const k = keyOf(ozon.article, ozon.sku);
        if (!k) continue;
        const existing = byKey.get(k);
        if (existing) {
          // Обновляем только импортируемые колонки, не трогаем остальные.
          const nextValues = { ...existing.values };
          for (const colKey of importedKeys) {
            const def = OZON_TO_MY_STORE_COLUMN_MAP[colKey];
            const value = extractOzonValue(ozon, colKey);
            if (value !== null) nextValues[def.id] = value;
          }
          byKey.set(k, { ...existing, values: nextValues });
        } else {
          // Новая строка
          const nextValues: Record<string, number | string> = {};
          for (const colKey of importedKeys) {
            const def = OZON_TO_MY_STORE_COLUMN_MAP[colKey];
            const value = extractOzonValue(ozon, colKey);
            if (value !== null) nextValues[def.id] = value;
          }
          byKey.set(k, {
            id: makeId('r'),
            article: ozon.article ?? '',
            name: ozon.name ?? '',
            values: nextValues,
            bindings: {},
          });
        }
      }

      const nextRows = Array.from(byKey.values());

      persist({
        columns: nextColumns,
        rows: nextRows,
        importSource: {
          blockId: settingsArg.blockId,
          pageKey: settingsArg.pageKey,
          columns: settingsArg.columns,
          matchBy: settingsArg.matchBy,
          mode: settingsArg.mode,
          syncOnMount: settingsArg.syncOnMount,
          lastImportedAt: new Date().toISOString(),
        },
      });

      return { rowsCount: nextRows.length, columnsAdded: newColumns.length };
    },
    [config.columns, config.rows, persist],
  );

  const runOzonImport = useCallback(
    async (settingsArg: OzonImportSettings): Promise<void> => {
      setImportInProgress(true);
      try {
        const res = await fetch('/api/unit-economics/import/ozon-analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBlockId: settingsArg.blockId,
            sourcePageKey: settingsArg.pageKey,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const rows = (data.rows ?? []) as OzonAnalyticsRow[];
        const stats = mergeOzonRowsIntoConfig(rows, settingsArg);
        lastSyncRef.current = Date.now();
        setImportNotice(
          `Импортировано ${stats.rowsCount} товаров` +
            (stats.columnsAdded > 0 ? `, +${stats.columnsAdded} колонок` : ''),
        );
        setTimeout(() => setImportNotice(null), 3500);
      } finally {
        setImportInProgress(false);
      }
    },
    [mergeOzonRowsIntoConfig],
  );

  /** Live-sync: при mount/изменении importSource.syncOnMount тихо обновляем. */
  const importSource = config.importSource;
  useEffect(() => {
    if (!importSource || !importSource.syncOnMount) return;
    // Throttle 30 sec.
    const now = Date.now();
    if (now - lastSyncRef.current < 30_000) return;
    runOzonImport({
      blockId: importSource.blockId,
      pageKey: importSource.pageKey,
      columns: importSource.columns as TableColumnKey[],
      matchBy: importSource.matchBy,
      mode: importSource.mode,
      syncOnMount: importSource.syncOnMount,
    }).catch(() => {
      // ignore silent sync errors
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importSource?.syncOnMount, importSource?.blockId, importSource?.pageKey]);

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

  /**
   * Массовое заполнение колонки одинаковым значением во всех строках.
   * Привязанные ячейки пропускаются — биндинг не ломаем. Текстовые/числовые
   * колонки поддержаны через union; для формульных — bulk fill бессмыслен,
   * UI должен disable-ить кнопку.
   */
  const bulkFillColumn = useCallback(
    (colId: string, value: number | string): { applied: number; skipped: number } => {
      let applied = 0;
      let skipped = 0;
      const nextRows = config.rows.map((r) => {
        if (r.bindings[colId]) {
          skipped += 1;
          return r;
        }
        applied += 1;
        return { ...r, values: { ...r.values, [colId]: value } };
      });
      persist({ rows: nextRows });
      return { applied, skipped };
    },
    [config.rows, persist],
  );

  /**
   * Видимые колонки в финальном порядке: сначала pinned (sticky-слева,
   * в порядке `pinnedColumns`), потом остальные в порядке `config.columns`.
   * pinned-id, которых нет в visibleColumns (скрыты / удалены), игнорируются.
   */
  const toggleSort = useCallback((key: string) => {
    setSort((prev) => nextSortState(prev, key));
  }, []);

  const togglePin = useCallback(
    (colId: string) => {
      const exists = config.pinnedColumns.includes(colId);
      const next = exists
        ? config.pinnedColumns.filter((id) => id !== colId)
        : [...config.pinnedColumns, colId];
      persist({ pinnedColumns: next });
    },
    [config.pinnedColumns, persist],
  );

  const handleHeaderDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      // Pinned колонки не двигаются и не принимают drop.
      if (config.pinnedColumns.includes(activeId) || config.pinnedColumns.includes(overId)) return;
      const oldIdx = config.columns.findIndex((c) => c.id === activeId);
      const newIdx = config.columns.findIndex((c) => c.id === overId);
      if (oldIdx < 0 || newIdx < 0) return;
      persist({ columns: arrayMove(config.columns, oldIdx, newIdx) });
    },
    [config.columns, config.pinnedColumns, persist],
  );

  /**
   * Drag-resize колонки. Во время drag обновляется только локальный
   * `widthOverrides` (без `persist`) — без этого был бы шторм записей
   * в config на каждое движение мыши. По `mouseup` один раз обновляем
   * `Column.width` в config и сбрасываем overlay.
   */
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const col = config.columns.find((c) => c.id === colId);
      if (!col) return;
      resizingRef.current = {
        key: colId,
        startX: e.clientX,
        startW: col.width ?? 96,
        minW: 40,
      };
      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = ev.clientX - resizingRef.current.startX;
        const newW = Math.max(resizingRef.current.minW, resizingRef.current.startW + delta);
        setWidthOverrides((prev) => ({ ...prev, [resizingRef.current!.key]: newW }));
      };
      const onUp = () => {
        const ref = resizingRef.current;
        resizingRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (ref) {
          setWidthOverrides((prev) => {
            const next = { ...prev };
            const finalW = next[ref.key];
            delete next[ref.key];
            if (typeof finalW === 'number' && finalW !== ref.startW) {
              persist({
                columns: config.columns.map((c) =>
                  c.id === ref.key ? { ...c, width: finalW } : c,
                ),
              });
            }
            return next;
          });
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [config.columns, persist],
  );

  const visibleColumns = useMemo(() => {
    const visibleAll = config.columns.filter((c) => !c.hidden);
    const byId = new Map(visibleAll.map((c) => [c.id, c]));
    const pins = config.pinnedColumns
      .map((id) => byId.get(id))
      .filter((c): c is Column => Boolean(c));
    const pinIds = new Set(pins.map((c) => c.id));
    const rest = visibleAll.filter((c) => !pinIds.has(c.id));
    return [...pins, ...rest];
  }, [config.columns, config.pinnedColumns]);

  const pinnedSet = useMemo(() => new Set(config.pinnedColumns), [config.pinnedColumns]);

  /** id колонок, доступных для DnD (всё кроме pinned). */
  const reorderableIds = useMemo(
    () => visibleColumns.filter((c) => !pinnedSet.has(c.id)).map((c) => c.id),
    [visibleColumns, pinnedSet],
  );

  /** Ширина с учётом локального drag-overlay (для плавного resize). */
  const widthOf = useCallback(
    (col: Column): number => widthOverrides[col.id] ?? col.width ?? 96,
    [widthOverrides],
  );

  /**
   * Cumulative left-offset для подряд идущих pinned колонок, начиная от
   * правого края sticky-блока `#/Артикул/Название` (`STICKY_GROUP_W`).
   * Только колонки, идущие подряд в начале `visibleColumns`, остаются sticky.
   */
  const stickyOffsets = useMemo(() => {
    const map = new Map<string, number>();
    let acc = STICKY_GROUP_W;
    for (const col of visibleColumns) {
      if (!pinnedSet.has(col.id)) break;
      map.set(col.id, acc);
      acc += widthOf(col);
    }
    return map;
  }, [visibleColumns, pinnedSet, widthOf]);

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

  /**
   * Сортированные строки. Если `sort=null` — отдаём `computedRows` в исходном
   * порядке. Сортировка применяется ПОСЛЕ расчёта формул и НЕ зависит от
   * totals (агрегаты считаются по `computedRows`).
   *
   * - `article`/`name` — `localeCompare` (ru).
   * - Остальные — числовое сравнение по `values[col.id]`. `'#CYCLE'/'#ERR'`
   *   и пустые/non-finite значения уходят в конец независимо от направления.
   */
  const sortedComputedRows = useMemo(() => {
    if (!sort) return computedRows;
    const colsById = new Map(config.columns.map((c) => [c.id, c]));
    const isTextSort = sort.key === 'article' || sort.key === 'name' || colsById.get(sort.key)?.type === 'text';
    const next = [...computedRows];
    next.sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      if (sort.key === 'article') {
        av = a.row.article;
        bv = b.row.article;
      } else if (sort.key === 'name') {
        av = a.row.name;
        bv = b.row.name;
      } else {
        av = a.values[sort.key];
        bv = b.values[sort.key];
      }
      const aBad =
        av === undefined ||
        av === null ||
        av === '' ||
        av === '#CYCLE' ||
        av === '#ERR' ||
        (typeof av === 'number' && !Number.isFinite(av));
      const bBad =
        bv === undefined ||
        bv === null ||
        bv === '' ||
        bv === '#CYCLE' ||
        bv === '#ERR' ||
        (typeof bv === 'number' && !Number.isFinite(bv));
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      if (isTextSort) {
        const as = String(av);
        const bs = String(bv);
        return sort.dir === 'asc' ? as.localeCompare(bs, 'ru') : bs.localeCompare(as, 'ru');
      }
      const na = Number(av);
      const nb = Number(bv);
      return sort.dir === 'asc' ? na - nb : nb - na;
    });
    return next;
  }, [computedRows, sort, config.columns]);

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

  /**
   * Output для `useBlockValuePublisher`:
   *  - Агрегаты блока (rowsCount, totalRevenue, totalProfit, avgMargin, stockTotal).
   *  - Per-row значения каждой видимой строки: `r_<slug>_<colId>`,
   *    плюс служебные `r_<slug>_article` / `r_<slug>_name`. Это позволяет
   *    другим блокам (KPI, Chart, custom-data formulas) биндиться к
   *    конкретной строке через стандартный picker (он читает `__labels`).
   *  - Money-колонки публикуются в копейках и перечисляются в `__money`.
   *  - Лимит — top-50 строк по `revenueMonth` DESC (защита от взрыва
   *    keys-пространства при тысячах товаров). Slug формируется из
   *    article (или `idx{N}` для пустых article); коллизии разрешаются
   *    суффиксом `_idx`.
   */
  const publisherOutput = useMemo(() => {
    const out: Record<string, number | string | null> = {
      rowsCount: totals.rowsCount,
      totalRevenue: rublesToKopecks(totals.totalRevenue),
      totalProfit: rublesToKopecks(totals.totalProfit),
      avgMargin: totals.avgMargin,
      stockTotal: totals.stockTotal,
      label: instance.appearance?.title ?? config.title,
    };
    const moneyFields: string[] = ['totalRevenue', 'totalProfit'];
    const labelFields: string[] = [
      'rowsCount=Товаров',
      'totalRevenue=Выручка / мес',
      'totalProfit=Прибыль / мес',
      'avgMargin=Средняя маржа',
      'stockTotal=Сумма остатков',
    ];

    // Top-50 строк по revenueMonth DESC.
    const ranked = computedRows
      .map((entry, idx) => ({
        entry,
        idx,
        revenue: Number(entry.values['revenueMonth'] ?? 0),
      }))
      .sort((a, b) => {
        const aOk = Number.isFinite(a.revenue);
        const bOk = Number.isFinite(b.revenue);
        if (!aOk && !bOk) return 0;
        if (!aOk) return 1;
        if (!bOk) return -1;
        return b.revenue - a.revenue;
      })
      .slice(0, 50);

    const seenSlugs = new Set<string>();
    for (const { entry, idx } of ranked) {
      const { row, values } = entry;
      let slug = articleSlug(row.article, idx);
      if (seenSlugs.has(slug)) slug = `${slug}_${idx}`;
      seenSlugs.add(slug);
      const rowLabel = row.article || row.name || `#${idx + 1}`;

      out[`r_${slug}_article`] = row.article || '';
      out[`r_${slug}_name`] = row.name || '';
      labelFields.push(`r_${slug}_article=${rowLabel} · Артикул`);
      labelFields.push(`r_${slug}_name=${rowLabel} · Название`);

      for (const col of visibleColumns) {
        const key = `r_${slug}_${col.id}`;
        const raw = values[col.id];
        if (raw === '#CYCLE' || raw === '#ERR') {
          out[key] = null;
        } else if (col.type === 'text') {
          out[key] = typeof raw === 'string' ? raw : String(raw ?? '');
        } else {
          const num = Number(raw);
          if (!Number.isFinite(num)) {
            out[key] = null;
          } else if (isMoneyCol(col)) {
            out[key] = rublesToKopecks(num);
            moneyFields.push(key);
          } else {
            out[key] = num;
          }
        }
        labelFields.push(`${key}=${rowLabel} · ${col.label}`);
      }
    }

    out.__money = moneyFields.join(',');
    out.__labels = labelFields.join(',');
    return out;
  }, [
    totals.rowsCount,
    totals.totalRevenue,
    totals.totalProfit,
    totals.avgMargin,
    totals.stockTotal,
    computedRows,
    visibleColumns,
    instance.appearance?.title,
    config.title,
  ]);

  useBlockValuePublisher(instance.id, publisherOutput);

  const editingColumn = editingCol ? config.columns.find((c) => c.id === editingCol) ?? null : null;

  const totalRowWidth =
    STICKY_GROUP_W + visibleColumns.reduce((acc, c) => acc + widthOf(c), 0) + ACTIONS_W;

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportDialogOpen(true)}
            disabled={importInProgress}
            title="Импортировать данные из блока «Ozon · Аналитика»"
          >
            <Download /> Из Ozon Аналитики
          </Button>
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

      {/* Import notice + live-sync indicator */}
      {(importNotice || config.importSource?.lastImportedAt) && (
        <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-sky-50/40 px-3 py-1 text-[11px] dark:bg-sky-950/30">
          {importNotice ? (
            <span className="text-sky-800 dark:text-sky-300">{importNotice}</span>
          ) : (
            <span className="text-muted-foreground">
              Импорт из Ozon Аналитики:{' '}
              {new Date(config.importSource!.lastImportedAt!).toLocaleString('ru-RU')}
              {config.importSource?.syncOnMount && ' · авто-синхронизация'}
            </span>
          )}
          {config.importSource && (
            <button
              type="button"
              onClick={() => persist({ importSource: undefined })}
              className="text-[10px] text-muted-foreground hover:text-red-500"
            >
              Отключить
            </button>
          )}
        </div>
      )}

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
            {/* Header row.
                DndContext оборачивает ВСЕ динамические заголовки; pinned-колонки
                добавляются в SortableContext с `disabled` через `useSortable` →
                handleHeaderDragEnd игнорирует drop на/из pinned. */}
            <div className="sticky top-0 z-40 flex border-b border-border/70 bg-card">
              <StickyTitleHeaderCell
                width={STICKY_INDEX_W}
                stickyLeft={0}
                className="text-center font-semibold text-muted-foreground"
                sortable={false}
              >
                #
              </StickyTitleHeaderCell>
              <StickyTitleHeaderCell
                width={STICKY_ARTICLE_W}
                stickyLeft={STICKY_ARTICLE_LEFT}
                className="font-semibold"
                sortable
                sortState={sort?.key === 'article' ? sort.dir : null}
                onSort={() => toggleSort('article')}
              >
                Артикул
              </StickyTitleHeaderCell>
              <StickyTitleHeaderCell
                width={STICKY_NAME_W}
                stickyLeft={STICKY_NAME_LEFT}
                stickyEdge
                className="font-semibold"
                sortable
                sortState={sort?.key === 'name' ? sort.dir : null}
                onSort={() => toggleSort('name')}
              >
                Название товара
              </StickyTitleHeaderCell>
              <DndContext
                id={dndId}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleHeaderDragEnd}
              >
                <SortableContext items={reorderableIds} strategy={horizontalListSortingStrategy}>
                  {visibleColumns.map((col) => {
                    const w = widthOf(col);
                    const stickyLeft = stickyOffsets.get(col.id);
                    const isPinned = stickyLeft !== undefined;
                    const nextCol = visibleColumns[visibleColumns.indexOf(col) + 1];
                    const isLastPinned = isPinned && (!nextCol || !stickyOffsets.has(nextCol.id));
                    return (
                      <MyStoreSortableHeaderCell
                        key={col.id}
                        col={col}
                        width={w}
                        draggable={!isPinned}
                        stickyLeft={stickyLeft}
                        isLastPinned={isLastPinned}
                        isPinned={isPinned}
                        sortState={sort?.key === col.id ? sort.dir : null}
                        onSort={() => toggleSort(col.id)}
                        onResizeStart={(e) => handleResizeStart(e, col.id)}
                        onOpenSettings={() => setEditingCol(col.id)}
                        onTogglePin={() => togglePin(col.id)}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
              <HeaderCell width={ACTIONS_W} className="text-center font-semibold text-muted-foreground">
                Действия
              </HeaderCell>
            </div>

            {sortedComputedRows.map(({ row, values }, idx) => (
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
                {visibleColumns.map((col) => {
                  const w = widthOf(col);
                  const stickyLeft = stickyOffsets.get(col.id);
                  const isPinned = stickyLeft !== undefined;
                  const nextCol = visibleColumns[visibleColumns.indexOf(col) + 1];
                  const isLastPinned = isPinned && (!nextCol || !stickyOffsets.has(nextCol.id));
                  const stickyProps = isPinned
                    ? { sticky: true, stickyLeft, stickyEdge: isLastPinned }
                    : {};
                  const raw = values[col.id];
                  if (col.type === 'formula') {
                    const isErr = raw === '#CYCLE' || raw === '#ERR';
                    const num = Number(raw);
                    const positive = col.positive && num > 0;
                    const negative = col.positive && num < 0;
                    return (
                      <BodyCell
                        key={col.id}
                        width={w}
                        {...stickyProps}
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
                      <BodyCell key={col.id} width={w} {...stickyProps} className="p-0">
                        <input
                          type="text"
                          value={text}
                          onChange={(e) => updateRowValue(row.id, col.id, e.target.value)}
                          placeholder={col.label}
                          className="h-full w-full min-w-0 truncate border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
                        />
                      </BodyCell>
                    );
                  }
                  const num = Number(raw);
                  const binding = row.bindings[col.id] as UnitCellBinding | undefined;
                  return (
                    <BodyCell key={col.id} width={w} {...stickyProps} className="p-0.5">
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
                <BodyCell width={ACTIONS_W} className="justify-center">
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
              <BodyCell width={STICKY_GROUP_W} sticky stickyLeft={0} stickyEdge zIndex={36} className="justify-end px-3 text-muted-foreground">
                Итого по {totals.rowsCount} товарам
              </BodyCell>
              {visibleColumns.map((col) => {
                const w = widthOf(col);
                const stickyLeft = stickyOffsets.get(col.id);
                const isPinned = stickyLeft !== undefined;
                const nextCol = visibleColumns[visibleColumns.indexOf(col) + 1];
                const isLastPinned = isPinned && (!nextCol || !stickyOffsets.has(nextCol.id));
                const stickyProps = isPinned
                  ? { sticky: true, stickyLeft, stickyEdge: isLastPinned, zIndex: 36 }
                  : {};
                if (col.id === 'revenueMonth') {
                  return (
                    <BodyCell key={col.id} width={w} {...stickyProps} className="justify-end px-1.5 tabular-nums text-foreground">
                      {formatNumber(totals.totalRevenue, col, showKopecks)}
                    </BodyCell>
                  );
                }
                if (col.id === 'profitMonth') {
                  return (
                    <BodyCell key={col.id} width={w} {...stickyProps} className="justify-end px-1.5 tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatNumber(totals.totalProfit, col, showKopecks)}
                    </BodyCell>
                  );
                }
                if (col.id === 'stock') {
                  return (
                    <BodyCell key={col.id} width={w} {...stickyProps} className="justify-end px-1.5 tabular-nums text-muted-foreground">
                      {new Intl.NumberFormat('ru-RU').format(totals.stockTotal)}
                    </BodyCell>
                  );
                }
                if (col.id === 'marginRetail') {
                  return (
                    <BodyCell key={col.id} width={w} {...stickyProps} className="justify-end px-1.5 tabular-nums text-muted-foreground">
                      {formatNumber(totals.avgMargin, col, showKopecks)}
                    </BodyCell>
                  );
                }
                return <BodyCell key={col.id} width={w} {...stickyProps} className="px-1.5" />;
              })}
              <BodyCell width={ACTIONS_W} className="px-1.5" />
            </div>
          </div>
        )}
      </div>

      {editingColumn && (
        <ColumnEditDialog
          column={editingColumn}
          pinned={config.pinnedColumns.includes(editingColumn.id)}
          onClose={() => setEditingCol(null)}
          onSave={(patch) => updateColumn(editingColumn.id, patch)}
          onDelete={() => {
            removeColumn(editingColumn.id);
            setEditingCol(null);
          }}
          onToggleHidden={() => updateColumn(editingColumn.id, { hidden: !editingColumn.hidden })}
          onTogglePin={() => togglePin(editingColumn.id)}
          onBulkFill={(value) => bulkFillColumn(editingColumn.id, value)}
        />
      )}

      <OzonImportFromAnalyticsDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImport={runOzonImport}
        initialSettings={
          config.importSource
            ? {
                blockId: config.importSource.blockId,
                pageKey: config.importSource.pageKey,
                columns: config.importSource.columns as TableColumnKey[],
                matchBy: config.importSource.matchBy,
                mode: config.importSource.mode,
                syncOnMount: config.importSource.syncOnMount,
              }
            : undefined
        }
      />
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
  stickyEdge?: boolean;
  zIndex?: number;
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
 * Заголовок sticky-колонки (#/Артикул/Название). Поддерживает sort-cycle:
 * клик по заголовку — `null → desc → asc → null`. Drag и resize не нужны:
 * эти три колонки фиксированы по ширине и порядку.
 */
function StickyTitleHeaderCell({
  width,
  stickyLeft,
  stickyEdge,
  sortable,
  sortState,
  onSort,
  className,
  children,
}: {
  width: number;
  stickyLeft: number;
  stickyEdge?: boolean;
  sortable: boolean;
  sortState?: 'asc' | 'desc' | null;
  onSort?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-sticky=""
      onClick={sortable ? onSort : undefined}
      className={
        'group/h relative isolate flex shrink-0 items-center overflow-hidden border-r border-border/40 bg-card ' +
        (sortable ? 'cursor-pointer hover:bg-accent/30 ' : '') +
        (className ?? '')
      }
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        height: HEADER_H,
        boxSizing: 'border-box',
        position: 'sticky',
        left: stickyLeft,
        zIndex: 45,
        boxShadow: stickyEdge ? PIN_SHADOW : undefined,
      }}
    >
      <span className="inline-flex w-full items-center gap-1 px-1.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="block flex-1 truncate">{children}</span>
        {sortable && (
          <span className="shrink-0">
            {sortState === 'asc' ? (
              <ArrowUp className="h-2.5 w-2.5 text-primary" />
            ) : sortState === 'desc' ? (
              <ArrowDown className="h-2.5 w-2.5 text-primary" />
            ) : (
              <ArrowDownUp className="h-2.5 w-2.5 opacity-0 group-hover/h:opacity-40" />
            )}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Sortable + resizable + sticky-pinnable заголовок динамической колонки.
 * Drag handle (GripVertical) виден на hover; resize-handle на правом крае;
 * click по заголовку (вне кнопок) — sort-cycle. Когда `isPinned=true`,
 * колонка получает `position: sticky` с указанным `stickyLeft`.
 */
function MyStoreSortableHeaderCell({
  col,
  width,
  draggable,
  stickyLeft,
  isLastPinned,
  isPinned,
  sortState,
  onSort,
  onResizeStart,
  onOpenSettings,
  onTogglePin,
}: {
  col: Column;
  width: number;
  draggable: boolean;
  stickyLeft?: number;
  isLastPinned?: boolean;
  isPinned: boolean;
  sortState?: 'asc' | 'desc' | null;
  onSort: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onOpenSettings: () => void;
  onTogglePin: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: col.id,
    disabled: !draggable,
  });
  const style: React.CSSProperties = {
    width,
    minWidth: width,
    maxWidth: width,
    height: HEADER_H,
    boxSizing: 'border-box',
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : isPinned ? 46 : 45,
    opacity: isDragging ? 0.85 : undefined,
    ...(isPinned
      ? {
          position: 'sticky',
          left: stickyLeft,
          backgroundColor: 'hsl(var(--card))',
          boxShadow: isLastPinned ? PIN_SHADOW : undefined,
        }
      : {}),
  };
  const unitBadge = col.type === 'formula' ? 'fx' : col.unit;
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSort}
      title={col.label}
      className={
        'group/h relative isolate flex shrink-0 items-center overflow-hidden border-r border-border/40 ' +
        'cursor-pointer hover:bg-accent/30 ' +
        (isPinned ? 'bg-card ' : '')
      }
    >
      <span className="inline-flex w-full items-center gap-1 px-1.5 py-1 text-[10px] uppercase tracking-wider">
        {draggable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="shrink-0 cursor-grab opacity-0 transition-opacity group-hover/h:opacity-60 hover:opacity-100 active:cursor-grabbing"
            title="Перетащите, чтобы изменить порядок"
            aria-label="Перетащить колонку"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        )}
        <span className="block flex-1 truncate font-semibold text-foreground" title={col.label}>
          {col.label}
        </span>
        {unitBadge && (
          <span className="shrink-0 text-[9px] font-normal text-muted-foreground/70">
            {unitBadge}
          </span>
        )}
        <span className="shrink-0 text-muted-foreground">
          {sortState === 'asc' ? (
            <ArrowUp className="h-2.5 w-2.5 text-primary" />
          ) : sortState === 'desc' ? (
            <ArrowDown className="h-2.5 w-2.5 text-primary" />
          ) : (
            <ArrowDownUp className="h-2.5 w-2.5 opacity-0 group-hover/h:opacity-40" />
          )}
        </span>
        <span className="ml-0.5 inline-flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/h:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-primary"
            title={isPinned ? 'Открепить колонку' : 'Закрепить слева'}
            aria-label={isPinned ? 'Открепить' : 'Закрепить'}
          >
            {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings();
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-primary"
            title="Настроить колонку"
            aria-label="Настроить"
          >
            <Settings2 className="h-3 w-3" />
          </button>
        </span>
      </span>
      <span
        onMouseDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize hover:bg-primary/20"
        aria-hidden
      />
    </div>
  );
}

function ColumnEditDialog({
  column,
  pinned,
  onClose,
  onSave,
  onDelete,
  onToggleHidden,
  onTogglePin,
  onBulkFill,
}: {
  column: Column;
  pinned: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Column>) => void;
  onDelete: () => void;
  onToggleHidden: () => void;
  onTogglePin: () => void;
  onBulkFill: (value: number | string) => { applied: number; skipped: number };
}) {
  const [draft, setDraft] = useState<Column>({ ...column });
  const [bulkDraft, setBulkDraft] = useState('');
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const isFormula = column.type === 'formula';
  const isText = column.type === 'text';

  function handleBulkApply() {
    if (isFormula) return;
    const trimmed = bulkDraft.trim();
    if (!trimmed) return;
    let value: number | string;
    if (isText) {
      value = trimmed;
    } else {
      const num = Number(trimmed.replace(',', '.'));
      if (!Number.isFinite(num)) {
        setBulkFeedback('Введите число');
        return;
      }
      value = num;
    }
    const { applied, skipped } = onBulkFill(value);
    setBulkFeedback(
      skipped > 0
        ? `Применено к ${applied} · пропущено ${skipped} (привязки сохранены)`
        : `Применено к ${applied}`,
    );
    setTimeout(() => setBulkFeedback(null), 2200);
    setBulkDraft('');
  }

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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pinned} onChange={() => onTogglePin()} />
            Закрепить слева (sticky)
          </label>

          <div className="rounded border border-dashed border-border/60 bg-muted/20 p-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Массовое заполнение
            </div>
            {isFormula ? (
              <p className="text-[11px] text-muted-foreground">
                Колонка типа «Формула» вычисляется автоматически — массовое заполнение недоступно.
              </p>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Применит указанное значение ко всем строкам колонки. Привязанные ячейки будут
                  пропущены.
                </p>
                <div className="flex items-center gap-1.5">
                  <Input
                    type={isText ? 'text' : 'number'}
                    value={bulkDraft}
                    onChange={(e) => setBulkDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleBulkApply();
                      }
                    }}
                    placeholder={isText ? 'Текст' : 'Значение'}
                    className="h-8 flex-1 text-sm"
                  />
                  {column.unit && !isText && (
                    <span className="text-xs text-muted-foreground">{column.unit}</span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleBulkApply}
                    disabled={bulkDraft.trim().length === 0}
                  >
                    Применить
                  </Button>
                </div>
                {bulkFeedback && (
                  <div className="mt-2 rounded bg-accent/50 px-2 py-1 text-[11px] text-foreground">
                    {bulkFeedback}
                  </div>
                )}
              </>
            )}
          </div>
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
