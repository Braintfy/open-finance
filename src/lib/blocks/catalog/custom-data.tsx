// PURPOSE: Универсальный data-блок (custom.data) — multi-column таблица с привязками per cell.
// Каждая строка имеет label + произвольный набор колонок. Каждая ячейка может быть либо
// manual-значением, либо ссылкой на другой блок (@blockId.field) — как в excel.cell.
// Блок публикует per-column агрегаты, чтобы их можно было @связать в формулах.
'use client';

import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Database,
  Plus,
  Trash2,
  Sparkles,
  Link2,
  Unlink,
  X,
  Hash,
  Percent,
  RussianRuble,
  Type,
  Check,
  Maximize2,
  GripVertical,
  FunctionSquare,
  AlertTriangle,
} from 'lucide-react';
import { z } from 'zod';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CurrencyInput } from '@/components/ui/currency-input';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import {
  BlockValuesContext,
  useAvailableBlockSources,
  useBlockValuePublisher,
} from '../values';
import {
  evaluateAllCells,
  resultAsNumber,
  cellAddress,
  type FormulaCell,
  type FormulaResult,
  type FormulaEvalContext,
} from '../custom-data-formulas';
import { cn } from '@/lib/utils';

// ============================================================================
// Schemas
// ============================================================================

const ColumnFormatSchema = z.enum(['rubles', 'number', 'percent', 'text']);
type ColumnFormat = z.infer<typeof ColumnFormatSchema>;

const ColumnSchema = z.object({
  id: z.string(),
  label: z.string(),
  format: ColumnFormatSchema.default('rubles'),
  width: z.number().optional(),
  publish: z.boolean().default(true),
});
type Column = z.infer<typeof ColumnSchema>;

const CellSchema = z.object({
  v: z.union([z.number(), z.string(), z.null()]).default(null),
  ref: z.string().optional(),
  isMoney: z.boolean().optional(),
});
type Cell = z.infer<typeof CellSchema>;

const RowSchema = z.object({
  id: z.string(),
  label: z.string(),
  cells: z.record(z.string(), CellSchema).default({}),
});
type Row = z.infer<typeof RowSchema>;

/**
 * Schema принимает и старый формат (`rows[i].value`, top-level `format`),
 * и новый. Реальная нормализация — в `parseConfig`.
 */
const ConfigSchema = z
  .object({
    columns: z.array(ColumnSchema).optional(),
    rows: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string().optional(),
            cells: z.record(z.string(), CellSchema).optional(),
            value: z.union([z.number(), z.string(), z.null()]).optional(),
          })
          .passthrough(),
      )
      .optional(),
    publishMode: z.enum(['sum', 'avg', 'count', 'last']).optional(),
    publishColumnId: z.string().optional(),
    format: ColumnFormatSchema.optional(),
    showKopecks: z.boolean().nullable().optional(),
    /** Override ширины первой («label») колонки в px. Undefined = автоширина. */
    labelColumnWidth: z.number().optional(),
  })
  .passthrough();

type Config = {
  columns: Column[];
  rows: Row[];
  publishMode: 'sum' | 'avg' | 'count' | 'last';
  publishColumnId?: string;
  showKopecks: boolean | null;
  labelColumnWidth?: number;
};

const DEFAULT_COLUMN_ID = 'amount';

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function defaultColumns(format: ColumnFormat = 'rubles'): Column[] {
  return [
    {
      id: DEFAULT_COLUMN_ID,
      label: 'Сумма',
      format,
      publish: true,
    },
  ];
}

function parseConfig(raw: unknown): Config {
  const r = ConfigSchema.safeParse(raw ?? {});
  const data = r.success ? r.data : {};

  // Колонки
  let columns: Column[] = (data.columns ?? []).map((c) => {
    const out: Column = {
      id: c.id || makeId('col'),
      label: c.label || 'Колонка',
      format: c.format,
      publish: c.publish ?? true,
    };
    if (typeof c.width === 'number') out.width = c.width;
    return out;
  });
  if (columns.length === 0) {
    columns = defaultColumns(data.format);
  }
  const primaryColumnId = columns[0]?.id ?? DEFAULT_COLUMN_ID;

  // Строки + миграция legacy `value` → cells[primary]
  const rows: Row[] = (data.rows ?? []).map((r) => {
    const cells: Record<string, Cell> = {};
    if (r.cells && typeof r.cells === 'object') {
      for (const [colId, cell] of Object.entries(r.cells)) {
        cells[colId] = {
          v: cell?.v ?? null,
          ref: cell?.ref,
          isMoney: cell?.isMoney,
        };
      }
    }
    if (
      r.value !== undefined &&
      r.value !== null &&
      cells[primaryColumnId] === undefined
    ) {
      cells[primaryColumnId] = { v: r.value };
    }
    return {
      id: r.id || makeId('row'),
      label: r.label ?? '',
      cells,
    };
  });

  return {
    columns,
    rows,
    publishMode: data.publishMode ?? 'sum',
    publishColumnId:
      data.publishColumnId && columns.some((c) => c.id === data.publishColumnId)
        ? data.publishColumnId
        : columns.find((c) => c.publish !== false)?.id ?? primaryColumnId,
    showKopecks: data.showKopecks === undefined ? null : data.showKopecks,
    labelColumnWidth:
      typeof data.labelColumnWidth === 'number' && data.labelColumnWidth > 0
        ? data.labelColumnWidth
        : undefined,
  };
}

function serializeConfig(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {
    columns: cfg.columns,
    rows: cfg.rows,
    publishMode: cfg.publishMode,
    publishColumnId: cfg.publishColumnId,
    showKopecks: cfg.showKopecks,
  };
  if (typeof cfg.labelColumnWidth === 'number') out.labelColumnWidth = cfg.labelColumnWidth;
  return out;
}

// ============================================================================
// Live values (BlockValuesContext)
// ============================================================================

type LiveValues = Record<string, number | string | null>;

function useAllBlockValues(): LiveValues {
  const api = useContext(BlockValuesContext);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setTick((t) => t + 1));
  }, [api]);
  return useMemo(() => {
    if (!api) return {};
    const result: LiveValues = {};
    for (const [blockId, output] of api.get().values.entries()) {
      for (const [field, value] of Object.entries(output)) {
        const key = field === 'value' ? blockId : `${blockId}.${field}`;
        result[key] = value;
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, tick]);
}

function moneyFieldSet(blockId: string, values: LiveValues): Set<string> {
  const raw = values[`${blockId}.__money`];
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean),
  );
}

function resolveCellValue(
  cell: Cell | undefined,
  liveValues: LiveValues,
): number | string | null {
  if (!cell) return null;
  if (cell.ref) {
    const live = liveValues[cell.ref];
    if (live !== undefined && live !== null) return live;
    return cell.v;
  }
  return cell.v ?? null;
}

function toNumeric(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/\s/g, '')
      .replace(/[₽рруб.]/gi, '')
      .replace(',', '.');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function aggregateByMode(
  values: number[],
  mode: Config['publishMode'],
): number {
  if (values.length === 0) return 0;
  switch (mode) {
    case 'sum':
      return values.reduce((s, n) => s + n, 0);
    case 'avg':
      return values.reduce((s, n) => s + n, 0) / values.length;
    case 'count':
      return values.length;
    case 'last':
      return values[values.length - 1];
  }
}

function formatColumnValue(
  value: number | string | null,
  format: ColumnFormat,
  showKopecks: boolean,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (format === 'text') return String(value);
  const numeric = toNumeric(value);
  if (numeric === null) return String(value);
  if (format === 'rubles') return formatRublesWithSettings(numeric, showKopecks);
  if (format === 'percent') {
    return `${numeric.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
  }
  return numeric.toLocaleString('ru-RU', {
    maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
  });
}

/**
 * Преобразует config колонок и строк в FormulaEvalContext, который понимает
 * evaluator. `liveValues`/`moneyRefs` собираются на стороне рендера.
 */
function buildEvalContext(
  columns: Column[],
  rows: Row[],
  liveValues: LiveValues,
): FormulaEvalContext {
  // moneyRefs собираем из `__money`-флагов всех блоков, а также из cell.isMoney
  // (последнее уже учитывается в evaluator при kind='binding', но для @-ссылок
  // в формулах нужно знать денежность ref'а в момент подстановки).
  const moneyRefs: Record<string, boolean> = {};
  for (const [key, _value] of Object.entries(liveValues)) {
    void _value;
    // ключи вида "<blockId>.__money" содержат CSV список денежных полей
    if (key.endsWith('.__money')) {
      const blockId = key.slice(0, -'.__money'.length);
      const raw = String(liveValues[key] ?? '');
      for (const field of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
        const refKey = field === 'value' ? blockId : `${blockId}.${field}`;
        moneyRefs[refKey] = true;
      }
    }
  }
  return {
    rows: rows as unknown as FormulaEvalContext['rows'],
    columns: columns.map((c) => ({ id: c.id, label: c.label, format: c.format })),
    liveValues,
    moneyRefs,
  };
}

/**
 * Возвращает Map { "A1" → FormulaResult } со всеми посчитанными ячейками
 * и считает агрегаты per-column.
 */
function computeAll(
  columns: Column[],
  rows: Row[],
  liveValues: LiveValues,
  mode: Config['publishMode'],
): { cache: Map<string, FormulaResult>; aggregates: Record<string, number> } {
  const ctx = buildEvalContext(columns, rows, liveValues);
  const cache = evaluateAllCells(ctx);

  const aggregates: Record<string, number> = {};
  for (let cIdx = 0; cIdx < columns.length; cIdx++) {
    const col = columns[cIdx];
    if (col.format === 'text') {
      aggregates[col.id] = 0;
      continue;
    }
    const numeric: number[] = [];
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const result = cache.get(cellAddress(rIdx, cIdx));
      if (!result) continue;
      const n = resultAsNumber(result);
      if (n !== null) numeric.push(n);
    }
    aggregates[col.id] = aggregateByMode(numeric, mode);
  }
  return { cache, aggregates };
}

function formatIcon(format: ColumnFormat) {
  if (format === 'rubles') return RussianRuble;
  if (format === 'number') return Hash;
  if (format === 'percent') return Percent;
  return Type;
}

function formatLabel(format: ColumnFormat): string {
  if (format === 'rubles') return '₽ Рубли';
  if (format === 'number') return '# Число';
  if (format === 'percent') return '% Процент';
  return 'T Текст';
}

// ============================================================================
// Auto-width measurement
// ============================================================================

/**
 * Один общий canvas-контекст на весь модуль для measureText.
 * SSR-safe: лениво инициализируется в браузере при первом обращении.
 * canvas.measureText в ~50× быстрее DOM-rendering и не требует mount/unmount.
 */
let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (_measureCtx) return _measureCtx;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  _measureCtx = ctx;
  return ctx;
}

/**
 * Меряет ширину текста с учётом font-стека приложения.
 * Шрифт берётся из computed style на body (fallback — sans-serif 12px).
 * Используем `tabular-nums`-эквивалент (моноширинные цифры) для number/rubles
 * — там просто умеряем по реальному кол-ву цифр × ширина '0' (стабильно).
 */
function measureTextWidth(text: string, fontSize = 12, weight: 400 | 600 = 400): number {
  if (!text) return 0;
  const ctx = getMeasureCtx();
  if (!ctx) {
    // SSR fallback — грубая оценка ~ 7px на символ
    return text.length * 7;
  }
  ctx.font = `${weight} ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  return ctx.measureText(text).width;
}

const COL_PADDING_PX = 18; // px-1 (8) + ring/border (2) + breath (8)
const LABEL_PADDING_PX = 22; // px-2 (16) + breath (6)
const MIN_LABEL_WIDTH = 80;
const MAX_LABEL_WIDTH = 240;
const MIN_VALUE_WIDTH = 72;
const MAX_VALUE_WIDTH = 220;

/**
 * Авто-ширина value-колонки = max(header_label, max(formatted_cell_value)) + padding.
 * Header участвует тоже — иначе при пустых ячейках колонка обрезает заголовок.
 */
function computeValueColumnWidth(
  col: Column,
  rows: Row[],
  liveValues: LiveValues,
  showKopecks: boolean,
): number {
  // Header text + icon (~14px ширина иконки + gap)
  const headerWidth = measureTextWidth(col.label.toUpperCase(), 10, 600) + 14;
  let maxCell = 0;
  for (const row of rows) {
    const resolved = resolveCellValue(row.cells[col.id], liveValues);
    const text = formatColumnValue(resolved, col.format, showKopecks);
    const w = measureTextWidth(text, 12, 400);
    if (w > maxCell) maxCell = w;
  }
  const target = Math.max(headerWidth, maxCell) + COL_PADDING_PX;
  return Math.max(MIN_VALUE_WIDTH, Math.min(MAX_VALUE_WIDTH, Math.ceil(target)));
}

function computeLabelColumnWidth(rows: Row[]): number {
  let max = 0;
  for (const row of rows) {
    const w = measureTextWidth(row.label, 12, 400);
    if (w > max) max = w;
  }
  const target = max + LABEL_PADDING_PX;
  return Math.max(MIN_LABEL_WIDTH, Math.min(MAX_LABEL_WIDTH, Math.ceil(target)));
}

// ============================================================================
// Block source picker — компактная версия (как в excel-cell)
// ============================================================================

type SourceField = {
  name: string;
  label: string;
  value: number | string | null;
  format?: 'money' | 'number' | 'text';
};

type SourceBlock = {
  blockId: string;
  pageKey: string;
  pageLabel: string;
  typeLabel: string;
  category: string;
  label: string;
  fields: SourceField[];
};

type SourcePage = {
  pageKey: string;
  pageLabel: string;
  blocks: SourceBlock[];
};

function refIsPlainNumber(ref: string): boolean {
  const lastSep = Math.max(ref.lastIndexOf(':'), -1);
  const after = ref.slice(lastSep + 1);
  const dot = after.lastIndexOf('.');
  const field = dot >= 0 ? after.slice(dot + 1) : 'value';
  return /^[A-Z]+\d+$/.test(field) || ['count', 'raw', 'label'].includes(field);
}

function sourceFieldIsMoney(block: SourceBlock, field: SourceField): boolean {
  if (field.format) return field.format === 'money';
  if (refIsPlainNumber(`${block.blockId}.${field.name}`)) return false;
  if (block.category === 'Таблицы') return false;
  if (['KPI', 'Кэшфлоу', 'Данные', 'Вычисления'].includes(block.category)) return true;
  return field.name === 'value';
}

function sourceFieldLabel(field: string): string {
  if (field === 'value') return 'Значение';
  if (field === 'count') return 'Количество';
  if (field === 'sum') return 'Сумма';
  return field;
}

function previewSourceValue(field: SourceField, showKopecks: boolean): string {
  if (field.value === null || field.value === undefined) return '—';
  if (field.format === 'money' && typeof field.value === 'number') {
    return formatRublesWithSettings(field.value, showKopecks).replace(/\s?₽$/, '') + ' ₽';
  }
  if (typeof field.value === 'number') {
    return field.value.toLocaleString('ru-RU', {
      maximumFractionDigits: Number.isInteger(field.value) ? 0 : 2,
    });
  }
  return String(field.value).slice(0, 24);
}

function CellRefPickerDialog({
  open,
  onOpenChange,
  selfBlockId,
  liveValues,
  showKopecks,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selfBlockId: string;
  liveValues: LiveValues;
  showKopecks: boolean;
  onPick: (block: SourceBlock, field: SourceField) => void;
}) {
  const availableBlocks = useAvailableBlockSources();
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSourceLoading(true);
    fetch('/api/blocks/sources')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.pages)) {
          setSourcePages(data.pages);
        }
      })
      .catch(() => {
        if (!cancelled) setSourcePages([]);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const blockSourcePages = useMemo<SourcePage[]>(() => {
    const liveBlocks: SourceBlock[] = availableBlocks
      .filter((b) => b.blockId !== selfBlockId)
      .map((b) => ({
        blockId: b.blockId,
        pageKey: 'current',
        pageLabel: 'Текущая страница',
        typeLabel: 'Live block',
        category: 'Текущая страница',
        label: String(
          liveValues[`${b.blockId}.label`] ?? `Блок ${b.blockId.slice(0, 8)}`,
        ),
        fields: b.fields.map((field) => ({
          name: field,
          label: b.labels?.[field] ?? sourceFieldLabel(field),
          value:
            liveValues[field === 'value' ? b.blockId : `${b.blockId}.${field}`] ?? null,
          format: moneyFieldSet(b.blockId, liveValues).has(field)
            ? ('money' as const)
            : undefined,
        })),
      }));
    const pages = sourcePages.map((page) => ({
      ...page,
      blocks: page.blocks
        .filter((block) => block.blockId !== selfBlockId)
        .map((block) => {
          const live = availableBlocks.find((a) => a.blockId === block.blockId);
          if (!live) return block;
          const moneyFields = moneyFieldSet(block.blockId, liveValues);
          const byName = new Map(block.fields.map((f) => [f.name, f]));
          live.fields.forEach((name) => {
            const key = name === 'value' ? block.blockId : `${block.blockId}.${name}`;
            const current = byName.get(name);
            byName.set(name, {
              name,
              label: live.labels?.[name] ?? current?.label ?? sourceFieldLabel(name),
              value: liveValues[key] ?? current?.value ?? null,
              format: moneyFields.has(name) ? 'money' : current?.format,
            });
          });
          return { ...block, fields: Array.from(byName.values()) };
        }),
    }));
    return liveBlocks.length > 0
      ? [
          { pageKey: 'current', pageLabel: 'Текущая страница', blocks: liveBlocks },
          ...pages,
        ]
      : pages;
  }, [availableBlocks, selfBlockId, liveValues, sourcePages]);

  const sourceGroups = useMemo(() => {
    const total = blockSourcePages.reduce((acc, p) => acc + p.blocks.length, 0);
    return [
      { id: 'all', label: 'Все блоки', count: total },
      ...blockSourcePages
        .filter((p) => p.blocks.length > 0)
        .map((p) => ({ id: `page:${p.pageKey}`, label: p.pageLabel, count: p.blocks.length })),
    ];
  }, [blockSourcePages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return blockSourcePages
      .map((page) => ({
        ...page,
        blocks: page.blocks.filter((block) => {
          if (selectedGroup.startsWith('page:') && selectedGroup.slice(5) !== page.pageKey) {
            return false;
          }
          if (!q) return true;
          return [page.pageLabel, block.category, block.typeLabel, block.label, block.blockId]
            .join(' ')
            .toLowerCase()
            .includes(q);
        }),
      }))
      .filter((p) => p.blocks.length > 0);
  }, [blockSourcePages, search, selectedGroup]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,640px)] max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-sm">Связать ячейку с источником</DialogTitle>
          <DialogDescription className="text-[11px]">
            Выберите блок и поле — значение подтянется автоматически
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-[320px] grid-cols-[180px_minmax(0,1fr)]">
          <aside className="border-r border-border/60 bg-muted/20">
            <div className="border-b border-border/40 px-3 py-2">
              <Input
                placeholder="Поиск..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-0.5 p-2">
              {sourceGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGroup(g.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition',
                    selectedGroup === g.id
                      ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border/70'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                >
                  <span className="truncate">{g.label}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {g.count}
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <div className="max-h-[420px] overflow-y-auto">
            {sourceLoading ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                Загружаю блоки…
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                Нет доступных блоков.
              </p>
            ) : (
              filtered.map((page) => (
                <section key={page.pageKey}>
                  <div className="sticky top-0 z-10 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {page.pageLabel}
                    </span>
                  </div>
                  {page.blocks.map((block) => (
                    <div
                      key={`${block.pageKey}:${block.blockId}`}
                      className="border-b border-border/30 px-3 py-2 last:border-b-0"
                    >
                      <div className="space-y-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-foreground">
                            {block.label}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {block.category} · {block.typeLabel}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {block.fields
                            .filter((f) => f.name !== 'label' && f.name !== 'raw')
                            .map((field) => {
                              const preview = previewSourceValue(field, showKopecks);
                              return (
                                <button
                                  key={field.name}
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition hover:bg-primary/10 hover:ring-primary/40"
                                  onClick={() => onPick(block, field)}
                                  title={`${field.label} = ${preview}`}
                                >
                                  <span className="font-medium text-primary">
                                    {field.label}
                                  </span>
                                  <span className="text-muted-foreground">{preview}</span>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Cell popover editor (Notion-style: click → popover с табами)
// ============================================================================

type CellEditorMode = 'value' | 'formula' | 'binding';

function detectMode(cell: Cell | undefined): CellEditorMode {
  if (cell?.ref) return 'binding';
  if (typeof cell?.v === 'string' && cell.v.startsWith('=')) return 'formula';
  return 'value';
}

function CellPopoverEditor({
  cell,
  column,
  showKopecks,
  result,
  isActive,
  onActivate,
  onClose,
  onChange,
  onRequestPicker,
}: {
  cell: Cell | undefined;
  column: Column;
  showKopecks: boolean;
  result: FormulaResult | undefined;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onChange: (next: Cell) => void;
  onRequestPicker: () => void;
}) {
  const initialMode = detectMode(cell);
  const [mode, setMode] = useState<CellEditorMode>(initialMode);
  // Draft значений per-tab — позволяют переключаться между табами без
  // потери ввода. На «Сохранить» применяется тот таб, который сейчас активен.
  const [valueDraft, setValueDraft] = useState<string>(() => {
    if (cell?.ref) return '';
    if (typeof cell?.v === 'number') return String(cell.v);
    if (typeof cell?.v === 'string' && !cell.v.startsWith('=')) return cell.v;
    return '';
  });
  const [formulaDraft, setFormulaDraft] = useState<string>(() => {
    if (typeof cell?.v === 'string' && cell.v.startsWith('=')) return cell.v;
    return '=';
  });

  // При повторном открытии popover'а — пересчитать драфты из текущего cell.
  useEffect(() => {
    if (!isActive) return;
    setMode(detectMode(cell));
    setValueDraft(() => {
      if (cell?.ref) return '';
      if (typeof cell?.v === 'number') return String(cell.v);
      if (typeof cell?.v === 'string' && !cell.v.startsWith('=')) return cell.v;
      return '';
    });
    setFormulaDraft(() => {
      if (typeof cell?.v === 'string' && cell.v.startsWith('=')) return cell.v;
      return '=';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const display = result
    ? formatColumnValue(result.value, column.format, showKopecks)
    : '—';
  const hasError = Boolean(result?.error);
  const isLinked = Boolean(cell?.ref);
  const isFormula = typeof cell?.v === 'string' && cell.v.startsWith('=');

  function commitValue() {
    const trimmed = valueDraft.trim();
    if (!trimmed) {
      onChange({ v: null, ref: undefined, isMoney: undefined });
    } else if (column.format === 'rubles' || column.format === 'number' || column.format === 'percent') {
      const parsed = toNumeric(trimmed);
      onChange({ v: parsed ?? trimmed, ref: undefined, isMoney: undefined });
    } else {
      onChange({ v: trimmed, ref: undefined, isMoney: undefined });
    }
    onClose();
  }

  function commitFormula() {
    let v = formulaDraft.trim();
    if (!v.startsWith('=')) v = '=' + v;
    if (v === '=') {
      onChange({ v: null, ref: undefined, isMoney: undefined });
    } else {
      onChange({ v, ref: undefined, isMoney: undefined });
    }
    onClose();
  }

  function commit() {
    if (mode === 'value') commitValue();
    else if (mode === 'formula') commitFormula();
    // binding-tab commits через onRequestPicker → CellRefPickerDialog
    onClose();
  }

  function clearCell() {
    onChange({ v: null, ref: undefined, isMoney: undefined });
    onClose();
  }

  function unlink() {
    onChange({ v: cell?.v ?? null, ref: undefined, isMoney: undefined });
    setMode('value');
  }

  return (
    <Popover
      open={isActive}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={() => onActivate()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'F2') {
              e.preventDefault();
              onActivate();
            }
          }}
          className={cn(
            'flex h-7 w-full min-w-0 items-center gap-1 rounded px-1.5 text-xs tabular-nums transition',
            column.format === 'text' ? 'justify-start' : 'justify-end',
            hasError
              ? 'border border-red-300 bg-red-50/60 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
              : isLinked
                ? 'border border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                : isFormula
                  ? 'border border-sky-200 bg-sky-50/40 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200'
                  : 'hover:bg-accent/40 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary',
          )}
          title={
            hasError
              ? `Ошибка: ${result?.error ?? '#ERR'}`
              : isLinked
                ? `Связь: @${cell?.ref}`
                : isFormula
                  ? `Формула: ${cell?.v}`
                  : 'Кликните чтобы редактировать'
          }
        >
          {isLinked && <Link2 className="h-2.5 w-2.5 shrink-0 text-amber-600" />}
          {isFormula && !isLinked && (
            <FunctionSquare className="h-2.5 w-2.5 shrink-0 text-sky-600" />
          )}
          {hasError && (
            <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-red-500" />
          )}
          <span className="truncate">{display}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
      >
        <Tabs value={mode} onValueChange={(v) => setMode(v as CellEditorMode)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="value">Значение</TabsTrigger>
            <TabsTrigger value="formula">
              <FunctionSquare className="h-3 w-3" />
              Формула
            </TabsTrigger>
            <TabsTrigger value="binding">
              <Link2 className="h-3 w-3" />
              Связь
            </TabsTrigger>
          </TabsList>

          <TabsContent value="value" className="space-y-2">
            {column.format === 'rubles' ? (
              <CurrencyInput
                value={toNumeric(valueDraft) ?? 0}
                showKopecks={showKopecks}
                onChange={(v) => setValueDraft(String(v))}
                className="h-9 text-right text-sm tabular-nums"
              />
            ) : column.format === 'percent' || column.format === 'number' ? (
              <Input
                type="text"
                inputMode="decimal"
                value={valueDraft}
                onChange={(e) => setValueDraft(e.target.value)}
                placeholder={column.format === 'percent' ? '0%' : '0'}
                className="h-9 text-right text-sm tabular-nums"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitValue();
                  if (e.key === 'Escape') onClose();
                }}
              />
            ) : (
              <Input
                type="text"
                value={valueDraft}
                onChange={(e) => setValueDraft(e.target.value)}
                placeholder="—"
                className="h-9 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitValue();
                  if (e.key === 'Escape') onClose();
                }}
              />
            )}
            <p className="text-[10px] text-muted-foreground">
              Введите число/текст. Для формулы переключитесь на вкладку «Формула».
            </p>
          </TabsContent>

          <TabsContent value="formula" className="space-y-2">
            <Textarea
              value={formulaDraft}
              onChange={(e) => setFormulaDraft(e.target.value)}
              rows={3}
              placeholder="=A1+B1  или  =[Метиленовый синий].qty*0.5"
              className="font-mono text-[12px] leading-5"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commitFormula();
                }
                if (e.key === 'Escape') onClose();
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onRequestPicker()}
                className="inline-flex h-6 items-center gap-1 rounded bg-amber-50 px-2 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300"
                title="Вставить ссылку @блок.поле"
              >
                <Link2 className="h-3 w-3" /> @связать
              </button>
              {result && result.error && (
                <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {result.error}
                </span>
              )}
            </div>
            <div className="rounded-md bg-muted/30 p-2 text-[10px] leading-relaxed text-muted-foreground">
              <p>
                <span className="font-semibold">A1-нотация:</span> <code>=A1+B2</code>,{' '}
                <code>=SUM(A1:A10)</code>
              </p>
              <p>
                <span className="font-semibold">Именованная:</span>{' '}
                <code>=[Название строки].id_колонки * 0.5</code>
              </p>
              <p>
                <span className="font-semibold">Cross-block:</span>{' '}
                <code>=@блок.field + 100</code>
              </p>
            </div>
          </TabsContent>

          <TabsContent value="binding" className="space-y-2">
            {isLinked ? (
              <div className="space-y-2">
                <div className="rounded-md border border-amber-200 bg-amber-50/40 p-2 text-[11px] dark:border-amber-900 dark:bg-amber-950/40">
                  <div className="font-mono text-amber-700 dark:text-amber-300">
                    @{cell?.ref}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Текущее значение: <span className="font-semibold">{display}</span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={onRequestPicker}
                  >
                    Выбрать другой
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={unlink}
                  >
                    <Unlink className="h-3 w-3" /> Отвязать
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Связать ячейку со значением другого блока. Изменения подтягиваются
                  автоматически.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full text-xs"
                  onClick={onRequestPicker}
                >
                  <Link2 className="h-3 w-3" /> Выбрать блок и поле
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-2">
          <button
            type="button"
            onClick={clearCell}
            className="text-[10px] text-muted-foreground hover:text-red-500"
          >
            Очистить ячейку
          </button>
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onClose}
            >
              Отмена
            </Button>
            {mode !== 'binding' && (
              <Button size="sm" className="h-7 text-xs" onClick={commit}>
                Сохранить
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Render
// ============================================================================

/** Порог виртуализации: при rows.length > VIRTUAL_THRESHOLD используется
 * @tanstack/react-virtual для рендера только видимых строк. Ниже порога —
 * обычный grid (быстрее и проще для типичных таблиц 5-50 строк). */
const VIRTUAL_THRESHOLD = 50;
const VIRTUAL_ROW_HEIGHT = 32;

function RenderCustomData({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const density = useBlockDensity();
  const { settings: globalSettings } = useFormatSettings();
  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;
  const accent = instance.appearance?.accentColor;
  const title = instance.appearance?.title ?? 'Данные';
  const liveValues = useAllBlockValues();

  // pickerCell = ячейка, для которой открывается CellRefPickerDialog
  // (вызывается из popover'а активной ячейки или из FormulaBar @связать).
  const [pickerCell, setPickerCell] = useState<{ rowId: string; columnId: string } | null>(null);

  // activeCell = ячейка с открытым popover-редактором. Используется также
  // formula bar'ом сверху.
  const [activeCell, setActiveCell] = useState<{ rowId: string; columnId: string } | null>(null);

  /**
   * Drag-state для resize колонок. Локальный — обновляется на каждое движение
   * мыши без записи в config (чтобы не дёргать persist). На mouseUp коммитим
   * финальную ширину в config через patch().
   *  - kind: 'label' — меняется ширина колонки названий строк
   *  - kind: 'value' — column.width конкретной value-колонки
   */
  const [dragState, setDragState] = useState<{
    kind: 'label' | 'value';
    columnId?: string;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);

  // v0.20.1: SSR-safe mounted-gate. measureText() через canvas доступен
  // только в браузере; на сервере fallback `text.length * 7` даёт другую
  // ширину → hydration mismatch на gridTemplateColumns. До первой
  // hydration мы рендерим с минимальной (детерминированной) шириной,
  // а после mount пересчитываем по реальным размерам.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Compute all cells + aggregates через единый evaluator ──
  // computeAll рассчитывает FormulaResult per cell с поддержкой A1, [row].col
  // и @blockId.field. Кэш переиспользуется через cellCache между ячейками.
  const { cache: cellCache, aggregates } = useMemo(
    () => computeAll(config.columns, config.rows, liveValues, config.publishMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.columns, config.rows, config.publishMode, liveValues],
  );

  const primaryColumn =
    config.columns.find((c) => c.id === config.publishColumnId) ??
    config.columns.find((c) => c.publish !== false) ??
    config.columns[0];

  // ── Publish ──
  const moneyFields = config.columns
    .filter((c) => c.publish !== false && c.format === 'rubles')
    .map((c) => c.id);
  const labelPairs = config.columns
    .filter((c) => c.publish !== false)
    .map((c) => `${c.id}=${c.label}`);
  const moneyFlag =
    moneyFields.length > 0
      ? [
          ...moneyFields,
          ...(primaryColumn && moneyFields.includes(primaryColumn.id) ? ['value'] : []),
        ].join(',')
      : '';

  useBlockValuePublisher(instance.id, {
    ...Object.fromEntries(
      config.columns
        .filter((c) => c.publish !== false)
        .map((c) => [c.id, aggregates[c.id] ?? 0]),
    ),
    value: primaryColumn ? aggregates[primaryColumn.id] ?? 0 : 0,
    count: config.rows.length,
    label: title,
    __money: moneyFlag,
    __labels: labelPairs.join(','),
  });

  // ── Editing helpers ──
  function patch(next: Partial<Config>) {
    const merged: Config = { ...config, ...next };
    onConfigChange?.(serializeConfig(merged));
  }

  function addRow() {
    patch({
      rows: [
        ...config.rows,
        { id: makeId('row'), label: 'Новая строка', cells: {} },
      ],
    });
  }

  function removeRow(id: string) {
    patch({ rows: config.rows.filter((r) => r.id !== id) });
  }

  function updateRow(id: string, changes: Partial<Row>) {
    patch({
      rows: config.rows.map((r) => (r.id === id ? { ...r, ...changes } : r)),
    });
  }

  function updateCell(rowId: string, columnId: string, next: Cell) {
    patch({
      rows: config.rows.map((r) =>
        r.id === rowId
          ? { ...r, cells: { ...r.cells, [columnId]: next } }
          : r,
      ),
    });
  }

  function addColumn() {
    const id = makeId('col');
    patch({
      columns: [
        ...config.columns,
        { id, label: 'Новая колонка', format: 'rubles', publish: true },
      ],
    });
  }

  function pickRefForCell(block: SourceBlock, field: SourceField) {
    if (!pickerCell) return;
    const ref =
      block.pageKey === 'current'
        ? field.name === 'value'
          ? block.blockId
          : `${block.blockId}.${field.name}`
        : `${block.pageKey}:${block.blockId}.${field.name}`;
    const next: Cell = {
      v: typeof field.value === 'number' || typeof field.value === 'string' ? field.value : null,
      ref,
      isMoney: sourceFieldIsMoney(block, field),
    };
    updateCell(pickerCell.rowId, pickerCell.columnId, next);
    setPickerCell(null);
    setActiveCell(null);
  }

  // ── DnD reorder: колонки + строки через @dnd-kit/sortable ──
  // Использует общие sensors для обоих контекстов (pointer + keyboard).
  // activationConstraint: distance 4px — чтобы случайные клики не запускали drag.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onColumnsDragEnd(e: DragEndEvent) {
    if (!e.over || e.over.id === e.active.id) return;
    const oldIdx = config.columns.findIndex((c) => c.id === e.active.id);
    const newIdx = config.columns.findIndex((c) => c.id === e.over!.id);
    if (oldIdx < 0 || newIdx < 0) return;
    patch({ columns: arrayMove(config.columns, oldIdx, newIdx) });
  }

  function onRowsDragEnd(e: DragEndEvent) {
    if (!e.over || e.over.id === e.active.id) return;
    const oldIdx = config.rows.findIndex((r) => r.id === e.active.id);
    const newIdx = config.rows.findIndex((r) => r.id === e.over!.id);
    if (oldIdx < 0 || newIdx < 0) return;
    patch({ rows: arrayMove(config.rows, oldIdx, newIdx) });
  }

  // Aggregate display in header — use primary column
  const headerAggregateText = primaryColumn
    ? formatColumnValue(aggregates[primaryColumn.id] ?? 0, primaryColumn.format, showKopecks)
    : '—';

  // ── Авто-ширина колонок (хуки ВЫШЕ early-returns: иначе rules-of-hooks нарушаются) ──
  // Считаем по самому длинному значению (header label + cells, форматированный текст).
  // Manual override (column.width / labelColumnWidth) имеет приоритет — кнопка «A» в шапке сбрасывает оба.
  // В xs/sm density этими значениями не пользуемся, но useMemo дёшев и должен быть стабилен.
  const autoLabelWidth = useMemo(
    () => computeLabelColumnWidth(config.rows),
    [config.rows],
  );
  const autoValueWidths = useMemo(() => {
    const map: Record<string, number> = {};
    for (const col of config.columns) {
      map[col.id] = computeValueColumnWidth(col, config.rows, liveValues, showKopecks);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.columns, config.rows, liveValues, showKopecks]);

  // ── Virtualization (для больших таблиц > VIRTUAL_THRESHOLD строк) ──
  // useVirtualizer всегда вызывается (rules-of-hooks), но enabled=false
  // делает его no-op для маленьких таблиц.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const enableVirtual = config.rows.length > VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: config.rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => VIRTUAL_ROW_HEIGHT,
    overscan: 8,
    enabled: enableVirtual,
  });

  // ── XS — только итог ──
  if (density === 'xs') {
    return (
      <Card className="flex h-full flex-col justify-center p-1">
        <div
          className="truncate text-center text-sm font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {headerAggregateText}
        </div>
      </Card>
    );
  }

  // ── SM — title + итог ──
  if (density === 'sm') {
    return (
      <Card className="flex h-full flex-col justify-center p-2">
        <div className="flex items-center gap-1">
          <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {title}
          </span>
        </div>
        <div
          className="mt-0.5 truncate text-lg font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {headerAggregateText}
        </div>
      </Card>
    );
  }

  // ── MD/LG — таблица ──
  // Стабильные fallback'и для SSR / первой hydration (до useEffect):
  // используем сохранённую в config ширину или фиксированные дефолты.
  // После mounted → переключаемся на canvas-measured auto-sizing.
  const SSR_DEFAULT_LABEL_WIDTH = 120;
  const SSR_DEFAULT_VALUE_WIDTH = 96;
  function effectiveLabelWidth(): number {
    if (dragState?.kind === 'label') return dragState.currentWidth;
    if (config.labelColumnWidth !== undefined) return config.labelColumnWidth;
    return mounted ? autoLabelWidth : SSR_DEFAULT_LABEL_WIDTH;
  }
  function effectiveValueWidth(col: Column): number {
    if (dragState?.kind === 'value' && dragState.columnId === col.id) {
      return dragState.currentWidth;
    }
    if (col.width !== undefined) return col.width;
    return mounted ? autoValueWidths[col.id] ?? SSR_DEFAULT_VALUE_WIDTH : SSR_DEFAULT_VALUE_WIDTH;
  }

  const isAutoSized =
    config.labelColumnWidth === undefined && config.columns.every((c) => c.width === undefined);

  const valueColTemplate = config.columns
    .map((c) => `${effectiveValueWidth(c)}px`)
    .join(' ');
  // v0.18.26: добавлен 20px slot слева под drag-handle строки (показывается
  // на hover'е), 16px справа — кнопка удаления.
  const gridTemplateColumns = `20px ${effectiveLabelWidth()}px ${valueColTemplate} 16px`;

  // ── Drag handlers (column resize) ──
  function startLabelResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = effectiveLabelWidth();
    setDragState({ kind: 'label', startX: e.clientX, startWidth, currentWidth: startWidth });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function startValueResize(e: React.PointerEvent, col: Column) {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = effectiveValueWidth(col);
    setDragState({
      kind: 'value',
      columnId: col.id,
      startX: e.clientX,
      startWidth,
      currentWidth: startWidth,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!dragState) return;
    const delta = e.clientX - dragState.startX;
    const min = dragState.kind === 'label' ? MIN_LABEL_WIDTH : MIN_VALUE_WIDTH;
    const max = dragState.kind === 'label' ? MAX_LABEL_WIDTH * 1.5 : MAX_VALUE_WIDTH * 1.5;
    const next = Math.max(min, Math.min(max, dragState.startWidth + delta));
    setDragState({ ...dragState, currentWidth: Math.round(next) });
  }
  function onResizeEnd(e: React.PointerEvent) {
    if (!dragState) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const finalWidth = dragState.currentWidth;
    if (dragState.kind === 'label') {
      patch({ labelColumnWidth: finalWidth });
    } else if (dragState.columnId) {
      const colId = dragState.columnId;
      patch({
        columns: config.columns.map((c) => (c.id === colId ? { ...c, width: finalWidth } : c)),
      });
    }
    setDragState(null);
  }

  function resetAllWidths() {
    patch({
      labelColumnWidth: undefined,
      columns: config.columns.map((c) => {
        const { width: _w, ...rest } = c;
        void _w;
        return rest;
      }),
    });
  }

  // ── Formula bar context: текущая активная ячейка ──
  const activeColIdx = activeCell
    ? config.columns.findIndex((c) => c.id === activeCell.columnId)
    : -1;
  const activeRowIdx = activeCell
    ? config.rows.findIndex((r) => r.id === activeCell.rowId)
    : -1;
  const activeAddr =
    activeRowIdx >= 0 && activeColIdx >= 0 ? cellAddress(activeRowIdx, activeColIdx) : '';
  const activeCellData =
    activeCell && activeRowIdx >= 0
      ? config.rows[activeRowIdx].cells[activeCell.columnId]
      : undefined;
  const activeResult = activeAddr ? cellCache.get(activeAddr) : undefined;
  const activeColumn = activeCell
    ? config.columns.find((c) => c.id === activeCell.columnId)
    : undefined;
  const activeRaw = (() => {
    if (!activeCell || !activeCellData) return '';
    if (activeCellData.ref) return `@${activeCellData.ref}`;
    if (typeof activeCellData.v === 'string') return activeCellData.v;
    if (typeof activeCellData.v === 'number') return String(activeCellData.v);
    return '';
  })();

  // ── Render row helper (общий для virtual/non-virtual путей) ──
  function renderRow(row: Row, rIdx: number) {
    return (
      <SortableRowGroup
        key={row.id}
        row={row}
        rIdx={rIdx}
        columns={config.columns}
        cellCache={cellCache}
        showKopecks={showKopecks}
        activeCell={activeCell}
        onActivate={(col) => setActiveCell({ rowId: row.id, columnId: col.id })}
        onCloseActive={() => setActiveCell(null)}
        onLabelChange={(label) => updateRow(row.id, { label })}
        onCellChange={(col, next) => updateCell(row.id, col.id, next)}
        onRequestPicker={(col) => setPickerCell({ rowId: row.id, columnId: col.id })}
        onRemove={() => removeRow(row.id)}
        gridTemplateColumns={gridTemplateColumns}
      />
    );
  }

  return (
    <Card
      className="flex h-full min-h-0 flex-col"
      onPointerMove={dragState ? onResizeMove : undefined}
      onPointerUp={dragState ? onResizeEnd : undefined}
      onPointerCancel={dragState ? onResizeEnd : undefined}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Database
            className="h-4 w-4 shrink-0 text-muted-foreground"
            style={accent ? { color: accent } : undefined}
          />
          <span className="truncate text-sm font-medium text-muted-foreground">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {!isAutoSized && (
            <button
              type="button"
              onClick={resetAllWidths}
              title="Авто-подгон ширины колонок по содержимому"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="Сбросить ширину колонок"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          )}
          <div
            className="text-base font-semibold tabular-nums"
            style={accent ? { color: accent } : undefined}
          >
            {headerAggregateText}
          </div>
        </div>
      </header>

      {/* Formula bar — sticky thin row под header'ом, видна когда есть activeCell.
          Показывает A1-адрес, сырое содержимое (формулу/литерал/binding) и
          ошибки. Edit идёт в popover'е, formula bar только read-only превью. */}
      {activeCell && activeColumn && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-1.5">
          <span className="inline-flex h-5 items-center rounded bg-background px-1.5 font-mono text-[10px] font-semibold text-muted-foreground ring-1 ring-border/60">
            {activeAddr}
          </span>
          <FunctionSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
          <code
            className={cn(
              'min-w-0 flex-1 truncate font-mono text-[11px]',
              activeResult?.error ? 'text-red-600' : 'text-foreground',
            )}
            title={activeRaw || 'пусто'}
          >
            {activeRaw || <span className="text-muted-foreground/60">пусто</span>}
          </code>
          {activeResult?.error && (
            <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
              <AlertTriangle className="h-2.5 w-2.5" />
              {activeResult.error}
            </span>
          )}
          <button
            type="button"
            onClick={() => setActiveCell(null)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
            aria-label="Закрыть редактор"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-3 pb-3"
      >
        {config.rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-center text-xs text-muted-foreground">
            <div>
              <Database className="mx-auto mb-1 h-4 w-4" />
              Нет данных. Добавьте строки или используйте AI-автозаполнение.
            </div>
          </div>
        ) : (
          <>
            {/* Header row (sortable columns) */}
            {/*
              v0.20.1: explicit id для DndContext — dnd-kit использует
              глобальный счётчик `useId()` для генерации `DndDescribedBy-N`.
              При SSR/client разнице в порядке монтирования получаем
              разные id → hydration mismatch. Задаём стабильный id по
              instance.id, чтобы сервер и клиент совпали.
            */}
            <DndContext
              id={`custom-data:${instance.id}:cols`}
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragEnd={onColumnsDragEnd}
            >
              <SortableContext
                items={config.columns.map((c) => c.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div
                  className="grid items-stretch gap-x-1.5"
                  style={{ gridTemplateColumns }}
                >
                  {/* пустой 20px-slot над drag-handle строк */}
                  <div />
                  {/* label-колонка header — с правым drag-handle для resize */}
                  <div className="relative flex items-center text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    <span className="select-none">Строка</span>
                    <span
                      onPointerDown={startLabelResize}
                      title="Перетащить — изменить ширину колонки названий"
                      className={cn(
                        'absolute -right-1.5 top-0 z-10 h-full w-2 cursor-col-resize select-none touch-none',
                        'after:pointer-events-none after:absolute after:right-1.5 after:top-1 after:h-[calc(100%-4px)] after:w-px after:bg-transparent',
                        'hover:after:bg-primary/40',
                        dragState?.kind === 'label' && 'after:bg-primary/60',
                      )}
                    />
                  </div>
                  {config.columns.map((col, colIdx) => {
                    const isLast = colIdx === config.columns.length - 1;
                    return (
                      <SortableColumnHeader
                        key={`h-${col.id}`}
                        column={col}
                        isLast={isLast}
                        startResize={startValueResize}
                        dragState={dragState}
                      />
                    );
                  })}
                  <div />
                </div>
              </SortableContext>
            </DndContext>

            {/* Body — sortable rows; виртуализация при rows > VIRTUAL_THRESHOLD */}
            <DndContext
              id={`custom-data:${instance.id}:rows`}
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragEnd={onRowsDragEnd}
            >
              <SortableContext
                items={config.rows.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                {enableVirtual ? (
                  <div
                    className="relative pt-1"
                    style={{ height: virtualizer.getTotalSize() }}
                  >
                    {virtualizer.getVirtualItems().map((vi) => {
                      const row = config.rows[vi.index];
                      return (
                        <div
                          key={row.id}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            transform: `translateY(${vi.start}px)`,
                          }}
                        >
                          {renderRow(row, vi.index)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-1 pt-1">
                    {config.rows.map((row, rIdx) => renderRow(row, rIdx))}
                  </div>
                )}
              </SortableContext>
            </DndContext>
          </>
        )}

        <div className="mt-auto flex items-center gap-1 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={addRow}
          >
            <Plus className="h-3 w-3" /> Строка
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={addColumn}
            title="Добавить колонку"
          >
            <Plus className="h-3 w-3" /> Колонка
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled
            title="AI-автозаполнение из истории операций (скоро)"
          >
            <Sparkles className="h-3 w-3" /> AI
          </Button>
        </div>
      </div>

      <CellRefPickerDialog
        open={pickerCell !== null}
        onOpenChange={(o) => !o && setPickerCell(null)}
        selfBlockId={instance.id}
        liveValues={liveValues}
        showKopecks={showKopecks}
        onPick={pickRefForCell}
      />
    </Card>
  );
}

// ============================================================================
// Sortable column header (DnD + resize handle + type icon)
// ============================================================================

function SortableColumnHeader({
  column,
  isLast,
  startResize,
  dragState,
}: {
  column: Column;
  isLast: boolean;
  startResize: (e: React.PointerEvent, col: Column) => void;
  dragState: { kind: 'label' | 'value'; columnId?: string } | null;
}) {
  const sortable = useSortable({ id: column.id });
  const Icon = formatIcon(column.format);
  // v0.18.26: last column resize fixed — handle теперь рендерится для всех
  // колонок, включая последнюю. Для last handle смещён внутрь (right-0),
  // чтобы не вылезать за пределы Card и не пропадать под скроллом.
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        'group/colh relative flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-muted-foreground',
        sortable.isDragging && 'opacity-50',
      )}
    >
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        className="hidden cursor-grab opacity-0 transition group-hover/colh:flex group-hover/colh:opacity-60 hover:opacity-100"
        title="Перетащить колонку"
        aria-label="Перетащить колонку"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <Icon className="h-2.5 w-2.5" />
      <span className="truncate">{column.label}</span>
      <span
        onPointerDown={(e) => startResize(e, column)}
        title="Перетащить — изменить ширину колонки"
        className={cn(
          'absolute top-0 z-10 h-full w-2 cursor-col-resize select-none touch-none',
          isLast ? 'right-0' : '-right-1.5',
          'after:pointer-events-none after:absolute after:top-1 after:h-[calc(100%-4px)] after:w-px after:bg-transparent',
          isLast ? 'after:right-0' : 'after:right-1.5',
          'hover:after:bg-primary/40',
          dragState?.kind === 'value' &&
            dragState.columnId === column.id &&
            'after:bg-primary/60',
        )}
      />
    </div>
  );
}

// ============================================================================
// Sortable row group — drag-handle + label + cells + delete
// ============================================================================

function SortableRowGroup({
  row,
  rIdx,
  columns,
  cellCache,
  showKopecks,
  activeCell,
  onActivate,
  onCloseActive,
  onLabelChange,
  onCellChange,
  onRequestPicker,
  onRemove,
  gridTemplateColumns,
}: {
  row: Row;
  rIdx: number;
  columns: Column[];
  cellCache: Map<string, FormulaResult>;
  showKopecks: boolean;
  activeCell: { rowId: string; columnId: string } | null;
  onActivate: (col: Column) => void;
  onCloseActive: () => void;
  onLabelChange: (label: string) => void;
  onCellChange: (col: Column, next: Cell) => void;
  onRequestPicker: (col: Column) => void;
  onRemove: () => void;
  gridTemplateColumns: string;
}) {
  const sortable = useSortable({ id: row.id });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        gridTemplateColumns,
      }}
      className={cn(
        'group/row grid items-stretch gap-x-1.5 gap-y-1 py-0.5',
        sortable.isDragging && 'z-10 opacity-50',
      )}
    >
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        className="flex items-center justify-center text-muted-foreground/40 opacity-0 transition group-hover/row:opacity-100 hover:text-foreground"
        title="Перетащить строку"
        aria-label="Перетащить строку"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <div className="flex min-w-0 items-center rounded-md border border-border/40 bg-muted/20 px-2 py-1">
        <Input
          value={row.label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="h-6 w-full min-w-0 truncate border-none bg-transparent px-0 text-xs shadow-none focus-visible:bg-background"
          placeholder="Название"
        />
      </div>
      {columns.map((col, cIdx) => {
        const addr = cellAddress(rIdx, cIdx);
        const result = cellCache.get(addr);
        const isActive =
          activeCell?.rowId === row.id && activeCell?.columnId === col.id;
        return (
          <div
            key={`${row.id}-${col.id}`}
            className="relative flex items-center rounded-md border border-border/40 bg-muted/20 px-1"
          >
            <CellPopoverEditor
              cell={row.cells[col.id]}
              column={col}
              showKopecks={showKopecks}
              result={result}
              isActive={isActive}
              onActivate={() => onActivate(col)}
              onClose={onCloseActive}
              onChange={(next) => onCellChange(col, next)}
              onRequestPicker={() => onRequestPicker(col)}
            />
          </div>
        );
      })}
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center justify-center rounded text-muted-foreground/40 opacity-0 transition group-hover/row:opacity-100 hover:text-red-500"
        aria-label="Удалить строку"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ============================================================================
// SettingsForm — управление колонками + публикацией
// ============================================================================

function CustomDataSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);

  function patch(next: Partial<Config>) {
    onChange(serializeConfig({ ...parsed, ...next }));
  }

  function updateColumn(id: string, changes: Partial<Column>) {
    patch({
      columns: parsed.columns.map((c) =>
        c.id === id ? { ...c, ...changes } : c,
      ),
    });
  }

  function removeColumn(id: string) {
    if (parsed.columns.length <= 1) return;
    patch({
      columns: parsed.columns.filter((c) => c.id !== id),
      rows: parsed.rows.map((r) => {
        const { [id]: _drop, ...rest } = r.cells;
        void _drop;
        return { ...r, cells: rest };
      }),
      publishColumnId:
        parsed.publishColumnId === id
          ? parsed.columns.find((c) => c.id !== id)?.id
          : parsed.publishColumnId,
    });
  }

  function addColumn() {
    const id = makeId('col');
    patch({
      columns: [
        ...parsed.columns,
        { id, label: 'Новая колонка', format: 'rubles', publish: true },
      ],
    });
  }

  return (
    <div className="space-y-4">
      {/* Колонки */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Колонки</Label>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addColumn}>
            <Plus className="h-3 w-3" /> Добавить
          </Button>
        </div>
        <div className="space-y-1.5">
          {parsed.columns.map((col) => (
            <div
              key={col.id}
              className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 p-1.5"
            >
              <Input
                value={col.label}
                onChange={(e) => updateColumn(col.id, { label: e.target.value })}
                className="h-7 flex-1 text-xs"
                placeholder="Название колонки"
              />
              <div className="flex shrink-0 gap-0.5">
                {(['rubles', 'number', 'percent', 'text'] as const).map((f) => {
                  const Icon = formatIcon(f);
                  const active = col.format === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => updateColumn(col.id, { format: f })}
                      title={formatLabel(f)}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded transition',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent',
                      )}
                    >
                      <Icon className="h-3 w-3" />
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => updateColumn(col.id, { publish: !col.publish })}
                title={col.publish ? 'Колонка публикуется в @связать' : 'Не публикуется'}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded transition',
                  col.publish
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {col.publish ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => removeColumn(col.id)}
                disabled={parsed.columns.length <= 1}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground/40 transition hover:text-red-500 disabled:opacity-30"
                title="Удалить колонку"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Зелёная галочка = колонка доступна как источник в @связать (например @блок.id_колонки).
        </p>
      </div>

      {/* Публикация */}
      <div className="space-y-2">
        <Label>Что публиковать как основное значение блока</Label>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={parsed.publishMode}
            onChange={(e) =>
              patch({ publishMode: e.target.value as Config['publishMode'] })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="sum">Сумма строк</option>
            <option value="avg">Среднее</option>
            <option value="count">Количество</option>
            <option value="last">Последнее значение</option>
          </select>
          <select
            value={parsed.publishColumnId ?? parsed.columns[0]?.id ?? ''}
            onChange={(e) => {
              const nextId = e.target.value || undefined;
              const target = parsed.columns.find((c) => c.id === nextId);
              if (target && target.publish === false) {
                patch({
                  publishColumnId: nextId,
                  columns: parsed.columns.map((c) =>
                    c.id === nextId ? { ...c, publish: true } : c,
                  ),
                });
              } else {
                patch({ publishColumnId: nextId });
              }
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {parsed.columns.map((c) => (
              <option key={c.id} value={c.id}>
                Колонка: {c.label}
                {c.publish === false ? ' · не публикуется' : ''}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-muted-foreground">
          В шапке блока показывается агрегат «основной» колонки. Все publish-колонки также
          публикуются отдельно (доступны как @блок.id_колонки). При выборе скрытой колонки
          она автоматически становится publish-колонкой.
        </p>
      </div>

      {/* Копейки */}
      <div className="space-y-1.5">
        <Label>Копейки (для рублёвых колонок)</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Показывать копейки</div>
            <div className="text-[11px] text-muted-foreground">
              {parsed.showKopecks === null
                ? 'Используется глобальная настройка'
                : parsed.showKopecks
                  ? 'Включено (1 234,56 ₽)'
                  : 'Выключено (1 235 ₽)'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {parsed.showKopecks !== null && (
              <button
                type="button"
                onClick={() => patch({ showKopecks: null })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Сбросить
              </button>
            )}
            <Switch
              checked={parsed.showKopecks ?? false}
              onCheckedChange={(v) => patch({ showKopecks: v })}
            />
          </div>
        </div>
      </div>

      <div className="rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
        Ячейки с привязкой (`@`) автоматически подтягивают значения других блоков и
        обновляются в реальном времени. Денежный формат сохраняется через `isMoney` флаг
        (как в excel.cell).
      </div>
    </div>
  );
}

// ============================================================================
// Block definition
// ============================================================================

export const CustomDataBlock: BlockDef = {
  type: 'custom.data',
  displayName: 'Данные (универсальный)',
  description:
    'Строки label + N произвольных колонок (рубли/число/%/текст). Каждая ячейка может быть привязана к другому блоку.',
  category: 'custom',
  icon: Database,
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  pages: ['*'],
  configSchema: ConfigSchema,
  defaultConfig: () => ({
    columns: defaultColumns(),
    rows: [],
    publishMode: 'sum',
    showKopecks: null,
  }),
  supportsDependencies: false,
  SettingsForm: CustomDataSettingsForm,
  Render: RenderCustomData,
};
