// PURPOSE: Sheet block — полноценная Excel-like таблица с формулами, настройкой размеров ячеек,
// header-строкой с названием/итогами и связями с другими блоками.
'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useContext, type CSSProperties } from 'react';
import { Table2, FunctionSquare, Check, X as XIcon } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBlockValuePublisher, BlockValuesContext, useAvailableBlockSources } from '../values';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import FormulaParser, { MAX_ROW, MAX_COLUMN } from 'fast-formula-parser';

// ============================================================================
// Reactive Block Values Hook (reads live values from BlockValues store)
// ============================================================================

function useAllBlockValues(): Record<string, number | string | null> {
  const api = useContext(BlockValuesContext);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setTick((t) => t + 1));
  }, [api]);
  return useMemo(() => {
    if (!api) return {};
    const result: Record<string, number | string | null> = {};
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

// ============================================================================
// Config Schema
// ============================================================================

const HeaderCellSchema = z.object({
  id: z.string(),
  label: z.string().default(''),
  /** Формула (=SUM(A1:A10)) или статический текст */
  value: z.string().default(''),
  width: z.number().optional(),
});

const SheetConfig = z.object({
  title: z.string().default('Таблица'),
  rows: z.number().int().min(1).max(200).default(10),
  cols: z.number().int().min(1).max(26).default(5),
  /** Двумерный массив строк: cells[row][col] — raw value (может быть формула =...) */
  cells: z.array(z.array(z.string())).optional(),
  /** Ширина колонок в px (индекс = номер колонки) */
  colWidths: z.array(z.number()).optional(),
  /** Высота строк в px (индекс = номер строки) */
  rowHeights: z.array(z.number()).optional(),
  /** Header-ячейки сверху (название блока, суммы и т.д.) */
  headerCells: z.array(HeaderCellSchema).optional(),
  /** Показывать header-строку */
  showHeader: z.boolean().default(true),
  /** Показывать formula bar */
  showFormulaBar: z.boolean().default(true),
  showKopecks: z.boolean().nullable().default(null),
  /** Ссылки на внешние блоки: имя переменной → значение (или null) */
  blockRefs: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});

type SheetCfg = z.infer<typeof SheetConfig>;
type HeaderCell = z.infer<typeof HeaderCellSchema>;

type BlockSourceField = {
  name: string;
  label: string;
  value: number | string | null;
  format?: 'money' | 'number' | 'text';
};

type BlockSourceBlock = {
  blockId: string;
  pageKey: string;
  pageLabel: string;
  type: string;
  typeLabel: string;
  category: string;
  label: string;
  fields: BlockSourceField[];
};

type BlockSourcePage = {
  pageKey: string;
  pageLabel: string;
  blocks: BlockSourceBlock[];
};

type BlockSourceGroup = {
  id: string;
  label: string;
  count: number;
};

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_COL_WIDTH = 100;
const DEFAULT_ROW_HEIGHT = 28;
const MIN_COL_WIDTH = 40;
const MAX_COL_WIDTH = 400;
const MIN_ROW_HEIGHT = 22;
const MAX_ROW_HEIGHT = 120;

function emptyCells(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
}

function ensureShape(cells: string[][] | undefined, rows: number, cols: number): string[][] {
  const grid = cells ?? [];
  const result: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(grid[r]?.[c] ?? '');
    }
    result.push(row);
  }
  return result;
}

function colLabel(i: number): string {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function colIndex(label: string): number {
  let n = 0;
  for (let i = 0; i < label.length; i++) {
    n = n * 26 + (label.charCodeAt(i) - 64);
  }
  return n - 1;
}

function cellAddress(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`;
}

function makeHeaderId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : `h_${Math.random().toString(36).slice(2, 8)}`;
}

function parseSheetNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPlainNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatKopecksValue(value: number, showKopecks: boolean): string {
  return formatRublesWithSettings(value, showKopecks).replace(/\s?₽$/, '');
}

function sourceFieldLabel(field: string): string {
  if (field === 'value') return 'Значение';
  if (field === 'count') return 'Количество';
  if (field === 'sum') return 'Сумма';
  return field;
}

function moneyFieldSet(blockId: string, values: Record<string, number | string | null>): Set<string> {
  const raw = values[`${blockId}.__money`];
  return new Set(String(raw ?? '').split(',').map((field) => field.trim()).filter(Boolean));
}

function mergeLiveFields(
  block: BlockSourceBlock,
  liveFields: string[] | undefined,
  liveValues: Record<string, number | string | null>,
): BlockSourceBlock {
  if (!liveFields) return block;
  const moneyFields = moneyFieldSet(block.blockId, liveValues);
  const byName = new Map(block.fields.map((field) => [field.name, field]));
  liveFields.forEach((name) => {
    const key = name === 'value' ? block.blockId : `${block.blockId}.${name}`;
    const current = byName.get(name);
    byName.set(name, {
      name,
      label: current?.label ?? sourceFieldLabel(name),
      value: liveValues[key] ?? current?.value ?? null,
      format: moneyFields.has(name) ? 'money' : current?.format,
    });
  });
  return { ...block, fields: Array.from(byName.values()) };
}

function previewSourceValue(field: BlockSourceField): string {
  if (field.value === null || field.value === undefined) return '—';
  if (field.format === 'money' && typeof field.value === 'number') return formatKopecksValue(field.value, true);
  return String(field.value).slice(0, 16);
}

function formatComputedValue(value: number | string, money: boolean, showKopecks: boolean): string {
  if (typeof value !== 'number') return String(value);
  return money ? formatKopecksValue(value, showKopecks) : formatPlainNumber(value);
}

function refFieldName(ref: string): string {
  const source = ref.includes(':') ? ref.slice(ref.lastIndexOf(':') + 1) : ref;
  const dot = source.lastIndexOf('.');
  return dot >= 0 ? source.slice(dot + 1) : 'value';
}

function refIsPlainNumber(ref: string): boolean {
  const field = refFieldName(ref);
  return /^[A-Z]+\d+$/.test(field) || ['count', 'raw', 'label'].includes(field);
}

function formulaReferencesMoneyRefs(raw: string): boolean {
  const refs = raw.matchAll(/@([A-Za-z0-9_.:-]+)/g);
  for (const match of refs) {
    if (!refIsPlainNumber(match[1])) return true;
  }
  return false;
}

type CellComputation = {
  display: string;
  value: number | string;
  money: boolean;
};

function formulaReferencesMoneyCells(raw: string, moneyCells: Set<string>): boolean {
  const ranges = /([A-Z]+)(\d+):([A-Z]+)(\d+)/g;
  let range: RegExpExecArray | null;
  while ((range = ranges.exec(raw)) !== null) {
    const c1 = colIndex(range[1]);
    const r1 = Number(range[2]) - 1;
    const c2 = colIndex(range[3]);
    const r2 = Number(range[4]) - 1;
    const minR = Math.min(r1, r2);
    const maxR = Math.max(r1, r2);
    const minC = Math.min(c1, c2);
    const maxC = Math.max(c1, c2);
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (moneyCells.has(cellAddress(r, c))) return true;
      }
    }
  }
  const refs = /\b([A-Z]+)(\d+)\b/g;
  let ref: RegExpExecArray | null;
  while ((ref = refs.exec(raw)) !== null) {
    if (moneyCells.has(`${ref[1]}${ref[2]}`)) return true;
  }
  return false;
}

// ============================================================================
// Formula Engine (lightweight, using fast-formula-parser)
// ============================================================================

/** Fallback: evaluate simple math expressions (handles =77, =21+22, etc.) */
function simpleMathEval(expr: string): number | null {
  if (!/^[\d\s+\-*/().,%]+$/.test(expr)) return null;
  try {
    const fn = new Function('return (' + expr + ')');
    const result = fn();
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function evaluateFormula(
  formula: string,
  cells: string[][],
  evaluated: Map<string, number | string>,
  blockValues: Record<string, number | string | null>,
  visiting?: Set<string>,
): number | string {
  try {
    // Заменяем @blockRef на значения из блоков
    let expr = formula;
    const blockRefPattern = /@([A-Za-z0-9_.:-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = blockRefPattern.exec(formula)) !== null) {
      const refName = m[1];
      const val = blockValues[refName];
      if (val !== null && val !== undefined) {
        expr = expr.replace(m[0], String(val));
      } else {
        expr = expr.replace(m[0], '0');
      }
    }

    // Fallback for simple numeric or pure-math expressions
    const simple = simpleMathEval(expr);
    if (simple !== null) return simple;

    // MAX_ROW / MAX_COLUMN from named exports (also available as FormulaParser.MAX_ROW)
    const maxRowConst = MAX_ROW ?? FormulaParser.MAX_ROW ?? 1048576;
    const maxColConst = MAX_COLUMN ?? FormulaParser.MAX_COLUMN ?? 16384;

    const parser = new FormulaParser({
      onCell: ({ row, col }: { sheet: string; row: number; col: number }) => {
        const addr = cellAddress(row - 1, col - 1);
        if (visiting?.has(addr)) return 0;
        if (evaluated.has(addr)) {
          const cached = evaluated.get(addr)!;
          return typeof cached === 'number' ? cached : parseFloat(cached) || 0;
        }
        const rawValue = cells[row - 1]?.[col - 1] ?? '';
        if (rawValue.startsWith('=')) {
          const newVisiting = new Set(visiting ?? []);
          newVisiting.add(addr);
          const result = evaluateFormula(rawValue.slice(1), cells, evaluated, blockValues, newVisiting);
          evaluated.set(addr, result);
          return typeof result === 'number' ? result : parseFloat(String(result)) || 0;
        }
        const num = parseSheetNumber(rawValue);
        return num ?? 0;
      },
      onRange: (ref: { from: { row: number; col: number }; to: { row: number; col: number } }) => {
        const maxRow = ref.to.row >= maxRowConst ? cells.length : ref.to.row;
        const maxCol = ref.to.col >= maxColConst
          ? (cells[0]?.length ?? 0)
          : ref.to.col;
        const arr: number[][] = [];
        for (let row = ref.from.row; row <= maxRow; row++) {
          const innerArr: number[] = [];
          for (let col = ref.from.col; col <= maxCol; col++) {
            const rawValue = cells[row - 1]?.[col - 1] ?? '';
            if (rawValue.startsWith('=')) {
              const addr = cellAddress(row - 1, col - 1);
              if (evaluated.has(addr)) {
                const cached = evaluated.get(addr)!;
                innerArr.push(typeof cached === 'number' ? cached : parseFloat(String(cached)) || 0);
              } else {
                const newVisiting = new Set(visiting ?? []);
                newVisiting.add(addr);
                const result = evaluateFormula(rawValue.slice(1), cells, evaluated, blockValues, newVisiting);
                evaluated.set(addr, result);
                innerArr.push(typeof result === 'number' ? result : parseFloat(String(result)) || 0);
              }
            } else {
              const num = parseSheetNumber(rawValue);
              innerArr.push(num ?? 0);
            }
          }
          arr.push(innerArr);
        }
        return arr;
      },
    });

    const position = { row: 1, col: 1, sheet: 'Sheet1' };
    const result = parser.parse(expr, position);
    if (typeof result === 'number') return result;
    if (typeof result === 'string') return result;
    if (typeof result === 'boolean') return result ? 1 : 0;
    if (result === null || result === undefined) return 0;
    if (result instanceof Error) return '#ERR';
    // FormulaError objects
    if (typeof result === 'object' && 'message' in (result as object)) return '#ERR';
    return String(result);
  } catch {
    // Last-resort fallback: try simple math
    const fallback = simpleMathEval(formula);
    if (fallback !== null) return fallback;
    return '#ERR';
  }
}

function computeCell(
  raw: string,
  cells: string[][],
  evaluated: Map<string, number | string>,
  blockValues: Record<string, number | string | null>,
  showKopecks: boolean,
  moneyCells: Set<string>,
): CellComputation {
  if (!raw.startsWith('=')) {
    const n = parseSheetNumber(raw);
    return { display: raw, value: n ?? raw, money: false };
  }
  const result = evaluateFormula(raw.slice(1), cells, evaluated, blockValues);
  const money = formulaReferencesMoneyRefs(raw) || formulaReferencesMoneyCells(raw, moneyCells);
  return { display: formatComputedValue(result, money, showKopecks), value: result, money };
}

// ============================================================================
// Render
// ============================================================================

function RenderSheet({ instance, onConfigChange }: BlockRenderProps) {
  const cfg = SheetConfig.parse(instance.config ?? {});
  const density = useBlockDensity();
  const { settings: globalFormatSettings } = useFormatSettings();
  const showKopecks = cfg.showKopecks ?? globalFormatSettings.showKopecks;
  const [cells, setCells] = useState<string[][]>(() =>
    ensureShape(cfg.cells, cfg.rows, cfg.cols)
  );
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  /** true когда editValue начинается с '=' и пользователь может кликнуть по ячейке для вставки ссылки */
  const [formulaMode, setFormulaMode] = useState(false);
  /** Курсор (caret position) в поле ввода для вставки ссылок */
  const [caretPos, setCaretPos] = useState<number | null>(null);
  /** Touch-режим: явно активировать pick-cell на мобильных */
  const [touchPickMode, setTouchPickMode] = useState(false);
  /** ID заголовочной ячейки, которую редактируем (formula mode для headers) */
  const [editingHeaderId, setEditingHeaderId] = useState<string | null>(null);
  /** Inline picker для @block mentions */
  const [blockPickerOpen, setBlockPickerOpen] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [selectedSourceGroup, setSelectedSourceGroup] = useState('all');
  const [sourcePages, setSourcePages] = useState<BlockSourcePage[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [colWidths, setColWidths] = useState<number[]>(
    () => cfg.colWidths ?? Array(cfg.cols).fill(DEFAULT_COL_WIDTH)
  );
  const [rowHeights, setRowHeights] = useState<number[]>(
    () => cfg.rowHeights ?? Array(cfg.rows).fill(DEFAULT_ROW_HEIGHT)
  );
  const [headerCells, setHeaderCells] = useState<HeaderCell[]>(
    () => cfg.headerCells ?? [
      { id: makeHeaderId(), label: 'Название', value: cfg.title, width: 200 },
      { id: makeHeaderId(), label: 'Итого', value: '=SUM(A1:A' + cfg.rows + ')', width: 150 },
    ]
  );
  const editInputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const openingBlockPickerRef = useRef(false);
  const resizingCol = useRef<{ col: number; startX: number; startW: number } | null>(null);
  const resizingRow = useRef<{ row: number; startY: number; startH: number } | null>(null);

  const title = instance.appearance?.title ?? cfg.title;
  const accent = instance.appearance?.accentColor;

  // Собираем blockValues: сначала cfg.blockRefs (статические), затем live values из reactive store
  // Reactive list of available block sources (for @mention picker)
  const availableBlocks = useAvailableBlockSources();
  const liveValues = useAllBlockValues();
  const blockValues: Record<string, number | string | null> = useMemo(() => {
    const result: Record<string, number | string | null> = { ...liveValues };
    sourcePages.forEach((page) => {
      page.blocks.forEach((block) => {
        block.fields.forEach((field) => {
          const scopedKey = `${block.pageKey}:${block.blockId}.${field.name}`;
          const localKey = field.name === 'value' ? block.blockId : `${block.blockId}.${field.name}`;
          result[scopedKey] = liveValues[scopedKey] ?? field.value;
          if (result[localKey] === undefined) result[localKey] = liveValues[localKey] ?? field.value;
        });
      });
    });
    const refs = cfg.blockRefs ?? {};
    Object.entries(refs).forEach(([name, val]) => {
      result[name] = val ?? liveValues[name] ?? null;
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveValues, cfg.blockRefs, sourcePages]);

  useEffect(() => {
    if (!blockPickerOpen) return;
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
  }, [blockPickerOpen]);

  const blockSourcePages = useMemo<BlockSourcePage[]>(() => {
    const liveById = new Map(availableBlocks.map((block) => [block.blockId, block.fields]));
    const liveBlocks: BlockSourceBlock[] = availableBlocks.map((b) => ({
      blockId: b.blockId,
      pageKey: 'current',
      pageLabel: 'Текущая страница',
      type: 'live',
      typeLabel: 'Live block',
      category: 'Текущая страница',
      label: String(liveValues[`${b.blockId}.label`] ?? `Блок ${b.blockId.slice(0, 8)}`),
      fields: b.fields.map((field) => ({
        name: field,
        label: sourceFieldLabel(field),
        value: liveValues[field === 'value' ? b.blockId : `${b.blockId}.${field}`] ?? null,
        format: moneyFieldSet(b.blockId, liveValues).has(field) ? 'money' as const : undefined,
      })),
    }));
    const pages = sourcePages.map((page) => ({
      ...page,
      blocks: page.blocks
        .filter((block) => block.blockId !== instance.id)
        .map((block) => mergeLiveFields(block, liveById.get(block.blockId), liveValues)),
    }));
    const hasLivePage = liveBlocks.length > 0;
    return hasLivePage
      ? [{ pageKey: 'current', pageLabel: 'Текущая страница', blocks: liveBlocks }, ...pages]
      : pages;
  }, [availableBlocks, liveValues, sourcePages, instance.id]);

  const sourceGroups = useMemo<BlockSourceGroup[]>(() => {
    const total = blockSourcePages.reduce((acc, page) => acc + page.blocks.length, 0);
    return [
      { id: 'all', label: 'Все блоки', count: total },
      ...blockSourcePages
        .filter((page) => page.blocks.length > 0)
        .map((page) => ({
          id: `page:${page.pageKey}`,
          label: page.pageLabel,
          count: page.blocks.length,
        })),
    ];
  }, [blockSourcePages]);

  const filteredSourcePages = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    return blockSourcePages
      .map((page) => ({
        ...page,
        blocks: page.blocks.filter((block) => {
          if (selectedSourceGroup.startsWith('page:') && selectedSourceGroup.slice(5) !== page.pageKey) return false;
          if (!q) return true;
          return [page.pageLabel, block.category, block.typeLabel, block.label, block.blockId]
            .join(' ')
            .toLowerCase()
            .includes(q);
        }),
      }))
      .filter((page) => page.blocks.length > 0);
  }, [blockSearch, blockSourcePages, selectedSourceGroup]);

  // Вычисляем все ячейки
  const evaluatedCells = useMemo(() => {
    const evaluated = new Map<string, number | string>();
    const moneyCells = new Set<string>();
    const result: string[][] = [];
    for (let r = 0; r < cells.length; r++) {
      const row: string[] = [];
      for (let c = 0; c < (cells[r]?.length ?? 0); c++) {
        const raw = cells[r][c];
        const addr = cellAddress(r, c);
        if (evaluated.has(addr)) {
          const cached = evaluated.get(addr)!;
          row.push(typeof cached === 'number'
            ? formatComputedValue(cached, moneyCells.has(addr), showKopecks)
            : String(cached));
        } else {
          const computed = computeCell(raw, cells, evaluated, blockValues, showKopecks, moneyCells);
          evaluated.set(addr, computed.value);
          if (computed.money) moneyCells.add(addr);
          row.push(computed.display);
        }
      }
      result.push(row);
    }
    return { result, evaluated, moneyCells };
  }, [cells, blockValues, showKopecks]);

  // Вычисляем header cells (используем общий evaluated cache из основной таблицы)
  const evaluatedHeaders = useMemo(() => {
    return headerCells.map((hc) => {
      if (!hc.value.startsWith('=')) return { ...hc, computed: hc.value };
      const computed = computeCell(hc.value, cells, evaluatedCells.evaluated, blockValues, showKopecks, evaluatedCells.moneyCells);
      return { ...hc, computed: computed.display };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerCells, cells, blockValues, evaluatedCells.evaluated, evaluatedCells.moneyCells, showKopecks]);

  // Публикуем значения для других блоков
  const publishOutput = useMemo(() => {
    const output: Record<string, number | string | null> = {};
    const numericCells: number[] = [];
    evaluatedCells.evaluated.forEach((value, addr) => {
      output[addr] = value;
      const n = typeof value === 'number' ? value : parseSheetNumber(String(value));
      if (n !== null) numericCells.push(n);
    });
    const sum = numericCells.reduce((s, n) => s + n, 0);
    return { value: sum, sum, count: numericCells.length, label: title, __money: Array.from(evaluatedCells.moneyCells).join(','), ...output };
  }, [evaluatedCells.evaluated, title]);
  useBlockValuePublisher(instance.id, publishOutput);

  // Синхронизация при внешнем изменении размеров
  useEffect(() => {
    setCells((prev) => ensureShape(prev, cfg.rows, cfg.cols));
  }, [cfg.rows, cfg.cols]);

  useEffect(() => {
    setColWidths((prev) => {
      const next = [...prev];
      while (next.length < cfg.cols) next.push(DEFAULT_COL_WIDTH);
      return next.slice(0, cfg.cols);
    });
  }, [cfg.cols]);

  useEffect(() => {
    setRowHeights((prev) => {
      const next = [...prev];
      while (next.length < cfg.rows) next.push(DEFAULT_ROW_HEIGHT);
      return next.slice(0, cfg.rows);
    });
  }, [cfg.rows]);

  const saveConfig = useCallback((patch: Partial<SheetCfg>) => {
    onConfigChange?.({ ...cfg, ...patch } as Record<string, unknown>);
  }, [cfg, onConfigChange]);

  function updateCell(r: number, c: number, value: string) {
    let saved: string[][] | null = null;
    setCells((prev) => {
      const next = prev.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row
      );
      saved = next;
      return next;
    });
    // Defer config save to avoid setState-in-setState (block-grid updateBlock bug)
    queueMicrotask(() => { if (saved) saveConfig({ cells: saved }); });
  }

  function handleCellClick(r: number, c: number) {
    closePickers();
    // В режиме формулы (в том числе для header): клик по ячейке вставляет ссылку
    if ((formulaMode || touchPickMode) && (editingHeaderId || (activeCell && !(activeCell.r === r && activeCell.c === c)))) {
      insertCellRef(r, c);
      return;
    }
    // Сброс редактирования header
    if (editingHeaderId) {
      commitEdit();
    }
    if (activeCell?.r === r && activeCell?.c === c && editing) return;
    setActiveCell({ r, c });
    setEditingHeaderId(null);
    setEditing(true);
    const raw = cells[r]?.[c] ?? '';
    setEditValue(raw);
    setFormulaMode(raw.startsWith('='));
    setTouchPickMode(false);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }

  /** Вставляет произвольный текст в текущую позицию курсора */
  function insertTextAtCursor(text: string) {
    const input = editInputRef.current;
    const pos = caretPos ?? input?.selectionStart ?? editValue.length;
    const before = editValue.slice(0, pos);
    const after = editValue.slice(pos);
    const newValue = before + text + after;
    setEditValue(newValue);
    setCaretPos(pos + text.length);
    setTimeout(() => {
      input?.focus();
      const newPos = pos + text.length;
      input?.setSelectionRange(newPos, newPos);
    }, 0);
  }

  function insertBlockField(block: BlockSourceBlock, field: BlockSourceField) {
    const ref =
      block.pageKey === 'current'
        ? field.name === 'value'
          ? block.blockId
          : `${block.blockId}.${field.name}`
        : `${block.pageKey}:${block.blockId}.${field.name}`;
    const token = `@${ref}`;
    const input = editInputRef.current;
    let base = editValue;
    let pos = caretPos ?? input?.selectionStart ?? base.length;
    if (!base.startsWith('=')) {
      base = `=${base}`;
      pos += 1;
    }
    pos = Math.max(1, Math.min(pos, base.length));
    const nextValue = base.slice(0, pos) + token + base.slice(pos);
    const newPos = pos + token.length;
    const nextRefs = { ...(cfg.blockRefs ?? {}), [ref]: field.value };

    setEditValue(nextValue);
    setFormulaMode(true);
    setEditing(true);
    setCaretPos(newPos);

    if (editingHeaderId) {
      const nextHeaders = headerCells.map((hc) => (hc.id === editingHeaderId ? { ...hc, value: nextValue } : hc));
      setHeaderCells(nextHeaders);
      saveConfig({ headerCells: nextHeaders, blockRefs: nextRefs });
    } else if (activeCell) {
      const nextCells = cells.map((row, ri) =>
        ri === activeCell.r ? row.map((cell, ci) => (ci === activeCell.c ? nextValue : cell)) : row
      );
      setCells(nextCells);
      saveConfig({ cells: nextCells, blockRefs: nextRefs });
    } else {
      saveConfig({ blockRefs: nextRefs });
    }

    setBlockPickerOpen(false);
    setBlockSearch('');
    openingBlockPickerRef.current = false;
    setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(newPos, newPos);
    }, 0);
  }

  /** Вставляет ссылку на ячейку (например A3) в текущую позицию курсора в formula bar */
  function insertCellRef(r: number, c: number) {
    const ref = cellAddress(r, c);
    const input = editInputRef.current;
    if (!input) {
      setEditValue((prev) => prev + ref);
      return;
    }
    const pos = caretPos ?? input.selectionStart ?? editValue.length;
    const before = editValue.slice(0, pos);
    const after = editValue.slice(pos);
    const newValue = before + ref + after;
    setEditValue(newValue);
    setCaretPos(pos + ref.length);
    // Восстанавливаем фокус и позицию курсора
    setTimeout(() => {
      input.focus();
      const newPos = pos + ref.length;
      input.setSelectionRange(newPos, newPos);
    }, 0);
  }

  function closePickers() {
    openingBlockPickerRef.current = false;
    setBlockPickerOpen(false);
    setTouchPickMode(false);
  }

  function commitEdit() {
    if (editingHeaderId) {
      // Commit header cell formula
      const next = headerCells.map((hc) => (hc.id === editingHeaderId ? { ...hc, value: editValue } : hc));
      setHeaderCells(next);
      queueMicrotask(() => saveConfig({ headerCells: next }));
      setEditingHeaderId(null);
      setFormulaMode(false);
      setTouchPickMode(false);
      setCaretPos(null);
      setEditing(false);
      return;
    }
    if (activeCell && editing) {
      updateCell(activeCell.r, activeCell.c, editValue);
      setEditing(false);
      setFormulaMode(false);
      setTouchPickMode(false);
      setCaretPos(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!activeCell) return;
    if (e.key === 'Enter') {
      commitEdit();
      const nextR = Math.min(activeCell.r + 1, cfg.rows - 1);
      setActiveCell({ r: nextR, c: activeCell.c });
      setEditing(true);
      const raw = cells[nextR]?.[activeCell.c] ?? '';
      setEditValue(raw);
      setFormulaMode(raw.startsWith('='));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      const nextC = e.shiftKey ? Math.max(0, activeCell.c - 1) : Math.min(activeCell.c + 1, cfg.cols - 1);
      setActiveCell({ r: activeCell.r, c: nextC });
      setEditing(true);
      const raw = cells[activeCell.r]?.[nextC] ?? '';
      setEditValue(raw);
      setFormulaMode(raw.startsWith('='));
    } else if (e.key === 'Escape') {
      if (editingHeaderId) setEditingHeaderId(null);
      setEditing(false);
      setFormulaMode(false);
      setTouchPickMode(false);
      setCaretPos(null);
      setEditValue(cells[activeCell.r]?.[activeCell.c] ?? '');
    }
  }

  /** Отслеживаем изменения editValue для автоматического formula mode */
  function handleEditChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setEditValue(val);
    setFormulaMode(val.startsWith('='));
    setCaretPos(e.target.selectionStart);
  }

  /** Запоминаем позицию курсора при клике/перемещении в input */
  function handleEditSelect(e: React.SyntheticEvent<HTMLInputElement>) {
    setCaretPos((e.target as HTMLInputElement).selectionStart);
  }

  // Column resize handlers
  function startColResize(col: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = { col, startX: e.clientX, startW: colWidths[col] ?? DEFAULT_COL_WIDTH };
    const onMove = (ev: MouseEvent) => {
      if (!resizingCol.current) return;
      const diff = ev.clientX - resizingCol.current.startX;
      const newW = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, resizingCol.current.startW + diff));
      setColWidths((prev) => {
        const next = [...prev];
        next[resizingCol.current!.col] = newW;
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizingCol.current = null;
      // Defer to avoid setState-in-setState
      setColWidths((current) => { queueMicrotask(() => saveConfig({ colWidths: current })); return current; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Row resize handlers
  function startRowResize(row: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    resizingRow.current = { row, startY: e.clientY, startH: rowHeights[row] ?? DEFAULT_ROW_HEIGHT };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRow.current) return;
      const diff = ev.clientY - resizingRow.current.startY;
      const newH = Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, resizingRow.current.startH + diff));
      setRowHeights((prev) => {
        const next = [...prev];
        next[resizingRow.current!.row] = newH;
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizingRow.current = null;
      // Defer to avoid setState-in-setState
      setRowHeights((current) => { queueMicrotask(() => saveConfig({ rowHeights: current })); return current; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Header cell updates
  function updateHeaderCell(id: string, patch: Partial<HeaderCell>) {
    const next = headerCells.map((hc) => (hc.id === id ? { ...hc, ...patch } : hc));
    setHeaderCells(next);
    saveConfig({ headerCells: next });
  }

  function addHeaderCell() {
    const next = [...headerCells, { id: makeHeaderId(), label: '', value: '', width: 120 }];
    setHeaderCells(next);
    saveConfig({ headerCells: next });
  }

  function removeHeaderCell(id: string) {
    const next = headerCells.filter((hc) => hc.id !== id);
    setHeaderCells(next);
    saveConfig({ headerCells: next });
  }

  const thStyle: CSSProperties = {
    background: 'var(--muted, #f4f4f5)',
    fontWeight: 500,
    fontSize: '0.65rem',
    color: 'var(--muted-foreground, #71717a)',
  };

  // XS density — just show title + count
  if (density === 'xs') {
    return (
      <Card className="flex h-full items-center justify-center p-1">
        <div className="text-center">
          <Table2 className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{title}</div>
        </div>
      </Card>
    );
  }

  // SM density — title + summary
  if (density === 'sm') {
    return (
      <Card className="flex h-full flex-col justify-center p-2">
        <div className="flex items-center gap-1">
          <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium text-muted-foreground">{title}</span>
        </div>
        <div className="mt-0.5 text-xs tabular-nums" style={accent ? { color: accent } : undefined}>
          {cfg.rows}×{cfg.cols} ячеек
        </div>
      </Card>
    );
  }

  // MD/LG — full spreadsheet
  return (
    <Card ref={sheetRef} className="flex h-full flex-col overflow-hidden">
      {/* Header summary row */}
      {cfg.showHeader && (
        <div className="flex items-center gap-0 border-b border-border/50 bg-muted/30">
          {evaluatedHeaders.map((hc) => (
            <div
              key={hc.id}
              className="group/hcell relative flex flex-col border-r border-border/30 px-2.5 py-1.5"
              style={{ width: hc.width ?? 'auto', minWidth: 80 }}
            >
              <div className="flex items-center gap-1">
                <input
                  className="h-4 flex-1 border-0 bg-transparent p-0 text-[10px] font-medium text-muted-foreground outline-none focus:ring-0"
                  value={hc.label}
                  onChange={(e) => updateHeaderCell(hc.id, { label: e.target.value })}
                  placeholder="Метка"
                />
                <button
                  type="button"
                  onClick={() => removeHeaderCell(hc.id)}
                  className="h-3 w-3 shrink-0 text-muted-foreground/30 opacity-0 transition hover:text-red-500 group-hover/hcell:opacity-100"
                  title="Удалить ячейку"
                >
                  ×
                </button>
              </div>
              <input
                className={'h-5 w-full truncate border-0 bg-transparent p-0 text-xs font-semibold tabular-nums outline-none focus:ring-0' + (editingHeaderId === hc.id ? ' ring-1 ring-primary/50 rounded px-1' : '')}
                style={accent ? { color: accent } : undefined}
                value={editingHeaderId === hc.id ? editValue : (hc.value.startsWith('=') ? (hc as { computed?: string }).computed ?? '' : hc.value)}
                tabIndex={-1}
                onMouseDown={(e) => {
                  // Prevent stealing focus if already editing this header
                  if (editingHeaderId === hc.id) e.preventDefault();
                }}
                onFocus={() => {
                  // Activate formula bar editing for this header
                  if (editingHeaderId !== hc.id) {
                    if (activeCell && editing) commitEdit();
                    setActiveCell(null);
                    setEditingHeaderId(hc.id);
                    setEditValue(hc.value);
                    setEditing(true);
                    setFormulaMode(hc.value.startsWith('='));
                    setCaretPos(null);
                    setTimeout(() => editInputRef.current?.focus(), 0);
                  }
                }}
                onChange={(e) => {
                  // Direct edit for non-formula headers (no formula bar)
                  if (!editingHeaderId) {
                    updateHeaderCell(hc.id, { value: e.target.value });
                  }
                }}
                title={hc.value.startsWith('=') ? `Формула: ${hc.value}\n(Кликните для редактирования)` : 'Кликните для ввода формулы (=SUM(A1:A5))'}
              />
            </div>
          ))}
          <button
            type="button"
            className="flex h-full items-center px-2 text-muted-foreground/50 transition hover:text-muted-foreground"
            onClick={addHeaderCell}
            title="Добавить ячейку"
          >
            <span className="text-lg leading-none">+</span>
          </button>
        </div>
      )}

      {/* Formula bar */}
      {cfg.showFormulaBar && (activeCell || editingHeaderId) && (
        <div className="flex items-center gap-1 border-b border-border/40 bg-muted/20 px-2 py-1">
          <span className="flex h-5 min-w-[36px] items-center justify-center rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
            {editingHeaderId
              ? (headerCells.find((h) => h.id === editingHeaderId)?.label || 'Header')
              : cellAddress(activeCell!.r, activeCell!.c)}
          </span>
          <FunctionSquare className="h-3 w-3 text-muted-foreground/60" />
          <input
            ref={editInputRef}
            className="h-5 flex-1 border-0 bg-transparent p-0 text-xs outline-none focus:ring-0"
            value={editValue}
            onChange={handleEditChange}
            onSelect={handleEditSelect}
            onBlur={(e) => {
              const related = e.relatedTarget as HTMLElement | null;
              if (openingBlockPickerRef.current || blockPickerOpen) return;
              if ((formulaMode || editingHeaderId) && related && sheetRef.current?.contains(related)) return;
              commitEdit();
            }}
            onKeyDown={handleKeyDown}
            placeholder={formulaMode ? 'Кликните по ячейке для вставки ссылки' : 'Введите значение или формулу (=SUM(A1:A5))'}
          />
          {/* Formula mode indicator */}
          {formulaMode && (
            <span className="flex h-5 items-center rounded bg-blue-100 px-1.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              fx
            </span>
          )}
          {/* Mobile: кнопка для активации pick-cell mode */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!editValue.startsWith('=')) {
                setEditValue('=' + editValue);
                setFormulaMode(true);
              }
              setTouchPickMode((v) => !v);
              editInputRef.current?.focus();
            }}
            className={
              'flex h-5 items-center rounded px-1.5 text-[10px] transition ' +
              (touchPickMode
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80')
            }
            title={touchPickMode ? 'Выключить выбор ячеек' : 'Выбрать ячейку для ссылки (для тачскрина)'}
          >
            📍
          </button>
        </div>
      )}

      {/* Mobile formula helpers — показываем при формуле */}
      {cfg.showFormulaBar && (activeCell || editingHeaderId) && (formulaMode || touchPickMode) && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 bg-muted/10 px-2 py-0.5">
          <span className="shrink-0 text-[10px] text-muted-foreground">Вставить:</span>
          {['+', '-', '*', '/', '(', ')', ',', ':'].map((op) => (
            <button
              key={op}
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-mono transition hover:bg-muted/80"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const input = editInputRef.current;
                const pos = caretPos ?? input?.selectionStart ?? editValue.length;
                const newValue = editValue.slice(0, pos) + op + editValue.slice(pos);
                setEditValue(newValue);
                setCaretPos(pos + 1);
                setTimeout(() => {
                  input?.focus();
                  input?.setSelectionRange(pos + 1, pos + 1);
                }, 0);
              }}
            >
              {op}
            </button>
          ))}
          <div className="mx-1 h-3 w-px bg-border/50" />
          {['SUM', 'AVG', 'MAX', 'MIN', 'COUNT'].map((fn) => (
            <button
              key={fn}
              type="button"
              className="flex h-5 shrink-0 items-center rounded bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-600 transition hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const fnText = fn === 'AVG' ? 'AVERAGE(' : `${fn}(`;
                const input = editInputRef.current;
                const pos = caretPos ?? input?.selectionStart ?? editValue.length;
                let newValue = editValue;
                if (!editValue.startsWith('=')) newValue = '=' + newValue;
                const insertPos = !editValue.startsWith('=') ? pos + 1 : pos;
                newValue = newValue.slice(0, insertPos) + fnText + newValue.slice(insertPos);
                setEditValue(newValue);
                setFormulaMode(true);
                const newPos = insertPos + fnText.length;
                setCaretPos(newPos);
                setTimeout(() => {
                  input?.focus();
                  input?.setSelectionRange(newPos, newPos);
                }, 0);
              }}
            >
              {fn}
            </button>
          ))}
          <div className="mx-1 h-3 w-px bg-border/50" />
          {/* @Block mention picker */}
          <Dialog
            open={blockPickerOpen}
            onOpenChange={(open) => {
              setBlockPickerOpen(open);
              if (!open) openingBlockPickerRef.current = false;
            }}
          >
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openingBlockPickerRef.current = true;
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openingBlockPickerRef.current = true;
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openingBlockPickerRef.current = true;
                setBlockPickerOpen(true);
              }}
              className={
                'flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold transition ' +
                (blockPickerOpen
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900')
              }
              title="Вставить значение из другого блока"
            >
              @связать
            </button>
            <DialogContent
              className="w-[min(94vw,640px)] max-w-none gap-0 overflow-hidden p-0"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
              }}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                openingBlockPickerRef.current = false;
                editInputRef.current?.focus();
              }}
            >
              <DialogHeader className="border-b border-border/60 px-4 py-3">
                <DialogTitle className="text-sm">Связать ячейку с источником</DialogTitle>
                <DialogDescription className="text-[11px]">
                  Выберите блок, поле или ячейку — ссылка будет добавлена в формулу
                </DialogDescription>
              </DialogHeader>
              <div className="grid min-h-[320px] grid-cols-[180px_minmax(0,1fr)]">
                <aside className="border-r border-border/60 bg-muted/20">
                  <div className="border-b border-border/40 px-3 py-2">
                    <Input
                      placeholder="Поиск..."
                      value={blockSearch}
                      onChange={(e) => setBlockSearch(e.target.value)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-0.5 p-2">
                    {sourceGroups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedSourceGroup(group.id)}
                        className={
                          'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition ' +
                          (selectedSourceGroup === group.id
                            ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border/70'
                            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground')
                        }
                      >
                        <span className="truncate">{group.label}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{group.count}</span>
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="max-h-[420px] overflow-y-auto">
                  {sourceLoading ? (
                    <p className="py-12 text-center text-xs text-muted-foreground">Загружаю блоки…</p>
                  ) : filteredSourcePages.length === 0 ? (
                    <p className="py-12 text-center text-xs text-muted-foreground">
                      Нет доступных блоков.
                    </p>
                  ) : (
                    <div>
                      {filteredSourcePages.map((page) => (
                        <section key={page.pageKey}>
                          <div className="sticky top-0 z-10 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                            <span className="text-[11px] font-semibold text-muted-foreground">{page.pageLabel}</span>
                          </div>
                          {page.blocks.map((block) => (
                            <div
                              key={`${block.pageKey}:${block.blockId}`}
                              className="border-b border-border/30 px-3 py-2 transition last:border-b-0 hover:bg-accent/30"
                            >
                              <div className="space-y-1.5">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium text-foreground">{block.label}</div>
                                  <div className="text-[10px] text-muted-foreground">{block.category} · {block.typeLabel}</div>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {block.fields.filter((f) => f.name !== 'label' && f.name !== 'raw').map((field) => {
                                    const preview = previewSourceValue(field);
                                    return (
                                      <button
                                        key={field.name}
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition hover:bg-primary/10 hover:ring-primary/40"
                                        onClick={() => insertBlockField(block, field)}
                                        title={`${field.label} = ${preview}`}
                                      >
                                        <span className="font-medium text-primary">{field.label}</span>
                                        <span className="text-muted-foreground">{preview}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ))}
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {touchPickMode && (
            <span className="ml-auto shrink-0 text-[10px] text-primary">← тапните ячейку</span>
          )}
        </div>
      )}

      {/* Spreadsheet grid */}
      <CardContent className="flex-1 overflow-auto p-0">
        <table className="border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 32 }} />
            {colWidths.slice(0, cfg.cols).map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border border-border/40" style={thStyle}></th>
              {Array.from({ length: cfg.cols }, (_, c) => (
                <th
                  key={c}
                  className="sticky top-0 z-10 border border-border/40 px-1 py-0.5 text-left"
                  style={{ ...thStyle, position: 'relative' }}
                >
                  {colLabel(c)}
                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30"
                    onMouseDown={(e) => startColResize(c, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evaluatedCells.result.map((row, r) => (
              <tr key={r} style={{ height: rowHeights[r] ?? DEFAULT_ROW_HEIGHT }}>
                <td
                  className="sticky left-0 z-10 border border-border/40 text-center"
                  style={{ ...thStyle, position: 'relative' }}
                >
                  {r + 1}
                  {/* Row resize handle */}
                  <div
                    className="absolute bottom-0 left-0 h-1 w-full cursor-row-resize hover:bg-primary/30"
                    onMouseDown={(e) => startRowResize(r, e)}
                  />
                </td>
                {row.map((displayValue, c) => {
                  const isActive = activeCell?.r === r && activeCell?.c === c;
                  const rawValue = cells[r]?.[c] ?? '';
                  const isFormula = rawValue.startsWith('=');
                  return (
                    <td
                      key={c}
                      className={
                        'border border-border/40 p-0 ' +
                        (isActive
                          ? 'ring-2 ring-inset ring-primary/60'
                          : 'hover:bg-accent/30')
                      }
                      tabIndex={-1}
                      onClick={() => handleCellClick(r, c)}
                      style={{ height: rowHeights[r] ?? DEFAULT_ROW_HEIGHT }}
                    >
                      {isActive && editing ? (
                        <input
                          ref={editInputRef}
                          className="h-full w-full border-0 bg-background px-1.5 text-xs outline-none"
                          value={editValue}
                          onChange={handleEditChange}
                          onSelect={handleEditSelect}
                          onBlur={(e) => {
                            const related = e.relatedTarget as HTMLElement | null;
                            if (openingBlockPickerRef.current || blockPickerOpen) return;
                            if ((formulaMode || editingHeaderId) && related && sheetRef.current?.contains(related)) return;
                            commitEdit();
                          }}
                          onKeyDown={handleKeyDown}
                          autoFocus
                        />
                      ) : (
                        <div
                          className={
                            'flex h-full items-center truncate px-1.5 tabular-nums ' +
                            (isFormula ? 'text-blue-700 dark:text-blue-400' : '') +
                            ((formulaMode || touchPickMode) && !isActive ? ' cursor-cell' : '')
                          }
                          title={
                            (formulaMode || touchPickMode) && !isActive
                              ? `Кликните чтобы вставить ${cellAddress(r, c)}`
                              : isFormula ? `Формула: ${rawValue}` : undefined
                          }
                        >
                          {displayValue}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>

      {/* Accept / Cancel floating buttons (BlockChrome style) */}
      {(activeCell || editingHeaderId) && editing && (
        <div className="absolute bottom-1.5 right-1.5 z-30 flex gap-1">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-background/95 text-green-600 shadow-sm ring-1 ring-border transition hover:bg-green-50 dark:hover:bg-green-950"
            onClick={() => commitEdit()}
            title="Принять (Enter)"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-background/95 text-red-600 shadow-sm ring-1 ring-border transition hover:bg-red-50 dark:hover:bg-red-950"
            onClick={() => {
              if (editingHeaderId) {
                setEditingHeaderId(null);
              }
              setEditing(false);
              setFormulaMode(false);
              setTouchPickMode(false);
              setCaretPos(null);
              if (activeCell) {
                setEditValue(cells[activeCell.r]?.[activeCell.c] ?? '');
              }
            }}
            title="Отменить (Esc)"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// Settings Form
// ============================================================================

function SheetSettings({ config, onChange }: BlockSettingsFormProps) {
  const cfg = SheetConfig.parse(config ?? {});

  function set<K extends keyof SheetCfg>(key: K, value: SheetCfg[K]) {
    onChange({ ...cfg, [key]: value } as unknown as Record<string, unknown>);
  }

  return (
    <div className="space-y-4">
      {/* Grid size */}
      <div className="space-y-2">
        <Label>Строк: <span className="tabular-nums">{cfg.rows}</span></Label>
        <input
          type="range"
          min={1}
          max={100}
          value={cfg.rows}
          onChange={(e) => set('rows', Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>
      <div className="space-y-2">
        <Label>Колонок: <span className="tabular-nums">{cfg.cols}</span></Label>
        <input
          type="range"
          min={1}
          max={26}
          value={cfg.cols}
          onChange={(e) => set('cols', Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>

      {/* Toggles */}
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div>
            <div className="text-xs font-medium">Header-строка</div>
            <div className="text-[11px] text-muted-foreground">Ячейки сверху с названием и итогами</div>
          </div>
          <button
            type="button"
            onClick={() => set('showHeader', !cfg.showHeader)}
            className={
              'h-5 w-9 rounded-full transition ' +
              (cfg.showHeader ? 'bg-primary' : 'bg-muted')
            }
          >
            <div
              className={
                'h-4 w-4 rounded-full bg-white shadow transition-transform ' +
                (cfg.showHeader ? 'translate-x-4' : 'translate-x-0.5')
              }
            />
          </button>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div>
            <div className="text-xs font-medium">Строка формул</div>
            <div className="text-[11px] text-muted-foreground">Показывает формулу активной ячейки</div>
          </div>
          <button
            type="button"
            onClick={() => set('showFormulaBar', !cfg.showFormulaBar)}
            className={
              'h-5 w-9 rounded-full transition ' +
              (cfg.showFormulaBar ? 'bg-primary' : 'bg-muted')
            }
          >
            <div
              className={
                'h-4 w-4 rounded-full bg-white shadow transition-transform ' +
                (cfg.showFormulaBar ? 'translate-x-4' : 'translate-x-0.5')
              }
            />
          </button>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Показывать копейки</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.showKopecks === null
                ? 'Используется глобальная настройка'
                : cfg.showKopecks
                  ? 'Включено (1 234,56)'
                  : 'Выключено (1 235)'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {cfg.showKopecks !== null && (
              <button
                type="button"
                onClick={() => set('showKopecks', null)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Сбросить
              </button>
            )}
            <Switch
              checked={cfg.showKopecks ?? false}
              onCheckedChange={(v) => set('showKopecks', v)}
            />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">Формулы:</p>
        <ul className="space-y-0.5 pl-2">
          <li><code className="rounded bg-muted px-1">=SUM(A1:A10)</code> — сумма диапазона</li>
          <li><code className="rounded bg-muted px-1">=AVERAGE(B1:B5)</code> — среднее</li>
          <li><code className="rounded bg-muted px-1">=A1+B1*2</code> — арифметика</li>
          <li><code className="rounded bg-muted px-1">=MAX(A:A)</code> — максимум колонки</li>
          <li><code className="rounded bg-muted px-1">=@income</code> — значение из блока</li>
        </ul>
        <p className="pt-1">
          Размеры ячеек: перетащите границы колонок/строк в таблице.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Block Definition
// ============================================================================

export const SheetBlock: BlockDef = {
  type: 'sheet',
  displayName: 'Таблица (Excel)',
  description: 'Полноценная таблица с формулами (=SUM, =AVERAGE...), настраиваемыми размерами ячеек, header-строкой и связями с блоками',
  category: 'tables',
  icon: Table2,
  defaultSize: { w: 5, h: 5 },
  minSize: { w: 3, h: 3 },
  minContentSize: { w: 360, h: 220 },
  pages: ['*'],
  supportsDependencies: true,
  configSchema: SheetConfig,
  defaultConfig: () => ({
    title: 'Таблица',
    rows: 5,
    cols: 3,
    cells: emptyCells(5, 3),
    colWidths: Array(3).fill(DEFAULT_COL_WIDTH),
    rowHeights: Array(5).fill(DEFAULT_ROW_HEIGHT),
    headerCells: [
      { id: makeHeaderId(), label: 'Название', value: 'Таблица', width: 200 },
      { id: makeHeaderId(), label: 'Итого', value: '=SUM(A1:A5)', width: 150 },
    ],
    showHeader: true,
    showFormulaBar: true,
    showKopecks: null,
  }),
  SettingsForm: SheetSettings,
  Render: RenderSheet,
};
