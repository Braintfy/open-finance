// PURPOSE: Универсальный data-блок (custom.data) — multi-column таблица с привязками per cell.
// Каждая строка имеет label + произвольный набор колонок. Каждая ячейка может быть либо
// manual-значением, либо ссылкой на другой блок (@blockId.field) — как в excel.cell.
// Блок публикует per-column агрегаты, чтобы их можно было @связать в формулах.
//
// v0.22.5: переписан UX редактирования формул в стиле sheet.tsx (без popover с табами):
//   - Единый formula bar сверху + inline `<input>` в активной ячейке (sheet-style).
//   - Operator toolbar (+ − × ÷ ( ) , :) в режиме формулы.
//   - Cell-pick клик по другой ячейке вставляет ссылку (A1, B2) — как раньше.
//   - Кнопка `@связать` в formula bar открывает CellRefPickerDialog;
//     в режиме формулы вставляет @-токен, иначе создаёт binding (cell.ref).
//   - Удалены: Popover с табами Значение/Формула/Связь, CurrencyInput-блокировка,
//     draggable popover, cellPopoverEnabled setting, hint plate.
// v0.23.1 fix: cell-pick больше не сбрасывает редактор. Раньше клик по другой
// ячейке в режиме формулы триггерил blur-commit на inline-input → session
// уничтожалась раньше, чем срабатывал handleCellClick. Решения:
//   1. CellTriggerButton — onMouseDown preventDefault (не воровать focus).
//   2. handleInputBlur — smart-blur через cardRef + pickerCell (commit только
//      если focus уходит из блока).
//   3. activateCell — commit прежней session перед переключением (раньше это
//      делал blur).
// См. также sheet.tsx (тот же паттерн с sheetRef + relatedTarget check).
//
// v0.23.2 fix: каретка после cell-pick / operator-click больше не «прыгает в 0»
// → следующая печать попадает в правильную позицию. Раньше setTimeout(0) для
// восстановления курсора расходился с браузерным дефолтом для controlled-input
// (cursor → end), и пользователь видел *60=B1 вместо =B1*60.
// Решения:
//   1. useLayoutEffect + pendingCaretRef — синхронное восстановление курсора
//      после commit, до paint, без race conditions.
//   2. insertIntoDraftWithSession читает каретку из DOM `input.selectionStart`,
//      а не из React-state `prev.caretPos` (state мог отставать).
//
// v0.23.2 features:
//   - Подсветка строк / колонок цветом (`row.highlight`, `column.highlight`).
//     6 предустановленных цветов, применяется как bg-tint + ring при selection.
//   - Множественное выделение строк и колонок (Excel-style):
//       • клик drag-handle (без movement) → select,
//       • Shift+клик → диапазон,
//       • Cmd/Ctrl+клик → toggle,
//       • drag (movement >4px) → реордер.
//   - Bulk-toolbar появляется когда выделено >0 строк/колонок:
//       «Подсветить» (палитра), «Удалить», «Снять».
'use client';

import {
  useContext,
  useEffect,
  useLayoutEffect,
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
  Palette,
  CheckSquare,
  Square,
  Ban,
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
import { useBlockDensity } from '@/components/blocks/block-size';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import {
  BlockValuesContext,
  useAvailableBlockSources,
  useBlockValuePublisher,
} from '../values';
import {
  evaluateAllCells,
  parseNumberLoose,
  resultAsNumber,
  cellAddress,
  type FormulaCell,
  type FormulaResult,
  type FormulaEvalContext,
} from '../custom-data-formulas';
import {
  computeFillTargets,
  fillCellFromSource,
  isInFillRange,
  type FillCoord,
  type FillDirection,
} from '../custom-data-fill';
import { cn } from '@/lib/utils';

// ============================================================================
// Schemas
// ============================================================================

const ColumnFormatSchema = z.enum(['rubles', 'number', 'percent', 'text']);
type ColumnFormat = z.infer<typeof ColumnFormatSchema>;

/**
 * v0.23.2: цветовая подсветка строк / колонок (Excel-style).
 * Поле `highlight` хранит ID цвета (`yellow|green|blue|red|purple|orange`)
 * — НЕ raw-цвет, чтобы был контроль над палитрой и темой (dark mode).
 */
const HIGHLIGHT_PALETTE = [
  { id: 'yellow', ring: 'ring-amber-400', bg: 'bg-amber-50/60', dark: 'dark:bg-amber-950/30', label: 'Жёлтый' },
  { id: 'green', ring: 'ring-emerald-400', bg: 'bg-emerald-50/60', dark: 'dark:bg-emerald-950/30', label: 'Зелёный' },
  { id: 'blue', ring: 'ring-sky-400', bg: 'bg-sky-50/60', dark: 'dark:bg-sky-950/30', label: 'Синий' },
  { id: 'red', ring: 'ring-rose-400', bg: 'bg-rose-50/60', dark: 'dark:bg-rose-950/30', label: 'Красный' },
  { id: 'purple', ring: 'ring-violet-400', bg: 'bg-violet-50/60', dark: 'dark:bg-violet-950/30', label: 'Фиолетовый' },
  { id: 'orange', ring: 'ring-orange-400', bg: 'bg-orange-50/60', dark: 'dark:bg-orange-950/30', label: 'Оранжевый' },
] as const;
type HighlightId = (typeof HIGHLIGHT_PALETTE)[number]['id'];

function isHighlightId(value: unknown): value is HighlightId {
  return typeof value === 'string' && HIGHLIGHT_PALETTE.some((h) => h.id === value);
}
function getHighlight(value: string | null | undefined) {
  if (!value) return null;
  return HIGHLIGHT_PALETTE.find((h) => h.id === value) ?? null;
}

const ColumnSchema = z.object({
  id: z.string(),
  label: z.string(),
  format: ColumnFormatSchema.default('rubles'),
  width: z.number().optional(),
  publish: z.boolean().default(true),
  highlight: z.string().nullable().optional(),
  /**
   * v0.23.3: per-column override для отображения дробной части.
   *   `true`  — показывать (1 234,56 ₽ / 1 234,56 / 12,5%).
   *   `false` — скрыть (1 235 ₽ / 1 235 / 13%).
   *   `null` / `undefined` — наследовать (row → block → global).
   * Применяется ко всем числовым форматам (rubles/number/percent).
   */
  showKopecks: z.boolean().nullable().optional(),
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
  highlight: z.string().nullable().optional(),
  /**
   * v0.23.3: per-row override для отображения дробной части. Имеет наивысший
   * приоритет в resolveShowKopecks (row → column → block → global). Применяется
   * ко всем cells этой строки независимо от формата колонки.
   */
  showKopecks: z.boolean().nullable().optional(),
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
    /**
     * Legacy (v0.22.0..v0.22.4) — был тоггл popover с табами. С v0.22.5 popover
     * удалён, редактирование всегда через formula bar + inline input.
     * Поле игнорируется (читается из старых configs, но не записывается).
     */
    cellPopoverEnabled: z.boolean().optional(),
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
    if (isHighlightId(c.highlight)) out.highlight = c.highlight;
    // v0.23.3: per-column showKopecks override (3-state).
    if (typeof c.showKopecks === 'boolean' || c.showKopecks === null) {
      out.showKopecks = c.showKopecks;
    }
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
    const out: Row = {
      id: r.id || makeId('row'),
      label: r.label ?? '',
      cells,
    };
    const rawHighlight = (r as { highlight?: unknown }).highlight;
    if (isHighlightId(rawHighlight)) out.highlight = rawHighlight;
    // v0.23.3: per-row showKopecks override (3-state).
    const rawShowKopecks = (r as { showKopecks?: unknown }).showKopecks;
    if (typeof rawShowKopecks === 'boolean' || rawShowKopecks === null) {
      out.showKopecks = rawShowKopecks;
    }
    return out;
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
  if (typeof value === 'string') return parseNumberLoose(value);
  return null;
}

/** Excel General-like: целые без дробной части; дробные — умная точность (MDN Intl). */
function formatPlainNumber(value: number, showDecimals: boolean): string {
  if (!Number.isFinite(value)) return String(value);
  const intlInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  if (!showDecimals) return intlInt.format(value);

  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-9) return intlInt.format(rounded);

  const abs = Math.abs(value);
  // |n| ≥ 1 → до 2 знаков; 0 < |n| < 1 → столько знаков, сколько нужно (0,01), max 6
  const maxFractionDigits =
    abs >= 1
      ? 2
      : Math.min(6, Math.max(2, Math.ceil(-Math.log10(abs)) + 1));

  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

/** ₽-колонка custom.data: значения в рублях (не копейках), Intl currency ru-RU. */
function formatCustomDataRubles(value: number, showDecimals: boolean): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(value);
}

/** Строка выглядит как число (не произвольный текст в text-колонке). */
function stringLooksNumeric(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return parseNumberLoose(trimmed) !== null;
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

/**
 * v0.23.3: единая семантика для всех числовых форматов.
 *   `showKopecks=true`  → дробная часть отображается:
 *     • rubles: `formatRublesWithSettings` (1 234,56 ₽).
 *     • number: Excel General-like (`formatPlainNumber`).
 *     • percent: max 2 + `%`.
 *   `showKopecks=false` → дробная часть скрыта (округление до integer):
 *     • rubles: `formatRublesWithSettings(false)` (1 235 ₽).
 *     • number: max 0 (1 235).
 *     • percent: max 0 + `%` (13%).
 * Это позволяет одним переключателем (block/column/row) скрывать дробную часть
 * во всех числовых форматах, а не только в рублёвых.
 */
export function formatColumnValue(
  value: number | string | null,
  format: ColumnFormat,
  showKopecks: boolean,
): string {
  if (value === null || value === undefined || value === '') return '—';
  // Text-колонка: произвольный текст as-is; числа (в т.ч. формулы) — с правилами дробной части.
  if (format === 'text') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return formatPlainNumber(value, showKopecks);
    }
    if (typeof value === 'string' && stringLooksNumeric(value)) {
      const numeric = toNumeric(value);
      if (numeric !== null) return formatPlainNumber(numeric, showKopecks);
    }
    return String(value);
  }
  const numeric = toNumeric(value);
  if (numeric === null) return String(value);
  if (format === 'rubles') return formatCustomDataRubles(numeric, showKopecks);
  if (format === 'percent') {
    return `${numeric.toLocaleString('ru-RU', {
      maximumFractionDigits: showKopecks ? 2 : 0,
    })}%`;
  }
  return formatPlainNumber(numeric, showKopecks);
}

/**
 * v0.23.3: резолвер showKopecks с приоритетом row → col → blockDefault.
 * `blockDefault` уже резолвнутое значение блока (`block.showKopecks ?? global`),
 * вычисляется один раз на верхнем уровне RenderCustomData. Per-cell вызывается
 * каждый раз, когда нужно отформатировать значение.
 *
 * Pure-функция (без хуков), удобно покрыть unit-тестами.
 */
export function resolveShowKopecks(
  row: { showKopecks?: boolean | null } | undefined,
  col: { showKopecks?: boolean | null } | undefined,
  blockDefault: boolean,
): boolean {
  if (row && typeof row.showKopecks === 'boolean') return row.showKopecks;
  if (col && typeof col.showKopecks === 'boolean') return col.showKopecks;
  return blockDefault;
}

/**
 * Блочный default для showKopecks в custom.data:
 *   `true/false` — явная настройка блока;
 *   `null` / `undefined` — **показывать дробную часть** (Excel-like default).
 * Глобальная настройка `useFormatSettings` на блок не влияет — только KPI/кэшфлоу.
 */
export function resolveBlockShowKopecks(
  blockShowKopecks: boolean | null | undefined,
  _globalShowKopecks: boolean,
): boolean {
  if (typeof blockShowKopecks === 'boolean') return blockShowKopecks;
  return true;
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
 *
 * v0.23.3: `blockDefault` — резолвнутое значение блока (`block.showKopecks ?? global`).
 * Per-row/per-col оверрайды резолвятся через `resolveShowKopecks(row, col, blockDefault)`
 * на каждой ячейке, чтобы ширина учитывала реальный формат.
 */
function computeValueColumnWidth(
  col: Column,
  rows: Row[],
  liveValues: LiveValues,
  blockDefault: boolean,
): number {
  const headerWidth = measureTextWidth(col.label.toUpperCase(), 10, 600) + 14;
  let maxCell = 0;
  for (const row of rows) {
    const resolved = resolveCellValue(row.cells[col.id], liveValues);
    const cellShowKopecks = resolveShowKopecks(row, col, blockDefault);
    const text = formatColumnValue(resolved, col.format, cellShowKopecks);
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
// Cell editor — sheet-style inline input + formula bar
// ============================================================================
//
// Архитектура (v0.22.5):
//   - Единый source-of-truth — `EditSession` с одним полем `draft`.
//   - Редактирование через два input'а: inline `<input>` в активной ячейке
//     (autoFocus при активации) + formula bar сверху. Оба пишут в session.draft.
//   - `isFormula(draft)` = `draft.startsWith('=')` — режим формулы.
//   - В режиме формулы:
//       • клик по другой ячейке вставляет cellAddress (cell-pick),
//       • показывается operator toolbar (+ − × ÷ ( ) , :),
//       • кнопка `@связать` вставляет @-токен.
//   - Не в режиме формулы:
//       • кнопка `@связать` создаёт binding (cell.ref).
//   - Binding (cell.ref) — отдельное persistent состояние ячейки, не входит
//     в session. Управляется через CellRefPickerDialog.

type EditSession = {
  rowId: string;
  columnId: string;
  draft: string;
  /** Положение каретки в input — нужно для cell-pick / operator toolbar. */
  caretPos: number | null;
  /** Какой input был последним сфокусирован — туда возвращаем focus после insert. */
  lastFocused: 'inline' | 'bar';
};

function makeSession(rowId: string, columnId: string, cell: Cell | undefined): EditSession {
  let draft = '';
  if (!cell?.ref) {
    if (typeof cell?.v === 'number') draft = String(cell.v);
    else if (typeof cell?.v === 'string') draft = cell.v;
  }
  return {
    rowId,
    columnId,
    draft,
    caretPos: null,
    lastFocused: 'inline',
  };
}

function isFormulaDraft(draft: string): boolean {
  return draft.startsWith('=');
}

/**
 * Вставка text в draft на позиции каретки. Если draft не начинается с '=',
 * добавляется автоматически (вставка cell-ref / operator переключает в режим формулы).
 * Возвращает новый draft + caretPos. Pure — для тестов.
 */
export function insertIntoDraft(
  prev: { draft: string; caretPos: number | null },
  text: string,
  options: { forceFormula?: boolean } = {},
): { draft: string; caretPos: number } {
  let draft = prev.draft;
  let pos = prev.caretPos ?? draft.length;
  if (options.forceFormula && !draft.startsWith('=')) {
    draft = '=' + draft;
    pos += 1;
  }
  pos = Math.max(0, Math.min(pos, draft.length));
  // Если draft пустой и forceFormula → начинаем с '='
  if (options.forceFormula && draft === '') {
    draft = '=';
    pos = 1;
  }
  const before = draft.slice(0, pos);
  const after = draft.slice(pos);
  const nextDraft = before + text + after;
  return { draft: nextDraft, caretPos: pos + text.length };
}

// ============================================================================
// HighlightPalettePopover — выбор цвета для подсветки строки/колонки.
// Используется как из per-row/per-col кнопки, так и из bulk-toolbar
// (когда выделено несколько строк/колонок).
// ============================================================================

function HighlightPalettePopover({
  current,
  onPick,
  align = 'start',
  children,
}: {
  current: string | null | undefined;
  onPick: (id: HighlightId | null) => void;
  align?: 'start' | 'center' | 'end';
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-auto p-2"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPick(null)}
            title="Снять подсветку"
            aria-label="Снять подсветку"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded border transition',
              !current
                ? 'border-foreground bg-muted'
                : 'border-border/60 hover:bg-accent',
            )}
          >
            <Ban className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {HIGHLIGHT_PALETTE.map((h) => {
            const active = current === h.id;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => onPick(h.id)}
                title={h.label}
                aria-label={h.label}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded ring-2',
                  h.bg,
                  h.dark,
                  active ? h.ring : 'ring-transparent hover:ring-border',
                )}
              >
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// DecimalsTogglePopover (v0.23.3) — 3-state переключатель «Дробная часть»
// для выделенных строк/колонок: Show / Hide / Inherit (block default).
// ============================================================================

type DecimalsState = boolean | null;

function DecimalsTogglePopover({
  current,
  onPick,
  align = 'start',
  children,
}: {
  /** Если у всех выделенных одинаковое значение — `true | false | null`; иначе `undefined` (mixed). */
  current: DecimalsState | undefined;
  onPick: (next: DecimalsState) => void;
  align?: 'start' | 'center' | 'end';
  children: React.ReactNode;
}) {
  const options: Array<{ value: DecimalsState; label: string; hint: string }> = [
    { value: true, label: 'Показывать', hint: '1 234,56 / 12,5%' },
    { value: false, label: 'Скрыть', hint: '1 235 / 13%' },
    { value: null, label: 'Глобально', hint: 'наследовать от блока' },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-48 p-1"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-0.5">
          {options.map((opt) => {
            const active = current === opt.value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onPick(opt.value)}
                className={cn(
                  'flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition',
                  active
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-foreground/80 hover:bg-accent/60',
                )}
              >
                <span>{opt.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// CellTriggerButton — кликабельная ячейка (без popover-обёртки).
// PopoverAnchor оборачивает её снаружи когда ячейка активна.
// ============================================================================

function CellTriggerButton({
  cell,
  column,
  showKopecks,
  result,
  pickModeActive,
  onClick,
}: {
  cell: Cell | undefined;
  column: Column;
  showKopecks: boolean;
  result: FormulaResult | undefined;
  pickModeActive: boolean;
  onClick: () => void;
}) {
  const display = result
    ? formatColumnValue(result.value, column.format, showKopecks)
    : '—';
  const hasError = Boolean(result?.error);
  const isLinked = Boolean(cell?.ref);
  const isFormula = typeof cell?.v === 'string' && cell.v.startsWith('=');

  return (
    <button
      type="button"
      onClick={onClick}
      // preventDefault на mousedown — чтобы клик по ячейке НЕ переносил
      // focus с активного inline-input на эту кнопку. Без этого blur
      // на inline-input сработал бы раньше click handler'а, session бы
      // потерялась, и в режиме формулы cell-pick не работал бы.
      // Click event при этом всё равно фаерится — onClick отработает.
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'F2') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-1 rounded px-1.5 text-xs tabular-nums transition',
        column.format === 'text' ? 'justify-start' : 'justify-end',
        pickModeActive && 'cursor-cell ring-1 ring-sky-400/60 hover:ring-sky-500',
        hasError
          ? 'border border-red-300 bg-red-50/60 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          : isLinked
            ? 'border border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
            : isFormula
              ? 'border border-sky-200 bg-sky-50/40 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200'
              : 'hover:bg-accent/40 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary',
      )}
      title={
        pickModeActive
          ? 'Кликните, чтобы вставить ссылку на эту ячейку в формулу'
          : hasError
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
  const showKopecks = resolveBlockShowKopecks(config.showKopecks, globalSettings.showKopecks);
  const accent = instance.appearance?.accentColor;
  const title = instance.appearance?.title ?? 'Данные';
  const liveValues = useAllBlockValues();

  // pickerCell — ячейка, для которой открывается CellRefPickerDialog.
  // mode: 'binding' создаёт cell.ref; 'formula' вставляет @-токен в draft.
  const [pickerCell, setPickerCell] = useState<
    { rowId: string; columnId: string; mode: 'binding' | 'formula' } | null
  >(null);

  // activeCell — ячейка с открытым inline-редактором.
  const [activeCell, setActiveCell] = useState<{ rowId: string; columnId: string } | null>(null);

  // v0.23.2: множественное выделение строк и колонок (Excel-style).
  // Клик по drag-handle строки (без перетаскивания) → выделение этой строки.
  // Shift+клик → расширение диапазона от последнего выделенного.
  // Cmd/Ctrl+клик → toggle.
  // Drag (mousedown + движение >4px) → реордер (dnd-kit activationConstraint).
  // Аналогично для колонок (header).
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const lastClickedRowRef = useRef<string | null>(null);
  const lastClickedColRef = useRef<string | null>(null);

  // Shared editing session — единый draft между inline-input и formula bar.
  const [session, setSession] = useState<EditSession | null>(null);

  // Refs на inline-input в ячейке + на formula bar. lastFocused в session
  // указывает куда вернуть focus после cell-pick / operator click.
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const formulaBarRef = useRef<HTMLInputElement | null>(null);
  // Ref на корневую Card — нужен для smart-blur: если focus уходит ВНУТРИ
  // блока (на другую ячейку, formula bar, кнопку @связать, operator toolbar),
  // мы НЕ коммитим session, иначе при cell-pick редактор сбрасывается.
  // См. sheet.tsx: тот же паттерн с sheetRef + relatedTarget check.
  const cardRef = useRef<HTMLDivElement | null>(null);

  // v0.23.2 caret-fix: вместо setTimeout(0) для восстановления каретки —
  // useLayoutEffect, который запускается синхронно после commit, до paint.
  // Раньше setTimeout мог расходиться с браузерным поведением controlled-input
  // (cursor «прыгал» в конец при value-change), и следующий ввод попадал в
  // неправильную позицию (например, '*60=B1' вместо '=*60B1').
  const pendingCaretRef = useRef<{ target: 'inline' | 'bar'; caret: number } | null>(
    null,
  );

  /**
   * Drag-state для resize колонок. Локальный — обновляется на каждое движение
   * мыши без записи в config. На mouseUp коммитим финальную ширину в config через patch().
   */
  const [dragState, setDragState] = useState<{
    kind: 'label' | 'value';
    columnId?: string;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);

  /**
   * v0.23.4: Fill-handle (Excel-style autofill). Пользователь захватывает
   * правый-нижний угол ячейки и тащит вверх/вниз/влево/вправо. На pointerUp
   * source-ячейка копируется в каждую промежуточную с относительной
   * корректировкой A1-ссылок в формуле (см. `shiftFormulaRefs`).
   */
  const [fillState, setFillState] = useState<{
    source: FillCoord;
    hover: FillCoord;
    direction: FillDirection | null;
  } | null>(null);
  // Ref на корневой scroll-контейнер таблицы. Использую для elementFromPoint
  // во время drag, чтобы определить какая ячейка под курсором.
  const tableBodyRef = useRef<HTMLDivElement | null>(null);

  // v0.20.1: SSR-safe mounted-gate для canvas measureText (см. registry.ts grабли).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // v0.23.2: восстановление каретки СИНХРОННО после commit. useLayoutEffect
  // запускается после всех DOM-mutations, но до browser paint — браузерное
  // дефолтное «cursor → end» поведение для controlled inputs не успеет
  // повлиять на следующий ввод. Без этого setTimeout(0)-вариант падал в
  // race condition: следующий печатаемый символ попадал в положение конца,
  // а не в место, где курсор должен был быть после insert.
  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    pendingCaretRef.current = null;
    const input =
      pending.target === 'bar' ? formulaBarRef.current : inlineInputRef.current;
    if (!input) return;
    if (typeof document !== 'undefined' && document.activeElement !== input) {
      input.focus();
    }
    try {
      input.setSelectionRange(pending.caret, pending.caret);
    } catch {
      // ignore
    }
  });

  // ── Compute all cells + aggregates через единый evaluator ──
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

  // ── Selection helpers (v0.23.2) ──

  function selectRow(
    rowId: string,
    opts: { extend?: boolean; toggle?: boolean } = {},
  ) {
    setSelectedRows((prev) => {
      if (opts.extend && lastClickedRowRef.current) {
        const startIdx = config.rows.findIndex(
          (r) => r.id === lastClickedRowRef.current,
        );
        const endIdx = config.rows.findIndex((r) => r.id === rowId);
        if (startIdx < 0 || endIdx < 0) return prev;
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(config.rows[i].id);
        return next;
      }
      if (opts.toggle) {
        const next = new Set(prev);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return next;
      }
      if (prev.size === 1 && prev.has(rowId)) return new Set();
      return new Set([rowId]);
    });
    lastClickedRowRef.current = rowId;
    setSelectedCols(new Set());
  }

  function selectCol(
    colId: string,
    opts: { extend?: boolean; toggle?: boolean } = {},
  ) {
    setSelectedCols((prev) => {
      if (opts.extend && lastClickedColRef.current) {
        const startIdx = config.columns.findIndex(
          (c) => c.id === lastClickedColRef.current,
        );
        const endIdx = config.columns.findIndex((c) => c.id === colId);
        if (startIdx < 0 || endIdx < 0) return prev;
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(config.columns[i].id);
        return next;
      }
      if (opts.toggle) {
        const next = new Set(prev);
        if (next.has(colId)) next.delete(colId);
        else next.add(colId);
        return next;
      }
      if (prev.size === 1 && prev.has(colId)) return new Set();
      return new Set([colId]);
    });
    lastClickedColRef.current = colId;
    setSelectedRows(new Set());
  }

  function clearSelection() {
    setSelectedRows(new Set());
    setSelectedCols(new Set());
    lastClickedRowRef.current = null;
    lastClickedColRef.current = null;
  }

  /** Применить (или снять) подсветку ко всем выделенным строкам/колонкам. */
  function applyHighlight(colorId: HighlightId | null) {
    const next: Partial<Config> = {};
    if (selectedRows.size > 0) {
      next.rows = config.rows.map((r) =>
        selectedRows.has(r.id)
          ? { ...r, highlight: colorId ?? undefined }
          : r,
      );
    }
    if (selectedCols.size > 0) {
      next.columns = config.columns.map((c) =>
        selectedCols.has(c.id)
          ? { ...c, highlight: colorId ?? undefined }
          : c,
      );
    }
    if (next.rows || next.columns) patch(next);
  }

  /**
   * v0.23.3: применить override `showKopecks` ко всем выделенным
   * строкам/колонкам. `null` = снять override (наследовать от blockDefault).
   */
  function applyShowKopecks(value: boolean | null) {
    const next: Partial<Config> = {};
    if (selectedRows.size > 0) {
      next.rows = config.rows.map((r) =>
        selectedRows.has(r.id)
          ? { ...r, showKopecks: value === null ? undefined : value }
          : r,
      );
    }
    if (selectedCols.size > 0) {
      next.columns = config.columns.map((c) =>
        selectedCols.has(c.id)
          ? { ...c, showKopecks: value === null ? undefined : value }
          : c,
      );
    }
    if (next.rows || next.columns) patch(next);
  }

  /**
   * v0.23.4: запуск Excel-like fill drag из ячейки (rowId, colId).
   * Использует pointer capture: pointermove/up на handle гарантированно
   * приходят даже если курсор покинул ячейку.
   */
  function startFill(rowId: string, colId: string, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rIdx = config.rows.findIndex((r) => r.id === rowId);
    const cIdx = config.columns.findIndex((c) => c.id === colId);
    if (rIdx < 0 || cIdx < 0) return;
    // Если в этой ячейке идёт редактирование — коммитим draft перед fill.
    if (session && session.rowId === rowId && session.columnId === colId) {
      commitSession();
    }
    const source: FillCoord = { rowIdx: rIdx, colIdx: cIdx };
    setFillState({ source, hover: source, direction: null });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  /**
   * Обработчик pointermove во время fill drag. Берём elementFromPoint и
   * поднимаемся вверх по DOM в поисках `[data-cell-coord]` атрибута,
   * который мы навешиваем на каждую ячейку (см. render).
   */
  function onFillMove(e: React.PointerEvent) {
    if (!fillState) return;
    let el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    while (el && !el.hasAttribute('data-cell-coord') && el !== tableBodyRef.current) {
      el = el.parentElement;
    }
    if (!el || !el.hasAttribute('data-cell-coord')) return;
    const coord = el.getAttribute('data-cell-coord');
    if (!coord) return;
    const [rStr, cStr] = coord.split(',');
    const rIdx = Number.parseInt(rStr, 10);
    const cIdx = Number.parseInt(cStr, 10);
    if (!Number.isFinite(rIdx) || !Number.isFinite(cIdx)) return;
    if (rIdx === fillState.hover.rowIdx && cIdx === fillState.hover.colIdx) return;
    const dR = Math.abs(rIdx - fillState.source.rowIdx);
    const dC = Math.abs(cIdx - fillState.source.colIdx);
    const direction: FillDirection | null =
      dR === 0 && dC === 0 ? null : dR >= dC ? 'vertical' : 'horizontal';
    setFillState({ ...fillState, hover: { rowIdx: rIdx, colIdx: cIdx }, direction });
  }

  function onFillEnd(e: React.PointerEvent) {
    if (!fillState) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    applyFill(fillState);
    setFillState(null);
  }

  function onFillCancel() {
    setFillState(null);
  }

  /**
   * Распространение source-ячейки на target-диапазон. Формулы получают
   * относительный сдвиг A1-ссылок; binding/литералы копируются как есть.
   */
  function applyFill(state: NonNullable<typeof fillState>) {
    const sourceRow = config.rows[state.source.rowIdx];
    const sourceCol = config.columns[state.source.colIdx];
    if (!sourceRow || !sourceCol) return;
    const sourceCell = sourceRow.cells[sourceCol.id];
    if (!sourceCell) return;

    const { targets } = computeFillTargets(state.source, state.hover);
    if (targets.length === 0) return;

    const maxRows = config.rows.length;
    const maxCols = config.columns.length;

    // Группируем targets по rowIdx, чтобы не пересоздавать rows-объект на каждой
    // ячейке. Карта rIdx → Map<colId, newCell>.
    const updatesByRow = new Map<number, Map<string, Cell>>();
    for (const t of targets) {
      const dRow = t.rowIdx - state.source.rowIdx;
      const dCol = t.colIdx - state.source.colIdx;
      const targetCol = config.columns[t.colIdx];
      if (!targetCol) continue;
      const newCell = fillCellFromSource(sourceCell, dRow, dCol, maxRows, maxCols);
      if (!updatesByRow.has(t.rowIdx)) updatesByRow.set(t.rowIdx, new Map());
      updatesByRow.get(t.rowIdx)!.set(targetCol.id, newCell);
    }

    const newRows = config.rows.map((row, rIdx) => {
      const rowUpdates = updatesByRow.get(rIdx);
      if (!rowUpdates) return row;
      const newCells = { ...row.cells };
      for (const [colId, cell] of rowUpdates) {
        newCells[colId] = cell;
      }
      return { ...row, cells: newCells };
    });

    patch({ rows: newRows });
  }

  function deleteSelected() {
    const next: Partial<Config> = {};
    if (selectedRows.size > 0) {
      next.rows = config.rows.filter((r) => !selectedRows.has(r.id));
    }
    if (selectedCols.size > 0) {
      const keptColIds = config.columns
        .filter((c) => !selectedCols.has(c.id))
        .map((c) => c.id);
      next.columns = config.columns.filter((c) => !selectedCols.has(c.id));
      // Удаляем cells из удалённых колонок во всех строках.
      next.rows = (next.rows ?? config.rows).map((r) => {
        const cells: Record<string, Cell> = {};
        for (const colId of keptColIds) {
          if (r.cells[colId] !== undefined) cells[colId] = r.cells[colId];
        }
        return { ...r, cells };
      });
    }
    if (next.rows || next.columns) patch(next);
    clearSelection();
  }

  // ── Editing session helpers ──

  function rowAndCell(rowId: string, columnId: string): { row: Row | undefined; cell: Cell | undefined } {
    const row = config.rows.find((r) => r.id === rowId);
    return { row, cell: row?.cells[columnId] };
  }

  function activateCell(rowId: string, columnId: string) {
    // Если уже редактируем другую ячейку — коммитим её перед переключением.
    // (Раньше эту работу делал blur-commit на inline input, но мы его убрали,
    // чтобы cell-pick в режиме формулы не сбрасывал session.)
    if (session && (session.rowId !== rowId || session.columnId !== columnId)) {
      commitSession();
    }
    const { cell } = rowAndCell(rowId, columnId);
    setActiveCell({ rowId, columnId });
    setSession(makeSession(rowId, columnId, cell));
  }

  /**
   * Smart-blur: коммитим session ТОЛЬКО если focus уходит из блока полностью
   * (например, клик вне блока). Если focus остаётся внутри (cell-pick, formula
   * bar, toolbar, @связать-кнопка, picker-диалог) — session сохраняется.
   *
   * Без этого guard'а клик по другой ячейке в режиме формулы триггерил blur →
   * commit → deactivate, и редактор сбрасывался ещё до того, как handleCellClick
   * успевал вставить ссылку.
   */
  function handleInputBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Picker-диалог открыт (Radix Portal вне cardRef) — не коммитим.
    if (pickerCell) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && cardRef.current?.contains(related)) return;
    commitSession();
  }

  function deactivateCell() {
    setActiveCell(null);
    setSession(null);
  }

  /**
   * Вставляет text в session.draft на позиции каретки. Если forceFormula=true и
   * draft не начинается с '=', добавляется автоматически.
   *
   * v0.23.2: каретка читается ИЗ DOM (`input.selectionStart`), а НЕ из React-state
   * `prev.caretPos`. Причина: после предыдущего setSelectionRange браузер может
   * не выстрелить onSelect, и `caretPos` в state остаётся устаревшим. Каретку
   * из DOM мы получаем актуальную (mousedown на cell-button c preventDefault не
   * сбрасывает её). Восстановление каретки после setSession — через
   * `pendingCaretRef` + `useLayoutEffect` (см. блок ниже).
   */
  function insertIntoDraftWithSession(text: string, forceFormula = false) {
    setSession((prev) => {
      if (!prev) return prev;
      const target = prev.lastFocused;
      const input =
        target === 'bar' ? formulaBarRef.current : inlineInputRef.current;
      const domCaret = input?.selectionStart;
      const caretPos =
        typeof domCaret === 'number'
          ? domCaret
          : prev.caretPos ?? prev.draft.length;
      const result = insertIntoDraft(
        { draft: prev.draft, caretPos },
        text,
        { forceFormula },
      );
      // Ставим в очередь восстановление каретки после commit. useLayoutEffect
      // ниже подхватит и выполнит синхронно после DOM-mutation.
      pendingCaretRef.current = { target, caret: result.caretPos };
      return { ...prev, draft: result.draft, caretPos: result.caretPos };
    });
  }

  function handleCellClick(rowId: string, columnId: string) {
    // Cell-pick: в режиме формулы клик по другой ячейке вставляет ссылку,
    // НЕ переключая активную ячейку.
    if (
      session &&
      isFormulaDraft(session.draft) &&
      (session.rowId !== rowId || session.columnId !== columnId)
    ) {
      const rIdx = config.rows.findIndex((r) => r.id === rowId);
      const cIdx = config.columns.findIndex((c) => c.id === columnId);
      if (rIdx < 0 || cIdx < 0) return;
      insertIntoDraftWithSession(cellAddress(rIdx, cIdx), true);
      return;
    }
    activateCell(rowId, columnId);
  }

  /** Сохраняет session в config.rows[].cells. */
  function commitSession() {
    if (!session) return;
    const { row } = rowAndCell(session.rowId, session.columnId);
    if (!row) {
      deactivateCell();
      return;
    }
    const column = config.columns.find((c) => c.id === session.columnId);
    if (!column) {
      deactivateCell();
      return;
    }
    const trimmed = session.draft.trim();
    let next: Cell;
    if (!trimmed) {
      next = { v: null, ref: undefined, isMoney: undefined };
    } else if (trimmed === '=') {
      next = { v: null, ref: undefined, isMoney: undefined };
    } else if (trimmed.startsWith('=')) {
      next = { v: trimmed, ref: undefined, isMoney: undefined };
    } else if (
      column.format === 'rubles' ||
      column.format === 'number' ||
      column.format === 'percent'
    ) {
      const parsed = toNumeric(trimmed);
      next = { v: parsed ?? trimmed, ref: undefined, isMoney: undefined };
    } else {
      next = { v: trimmed, ref: undefined, isMoney: undefined };
    }
    updateCell(session.rowId, session.columnId, next);
    deactivateCell();
  }

  function clearActiveCell() {
    if (!activeCell) return;
    updateCell(activeCell.rowId, activeCell.columnId, {
      v: null,
      ref: undefined,
      isMoney: undefined,
    });
    deactivateCell();
  }

  function unlinkActiveCell() {
    if (!activeCell) return;
    const { cell } = rowAndCell(activeCell.rowId, activeCell.columnId);
    const nextV = cell?.v ?? null;
    updateCell(activeCell.rowId, activeCell.columnId, {
      v: nextV,
      ref: undefined,
      isMoney: undefined,
    });
    // Обновляем session draft чтобы input показывал unlinked value.
    setSession((prev) => {
      if (!prev) return prev;
      let draft = '';
      if (typeof nextV === 'number') draft = String(nextV);
      else if (typeof nextV === 'string') draft = nextV;
      return { ...prev, draft, caretPos: draft.length };
    });
  }

  /**
   * Обработчик выбора блок/поле в CellRefPickerDialog.
   *   - mode === 'formula' → вставка @-токена в draft текущей session (без
   *     создания binding'а).
   *   - mode === 'binding' → создаёт постоянный cell.ref (binding), session
   *     закрывается.
   */
  function pickRefForCell(block: SourceBlock, field: SourceField) {
    if (!pickerCell) return;
    const ref =
      block.pageKey === 'current'
        ? field.name === 'value'
          ? block.blockId
          : `${block.blockId}.${field.name}`
        : `${block.pageKey}:${block.blockId}.${field.name}`;
    if (
      pickerCell.mode === 'formula' &&
      session &&
      session.rowId === pickerCell.rowId &&
      session.columnId === pickerCell.columnId
    ) {
      insertIntoDraftWithSession(`@${ref}`, true);
      setPickerCell(null);
      return;
    }
    const next: Cell = {
      v: typeof field.value === 'number' || typeof field.value === 'string' ? field.value : null,
      ref,
      isMoney: sourceFieldIsMoney(block, field),
    };
    updateCell(pickerCell.rowId, pickerCell.columnId, next);
    setPickerCell(null);
    deactivateCell();
  }

  /** Открывает binding picker для активной ячейки. Тип определяется автоматически. */
  function openBindingPicker() {
    if (!activeCell || !session) return;
    const mode: 'binding' | 'formula' = isFormulaDraft(session.draft) ? 'formula' : 'binding';
    setPickerCell({ rowId: activeCell.rowId, columnId: activeCell.columnId, mode });
  }

  /** Вставка оператора/функции в draft. Автопрефикс '=' для операторов. */
  function insertOperator(text: string) {
    insertIntoDraftWithSession(text, true);
  }

  /** Common keyboard handler для inline-input и formula bar. */
  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSession();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      deactivateCell();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitSession();
      // Переход к следующей колонке/строке (как в sheet)
      if (!activeCell) return;
      const cIdx = config.columns.findIndex((c) => c.id === activeCell.columnId);
      const rIdx = config.rows.findIndex((r) => r.id === activeCell.rowId);
      if (cIdx < 0 || rIdx < 0) return;
      const nextC = e.shiftKey
        ? Math.max(0, cIdx - 1)
        : Math.min(config.columns.length - 1, cIdx + 1);
      const nextCol = config.columns[nextC];
      if (nextCol) {
        setTimeout(() => activateCell(activeCell.rowId, nextCol.id), 0);
      }
      void rIdx;
    }
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

  // Aggregate display in header — use primary column (resolve per-col override).
  const headerAggregateText = primaryColumn
    ? formatColumnValue(
        aggregates[primaryColumn.id] ?? 0,
        primaryColumn.format,
        resolveShowKopecks(undefined, primaryColumn, showKopecks),
      )
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
  // Pick-mode индикатор: подсвечивать кликабельные ячейки в режиме формулы.
  const inPickMode = Boolean(
    session && isFormulaDraft(session.draft) && activeCell !== null,
  );
  const isLinked = Boolean(activeCellData?.ref);
  const isFormulaSession = Boolean(session && isFormulaDraft(session.draft));

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
        inPickMode={inPickMode}
        session={session}
        inlineInputRef={inlineInputRef}
        isSelected={selectedRows.has(row.id)}
        selectedCols={selectedCols}
        fillState={fillState}
        onSessionChange={(draft, caret) =>
          setSession((prev) =>
            prev ? { ...prev, draft, caretPos: caret, lastFocused: 'inline' } : prev,
          )
        }
        onInlineFocus={() =>
          setSession((prev) => (prev ? { ...prev, lastFocused: 'inline' } : prev))
        }
        onInlineKeyDown={handleInputKeyDown}
        onInlineBlur={handleInputBlur}
        onCellClick={(col) => handleCellClick(row.id, col.id)}
        onSelectRow={(opts) => selectRow(row.id, opts)}
        onLabelChange={(label) => updateRow(row.id, { label })}
        onRemove={() => removeRow(row.id)}
        onFillStart={startFill}
        onFillMove={onFillMove}
        onFillEnd={onFillEnd}
        onFillCancel={onFillCancel}
        gridTemplateColumns={gridTemplateColumns}
      />
    );
  }

  const hasSelection = selectedRows.size > 0 || selectedCols.size > 0;
  const currentSelectionHighlight = (() => {
    const rows = config.rows.filter((r) => selectedRows.has(r.id));
    const cols = config.columns.filter((c) => selectedCols.has(c.id));
    const all = [...rows.map((r) => r.highlight), ...cols.map((c) => c.highlight)];
    if (all.length === 0) return null;
    const first = all[0];
    return all.every((h) => h === first) ? first ?? null : null;
  })();
  // v0.23.3: общее значение showKopecks-override по выделенным строкам/колонкам.
  // Нормализуем `undefined` → `null` (inherit), `true/false` остаётся как есть.
  // Возвращает `undefined` если значения смешаны (mixed) — кнопка показывает «—».
  const currentSelectionShowKopecks: DecimalsState | undefined = (() => {
    const rows = config.rows.filter((r) => selectedRows.has(r.id));
    const cols = config.columns.filter((c) => selectedCols.has(c.id));
    const all: DecimalsState[] = [
      ...rows.map((r) => (typeof r.showKopecks === 'boolean' ? r.showKopecks : null)),
      ...cols.map((c) => (typeof c.showKopecks === 'boolean' ? c.showKopecks : null)),
    ];
    if (all.length === 0) return null;
    const first = all[0];
    return all.every((v) => v === first) ? first : undefined;
  })();

  return (
    <Card
      ref={cardRef}
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

      {/* Formula bar — sheet-style: единственный input для активной ячейки,
          всегда editable. При вводе '=' draft автоматически становится формулой. */}
      {activeCell && activeColumn && session && (
        <div className="flex shrink-0 flex-col gap-1 border-b border-border/40 bg-muted/20 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 shrink-0 items-center rounded bg-background px-1.5 font-mono text-[10px] font-semibold text-muted-foreground ring-1 ring-border/60">
              {activeAddr}
            </span>
            <FunctionSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={formulaBarRef}
              value={session.draft}
              onFocus={() =>
                setSession((prev) => (prev ? { ...prev, lastFocused: 'bar' } : prev))
              }
              onChange={(e) =>
                setSession((prev) =>
                  prev
                    ? {
                        ...prev,
                        draft: e.target.value,
                        caretPos: e.target.selectionStart,
                        lastFocused: 'bar',
                      }
                    : prev,
                )
              }
              onSelect={(e) =>
                setSession((prev) =>
                  prev
                    ? {
                        ...prev,
                        caretPos: (e.target as HTMLInputElement).selectionStart,
                      }
                    : prev,
                )
              }
              onKeyDown={handleInputKeyDown}
              onBlur={handleInputBlur}
              placeholder={
                isFormulaSession
                  ? 'Клик по ячейке вставит ссылку (A1, B2…)'
                  : 'Значение, или начните с = для формулы'
              }
              className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[11px] outline-none focus:ring-0"
            />
            {isFormulaSession && (
              <span className="inline-flex h-5 shrink-0 items-center rounded bg-blue-100 px-1.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                fx
              </span>
            )}
            {isLinked && (
              <button
                type="button"
                onClick={unlinkActiveCell}
                className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-accent"
                title="Отвязать ячейку от источника"
              >
                <Unlink className="h-2.5 w-2.5" /> отвязать
              </button>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={openBindingPicker}
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300"
              title={
                isFormulaSession
                  ? 'Вставить @-ссылку в формулу'
                  : 'Привязать ячейку к источнику (binding)'
              }
            >
              <Link2 className="h-2.5 w-2.5" /> @связать
            </button>
            {activeResult?.error && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                <AlertTriangle className="h-2.5 w-2.5" />
                {activeResult.error}
              </span>
            )}
            <button
              type="button"
              onClick={clearActiveCell}
              className="text-[10px] text-muted-foreground hover:text-red-500"
              title="Очистить ячейку"
            >
              <Trash2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={commitSession}
              className="text-[10px] text-muted-foreground hover:text-foreground"
              aria-label="Сохранить и закрыть редактор"
              title="Сохранить и закрыть (Enter)"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {/* Operator toolbar — показывается в режиме формулы */}
          {isFormulaSession && (
            <div className="flex items-center gap-1 overflow-x-auto pl-[58px]">
              <span className="shrink-0 text-[10px] text-muted-foreground">Вставить:</span>
              {['+', '-', '*', '/', '(', ')', ',', ':'].map((op) => (
                <button
                  key={op}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertOperator(op)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-background font-mono text-[11px] ring-1 ring-border/60 transition hover:bg-accent"
                  title={`Вставить «${op}»`}
                >
                  {op}
                </button>
              ))}
              <div className="mx-1 h-3 w-px bg-border/50" />
              {['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'].map((fn) => (
                <button
                  key={fn}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertOperator(`${fn}(`)}
                  className="flex h-5 shrink-0 items-center rounded bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                  title={`Вставить ${fn}(`}
                >
                  {fn}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selection bulk-action toolbar (v0.23.2) — показывается когда
          выделена хотя бы одна строка или колонка. */}
      {hasSelection && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-primary/5 px-3 py-1.5">
          <span className="inline-flex h-5 shrink-0 items-center rounded bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
            Выделено:{' '}
            {selectedRows.size > 0 && `${selectedRows.size} строк`}
            {selectedRows.size > 0 && selectedCols.size > 0 && ' · '}
            {selectedCols.size > 0 && `${selectedCols.size} колонок`}
          </span>
          <HighlightPalettePopover
            current={currentSelectionHighlight}
            onPick={applyHighlight}
            align="start"
          >
            <button
              type="button"
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-background px-2 text-[11px] font-medium text-foreground ring-1 ring-border/60 transition hover:bg-accent"
              title="Выбрать цвет подсветки для выделенных строк/колонок"
            >
              <Palette className="h-3 w-3" />
              Подсветить
            </button>
          </HighlightPalettePopover>
          {/* v0.23.3: переключатель «Дробная часть» (Show / Hide / Inherit). */}
          <DecimalsTogglePopover
            current={currentSelectionShowKopecks}
            onPick={applyShowKopecks}
            align="start"
          >
            <button
              type="button"
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-background px-2 text-[11px] font-medium text-foreground ring-1 ring-border/60 transition hover:bg-accent"
              title="Дробная часть для выделенных (показать/скрыть/глобально)"
            >
              <Hash className="h-3 w-3" />
              Десятичные
              <span className="text-[10px] font-mono text-muted-foreground">
                {currentSelectionShowKopecks === undefined
                  ? '—'
                  : currentSelectionShowKopecks === null
                    ? 'глоб.'
                    : currentSelectionShowKopecks
                      ? 'вкл'
                      : 'выкл'}
              </span>
            </button>
          </DecimalsTogglePopover>
          <button
            type="button"
            onClick={deleteSelected}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-background px-2 text-[11px] font-medium text-rose-700 ring-1 ring-border/60 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950"
            title="Удалить выделенные строки/колонки"
          >
            <Trash2 className="h-3 w-3" />
            Удалить
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Снять выделение"
          >
            <X className="h-3 w-3" />
            Снять
          </button>
        </div>
      )}

      <div
        ref={(el) => {
          scrollContainerRef.current = el;
          tableBodyRef.current = el;
        }}
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
                        isSelected={selectedCols.has(col.id)}
                        onSelectCol={(opts) => selectCol(col.id, opts)}
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
  isSelected,
  onSelectCol,
}: {
  column: Column;
  isLast: boolean;
  startResize: (e: React.PointerEvent, col: Column) => void;
  dragState: { kind: 'label' | 'value'; columnId?: string } | null;
  isSelected: boolean;
  onSelectCol: (opts: { extend?: boolean; toggle?: boolean }) => void;
}) {
  const sortable = useSortable({ id: column.id });
  const Icon = formatIcon(column.format);
  const colHighlight = getHighlight(column.highlight);
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
        'group/colh relative flex items-center justify-end gap-1 rounded px-1 text-[10px] uppercase tracking-wide text-muted-foreground transition',
        sortable.isDragging && 'opacity-50',
        // v0.23.2: column-level подсветка только на header (background).
        colHighlight && [colHighlight.bg, colHighlight.dark],
        // v0.23.2: selection ring.
        isSelected && 'ring-2 ring-primary/60',
      )}
    >
      {/*
        v0.23.2: drag-handle колонки также работает как select-trigger.
        Click без модификаторов = select колонку. Shift / Cmd / Ctrl —
        как у строк.
      */}
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={(e) => {
          if (sortable.isDragging) return;
          onSelectCol({
            extend: e.shiftKey,
            toggle: e.metaKey || e.ctrlKey,
          });
        }}
        className={cn(
          'cursor-grab transition',
          isSelected
            ? 'flex text-primary'
            : 'hidden opacity-0 group-hover/colh:flex group-hover/colh:opacity-60 hover:opacity-100',
        )}
        title="Перетащить колонку (клик — выделить, Shift+клик — диапазон)"
        aria-label="Перетащить колонку"
      >
        {isSelected ? (
          <CheckSquare className="h-3 w-3" />
        ) : (
          <GripVertical className="h-3 w-3" />
        )}
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
  inPickMode,
  session,
  inlineInputRef,
  isSelected,
  selectedCols,
  fillState,
  onSessionChange,
  onInlineFocus,
  onInlineKeyDown,
  onInlineBlur,
  onCellClick,
  onSelectRow,
  onLabelChange,
  onRemove,
  onFillStart,
  onFillMove,
  onFillEnd,
  onFillCancel,
  gridTemplateColumns,
}: {
  row: Row;
  rIdx: number;
  columns: Column[];
  cellCache: Map<string, FormulaResult>;
  showKopecks: boolean;
  activeCell: { rowId: string; columnId: string } | null;
  inPickMode: boolean;
  session: EditSession | null;
  inlineInputRef: React.MutableRefObject<HTMLInputElement | null>;
  isSelected: boolean;
  selectedCols: Set<string>;
  fillState: { source: FillCoord; hover: FillCoord; direction: FillDirection | null } | null;
  onSessionChange: (draft: string, caretPos: number | null) => void;
  onInlineFocus: () => void;
  onInlineKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onInlineBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
  onCellClick: (col: Column) => void;
  onSelectRow: (opts: { extend?: boolean; toggle?: boolean }) => void;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  onFillStart: (rowId: string, colId: string, e: React.PointerEvent) => void;
  onFillMove: (e: React.PointerEvent) => void;
  onFillEnd: (e: React.PointerEvent) => void;
  onFillCancel: () => void;
  gridTemplateColumns: string;
}) {
  const sortable = useSortable({ id: row.id });
  const rowHighlight = getHighlight(row.highlight);
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        gridTemplateColumns,
      }}
      className={cn(
        'group/row grid items-stretch gap-x-1.5 gap-y-1 rounded-md py-0.5 transition',
        sortable.isDragging && 'z-10 opacity-50',
        // v0.23.2: row-level подсветка (background tint).
        rowHighlight && [rowHighlight.bg, rowHighlight.dark],
        // v0.23.2: selection ring.
        isSelected && 'ring-2 ring-primary/60 ring-offset-1 ring-offset-background',
      )}
    >
      {/*
        v0.23.2: drag-handle ТАКЖЕ работает как select-trigger.
        — Click без модификаторов: select (заменяет выделение).
        — Shift+click: extend (диапазон).
        — Cmd/Ctrl+click: toggle.
        — Drag (mousedown + move >4px): реордер через dnd-kit.
        Видимость:
          • drag handle всегда виден если строка выделена,
          • иначе появляется на hover.
      */}
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={(e) => {
          if (sortable.isDragging) return;
          onSelectRow({
            extend: e.shiftKey,
            toggle: e.metaKey || e.ctrlKey,
          });
        }}
        className={cn(
          'flex items-center justify-center transition',
          isSelected
            ? 'text-primary'
            : 'text-muted-foreground/40 opacity-0 group-hover/row:opacity-100 hover:text-foreground',
        )}
        title="Перетащить строку (клик — выделить, Shift+клик — диапазон, Cmd/Ctrl+клик — toggle)"
        aria-label="Перетащить строку"
      >
        {isSelected ? (
          <CheckSquare className="h-3 w-3" />
        ) : (
          <GripVertical className="h-3 w-3" />
        )}
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
        // Pick-mode visual: подсвечиваем НЕ-активные ячейки как кликабельные
        // источники ссылок (текущая активная — не вставляется в саму себя).
        const cellInPickMode = inPickMode && !isActive;
        const colHighlight = getHighlight(col.highlight);
        const colIsSelected = selectedCols.has(col.id);
        // v0.23.3: разрешение showKopecks с приоритетом row → col → blockDefault.
        // `showKopecks` (prop) уже — резолвнутое block-default значение.
        const cellShowKopecks = resolveShowKopecks(row, col, showKopecks);
        // v0.23.4: fill-handle visual.
        const isFillSource =
          fillState?.source.rowIdx === rIdx && fillState?.source.colIdx === cIdx;
        const isInFill = fillState
          ? isInFillRange(fillState.source, fillState.hover, rIdx, cIdx)
          : false;
        // Handle показываем в правом-нижнем углу last cell диапазона при drag,
        // а в idle-состоянии — на каждой ячейке при hover (Excel-стиль).
        return (
          <div
            key={`${row.id}-${col.id}`}
            data-cell-coord={`${rIdx},${cIdx}`}
            className={cn(
              'group/cell relative flex items-center rounded-md border bg-muted/20 px-1 transition',
              isActive ? 'border-primary ring-1 ring-primary/40' : 'border-border/40',
              // Подсветка от колонки (накладывается поверх подсветки строки).
              colHighlight && !isActive && [colHighlight.bg, colHighlight.dark],
              colIsSelected && !isActive && 'ring-1 ring-primary/40',
              // v0.23.4: визуализация fill-range.
              isFillSource && 'ring-2 ring-primary/70',
              isInFill && !isFillSource && 'bg-primary/10 ring-1 ring-primary/40',
            )}
          >
            {isActive && session ? (
              <input
                ref={inlineInputRef}
                value={session.draft}
                onFocus={onInlineFocus}
                onChange={(e) =>
                  onSessionChange(e.target.value, e.target.selectionStart)
                }
                onSelect={(e) =>
                  onSessionChange(
                    (e.target as HTMLInputElement).value,
                    (e.target as HTMLInputElement).selectionStart,
                  )
                }
                onKeyDown={onInlineKeyDown}
                onBlur={onInlineBlur}
                autoFocus
                placeholder={col.format === 'text' ? '—' : '0'}
                className={cn(
                  'h-7 w-full min-w-0 border-0 bg-background px-1.5 font-mono text-xs tabular-nums outline-none focus:ring-0',
                  col.format === 'text' ? 'text-left' : 'text-right',
                )}
              />
            ) : (
              <CellTriggerButton
                cell={row.cells[col.id]}
                column={col}
                showKopecks={cellShowKopecks}
                result={result}
                pickModeActive={cellInPickMode}
                onClick={() => onCellClick(col)}
              />
            )}
            {/*
              v0.23.4: Excel-like fill-handle (правый-нижний угол).
              Видим:
                • на hover ячейки (Excel-стиль — любую ячейку можно использовать как источник),
                • всегда видим на source-ячейке во время drag.
              Drag-сценарий:
                • pointerDown на handle → setPointerCapture + setFillState.
                • pointerMove → elementFromPoint находит ячейку под курсором,
                  обновляет hover; visual feedback через isInFill.
                • pointerUp → applyFill (копирование source с relative-shift).
              Скрыт когда:
                • ячейка в режиме редактирования (isActive + session),
                • cell-pick-mode (формула: клик по ячейке вставляет ссылку — не fill),
                • drag-state активен и эта ячейка НЕ источник (handle только у source).
            */}
            {!isActive && !cellInPickMode && (!fillState || isFillSource) && (
              <button
                type="button"
                aria-label="Растянуть формулу/значение"
                title="Перетащите вверх/вниз — скопировать формулу или значение"
                data-fill-handle
                onPointerDown={(e) => onFillStart(row.id, col.id, e)}
                onPointerMove={fillState ? onFillMove : undefined}
                onPointerUp={fillState ? onFillEnd : undefined}
                onPointerCancel={fillState ? onFillCancel : undefined}
                className={cn(
                  'absolute -bottom-[3px] -right-[3px] z-30 h-2 w-2 cursor-crosshair rounded-[1px] bg-primary ring-1 ring-background transition',
                  // Visible: source во время drag — всегда; иначе — только при hover.
                  isFillSource
                    ? 'opacity-100 scale-110'
                    : 'opacity-0 group-hover/cell:opacity-100 hover:scale-125',
                )}
              />
            )}
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

      {/* v0.23.3: Дробная часть для всех числовых форматов (рубли/число/процент).
          Раньше «Копейки (для рублёвых колонок)» — теперь применяется ко всем
          числовым колонкам. Можно переопределить per-row/per-col через bulk-toolbar. */}
      <div className="space-y-1.5">
        <Label>Дробная часть</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Показывать знаки после запятой</div>
            <div className="text-[11px] text-muted-foreground">
              {parsed.showKopecks === null || parsed.showKopecks === undefined
                ? 'По умолчанию (включено)'
                : parsed.showKopecks
                  ? 'Включено (1 234,56 ₽ / 12,5%)'
                  : 'Выключено (1 235 ₽ / 13%)'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {parsed.showKopecks !== null && parsed.showKopecks !== undefined && (
              <button
                type="button"
                onClick={() => patch({ showKopecks: null })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Сбросить
              </button>
            )}
            <Switch
              checked={parsed.showKopecks ?? true}
              onCheckedChange={(v) => patch({ showKopecks: v })}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Применяется ко всем числовым колонкам (рубли / число / процент), а также к числовым
          результатам формул в text-колонках. Чтобы переопределить для отдельной строки или
          колонки — выделите её на сетке и используйте кнопку «Десятичные» в верхнем тулбаре.
        </p>
      </div>

      <div className="rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
        Кликните по ячейке, чтобы редактировать. Введите <code className="font-mono">=</code>{' '}
        чтобы переключиться в режим формулы — появится строка формул с кнопками операторов
        (+ − × ÷, SUM, MIN…). В режиме формулы клик по другой ячейке вставит ссылку (A1, B2…),
        а «@связать» откроет picker блок-источника. Ячейки с привязкой автоматически
        подтягивают значения других блоков (как в excel.cell).
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
    showKopecks: true,
  }),
  supportsDependencies: false,
  SettingsForm: CustomDataSettingsForm,
  Render: RenderCustomData,
};
