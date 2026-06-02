// PURPOSE: Блок «Мой магазин» — кастомизируемая таблица товаров с
// настраиваемыми колонками (число/процент/деньги/текст/формула),
// привязками через MyStoreNumberCell (dumb-ячейка без подписки на стор) и
// формулами с защитой от циклов. Большие таблицы виртуализируются (окно строк),
// строки мемоизируются, ввод держит локальный draft (commit на blur) + Excel-протяжка.
// Базируется на структуре unit.ozon-multi-table (sticky шапка/колонки/итоги).
//
// Excel-режим (v0.39.0): тоггл `config.excelMode` включает sheet-style
// редактирование ЛЮБОЙ ячейки (как в блоках «Данные»/«Эксель ячейка»).
//   - per-cell формула = строка `row.values[colId]`, начинающаяся с `=`
//     (тот же контракт, что и `cell.v` в custom.data; XLSX-адаптер уже её
//     сохраняет/читает). Переменные формулы — id колонок ТОЙ ЖЕ строки +
//     `vatPct`/`taxRatePct` (как у колонок-формул), движок — `evalRowFormulas`.
//   - единый `EditSession` (один draft на активную ячейку) между inline-input
//     и formula bar; commit на blur/Enter/Tab, отмена на Escape.
//   - в обычном режиме блок работает как раньше; ячейка с per-cell формулой
//     рендерится read-only (computed + бейдж fx). Формулы редактируются только
//     в Excel-режиме. Формульные КОЛОНКИ остаются column-driven (read-only).
'use client';

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  SlidersHorizontal,
  Check,
  Link2,
  Link2Off,
  FunctionSquare,
  Unlink,
  Table2,
  X,
} from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
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
import { UnitCellBindingDialog } from '@/components/unit-economics/unit-cell-binding-dialog';
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { resolveBindingValue, isBindingActive } from '@/lib/unit-economics/bindings';
import type { UnitCellBinding } from '@/lib/unit-economics/types';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { evalRowFormulas, evalSingleFormula } from '@/lib/unit-economics/store-formula';
import {
  OzonImportFromAnalyticsDialog,
  type OzonImportSettings,
} from '@/components/unit-economics/ozon-import-from-analytics-dialog';
import {
  OZON_TO_MY_STORE_COLUMN_MAP,
  extractOzonValue,
} from '@/lib/unit-economics/ozon-to-my-store';
import { SmartImportDialog } from '@/components/unit-economics/smart-import-dialog';
import type {
  ApplyResult,
  TargetColumn,
  TargetRow,
} from '@/lib/unit-economics/table-import';
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

const ColumnTypeEnum = z.enum(['number', 'percent', 'money', 'text', 'formula', 'identity']);
type ColumnType = z.infer<typeof ColumnTypeEnum>;

/**
 * id зарезервированных «identity»-колонок (Артикул и Название). Хранятся
 * в `config.columns` наравне с пользовательскими, но рендерятся специально
 * (input на `row.article`/`row.name`, без LinkableNumberCell и без формул).
 */
const IDENTITY_ARTICLE_ID = 'article';
const IDENTITY_NAME_ID = 'name';
const DEFAULT_IDENTITY_COLUMNS = [
  { id: IDENTITY_ARTICLE_ID, label: 'Артикул', type: 'identity' as const, width: 110 },
  { id: IDENTITY_NAME_ID, label: 'Название товара', type: 'identity' as const, width: 220 },
];

function isIdentityCol(col: Column): boolean {
  return col.type === 'identity';
}

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
    ...DEFAULT_IDENTITY_COLUMNS,
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
   * id колонок, закреплённых слева (sticky), включая identity-колонки
   * (`'article'`, `'name'`). Pinned-колонки не участвуют в DnD-сортировке.
   * По умолчанию закреплены `article` и `name` — самые важные для идентификации.
   */
  pinnedColumns: z.array(z.string()).default([IDENTITY_ARTICLE_ID, IDENTITY_NAME_ID]),
  /**
   * Excel-режим: sheet-style редактирование любой ячейки (значение/формула)
   * через единый formula bar. Персистится, чтобы «точечная» сессия работы с
   * таблицей переживала перезагрузку. Дефолт `false` — обычный режим.
   */
  excelMode: z.boolean().default(false),
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

  // Migration (v0.24.2): article/name стали полноценными identity-колонками
  // в `config.columns`. Старые конфиги их не содержат — prepend и pin
  // по умолчанию. Уже мигрированные конфиги (с identity внутри columns)
  // пропускаем — уважаем пользовательские настройки pin/hide/width.
  const hasArticleCol = cfg.columns.some((c) => c.id === IDENTITY_ARTICLE_ID);
  const hasNameCol = cfg.columns.some((c) => c.id === IDENTITY_NAME_ID);
  if (!hasArticleCol || !hasNameCol) {
    const prepend: Column[] = [];
    if (!hasArticleCol) prepend.push(DEFAULT_IDENTITY_COLUMNS[0]);
    if (!hasNameCol) prepend.push(DEFAULT_IDENTITY_COLUMNS[1]);
    cfg.columns = [...prepend, ...cfg.columns];
    // Pin identity-колонок по дефолту, сохраняя порядок: article, name, ...existing.
    const pinned = [...cfg.pinnedColumns];
    if (!hasNameCol && !pinned.includes(IDENTITY_NAME_ID)) pinned.unshift(IDENTITY_NAME_ID);
    if (!hasArticleCol && !pinned.includes(IDENTITY_ARTICLE_ID)) pinned.unshift(IDENTITY_ARTICLE_ID);
    cfg.pinnedColumns = pinned;
  }
  return cfg;
}

function isMoneyCol(col: Column): boolean {
  return col.type === 'money' || (col.type === 'formula' && (col.unit === '₽' || /руб|rub/i.test(col.unit ?? '')));
}

/**
 * Per-cell формула (Excel-режим) — строковое значение `row.values[colId]`,
 * начинающееся с `=`. Тот же контракт, что и `cell.v` в блоке «Данные»;
 * именно так формулы сохраняет/читает XLSX-адаптер (`my-store-table.ts`).
 * Применяется только к НЕ-формульным колонкам (формульные column-driven).
 */
function isCellFormulaValue(v: unknown): boolean {
  return typeof v === 'string' && v.trim().startsWith('=');
}


function formatNumber(value: number, col: Column, showKopecks: boolean): string {
  if (!Number.isFinite(value)) return '—';
  if (isMoneyCol(col)) return formatRublesWithSettings(rublesToKopecks(value), showKopecks);
  if (col.type === 'percent') return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}%`;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

/** Краткое относительное время для чипа импорта: «сегодня» / «вчера» / «N дн. назад» / дата. */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

/**
 * Вычисляет значения строки: manual-скоуп (значения/привязки/дефолты) + формулы.
 * ЕДИНЫЙ источник правды для рендера строки (MyStoreRow) и агрегатов (computedRows).
 * `boundForRow` — заранее разрешённые block_ref-привязки строки (colId → число),
 * чтобы per-row компонент не подписывался на стор сам.
 */
function computeRowValues(
  row: Row,
  columns: Column[],
  vatPct: number,
  taxRatePct: number,
  formulasMap: Record<string, string | undefined>,
  boundForRow: Record<string, number> | undefined,
): Record<string, number | string> {
  const manual: Record<string, number | string> = { vatPct, taxRatePct };
  // Per-cell формулы этой строки (Excel-режим): colId → формула. Накладываются
  // поверх column-formula в `formulasMap` через `evalRowFormulas`. Работают и
  // для НЕ-формульных колонок (импортированное число → формула), и для
  // формульных (переопределение column-formula в одной строке).
  let cellFormulas: Record<string, string> | null = null;
  // Формульные колонки, переопределённые per-cell ЛИТЕРАЛОМ (жёстким числом):
  // их column-formula убираем из effectiveFormulas, чтобы победил литерал.
  let literalOverrides: Set<string> | null = null;
  for (const col of columns) {
    if (col.type === 'identity') continue;
    const raw = row.values[col.id];
    // Per-cell формула: значение-строка с `=`. Уходит в formulas, не в manual,
    // чтобы движок её вычислил (а не трактовал как литерал → NaN → 0).
    // Переопределяет column-formula для формульных колонок в этой строке.
    if (isCellFormulaValue(raw)) {
      (cellFormulas ??= {})[col.id] = String(raw).trim();
      continue;
    }
    if (col.type === 'formula') {
      // Формульная колонка: per-cell ЛИТЕРАЛ-override (жёстко заданное значение).
      if (raw !== undefined && raw !== null && raw !== '') {
        manual[col.id] = raw;
        (literalOverrides ??= new Set()).add(col.id);
      }
      // иначе — column-formula (она в formulasMap), manual не трогаем.
      continue;
    }
    const bound = boundForRow?.[col.id];
    if (bound !== undefined) {
      manual[col.id] = bound;
      continue;
    }
    if (raw === undefined || raw === null || raw === '') {
      manual[col.id] = (col.default as number | string | undefined) ?? (col.type === 'text' ? '' : 0);
    } else {
      manual[col.id] = raw;
    }
  }
  let effectiveFormulas = formulasMap;
  if (cellFormulas || literalOverrides) {
    effectiveFormulas = { ...formulasMap };
    if (cellFormulas) Object.assign(effectiveFormulas, cellFormulas);
    if (literalOverrides) for (const id of literalOverrides) delete effectiveFormulas[id];
  }
  const computed = evalRowFormulas(manual, effectiveFormulas);
  const merged: Record<string, number | string> = { ...manual };
  for (const [k, v] of Object.entries(computed)) merged[k] = v;
  return merged;
}

/** Форматирование значения числовой ячейки (деньги — через настройки, суффикс ₽ срезаем). */
function formatCellValue(v: number, money: boolean, showKopecks: boolean): string {
  if (!Number.isFinite(v)) return '';
  if (money) return formatRublesWithSettings(rublesToKopecks(v), showKopecks).replace(/\s?₽$/, '').trim();
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v);
}

/** Парсинг ручного ввода числа ('1 000,5' → 1000.5). */
function parseCellInput(text: string): number {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Единая сессия редактирования (Excel-режим). Один `draft` шарится между
 * inline-input активной ячейки и formula bar. `isFormula(draft)` = начинается
 * с `=`. `dirty` — был ли draft изменён пользователем (если нет, commit не
 * перезаписывает ячейку → не ломает binding при простом проходе Tab'ом).
 * Зеркалит `EditSession` из custom.data (тот же проверенный паттерн).
 */
type EditSession = {
  rowId: string;
  columnId: string;
  draft: string;
  caretPos: number | null;
  lastFocused: 'inline' | 'bar';
  dirty: boolean;
};

function isFormulaDraft(draft: string): boolean {
  return draft.trim().startsWith('=');
}

/**
 * Стартовый draft ячейки: формула/текст как есть, число → строкой, привязанная
 * ячейка → пусто (печать переопределит привязку). Identity → article/name.
 */
function draftForCell(row: Row, col: Column): string {
  if (col.type === 'identity') {
    return col.id === IDENTITY_ARTICLE_ID ? row.article : row.name;
  }
  // Формульные колонки не биндятся; для остальных привязанная ячейка → пустой
  // draft (печать переопределит привязку).
  if (
    col.type !== 'formula' &&
    isBindingActive(row.bindings[col.id] as UnitCellBinding | undefined)
  ) {
    return '';
  }
  const raw = row.values[col.id];
  if (typeof raw === 'string') return raw; // per-cell формула / текст / литерал-строка
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw); // per-cell литерал
  // Формульная колонка без per-cell override → показываем column-formula для правки
  // (чтобы пользователь видел и мог отредактировать действующую формулу).
  if (col.type === 'formula' && col.formula) return col.formula;
  return '';
}

/**
 * Вставка `text` в draft на позиции каретки. forceFormula добавляет ведущий `=`
 * (вставка переменной/оператора переводит ячейку в режим формулы). Pure.
 */
function insertIntoDraft(
  prev: { draft: string; caretPos: number | null },
  text: string,
  forceFormula = false,
): { draft: string; caretPos: number } {
  let draft = prev.draft;
  let pos = prev.caretPos ?? draft.length;
  if (forceFormula && draft === '') {
    return { draft: `=${text}`, caretPos: text.length + 1 };
  }
  if (forceFormula && !draft.startsWith('=')) {
    draft = `=${draft}`;
    pos += 1;
  }
  pos = Math.max(0, Math.min(pos, draft.length));
  const next = draft.slice(0, pos) + text + draft.slice(pos);
  return { draft: next, caretPos: pos + text.length };
}

/** Высота строки/окна виртуализации. Виртуализируем только большие таблицы. */
const VIRTUALIZE_THRESHOLD = 60;
const ROW_OVERSCAN = 10;

const STICKY_INDEX_W = 32;
const ACTIONS_W = 80;
const HEADER_H = 32;
const ROW_H = 30;
const PIN_SHADOW = '1px 0 0 0 var(--border)';

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

/**
 * Анализирует зависимости формул.
 * Возвращает Map: colId → список {id, label} формульных колонок, которые его используют.
 * Используется для защиты от удаления колонок, задействованных в расчётах.
 */
function getFormulaUsages(columns: Column[]): Map<string, { id: string; label: string }[]> {
  const usages = new Map<string, { id: string; label: string }[]>();
  const colIdSet = new Set(columns.map((c) => c.id));
  const globalVars = new Set(['vatPct', 'taxRatePct']);
  for (const col of columns) {
    if (col.type !== 'formula' || !col.formula) continue;
    const tokens = col.formula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
    for (const token of tokens) {
      if (globalVars.has(token) || !colIdSet.has(token)) continue;
      if (!usages.has(token)) usages.set(token, []);
      usages.get(token)!.push({ id: col.id, label: col.label });
    }
  }
  return usages;
}

/**
 * id «встроенных» дефолтных колонок. Если такая колонка используется в формулах —
 * кнопка «Удалить» для неё полностью недоступна (onDelete=null в меню).
 * Пользовательские (не в этом множестве) колонки с зависимостями дают предупреждение,
 * но удаление возможно.
 */
const DEFAULT_COL_IDS = new Set([
  'cost', 'packaging', 'delivery', 'priceRetail', 'priceWholesale',
  'marginRetail', 'marginWholesale', 'salesPerMonth', 'stock',
  'revenueMonth', 'profitMonth',
]);

function RenderMyStoreTable({ instance, onConfigChange }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const liveValues = useAllBlockValuesFlat();
  const { settings } = useFormatSettings();
  const showKopecks = settings.showKopecks;
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [smartImportOpen, setSmartImportOpen] = useState(false);
  const [importInProgress, setImportInProgress] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  /** Controlled popover «Параметры» — открывается также по клику на чип НДС. */
  const [paramsOpen, setParamsOpen] = useState(false);
  const lastSyncRef = useRef<number>(0);
  /** Локальный transient sort state — НЕ персистится в config. */
  const [sort, setSort] = useState<SortState>(null);
  /** Колонка, ожидающая подтверждения удаления (задействована в формулах). */
  const [deleteWarnCol, setDeleteWarnCol] = useState<Column | null>(null);
  /**
   * Локальный overlay ширин на время drag-resize. Базовый источник —
   * `Column.width` из config. После mouseup overrides записываются обратно
   * в config (один batched `persist`), а локальный state очищается.
   */
  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startW: number; minW: number } | null>(null);
  // Виртуализация: ref на скролл-контейнер тела + измерения вьюпорта.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  // Excel-протяжка (task 2): { colId, sourceIdx, hoverIdx } в индексах ВИДИМОГО порядка строк.
  const [fillState, setFillState] = useState<{ colId: string; sourceIdx: number; hoverIdx: number } | null>(null);
  const fillStateRef = useRef(fillState);
  fillStateRef.current = fillState;

  // ── Excel-режим: единая сессия редактирования ─────────────────────────────
  const excelMode = config.excelMode;
  const [session, setSession] = useState<EditSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Refs на активный inline-input ячейки + на input formula bar (куда вернуть
  // focus/каретку после вставки переменной/оператора).
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const formulaBarRef = useRef<HTMLInputElement | null>(null);
  // Ref на корневую Card — smart-blur: focus ушёл ВНУТРИ блока → не коммитим.
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Восстановление каретки после programmatic-вставки (useLayoutEffect, до paint).
  const pendingCaretRef = useRef<{ target: 'inline' | 'bar'; caret: number } | null>(null);
  // Намерение клавиатурной навигации (Tab/Enter) — focus-эффект сфокусирует
  // целевую ячейку; при прямом клике namerenie=null → эффект не вмешивается.
  const navFocusRef = useRef<{ rowId: string; colId: string } | null>(null);

  // Стабильный id для DndContext — `useId()` SSR-safe, предотвращает
  // hydration mismatch на ARIA-описании (DndDescribedBy-N).
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Стабильные refs на актуальный config / onConfigChange — чтобы row-колбэки
  // не меняли идентичность на каждый рендер (нужно для React.memo строк и
  // отсутствия лишних ре-рендеров при печати в большой таблице).
  const configRef = useRef(config);
  configRef.current = config;
  const onConfigChangeRef = useRef(onConfigChange);
  onConfigChangeRef.current = onConfigChange;

  const persist = useCallback((patch: Partial<Config>) => {
    onConfigChangeRef.current?.({ ...configRef.current, ...patch } as unknown as Record<string, unknown>);
  }, []);

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

  /**
   * Зависимости формул — какие формулы ссылаются на каждую колонку.
   * Пересчитывается при изменении `config.columns`.
   */
  const formulaUsages = useMemo(() => getFormulaUsages(config.columns), [config.columns]);

  /**
   * Безопасное удаление колонки с проверкой формул:
   * - identity-колонки: недоступны (защищено снаружи через onDelete=null)
   * - встроенные (DEFAULT_COL_IDS) с зависимостями: полный запрет (onDelete=null)
   * - пользовательские с зависимостями: предупреждение перед удалением
   * - без зависимостей: удаление сразу
   */
  const handleDeleteColumn = useCallback((colId: string) => {
    const col = config.columns.find((c) => c.id === colId);
    if (!col || isIdentityCol(col)) return;
    const usages = formulaUsages.get(colId);
    if (usages && usages.length > 0) {
      if (DEFAULT_COL_IDS.has(colId)) return; // не должно сюда попадать, onDelete=null
      setDeleteWarnCol(col);
      return;
    }
    removeColumn(colId);
  }, [config.columns, formulaUsages, removeColumn]);

  /**
   * Применение результата умного импорта (XLSX / другой блок).
   * `applyImportPlan` уже посчитал новые columns/rows на клиенте — просто
   * персистим и показываем сводку. Identity-колонки и не затронутые данные
   * сохраняются (план строится поверх текущего config).
   */
  const handleSmartImport = useCallback(
    (result: ApplyResult, meta: { sourceLabel: string; sourceKind: 'xlsx' | 'block' }) => {
      persist({
        columns: result.columns as unknown as Column[],
        rows: result.rows as unknown as Row[],
      });
      const { columnsAdded, rowsAdded, rowsUpdated } = result.stats;
      setImportNotice(
        `Импорт из «${meta.sourceLabel}»: +${rowsAdded} строк` +
          (rowsUpdated > 0 ? `, обновлено ${rowsUpdated}` : '') +
          (columnsAdded > 0 ? `, +${columnsAdded} колонок` : ''),
      );
      setTimeout(() => setImportNotice(null), 4000);
    },
    [persist],
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

  // Row-колбэки читают актуальный config через configRef → стабильны (deps [persist]).
  // Это позволяет React.memo строк не сбрасываться при печати и убирает лаги.
  const updateRow = useCallback(
    (rowId: string, patch: Partial<Row>) => {
      persist({ rows: configRef.current.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) });
    },
    [persist],
  );

  const updateRowValue = useCallback(
    (rowId: string, colId: string, value: number | string) => {
      const row = configRef.current.rows.find((r) => r.id === rowId);
      if (!row) return;
      updateRow(rowId, { values: { ...row.values, [colId]: value } });
    },
    [updateRow],
  );

  const updateRowBinding = useCallback(
    (rowId: string, colId: string, binding: UnitCellBinding | undefined) => {
      const row = configRef.current.rows.find((r) => r.id === rowId);
      if (!row) return;
      const next = { ...row.bindings };
      if (binding) next[colId] = binding;
      else delete next[colId];
      updateRow(rowId, { bindings: next });
    },
    [updateRow],
  );

  const addRows = useCallback(
    (count: number) => {
      const additions = Array.from({ length: count }, () => emptyRow());
      persist({ rows: [...configRef.current.rows, ...additions] });
    },
    [persist],
  );

  const removeRow = useCallback(
    (rowId: string) => {
      persist({ rows: configRef.current.rows.filter((r) => r.id !== rowId) });
    },
    [persist],
  );

  const duplicateRow = useCallback(
    (rowId: string) => {
      const rows = configRef.current.rows;
      const idx = rows.findIndex((r) => r.id === rowId);
      if (idx < 0) return;
      const copy: Row = {
        ...rows[idx],
        id: makeId('r'),
        values: { ...rows[idx].values },
        bindings: { ...rows[idx].bindings },
      };
      const next = [...rows];
      next.splice(idx + 1, 0, copy);
      persist({ rows: next });
    },
    [persist],
  );

  const resetBindings = useCallback(
    (rowId: string) => updateRow(rowId, { bindings: {} }),
    [updateRow],
  );

  /** Открыть модалку привязки для конкретной ячейки (единая на всю таблицу). */
  const [pickerCell, setPickerCell] = useState<{ rowId: string; colId: string } | null>(null);
  // Ref на pickerCell — smart-blur читает актуальное значение, оставаясь стабильным
  // колбэком (иначе открытие пикера ре-рендерит все строки).
  const pickerCellRef = useRef(pickerCell);
  pickerCellRef.current = pickerCell;
  const openPicker = useCallback((rowId: string, colId: string) => {
    setPickerCell({ rowId, colId });
  }, []);

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
        // Пропускаем привязанные ячейки И ячейки с per-cell формулой (`=…`) —
        // массовая заливка значением не должна молча затирать ни то, ни другое.
        if (r.bindings[colId] || isCellFormulaValue(r.values[colId])) {
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

  /** Явная установка направления сортировки (для пунктов меню). */
  const setExplicitSort = useCallback((key: string, dir: 'asc' | 'desc' | null) => {
    setSort(dir === null ? null : { key, dir });
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
   * правого края единственной hardcoded sticky-колонки `#` (`STICKY_INDEX_W`).
   * Identity-колонки (article/name) и dynamic pinned идут вперемешку в
   * `pinnedColumns` — sticky только пока в начале `visibleColumns` все pinned.
   */
  const stickyOffsets = useMemo(() => {
    const map = new Map<string, number>();
    let acc = STICKY_INDEX_W;
    for (const col of visibleColumns) {
      if (!pinnedSet.has(col.id)) break;
      map.set(col.id, acc);
      acc += widthOf(col);
    }
    return map;
  }, [visibleColumns, pinnedSet, widthOf]);

  /**
   * id ПОСЛЕДНЕЙ pinned колонки (если такие есть). Только она получает
   * PIN_SHADOW справа — иначе тень предыдущей sticky-cell перекрывается
   * фоном следующей и визуально пропадает (был баг до этой переработки).
   * `null` если pinned-колонок нет.
   */
  const lastPinnedId = useMemo(() => {
    let last: string | null = null;
    for (const col of visibleColumns) {
      if (!pinnedSet.has(col.id)) break;
      last = col.id;
    }
    return last;
  }, [visibleColumns, pinnedSet]);

  /** Стабильная карта ширин видимых колонок (меняется только при resize/правке колонок). */
  const colWidths = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of visibleColumns) m[c.id] = widthOf(c);
    return m;
  }, [visibleColumns, widthOf]);

  const formulasMap = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const c of config.columns) if (c.type === 'formula') m[c.id] = c.formula;
    return m;
  }, [config.columns]);

  /**
   * Сигнатура разрешённых block_ref-привязок (`rowId:colId=value;…`). Меняется
   * ТОЛЬКО когда добавили/убрали привязку или изменилось значение источника —
   * не на каждый чужой publish стора и не на каждый keystroke. На неё завязаны
   * `boundByRow`/`computedRows`, поэтому печать в ячейке (или публикации других
   * блоков) не пересчитывают формулы всей таблицы → главный фикс лагов.
   */
  const boundSig = useMemo(() => {
    let sig = '';
    for (const row of config.rows) {
      for (const colId in row.bindings) {
        const binding = row.bindings[colId] as UnitCellBinding | undefined;
        if (binding && binding.mode === 'block_ref') {
          sig += `${row.id}:${colId}=${resolveBindingValue(binding, liveValues)};`;
        }
      }
    }
    return sig;
  }, [config.rows, liveValues]);

  /** rowId → { colId → разрешённое значение привязки }. Стабилен пока стабилен boundSig. */
  const boundByRow = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const row of configRef.current.rows) {
      let obj: Record<string, number> | undefined;
      for (const colId in row.bindings) {
        const binding = row.bindings[colId] as UnitCellBinding | undefined;
        if (binding && binding.mode === 'block_ref') {
          const v = resolveBindingValue(binding, liveValues);
          if (v !== null) (obj ??= {})[colId] = v;
        }
      }
      if (obj) m.set(row.id, obj);
    }
    return m;
    // boundSig инкапсулирует config.rows-привязки + liveValues; этого достаточно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundSig]);

  const computedRows = useMemo(() => {
    return config.rows.map((row) => ({
      row,
      values: computeRowValues(
        row,
        config.columns,
        config.global.vatPct,
        config.global.taxRatePct,
        formulasMap,
        boundByRow.get(row.id),
      ),
    }));
  }, [config.rows, config.columns, config.global.vatPct, config.global.taxRatePct, formulasMap, boundByRow]);

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

  // ── Виртуализация строк (только для больших таблиц) + drag-fill ──────────
  const sortedRowsRef = useRef(sortedComputedRows);
  sortedRowsRef.current = sortedComputedRows;

  // Измерение высоты вьюпорта тела (ResizeObserver) + слежение за скроллом.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setViewport((v) =>
        v.scrollTop === el.scrollTop && v.height === el.clientHeight
          ? v
          : { scrollTop: el.scrollTop, height: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setViewport((v) =>
      v.scrollTop === el.scrollTop && v.height === el.clientHeight
        ? v
        : { scrollTop: el.scrollTop, height: el.clientHeight },
    );
  }, []);

  const totalRows = sortedComputedRows.length;
  const virtualize = totalRows > VIRTUALIZE_THRESHOLD;
  const { startIdx, endIdx } = useMemo(() => {
    if (!virtualize || viewport.height === 0) return { startIdx: 0, endIdx: totalRows };
    // Шапка (HEADER_H) sticky сверху скролл-контейнера → вычитаем из scrollTop.
    const first = Math.max(0, Math.floor((viewport.scrollTop - HEADER_H) / ROW_H) - ROW_OVERSCAN);
    const count = Math.ceil(viewport.height / ROW_H) + ROW_OVERSCAN * 2;
    return { startIdx: first, endIdx: Math.min(totalRows, first + count) };
  }, [virtualize, viewport.scrollTop, viewport.height, totalRows]);
  const topSpacer = startIdx * ROW_H;
  const bottomSpacer = Math.max(0, (totalRows - endIdx) * ROW_H);
  const windowRows = virtualize ? sortedComputedRows.slice(startIdx, endIdx) : sortedComputedRows;

  // Excel-протяжка: копирование значения/привязки исходной ячейки вниз/вверх
  // по колонке (видимый порядок). Формульные/identity-колонки — без хэндла.
  const applyFill = useCallback(
    (fs: { colId: string; sourceIdx: number; hoverIdx: number }) => {
      const rows = sortedRowsRef.current;
      const src = rows[fs.sourceIdx];
      if (!src) return;
      const lo = Math.min(fs.sourceIdx, fs.hoverIdx);
      const hi = Math.max(fs.sourceIdx, fs.hoverIdx);
      if (lo === hi) return;
      const targetIds = new Set<string>();
      for (let i = lo; i <= hi; i++) {
        if (i === fs.sourceIdx) continue;
        const r = rows[i]?.row;
        if (r) targetIds.add(r.id);
      }
      if (targetIds.size === 0) return;
      const srcValue = src.row.values[fs.colId];
      const srcBinding = src.row.bindings[fs.colId];
      const nextRows = configRef.current.rows.map((r) => {
        if (!targetIds.has(r.id)) return r;
        const values = { ...r.values };
        const bindings = { ...r.bindings };
        if (srcBinding) {
          // Привязка — абсолютная ссылка на блок, копируется как есть.
          bindings[fs.colId] = srcBinding;
        } else {
          delete bindings[fs.colId];
          if (srcValue === undefined || srcValue === '') delete values[fs.colId];
          else values[fs.colId] = srcValue;
        }
        return { ...r, values, bindings };
      });
      persist({ rows: nextRows });
    },
    [persist],
  );

  /**
   * Старт протяжки. Document-level listeners (не pointer-capture на хэндле):
   * source-строка может уйти из окна виртуализации при авто-скролле, а хэндл
   * размонтироваться — глобальные слушатели это переживают.
   */
  const startFill = useCallback(
    (sourceIdx: number, colId: string, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const initial = { colId, sourceIdx, hoverIdx: sourceIdx };
      fillStateRef.current = initial;
      setFillState(initial);

      const onMove = (ev: PointerEvent) => {
        const fs = fillStateRef.current;
        if (!fs) return;
        // Авто-скролл у кромок — тянуть за пределы вьюпорта.
        const sc = scrollRef.current;
        if (sc) {
          const r = sc.getBoundingClientRect();
          if (ev.clientY < r.top + HEADER_H + 24) sc.scrollTop -= 14;
          else if (ev.clientY > r.bottom - 24) sc.scrollTop += 14;
        }
        let el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        while (el && !el.hasAttribute('data-fill-row') && el !== scrollRef.current) el = el.parentElement;
        if (!el || !el.hasAttribute('data-fill-row')) return;
        const idx = Number.parseInt(el.getAttribute('data-fill-row') || '', 10);
        if (!Number.isFinite(idx) || idx === fs.hoverIdx) return;
        const next = { ...fs, hoverIdx: idx };
        fillStateRef.current = next;
        setFillState(next);
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const fs = fillStateRef.current;
        if (fs) applyFill(fs);
        fillStateRef.current = null;
        setFillState(null);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [applyFill],
  );

  const fillColId = fillState?.colId ?? null;
  const fillFrom = fillState?.sourceIdx ?? null;
  const fillTo = fillState?.hoverIdx ?? null;

  // ── Excel-режим: контроллер сессии редактирования ─────────────────────────
  // id видимых колонок для навигации Tab/Enter — ВСЕ (включая формульные:
  // per-cell override) и identity (артикул/название).
  const editableColIds = useMemo(() => visibleColumns.map((c) => c.id), [visibleColumns]);
  const editableColsRef = useRef<string[]>(editableColIds);
  editableColsRef.current = editableColIds;

  /** Записать draft активной ячейки в config (без setState). */
  const writeSession = useCallback(
    (s: EditSession) => {
      const rows = configRef.current.rows;
      const row = rows.find((r) => r.id === s.rowId);
      const col = configRef.current.columns.find((c) => c.id === s.columnId);
      if (!row || !col) return;
      if (col.type === 'identity') {
        const patch =
          col.id === IDENTITY_ARTICLE_ID ? { article: s.draft } : { name: s.draft };
        persist({ rows: rows.map((r) => (r.id === s.rowId ? { ...r, ...patch } : r)) });
        return;
      }
      const trimmed = s.draft.trim();

      // Формульная КОЛОНКА: правка ячейки создаёт per-cell override (только эта
      // строка). Привязок у формульных колонок нет (не трогаем bindings).
      if (col.type === 'formula') {
        const nextValues = { ...row.values };
        const colFormula = (col.formula ?? '').trim();
        if (!trimmed || trimmed === '=' || trimmed === colFormula) {
          // Пусто / совпало с column-formula → убираем override (вернётся колоночная).
          delete nextValues[col.id];
        } else if (trimmed.startsWith('=')) {
          nextValues[col.id] = trimmed; // per-cell формула-override
        } else {
          nextValues[col.id] = parseCellInput(trimmed); // жёсткий литерал-override
        }
        persist({
          rows: rows.map((r) => (r.id === s.rowId ? { ...r, values: nextValues } : r)),
        });
        return;
      }

      const nextValues = { ...row.values };
      const nextBindings = { ...row.bindings };
      // Любой ручной ввод значения/формулы снимает привязку этой ячейки.
      delete nextBindings[col.id];
      if (!trimmed || trimmed === '=') {
        delete nextValues[col.id];
      } else if (trimmed.startsWith('=')) {
        nextValues[col.id] = trimmed; // per-cell формула (строка с `=`)
      } else if (col.type === 'text') {
        nextValues[col.id] = trimmed;
      } else {
        nextValues[col.id] = parseCellInput(trimmed);
      }
      persist({
        rows: rows.map((r) =>
          r.id === s.rowId ? { ...r, values: nextValues, bindings: nextBindings } : r,
        ),
      });
    },
    [persist],
  );

  /** Commit активной сессии (пишет, только если был ввод) + закрыть редактор. */
  const commitSession = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.dirty) writeSession(s);
    setSession(null);
  }, [writeSession]);

  const cancelEdit = useCallback(() => setSession(null), []);

  /** Активировать ячейку: закоммитить предыдущую и открыть новую сессию. */
  const activateCell = useCallback(
    (rowId: string, colId: string) => {
      const prev = sessionRef.current;
      if (prev && prev.dirty && (prev.rowId !== rowId || prev.columnId !== colId)) {
        writeSession(prev);
      }
      const row = configRef.current.rows.find((r) => r.id === rowId);
      const col = configRef.current.columns.find((c) => c.id === colId);
      if (!row || !col) {
        setSession(null);
        return;
      }
      setSession({
        rowId,
        columnId: colId,
        draft: draftForCell(row, col),
        caretPos: null,
        lastFocused: 'inline',
        dirty: false,
      });
    },
    [writeSession],
  );

  /**
   * Smart-blur: коммитим, ТОЛЬКО если focus уходит из блока полностью. Если
   * остаётся внутри (formula bar, operator toolbar, другая ячейка, picker) —
   * сессию сохраняем. Picker — Radix-портал вне cardRef → отдельная проверка.
   */
  const handleInputBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      if (pickerCellRef.current) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related && cardRef.current?.contains(related)) return;
      commitSession();
    },
    [commitSession],
  );

  /** Вставка текста в draft с восстановлением каретки после commit (useLayoutEffect). */
  const insertIntoDraftWithSession = useCallback((text: string, forceFormula = false) => {
    setSession((prev) => {
      if (!prev) return prev;
      const target = prev.lastFocused;
      const input = target === 'bar' ? formulaBarRef.current : inlineInputRef.current;
      const domCaret = input?.selectionStart;
      const caretPos =
        typeof domCaret === 'number' ? domCaret : prev.caretPos ?? prev.draft.length;
      const result = insertIntoDraft({ draft: prev.draft, caretPos }, text, forceFormula);
      pendingCaretRef.current = { target, caret: result.caretPos };
      return { ...prev, draft: result.draft, caretPos: result.caretPos, dirty: true };
    });
  }, []);

  const insertToken = useCallback(
    (token: string) => insertIntoDraftWithSession(token, true),
    [insertIntoDraftWithSession],
  );

  /** Открыть picker привязки для активной ячейки. */
  const openBindingPickerForActive = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    setPickerCell({ rowId: s.rowId, colId: s.columnId });
  }, []);

  /** Очистить активную ячейку (значение + привязка). */
  const clearActiveCell = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    writeSession({ ...s, draft: '', dirty: true });
    setSession(null);
  }, [writeSession]);

  /** Снять привязку активной ячейки, не закрывая редактор. */
  const unlinkActiveCell = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const rows = configRef.current.rows;
    const row = rows.find((r) => r.id === s.rowId);
    if (!row) return;
    const nextBindings = { ...row.bindings };
    delete nextBindings[s.columnId];
    persist({ rows: rows.map((r) => (r.id === s.rowId ? { ...r, bindings: nextBindings } : r)) });
  }, [persist]);

  /** Навигация Tab/Enter: commit + перейти на ячейку по видимому порядку. */
  const moveActive = useCallback(
    (dRow: number, dCol: number) => {
      const s = sessionRef.current;
      if (!s) return;
      if (s.dirty) writeSession(s);
      const rows = sortedRowsRef.current;
      const cols = editableColsRef.current;
      const rIdx = rows.findIndex((e) => e.row.id === s.rowId);
      const cIdx = cols.indexOf(s.columnId);
      if (rIdx < 0 || cIdx < 0) return;
      let rNext = rIdx;
      let cNext = cIdx;
      if (dCol !== 0) {
        cNext = cIdx + dCol;
        if (cNext >= cols.length) {
          cNext = 0;
          rNext = Math.min(rows.length - 1, rIdx + 1);
        } else if (cNext < 0) {
          cNext = cols.length - 1;
          rNext = Math.max(0, rIdx - 1);
        }
      }
      if (dRow !== 0) rNext = Math.max(0, Math.min(rows.length - 1, rIdx + dRow));
      const targetRow = rows[rNext];
      const targetColId = cols[cNext];
      if (!targetRow || !targetColId) return;
      navFocusRef.current = { rowId: targetRow.row.id, colId: targetColId };
      activateCell(targetRow.row.id, targetColId);
    },
    [writeSession, activateCell],
  );

  /** Общий keydown для inline-input и formula bar. */
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        moveActive(e.shiftKey ? -1 : 1, 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        moveActive(0, e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    },
    [moveActive, cancelEdit],
  );

  const toggleExcelMode = useCallback(() => {
    const next = !configRef.current.excelMode;
    if (!next) {
      const s = sessionRef.current;
      if (s?.dirty) writeSession(s);
      setSession(null);
    }
    persist({ excelMode: next });
  }, [persist, writeSession]);

  // Стабильные row-колбэки активации/ввода (для React.memo строк).
  const handleCellDraftChange = useCallback((draft: string, caret: number | null) => {
    setSession((prev) =>
      prev ? { ...prev, draft, caretPos: caret, lastFocused: 'inline', dirty: true } : prev,
    );
  }, []);
  const handleCellInlineFocus = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, lastFocused: 'inline' } : prev));
  }, []);

  // Восстановление каретки СИНХРОННО после programmatic-вставки (до paint).
  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    pendingCaretRef.current = null;
    const input = pending.target === 'bar' ? formulaBarRef.current : inlineInputRef.current;
    if (!input) return;
    if (typeof document !== 'undefined' && document.activeElement !== input) input.focus();
    try {
      input.setSelectionRange(pending.caret, pending.caret);
    } catch {
      // ignore
    }
  });

  // Фокус на целевую ячейку после клавиатурной навигации (+ scroll-into-view
  // для виртуализированных таблиц). Прямой клик не ставит navFocusRef → пропуск.
  useEffect(() => {
    const target = navFocusRef.current;
    if (!target) return;
    navFocusRef.current = null;
    const sc = scrollRef.current;
    const idx = sortedRowsRef.current.findIndex((e) => e.row.id === target.rowId);
    if (sc && idx >= 0) {
      const top = HEADER_H + idx * ROW_H;
      const bottom = top + ROW_H;
      if (top - HEADER_H < sc.scrollTop) sc.scrollTop = Math.max(0, top - HEADER_H);
      else if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight;
    }
    let raf = 0;
    let tries = 0;
    const tryFocus = () => {
      const el = sc?.querySelector(
        `[data-cell-input="${target.rowId}|${target.colId}"]`,
      ) as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select?.();
        return;
      }
      if (tries++ < 6) raf = requestAnimationFrame(tryFocus);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [session?.rowId, session?.columnId]);

  // Флаш недокоммиченной сессии при размонтировании блока.
  useEffect(
    () => () => {
      const s = sessionRef.current;
      if (s?.dirty) writeSession(s);
    },
    [writeSession],
  );

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

      for (const col of visibleColumns) {
        const key = `r_${slug}_${col.id}`;
        // Identity-колонки: значение приходит напрямую из row.article/row.name,
        // а не из computedRows.values (там их нет). Раньше публиковались
        // отдельной веткой ДО цикла — теперь через единый проход.
        if (col.type === 'identity') {
          out[key] = col.id === IDENTITY_ARTICLE_ID ? row.article || '' : row.name || '';
          labelFields.push(`${key}=${rowLabel} · ${col.label}`);
          continue;
        }
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
    STICKY_INDEX_W + visibleColumns.reduce((acc, c) => acc + widthOf(c), 0) + ACTIONS_W;

  // ── Formula bar: данные активной ячейки (Excel-режим) ─────────────────────
  const activeColumn = session ? config.columns.find((c) => c.id === session.columnId) ?? null : null;
  const activeRowEntry = session ? computedRows.find((e) => e.row.id === session.rowId) ?? null : null;
  const activeIsFormula = session ? isFormulaDraft(session.draft) : false;
  const activeIsIdentity = activeColumn?.type === 'identity';
  // Привязка к блоку доступна только для НЕ-identity и НЕ-формульных колонок.
  const activeAllowsBinding =
    !!activeColumn && activeColumn.type !== 'identity' && activeColumn.type !== 'formula';
  const activeIsLinked =
    session && activeRowEntry
      ? isBindingActive(activeRowEntry.row.bindings[session.columnId] as UnitCellBinding | undefined)
      : false;
  // Адрес ячейки для бара: «<артикул|название|#N> · <колонка>».
  const activeAddr = (() => {
    if (!session || !activeColumn || !activeRowEntry) return '';
    const row = activeRowEntry.row;
    const ord = sortedComputedRows.findIndex((e) => e.row.id === session.rowId);
    const rowLabel = row.article || row.name || (ord >= 0 ? `#${ord + 1}` : '#');
    return `${rowLabel} · ${activeColumn.label}`;
  })();
  // Живой предпросмотр результата draft (без коммита) — для «точечной» работы.
  const activePreview: { value: number | string; error: boolean } | null = (() => {
    if (!session || !activeColumn || activeIsIdentity) return null;
    const draft = session.draft.trim();
    if (!draft || draft === '=') return null;
    if (!draft.startsWith('=')) {
      return activeColumn.type === 'text'
        ? { value: draft, error: false }
        : { value: parseCellInput(draft), error: false };
    }
    const scope: Record<string, number | string> = { ...(activeRowEntry?.values ?? {}) };
    delete scope[session.columnId]; // избегаем мнимого self-ref в предпросмотре
    scope.vatPct = config.global.vatPct;
    scope.taxRatePct = config.global.taxRatePct;
    const res = evalSingleFormula(draft, scope);
    return typeof res === 'number'
      ? { value: res, error: false }
      : { value: res, error: true };
  })();
  // Переменные для подсказок formula bar: id колонок (кроме identity) + глобальные.
  const formulaVars = useMemo(() => {
    const vars = config.columns
      .filter((c) => c.type !== 'identity')
      .map((c) => ({ id: c.id, label: c.label }));
    vars.push({ id: 'vatPct', label: 'НДС %' }, { id: 'taxRatePct', label: 'Налог %' });
    return vars;
  }, [config.columns]);

  return (
    <Card ref={cardRef} className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={config.title}
            onChange={(e) => persist({ title: e.target.value })}
            className="h-7 w-44 min-w-0 border-0 bg-transparent px-0 text-sm font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          {/* Тихий чип импорта: transient-уведомление, иначе дата последнего импорта. */}
          {importNotice ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Check className="h-3 w-3" /> {importNotice}
            </span>
          ) : config.importSource?.lastImportedAt ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="Импорт из Ozon Аналитики"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/50 bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  {formatRelativeTime(config.importSource.lastImportedAt)}
                  {config.importSource.syncOnMount && (
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-60 space-y-2 p-3 text-[12px]">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Импорт из Ozon Аналитики
                </div>
                <div className="text-muted-foreground">
                  {new Date(config.importSource.lastImportedAt).toLocaleString('ru-RU')}
                </div>
                {config.importSource.syncOnMount && (
                  <div className="text-[11px] text-sky-600 dark:text-sky-400">
                    Авто-синхронизация включена
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => persist({ importSource: undefined })}
                  className="text-[11px] text-muted-foreground hover:text-red-500"
                >
                  Отключить
                </button>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={excelMode ? 'default' : 'outline'}
            size="sm"
            onClick={toggleExcelMode}
            title={
              excelMode
                ? 'Excel-режим включён: кликните ячейку и введите значение или = для формулы. Выключить.'
                : 'Excel-режим: точечное редактирование значений и формул в любой ячейке (как в блоках «Данные» / «Эксель ячейка»)'
            }
            aria-pressed={excelMode}
          >
            <Table2 /> Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSmartImportOpen(true)}
            disabled={importInProgress}
            title="Умный импорт: XLSX-файл, другая таблица или Ozon Аналитика"
          >
            <Download /> Импорт
          </Button>
          <Button variant="outline" size="sm" onClick={() => addColumn()}>
            <Plus /> Колонка
          </Button>
          <Popover open={paramsOpen} onOpenChange={setParamsOpen}>
            <div className="flex items-center gap-1">
              {config.global.vatPct > 0 && (
                <button
                  type="button"
                  onClick={() => setParamsOpen(true)}
                  title="Параметры: НДС / налог"
                  className="inline-flex items-center rounded border border-border/50 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  НДС {config.global.vatPct}%
                </button>
              )}
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Параметры таблицы">
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </div>
            <PopoverContent align="end" className="w-60 space-y-3 p-3 text-[12px]">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Параметры
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">НДС, %</span>
                <input
                  type="number"
                  value={config.global.vatPct}
                  step={1}
                  onChange={(e) => updateGlobal('vatPct', Number(e.target.value))}
                  className="h-7 w-20 rounded border border-border/60 bg-background px-1 text-right tabular-nums"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Налог, %</span>
                <input
                  type="number"
                  value={config.global.taxRatePct}
                  step={1}
                  onChange={(e) => updateGlobal('taxRatePct', Number(e.target.value))}
                  className="h-7 w-20 rounded border border-border/60 bg-background px-1 text-right tabular-nums"
                />
              </div>
              <div className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                Колонок: {config.columns.length} ({config.columns.filter((c) => c.hidden).length} скрыто)
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Import notice + live-sync indicator перенесены в шапку (тихий чип). */}

      {/* Formula bar (Excel-режим) — единый input активной ячейки + operator/
          variable toolbar; зеркалит UX блока «Данные». Вне excelMode не виден. */}
      {excelMode && (
        <div className="flex shrink-0 flex-col gap-1 border-b border-border/60 bg-muted/30 px-3 py-1.5">
          {session && activeColumn ? (
            <>
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-5 shrink-0 items-center rounded bg-background px-1.5 font-mono text-[10px] font-semibold text-muted-foreground ring-1 ring-border/60"
                  title={activeAddr}
                >
                  <span className="max-w-[180px] truncate">{activeAddr}</span>
                </span>
                {activeIsIdentity ? (
                  <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">Aa</span>
                ) : (
                  <FunctionSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
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
                            dirty: true,
                          }
                        : prev,
                    )
                  }
                  onSelect={(e) =>
                    setSession((prev) =>
                      prev
                        ? { ...prev, caretPos: (e.target as HTMLInputElement).selectionStart }
                        : prev,
                    )
                  }
                  onKeyDown={handleInputKeyDown}
                  onBlur={handleInputBlur}
                  placeholder={
                    activeIsIdentity
                      ? 'Текст'
                      : activeIsFormula
                        ? 'Формула: id колонок, vatPct, taxRatePct'
                        : 'Значение, или начните с = для формулы'
                  }
                  className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[11px] outline-none focus:ring-0"
                />
                {activePreview && (
                  <span
                    className={cn(
                      'inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-mono text-[10px] font-semibold',
                      activePreview.error
                        ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                        : 'bg-background text-muted-foreground ring-1 ring-border/60',
                    )}
                    title="Предпросмотр результата"
                  >
                    {!activePreview.error && <span className="text-muted-foreground/60">=</span>}
                    {typeof activePreview.value === 'number'
                      ? formatNumber(activePreview.value, activeColumn, showKopecks)
                      : String(activePreview.value)}
                  </span>
                )}
                {activeIsFormula && !activeIsIdentity && (
                  <span className="inline-flex h-5 shrink-0 items-center rounded bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    fx
                  </span>
                )}
                {activeIsLinked && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={unlinkActiveCell}
                    className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-accent"
                    title="Отвязать ячейку от источника"
                  >
                    <Unlink className="h-2.5 w-2.5" /> отвязать
                  </button>
                )}
                {activeAllowsBinding && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={openBindingPickerForActive}
                    className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300"
                    title="Привязать ячейку к источнику (другой блок)"
                  >
                    <Link2 className="h-2.5 w-2.5" /> привязать
                  </button>
                )}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearActiveCell}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-red-500"
                  title="Очистить ячейку"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commitSession}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  title="Готово (Enter)"
                  aria-label="Сохранить и закрыть редактор"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {/* Operator + variable toolbar — только в режиме формулы для не-identity. */}
              {activeIsFormula && !activeIsIdentity && (
                <div className="flex items-center gap-1 overflow-x-auto">
                  <span className="shrink-0 text-[10px] text-muted-foreground">Вставить:</span>
                  {['+', '-', '*', '/', '(', ')'].map((op) => (
                    <button
                      key={op}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertToken(op)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-background font-mono text-[11px] ring-1 ring-border/60 transition hover:bg-accent"
                      title={`Вставить «${op}»`}
                    >
                      {op}
                    </button>
                  ))}
                  <div className="mx-0.5 h-3 w-px shrink-0 bg-border/50" />
                  {formulaVars.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertToken(v.id)}
                      className="flex h-5 shrink-0 items-center rounded bg-sky-50 px-1.5 text-[10px] font-medium text-sky-700 transition hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:hover:bg-sky-900"
                      title={`Вставить переменную «${v.id}»`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Table2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                Excel-режим. Кликните любую ячейку и введите значение или{' '}
                <code className="rounded bg-background px-1 ring-1 ring-border/50">=</code> для
                формулы (id колонок, <code className="rounded bg-background px-1 ring-1 ring-border/50">vatPct</code>,{' '}
                <code className="rounded bg-background px-1 ring-1 ring-border/50">taxRatePct</code>). Enter/Tab — переход,
                Esc — отмена.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div ref={scrollRef} onScroll={onBodyScroll} className="flex-1 overflow-auto">
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
                Единственная hardcoded sticky-cell — `#` (счётчик строки), без
                меню. Identity (Артикул, Название) и dynamic-колонки идут через
                единый цикл visibleColumns с DnD-контекстом. Pinned-колонки
                имеют disabled={true} в useSortable → не двигаются, но не
                ломают drop-зоны для unpinned. */}
            <div className="sticky top-0 z-40 flex border-b border-border/70 bg-card">
              <HeaderCell
                width={STICKY_INDEX_W}
                sticky
                stickyLeft={0}
                className="text-center font-semibold text-muted-foreground"
              >
                #
              </HeaderCell>
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
                    const isLastPinned = isPinned && col.id === lastPinnedId;
                    // Встроенные колонки, задействованные в формулах — без удаления.
                    // Пользовательские с зависимостями — с предупреждением (через handleDeleteColumn).
                    const colUsages = formulaUsages.get(col.id) ?? [];
                    const canDelete =
                      !isIdentityCol(col) &&
                      !(DEFAULT_COL_IDS.has(col.id) && colUsages.length > 0);
                    const colSortState = sort?.key === col.id ? sort.dir : null;
                    return (
                      <MyStoreSortableHeaderCell
                        key={col.id}
                        col={col}
                        width={w}
                        draggable={!isPinned}
                        stickyLeft={stickyLeft}
                        isLastPinned={isLastPinned}
                        isPinned={isPinned}
                        sortState={colSortState}
                        onSort={() => toggleSort(col.id)}
                        onSetSort={(dir) => setExplicitSort(col.id, dir)}
                        onResizeStart={(e) => handleResizeStart(e, col.id)}
                        onOpenSettings={() => setEditingCol(col.id)}
                        onTogglePin={() => togglePin(col.id)}
                        onToggleHidden={() =>
                          updateColumn(col.id, { hidden: !col.hidden })
                        }
                        onDelete={canDelete ? () => handleDeleteColumn(col.id) : null}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
              <HeaderCell width={ACTIONS_W} className="text-center font-semibold text-muted-foreground">
                Действия
              </HeaderCell>
            </div>

            {/* Виртуализация: спейсер сверху + окно строк + спейсер снизу.
                Для таблиц ≤ VIRTUALIZE_THRESHOLD спейсеры = 0 и рендерятся все строки. */}
            {topSpacer > 0 && <div aria-hidden style={{ height: topSpacer }} />}
            {windowRows.map(({ row }, i) => (
              <MyStoreRow
                key={row.id}
                row={row}
                rowIdx={startIdx + i}
                columns={visibleColumns}
                vatPct={config.global.vatPct}
                taxRatePct={config.global.taxRatePct}
                formulasMap={formulasMap}
                boundForRow={boundByRow.get(row.id)}
                widths={colWidths}
                stickyOffsets={stickyOffsets}
                lastPinnedId={lastPinnedId}
                showKopecks={showKopecks}
                onUpdateRow={updateRow}
                onUpdateRowValue={updateRowValue}
                onRemoveRow={removeRow}
                onDuplicateRow={duplicateRow}
                onResetBindings={resetBindings}
                onOpenPicker={openPicker}
                onFillStart={startFill}
                fillActive={fillState !== null}
                fillColId={fillColId}
                fillFrom={fillFrom}
                fillTo={fillTo}
                excelMode={excelMode}
                activeColId={session?.rowId === row.id ? session.columnId : null}
                sessionDraft={session?.rowId === row.id ? session.draft : null}
                inlineInputRef={inlineInputRef}
                onCellActivate={activateCell}
                onCellDraftChange={handleCellDraftChange}
                onCellInlineFocus={handleCellInlineFocus}
                onCellKeyDown={handleInputKeyDown}
                onCellBlur={handleInputBlur}
              />
            ))}
            {bottomSpacer > 0 && <div aria-hidden style={{ height: bottomSpacer }} />}

            {/* Totals row.
                Лейбл «Итого по N товарам» рендерится в первой видимой identity-
                колонке (если есть) — обычно это Артикул или Название. Если
                identity-колонок нет (пользователь скрыл обе), лейбл уходит в
                ячейку `#`. Остальные identity-cells в totals — пустые. */}
            {(() => {
              const firstIdentity = visibleColumns.find((c) => c.type === 'identity');
              const totalsLabel = `Итого по ${totals.rowsCount} товарам`;
              return (
                <div className="sticky bottom-0 z-[35] flex border-t border-border/70 bg-card text-[11px] font-semibold">
                  <BodyCell
                    width={STICKY_INDEX_W}
                    sticky
                    stickyLeft={0}
                    zIndex={36}
                    className="justify-center text-center text-muted-foreground tabular-nums"
                  >
                    {firstIdentity ? totals.rowsCount : ''}
                  </BodyCell>
                  {visibleColumns.map((col) => {
                    const w = widthOf(col);
                    const stickyLeft = stickyOffsets.get(col.id);
                    const isPinned = stickyLeft !== undefined;
                    const isLastPinned = isPinned && col.id === lastPinnedId;
                    const stickyProps = isPinned
                      ? { sticky: true, stickyLeft, stickyEdge: isLastPinned, zIndex: 36 }
                      : {};
                    if (col.type === 'identity') {
                      if (col.id === firstIdentity?.id) {
                        return (
                          <BodyCell key={col.id} width={w} {...stickyProps} className="justify-end px-3 text-muted-foreground">
                            {totalsLabel}
                          </BodyCell>
                        );
                      }
                      return <BodyCell key={col.id} width={w} {...stickyProps} className="px-1.5" />;
                    }
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
              );
            })()}
          </div>
        )}
      </div>

      {/*
        Нижняя панель действий. Левый отступ `pl-[76px]` зарезервирован под
        плавающие круглые кнопки блока (ИИ + Настройки из BlockChrome, которые
        рендерятся в `bottom-1 left-1`) — раньше они перекрывали sticky-футер
        «Итого». Теперь они ложатся в пустую левую зону панели.
      */}
      <div className="flex items-center gap-1.5 border-t border-border/60 bg-muted/20 py-1.5 pl-[76px] pr-3 text-[11px]">
        <span className="mr-0.5 text-muted-foreground">Добавить:</span>
        <Button variant="outline" size="sm" className="h-6 px-2" onClick={() => addRows(1)}>
          <Plus /> 1
        </Button>
        <Button variant="outline" size="sm" className="h-6 px-2" onClick={() => addRows(5)}>
          <Plus /> 5
        </Button>
        <Button variant="outline" size="sm" className="h-6 px-2" onClick={() => addRows(10)}>
          <Plus /> 10
        </Button>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {totals.rowsCount} строк · {visibleColumns.length} колонок
        </span>
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

      {/* Предупреждение при удалении колонки с формульными зависимостями */}
      {deleteWarnCol && (
        <Dialog open onOpenChange={(o) => !o && setDeleteWarnCol(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Удалить колонку «{deleteWarnCol.label}»?</DialogTitle>
              <DialogDescription>
                Эта колонка используется в формулах. Удаление нарушит расчёты:
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1 pl-1 text-sm">
              {(formulaUsages.get(deleteWarnCol.id) ?? []).map((u) => (
                <li key={u.id} className="text-amber-700 dark:text-amber-300">
                  •{' '}
                  <strong>{u.label}</strong>{' '}
                  <code className="text-[11px] text-muted-foreground">({u.id})</code>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDeleteWarnCol(null)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  removeColumn(deleteWarnCol.id);
                  setDeleteWarnCol(null);
                }}
              >
                Удалить всё равно
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <SmartImportDialog
        open={smartImportOpen}
        onClose={() => setSmartImportOpen(false)}
        existingColumns={config.columns as unknown as TargetColumn[]}
        existingRows={config.rows as unknown as TargetRow[]}
        makeId={makeId}
        onApply={handleSmartImport}
        onOpenOzon={() => setImportDialogOpen(true)}
      />

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

      {/* Единая модалка привязки ячейки (lifted из ячеек ради перформанса —
          ячейки больше не подписываются на стор сами). */}
      {pickerCell &&
        (() => {
          const row = config.rows.find((r) => r.id === pickerCell.rowId);
          const col = config.columns.find((c) => c.id === pickerCell.colId);
          if (!row || !col) return null;
          const binding = row.bindings[col.id] as UnitCellBinding | undefined;
          return (
            <UnitCellBindingDialog
              open
              onOpenChange={(o) => {
                if (!o) setPickerCell(null);
              }}
              selfBlockId={instance.id}
              fieldLabel={col.label}
              binding={binding}
              money={isMoneyCol(col)}
              currentManualValue={Number(row.values[col.id] ?? 0)}
              onSave={(b) => {
                updateRowBinding(row.id, col.id, b);
                setPickerCell(null);
                // Закрываем активную Excel-сессию этой ячейки: значение теперь
                // определяется привязкой, а не draft'ом (иначе commit мог бы
                // перетереть свежую привязку пустым/старым черновиком).
                setSession((prev) =>
                  prev && prev.rowId === row.id && prev.columnId === col.id ? null : prev,
                );
              }}
            />
          );
        })()}
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

/** Excel-хэндл протяжки в правом-нижнем углу ячейки. Pointer-capture стартует в startFill. */
function FillHandle({
  onPointerDown,
  active,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  active: boolean;
}) {
  return (
    <span
      data-fill-handle
      onPointerDown={onPointerDown}
      title="Протянуть значение вниз/вверх по колонке"
      className={cn(
        'absolute bottom-[1px] right-[1px] z-20 h-2 w-2 cursor-crosshair rounded-[1px] bg-primary ring-1 ring-background transition-opacity',
        active ? 'opacity-100' : 'opacity-0 group-hover/cell:opacity-100',
      )}
    />
  );
}

/**
 * Лёгкая числовая ячейка «Моего магазина». В ОТЛИЧИЕ от LinkableNumberCell
 * НЕ подписывается на стор (значение/формат приходят пропсами от родителя —
 * один подписчик на блок) и держит ЛОКАЛЬНЫЙ draft при редактировании: печать
 * не дёргает persist/ре-рендер таблицы, commit — на blur/Enter. Это и есть
 * главный фикс лагов ввода на больших таблицах.
 */
function MyStoreNumberCell({
  manualValue,
  isLinked,
  resolvedValue,
  money,
  showKopecks,
  fieldLabel,
  unit,
  bindingLabel,
  onCommit,
  onOpenPicker,
}: {
  manualValue: number;
  isLinked: boolean;
  resolvedValue: number | null | undefined;
  money: boolean;
  showKopecks: boolean;
  fieldLabel: string;
  unit?: string;
  bindingLabel?: string;
  onCommit: (v: number) => void;
  onOpenPicker: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  draftRef.current = draft;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  // Флаш недокоммиченного draft при размонтировании (напр. строка ушла из окна
  // виртуализации во время редактирования) — чтобы не потерять ввод.
  useEffect(
    () => () => {
      if (draftRef.current !== null) onCommitRef.current(parseCellInput(draftRef.current));
    },
    [],
  );

  const linkUnavailable = isLinked && (resolvedValue === null || resolvedValue === undefined);
  const display = isLinked
    ? linkUnavailable
      ? '—'
      : formatCellValue(resolvedValue as number, money, showKopecks)
    : formatCellValue(manualValue, money, showKopecks);

  return (
    <div
      className={cn(
        'group/cellnum relative flex h-full items-stretch overflow-hidden rounded border border-transparent text-[12px] transition-colors',
        isLinked ? 'bg-amber-50/60 dark:bg-amber-950/30' : 'bg-transparent',
        'focus-within:border-primary/60 hover:border-border/70',
      )}
      title={
        isLinked
          ? `Привязано: ${bindingLabel ?? 'блок'}${linkUnavailable ? ' (источник недоступен)' : ''}`
          : `Введите ${fieldLabel}${unit ? ', ' + unit : ''}`
      }
    >
      <input
        type="text"
        inputMode={isLinked ? undefined : 'decimal'}
        readOnly={isLinked}
        tabIndex={isLinked ? -1 : 0}
        value={draft !== null ? draft : display}
        onClick={isLinked ? onOpenPicker : undefined}
        onFocus={isLinked ? undefined : () => setDraft(String(manualValue))}
        onChange={isLinked ? undefined : (e) => setDraft(e.target.value)}
        onBlur={
          isLinked
            ? undefined
            : () => {
                if (draftRef.current !== null) onCommit(parseCellInput(draftRef.current));
                setDraft(null);
              }
        }
        onKeyDown={
          isLinked
            ? undefined
            : (e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                else if (e.key === 'Escape') {
                  setDraft(null);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }
        }
        className={cn(
          'h-full flex-1 min-w-0 border-0 bg-transparent px-1.5 text-right tabular-nums outline-none placeholder:text-muted-foreground/60',
          isLinked && 'cursor-pointer select-none',
          linkUnavailable && 'text-amber-700 dark:text-amber-400',
        )}
      />
      <button
        type="button"
        onClick={onOpenPicker}
        title={isLinked ? 'Изменить или отменить привязку' : 'Привязать к блоку'}
        className={cn(
          'flex h-full w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-primary',
          isLinked ? 'opacity-100 text-amber-600 dark:text-amber-400' : 'opacity-0 group-hover/cellnum:opacity-100',
        )}
      >
        {isLinked ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
      </button>
    </div>
  );
}

/**
 * Ячейка Excel-режима (sheet-style). Когда активна — controlled `<input>`,
 * привязанный к общему `draft` сессии (родитель). Когда нет — кликабельный
 * дисплей (computed-значение / артикул-название) с бейджами fx (per-cell
 * формула) и Link2 (привязка). Зеркалит `CellTriggerButton`/inline-input из
 * блока «Данные», адаптировано под модель «Моего магазина».
 *
 * `onMouseDown preventDefault` на дисплее — чтобы клик по ячейке не уводил
 * focus с активного input'а раньше времени (commit при переключении делает
 * `activateCell`).
 */
function MyStoreExcelCell({
  col,
  isActive,
  draft,
  displayText,
  isIdentity,
  isLinked,
  hasFormula,
  bindingLabel,
  dataCellInput,
  inputRef,
  placeholder,
  tone,
  onActivate,
  onDraftChange,
  onInlineFocus,
  onKeyDown,
  onBlur,
}: {
  col: Column;
  isActive: boolean;
  draft: string;
  displayText: string;
  isIdentity: boolean;
  isLinked: boolean;
  hasFormula: boolean;
  bindingLabel?: string;
  dataCellInput: string;
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
  placeholder?: string;
  /** Подсветка значения (для колонок с `positive` — +/−). */
  tone?: 'positive' | 'negative';
  onActivate: () => void;
  onDraftChange: (draft: string, caret: number | null) => void;
  onInlineFocus: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
}) {
  const leftAlign = isIdentity || col.type === 'text';

  if (isActive) {
    return (
      <div className="relative flex h-full items-stretch overflow-hidden rounded border border-primary bg-background ring-1 ring-primary/40">
        <input
          ref={inputRef}
          data-cell-input={dataCellInput}
          type="text"
          inputMode={leftAlign ? undefined : 'decimal'}
          value={draft}
          autoFocus
          onFocus={onInlineFocus}
          onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart)}
          onSelect={(e) =>
            onDraftChange(
              (e.target as HTMLInputElement).value,
              (e.target as HTMLInputElement).selectionStart,
            )
          }
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          className={cn(
            'h-full w-full min-w-0 border-0 bg-transparent px-1.5 font-mono text-[12px] tabular-nums outline-none placeholder:text-muted-foreground/50',
            leftAlign ? 'text-left' : 'text-right',
          )}
        />
      </div>
    );
  }

  const isErr = displayText === '#CYCLE' || displayText === '#ERR';
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'F2') {
          e.preventDefault();
          onActivate();
        }
      }}
      title={
        hasFormula
          ? 'Формула — кликните для правки'
          : isLinked
            ? `Привязано: ${bindingLabel ?? 'блок'}`
            : 'Кликните, чтобы редактировать'
      }
      className={cn(
        'flex h-full w-full min-w-0 items-center gap-1 rounded border border-transparent px-1.5 text-[12px] tabular-nums transition hover:border-border/70',
        leftAlign ? 'justify-start' : 'justify-end',
        isErr
          ? 'text-amber-600 dark:text-amber-400'
          : isLinked
            ? 'bg-amber-50/60 dark:bg-amber-950/30'
            : hasFormula
              ? 'bg-sky-50/50 dark:bg-sky-950/30'
              : '',
      )}
    >
      {isLinked && <Link2 className="h-2.5 w-2.5 shrink-0 text-amber-600 dark:text-amber-400" />}
      {hasFormula && !isLinked && <FunctionSquare className="h-2.5 w-2.5 shrink-0 text-sky-500" />}
      {displayText ? (
        <span
          className={cn(
            'truncate',
            !isErr && tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
            !isErr && tone === 'negative' && 'text-red-600 dark:text-red-400',
          )}
        >
          {displayText}
        </span>
      ) : (
        <span className="text-muted-foreground/40">—</span>
      )}
    </button>
  );
}

type MyStoreRowProps = {
  row: Row;
  /** Абсолютный индекс в видимом (sorted) порядке — для `#`, data-fill-row и подсветки. */
  rowIdx: number;
  columns: Column[];
  vatPct: number;
  taxRatePct: number;
  formulasMap: Record<string, string | undefined>;
  boundForRow: Record<string, number> | undefined;
  widths: Record<string, number>;
  stickyOffsets: Map<string, number>;
  lastPinnedId: string | null;
  showKopecks: boolean;
  onUpdateRow: (rowId: string, patch: Partial<Row>) => void;
  onUpdateRowValue: (rowId: string, colId: string, value: number | string) => void;
  onRemoveRow: (rowId: string) => void;
  onDuplicateRow: (rowId: string) => void;
  onResetBindings: (rowId: string) => void;
  onOpenPicker: (rowId: string, colId: string) => void;
  onFillStart: (sourceIdx: number, colId: string, e: React.PointerEvent) => void;
  fillActive: boolean;
  fillColId: string | null;
  fillFrom: number | null;
  fillTo: number | null;
  /** Excel-режим (sheet-style редактирование любой ячейки). */
  excelMode: boolean;
  /** colId активной ячейки ЭТОЙ строки (или null) — стабилен для мемо. */
  activeColId: string | null;
  /** Draft активной ячейки ЭТОЙ строки (или null). Меняется только у активной строки. */
  sessionDraft: string | null;
  /** Общий ref на активный inline-input (родитель восстанавливает каретку/фокус). */
  inlineInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onCellActivate: (rowId: string, colId: string) => void;
  onCellDraftChange: (draft: string, caret: number | null) => void;
  onCellInlineFocus: () => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onCellBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
};

/**
 * Мемоизированная строка таблицы. Вычисляет свои значения через
 * `computeRowValues` (тот же helper, что и агрегаты) → ре-рендерится ТОЛЬКО
 * когда меняется её `row` (или колонки/привязки), а не на каждый keystroke
 * соседней строки или чужую публикацию стора.
 */
const MyStoreRow = memo(function MyStoreRow({
  row,
  rowIdx,
  columns,
  vatPct,
  taxRatePct,
  formulasMap,
  boundForRow,
  widths,
  stickyOffsets,
  lastPinnedId,
  showKopecks,
  onUpdateRow,
  onUpdateRowValue,
  onRemoveRow,
  onDuplicateRow,
  onResetBindings,
  onOpenPicker,
  onFillStart,
  fillActive,
  fillColId,
  fillFrom,
  fillTo,
  excelMode,
  activeColId,
  sessionDraft,
  inlineInputRef,
  onCellActivate,
  onCellDraftChange,
  onCellInlineFocus,
  onCellKeyDown,
  onCellBlur,
}: MyStoreRowProps) {
  // Мемо: при drag-fill меняются только fill*-пропсы — формулы не пересчитываем.
  const values = useMemo(
    () => computeRowValues(row, columns, vatPct, taxRatePct, formulasMap, boundForRow),
    [row, columns, vatPct, taxRatePct, formulasMap, boundForRow],
  );
  const fillLo =
    fillColId !== null && fillFrom !== null && fillTo !== null ? Math.min(fillFrom, fillTo) : null;
  const fillHi = fillLo !== null ? Math.max(fillFrom as number, fillTo as number) : null;

  return (
    <div
      data-fill-row={rowIdx}
      className="group flex border-b border-border/40 transition-colors hover:bg-accent/5"
      style={{ height: ROW_H }}
    >
      <BodyCell
        width={STICKY_INDEX_W}
        sticky
        stickyLeft={0}
        className="justify-center text-center text-muted-foreground tabular-nums"
      >
        {rowIdx + 1}
      </BodyCell>
      {columns.map((col) => {
        const w = widths[col.id] ?? 96;
        const stickyLeft = stickyOffsets.get(col.id);
        const isPinned = stickyLeft !== undefined;
        const isLastPinned = isPinned && col.id === lastPinnedId;
        const stickyProps = isPinned ? { sticky: true, stickyLeft, stickyEdge: isLastPinned } : {};
        const inFill =
          fillColId === col.id && fillLo !== null && rowIdx >= fillLo && rowIdx <= (fillHi as number);
        const fillCls = inFill ? 'bg-primary/5 ring-1 ring-inset ring-primary/40' : '';

        // ── Excel-режим: единый sheet-style редактор для ЛЮБОЙ ячейки —
        //    identity / text / number / money / percent / formula (per-cell
        //    override колоночной формулы для одной строки). ──
        if (excelMode) {
          const isActive = activeColId === col.id;
          const isIdentity = col.type === 'identity';
          const isFormulaCol = col.type === 'formula';
          const binding =
            isIdentity || isFormulaCol
              ? undefined
              : (row.bindings[col.id] as UnitCellBinding | undefined);
          const linked = isBindingActive(binding);
          const rawVal = row.values[col.id];
          const hasOverride = rawVal !== undefined && rawVal !== null && rawVal !== '';
          // fx-бейдж: per-cell формула ИЛИ формульная колонка без литерал-override.
          const cellFormula = isCellFormulaValue(rawVal) || (isFormulaCol && !hasOverride);
          const computed = values[col.id];
          const isErr = computed === '#CYCLE' || computed === '#ERR';
          let displayText: string;
          if (isIdentity) {
            displayText = col.id === IDENTITY_ARTICLE_ID ? row.article : row.name;
          } else if (isErr) {
            displayText = String(computed);
          } else if (col.type === 'text') {
            displayText = typeof computed === 'string' ? computed : String(computed ?? '');
          } else {
            const n = Number(computed);
            displayText = Number.isFinite(n) ? formatCellValue(n, isMoneyCol(col), showKopecks) : '';
          }
          let tone: 'positive' | 'negative' | undefined;
          if (!isErr && col.positive && !isIdentity && col.type !== 'text') {
            const n = Number(computed);
            if (n > 0) tone = 'positive';
            else if (n < 0) tone = 'negative';
          }
          return (
            <BodyCell
              key={col.id}
              width={w}
              {...stickyProps}
              className={cn('group/cell relative p-0.5', fillCls)}
            >
              <MyStoreExcelCell
                col={col}
                isActive={isActive}
                draft={isActive ? sessionDraft ?? '' : ''}
                displayText={displayText}
                isIdentity={isIdentity}
                isLinked={linked}
                hasFormula={cellFormula}
                bindingLabel={binding?.ref?.label}
                dataCellInput={`${row.id}|${col.id}`}
                inputRef={isActive ? inlineInputRef : undefined}
                placeholder={isIdentity || col.type === 'text' ? col.label : '0'}
                tone={tone}
                onActivate={() => onCellActivate(row.id, col.id)}
                onDraftChange={onCellDraftChange}
                onInlineFocus={onCellInlineFocus}
                onKeyDown={onCellKeyDown}
                onBlur={onCellBlur}
              />
              {!isIdentity && (
                <FillHandle onPointerDown={(e) => onFillStart(rowIdx, col.id, e)} active={fillActive} />
              )}
            </BodyCell>
          );
        }

        if (col.type === 'identity') {
          const isArticle = col.id === IDENTITY_ARTICLE_ID;
          const value = isArticle ? row.article : row.name;
          return (
            <BodyCell key={col.id} width={w} {...stickyProps} className="p-0">
              <input
                type="text"
                value={value}
                onChange={(e) =>
                  onUpdateRow(row.id, isArticle ? { article: e.target.value } : { name: e.target.value })
                }
                placeholder={col.label}
                className="h-full w-full min-w-0 truncate border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
              />
            </BodyCell>
          );
        }

        const raw = values[col.id];
        if (col.type === 'formula') {
          const isErr = raw === '#CYCLE' || raw === '#ERR';
          const num = Number(raw);
          const positive = col.positive && num > 0;
          const negative = col.positive && num < 0;
          return (
            <BodyCell key={col.id} width={w} {...stickyProps} className="justify-end px-1.5 tabular-nums">
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

        // ── Обычный режим: ячейка с per-cell формулой (`=…`) → read-only computed
        //    + бейдж fx. Правка формулы доступна только в Excel-режиме. ──
        if (isCellFormulaValue(row.values[col.id])) {
          const isErr = raw === '#CYCLE' || raw === '#ERR';
          const num = Number(raw);
          const positive = col.positive && num > 0;
          const negative = col.positive && num < 0;
          const display = isErr
            ? String(raw)
            : col.type === 'text'
              ? typeof raw === 'string'
                ? raw
                : String(raw ?? '')
              : formatNumber(num, col, showKopecks);
          return (
            <BodyCell
              key={col.id}
              width={w}
              {...stickyProps}
              className={cn('group/cell relative justify-end px-1.5 tabular-nums', fillCls)}
            >
              <span
                className="flex min-w-0 items-center gap-1"
                title={`Формула: ${String(row.values[col.id])} · включите Excel-режим для правки`}
              >
                <FunctionSquare className="h-2.5 w-2.5 shrink-0 text-sky-500" />
                <span
                  className={cn(
                    'truncate',
                    isErr
                      ? 'text-amber-600 dark:text-amber-400'
                      : positive
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : negative
                          ? 'text-red-600 dark:text-red-400'
                          : '',
                  )}
                >
                  {display}
                </span>
              </span>
              <FillHandle onPointerDown={(e) => onFillStart(rowIdx, col.id, e)} active={fillActive} />
            </BodyCell>
          );
        }

        if (col.type === 'text') {
          const text = typeof raw === 'string' ? raw : String(raw ?? '');
          return (
            <BodyCell key={col.id} width={w} {...stickyProps} className={cn('group/cell relative p-0', fillCls)}>
              <input
                type="text"
                value={text}
                onChange={(e) => onUpdateRowValue(row.id, col.id, e.target.value)}
                placeholder={col.label}
                className="h-full w-full min-w-0 truncate border-0 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
              />
              <FillHandle onPointerDown={(e) => onFillStart(rowIdx, col.id, e)} active={fillActive} />
            </BodyCell>
          );
        }

        // number / money / percent
        const binding = row.bindings[col.id] as UnitCellBinding | undefined;
        const linked = isBindingActive(binding);
        const manualNum = Number(row.values[col.id]);
        return (
          <BodyCell key={col.id} width={w} {...stickyProps} className={cn('group/cell relative p-0.5', fillCls)}>
            <MyStoreNumberCell
              manualValue={Number.isFinite(manualNum) ? manualNum : 0}
              isLinked={linked}
              resolvedValue={linked ? (boundForRow?.[col.id] ?? null) : undefined}
              money={isMoneyCol(col)}
              showKopecks={showKopecks}
              fieldLabel={col.label}
              unit={col.unit}
              bindingLabel={binding?.ref?.label}
              onCommit={(v) => onUpdateRowValue(row.id, col.id, v)}
              onOpenPicker={() => onOpenPicker(row.id, col.id)}
            />
            <FillHandle onPointerDown={(e) => onFillStart(rowIdx, col.id, e)} active={fillActive} />
          </BodyCell>
        );
      })}
      <BodyCell width={ACTIONS_W} className="justify-center">
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDuplicateRow(row.id)} title="Дублировать">
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onResetBindings(row.id)} title="Сбросить привязки">
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-red-600 hover:text-red-700"
            onClick={() => onRemoveRow(row.id)}
            title="Удалить"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </BodyCell>
    </div>
  );
});

/**
 * Меню действий с колонкой. Открывается кликом или ховером (400ms) на иконку
 * GripVertical, которая появляется в правой части ячейки при hover.
 *
 * DnD FIX (v0.24.3): Используется `PopoverAnchor asChild` вместо
 * `PopoverTrigger asChild`. `PopoverTrigger` добавлял свой `onPointerDown`
 * через Radix, который перехватывал события раньше @dnd-kit/PointerSensor →
 * drag не начинался. `PopoverAnchor` только позиционирует Popover
 * относительно якорного элемента, НЕ добавляя обработчики событий.
 *
 * Когда dnd-kit начинает drag (`isDragging=true`), меню принудительно
 * закрывается через `useEffect`.
 */
function HeaderActionsMenu({
  col,
  isPinned,
  isDragging,
  sortState,
  dragAttributes,
  dragListeners,
  onSetSort,
  onTogglePin,
  onToggleHidden,
  onOpenSettings,
  onDelete,
}: {
  col: Column;
  isPinned: boolean;
  /** Когда drag активен — меню принудительно закрывается. */
  isDragging: boolean;
  sortState: 'asc' | 'desc' | null | undefined;
  dragAttributes: React.HTMLAttributes<HTMLButtonElement> | undefined;
  dragListeners: Record<string, (e: unknown) => void> | undefined;
  onSetSort: (dir: 'asc' | 'desc' | null) => void;
  onTogglePin: () => void;
  onToggleHidden: () => void;
  onOpenSettings: () => void;
  /** null — удаление недоступно (identity или built-in referenced). */
  onDelete: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    clearCloseTimer();
    if (open) return;
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => setOpen(true), 400);
  }, [open, clearCloseTimer, clearOpenTimer]);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 200);
  }, [clearOpenTimer, clearCloseTimer]);

  // Закрыть меню, когда dnd-kit начинает drag.
  const closeNow = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
  }, [clearOpenTimer, clearCloseTimer]);

  useEffect(() => {
    if (isDragging) closeNow();
  }, [isDragging, closeNow]);

  // Cleanup на unmount.
  useEffect(() => {
    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearOpenTimer, clearCloseTimer]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/*
        PopoverAnchor asChild — Radix позиционирует Popover относительно
        этого элемента, но НЕ добавляет onPointerDown/onClick.
        Это даёт dnd-kit полный контроль над pointer-событиями.
      */}
      <PopoverAnchor asChild>
        <button
          type="button"
          {...(dragAttributes ?? {})}
          {...(dragListeners ?? {})}
          onClick={(e) => {
            e.stopPropagation();
            clearOpenTimer();
            clearCloseTimer();
            setOpen((v) => !v);
          }}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          // pointerDown отменяет hover-open — при реальном drag меню не появится.
          onPointerDown={(e) => {
            clearOpenTimer();
            // Пробрасываем dragListeners.onPointerDown если есть.
            (dragListeners as Record<string, (e: React.PointerEvent<HTMLButtonElement>) => void> | undefined)?.onPointerDown?.(e);
          }}
          className="inline-flex h-5 w-5 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/h:opacity-100 active:cursor-grabbing"
          title="Перетащите для смены порядка · кликните для меню"
          aria-label="Меню колонки"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={4}
        className="w-52 p-1"
        onMouseEnter={clearCloseTimer}
        onMouseLeave={scheduleClose}
      >
        {/* Сортировка */}
        <MenuItem
          icon={ArrowDown}
          active={sortState === 'desc'}
          onClick={() => { onSetSort('desc'); closeNow(); }}
        >
          По убыванию
        </MenuItem>
        <MenuItem
          icon={ArrowUp}
          active={sortState === 'asc'}
          onClick={() => { onSetSort('asc'); closeNow(); }}
        >
          По возрастанию
        </MenuItem>
        {sortState && (
          <MenuItem
            icon={ArrowDownUp}
            onClick={() => { onSetSort(null); closeNow(); }}
          >
            Сбросить сортировку
          </MenuItem>
        )}
        {/* Разделитель */}
        <div className="my-1 h-px bg-border/50" />
        {/* Управление колонкой */}
        <MenuItem
          icon={isPinned ? PinOff : Pin}
          onClick={() => { onTogglePin(); closeNow(); }}
        >
          {isPinned ? 'Открепить' : 'Закрепить слева'}
        </MenuItem>
        <MenuItem
          icon={col.hidden ? Eye : EyeOff}
          onClick={() => { onToggleHidden(); closeNow(); }}
        >
          {col.hidden ? 'Показать' : 'Скрыть'}
        </MenuItem>
        <MenuItem
          icon={Settings2}
          onClick={() => { onOpenSettings(); closeNow(); }}
        >
          Настройки…
        </MenuItem>
        {onDelete && (
          <MenuItem
            icon={Trash2}
            destructive
            onClick={() => { onDelete(); closeNow(); }}
          >
            Удалить колонку
          </MenuItem>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onClick,
  active,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick: () => void;
  /** Подсветка активного пункта (напр. текущее направление сортировки). */
  active?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-accent',
        active && 'bg-accent/60 font-medium text-primary',
        destructive && 'text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', active && 'text-primary')} />
      <span className="truncate">{children}</span>
    </button>
  );
}

/**
 * Sortable + resizable + sticky-pinnable заголовок колонки.
 *
 * Визуальный дизайн (v0.24.3):
 * - Idle: [sort-indicator?] [label................] [unit]
 * - Hover: [sort-indicator?] [label...............] [GripVertical → меню]
 *
 * Единица (unit/fx) и иконка grip занимают один слот — единица скрывается
 * при hover с CSS transition, grip появляется в том же пространстве.
 * Resize-handle 5px на правом крае. Клик по ячейке (вне grip) — sort-cycle.
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
  onSetSort,
  onResizeStart,
  onOpenSettings,
  onTogglePin,
  onToggleHidden,
  onDelete,
}: {
  col: Column;
  width: number;
  draggable: boolean;
  stickyLeft?: number;
  isLastPinned?: boolean;
  isPinned: boolean;
  sortState?: 'asc' | 'desc' | null;
  onSort: () => void;
  onSetSort: (dir: 'asc' | 'desc' | null) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onOpenSettings: () => void;
  onTogglePin: () => void;
  onToggleHidden: () => void;
  onDelete: (() => void) | null;
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
    zIndex: isDragging ? 50 : isPinned ? 46 : undefined,
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
  const unitBadge = col.type === 'formula' ? 'fx' : (col.unit ?? '');
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSort}
      title={col.label}
      className={
        'group/h relative isolate flex shrink-0 items-center overflow-hidden border-r border-border/40 ' +
        'cursor-pointer bg-card ' +
        (isPinned ? '' : 'hover:bg-accent/30 ')
      }
    >
      {/*
        `flex w-full min-w-0`: обязательно для truncate в flex-контексте.
        pr-1: отступ от resize-handle (5px справа).
      */}
      <span className="flex w-full min-w-0 items-center gap-0.5 px-1.5 pr-1 py-1 text-[10px] uppercase tracking-wider">
        {/* Активный индикатор сортировки — только когда sort активна. */}
        {sortState && (
          <span className="shrink-0 text-primary">
            {sortState === 'asc' ? (
              <ArrowUp className="h-2.5 w-2.5" />
            ) : (
              <ArrowDown className="h-2.5 w-2.5" />
            )}
          </span>
        )}
        {/* Метка — занимает всё оставшееся место. */}
        <span
          className="block min-w-0 flex-1 truncate font-semibold text-foreground"
          title={col.label}
        >
          {col.label}
        </span>
        {/*
          Unit/grip слот: оба занимают одно место в правом краю.
          Unit виден в idle (group-hover/h:opacity-0),
          Grip появляется на hover (opacity-0 group-hover/h:opacity-100).
          Используем relative-обёртку чтобы не менять размер flex-контейнера.
        */}
        <span className="relative ml-0.5 inline-flex h-4 shrink-0 items-center justify-center">
          {/* Unit badge — скрывается при hover */}
          {unitBadge && (
            <span className="text-[9px] font-normal text-muted-foreground/70 transition-opacity duration-150 group-hover/h:opacity-0">
              {unitBadge}
            </span>
          )}
          {/* Grip / menu button — появляется при hover поверх unit badge */}
          <span className={cn(
            'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
            'opacity-0 group-hover/h:opacity-100',
          )}>
            <HeaderActionsMenu
              col={col}
              isPinned={isPinned}
              isDragging={isDragging}
              sortState={sortState}
              dragAttributes={draggable ? (attributes as unknown as React.HTMLAttributes<HTMLButtonElement>) : undefined}
              dragListeners={draggable ? (listeners as unknown as Record<string, (e: unknown) => void>) : undefined}
              onSetSort={onSetSort}
              onTogglePin={onTogglePin}
              onToggleHidden={onToggleHidden}
              onOpenSettings={onOpenSettings}
              onDelete={onDelete}
            />
          </span>
        </span>
      </span>
      {/* Resize handle — правый край, 5px. Не мешает grip: grip позиционируется левее. */}
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
  const isIdentity = column.type === 'identity';

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
          {!isIdentity && (
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
          )}
          {!isIdentity && (
            <Field label="Единица (опц.)">
              <Input
                value={draft.unit ?? ''}
                onChange={(e) => setDraft({ ...draft, unit: e.target.value || undefined })}
                placeholder="₽, %, шт."
              />
            </Field>
          )}
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
          {!isIdentity && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!draft.positive}
                onChange={(e) => setDraft({ ...draft, positive: e.target.checked })}
              />
              Подсвечивать +/−
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pinned} onChange={() => onTogglePin()} />
            Закрепить слева (sticky)
          </label>

          {!isIdentity && (
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
          )}
        </div>
        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onToggleHidden}>
              {column.hidden ? <Eye /> : <EyeOff />}
              {column.hidden ? 'Показать' : 'Скрыть'}
            </Button>
            {!isIdentity && (
              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={onDelete}>
                <Trash2 /> Удалить
              </Button>
            )}
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
