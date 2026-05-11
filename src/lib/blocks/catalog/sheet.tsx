// PURPOSE: Sheet block — полноценная Excel-like таблица с формулами, настройкой размеров ячеек,
// header-строкой с названием/итогами и связями с другими блоками.
'use client';

import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react';
import { Table2, FunctionSquare } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useBlockValuePublisher } from '../values';
import { useBlockDensity } from '@/components/blocks/block-size';
import FormulaParser from 'fast-formula-parser';

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
  /** Ссылки на внешние блоки: имя переменной → blockId.field */
  blockRefs: z.record(z.string(), z.object({
    blockId: z.string(),
    field: z.string().default('value'),
    label: z.string().optional(),
  })).optional(),
});

type SheetCfg = z.infer<typeof SheetConfig>;
type HeaderCell = z.infer<typeof HeaderCellSchema>;

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

function cellAddress(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`;
}

function makeHeaderId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : `h_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Formula Engine (lightweight, using fast-formula-parser)
// ============================================================================

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
    const blockRefPattern = /@(\w+)/g;
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

    // Используем парсер формул
    const MAX_ROW = FormulaParser.MAX_ROW;
    const MAX_COLUMN = FormulaParser.MAX_COLUMN;

    const parser = new FormulaParser({
      onCell: ({ row, col }: { sheet: string; row: number; col: number }) => {
        const addr = cellAddress(row - 1, col - 1);
        // Проверяем circular
        if (visiting?.has(addr)) return 0;
        // Проверяем кэш
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
        const num = parseFloat(rawValue);
        return Number.isFinite(num) ? num : 0;
      },
      onRange: (ref: { from: { row: number; col: number }; to: { row: number; col: number } }) => {
        const maxRow = ref.to.row === MAX_ROW ? cells.length : ref.to.row;
        const maxCol = ref.to.col === MAX_COLUMN
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
              const num = parseFloat(rawValue);
              innerArr.push(Number.isFinite(num) ? num : 0);
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
    if (result instanceof Error) return '#ERR';
    return String(result ?? '');
  } catch {
    return '#ERR';
  }
}

function computeCell(
  raw: string,
  cells: string[][],
  evaluated: Map<string, number | string>,
  blockValues: Record<string, number | string | null>,
): string {
  if (!raw.startsWith('=')) return raw;
  const result = evaluateFormula(raw.slice(1), cells, evaluated, blockValues);
  return typeof result === 'number'
    ? (Number.isInteger(result) ? result.toString() : result.toFixed(2))
    : String(result);
}

// ============================================================================
// Render
// ============================================================================

function RenderSheet({ instance, onConfigChange }: BlockRenderProps) {
  const cfg = SheetConfig.parse(instance.config ?? {});
  const density = useBlockDensity();
  const [cells, setCells] = useState<string[][]>(() =>
    ensureShape(cfg.cells, cfg.rows, cfg.cols)
  );
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
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
  const resizingCol = useRef<{ col: number; startX: number; startW: number } | null>(null);
  const resizingRow = useRef<{ row: number; startY: number; startH: number } | null>(null);

  const title = instance.appearance?.title ?? cfg.title;
  const accent = instance.appearance?.accentColor;

  // Собираем blockValues из blockRefs
  const blockValues: Record<string, number | string | null> = useMemo(() => {
    const refs = cfg.blockRefs ?? {};
    const result: Record<string, number | string | null> = {};
    Object.entries(refs).forEach(([name]) => {
      result[name] = null;
    });
    return result;
  }, [cfg.blockRefs]);

  // Вычисляем все ячейки
  const evaluatedCells = useMemo(() => {
    const evaluated = new Map<string, number | string>();
    const result: string[][] = [];
    for (let r = 0; r < cells.length; r++) {
      const row: string[] = [];
      for (let c = 0; c < (cells[r]?.length ?? 0); c++) {
        const raw = cells[r][c];
        const addr = cellAddress(r, c);
        if (evaluated.has(addr)) {
          const cached = evaluated.get(addr)!;
          row.push(typeof cached === 'number'
            ? (Number.isInteger(cached) ? cached.toString() : cached.toFixed(2))
            : String(cached));
        } else {
          const computed = computeCell(raw, cells, evaluated, blockValues);
          evaluated.set(addr, raw.startsWith('=')
            ? (parseFloat(computed) || computed)
            : (parseFloat(raw) || raw));
          row.push(computed);
        }
      }
      result.push(row);
    }
    return { result, evaluated };
  }, [cells, blockValues]);

  // Вычисляем header cells
  const evaluatedHeaders = useMemo(() => {
    return headerCells.map((hc) => {
      if (!hc.value.startsWith('=')) return { ...hc, computed: hc.value };
      const computed = computeCell(hc.value, cells, new Map(), blockValues);
      return { ...hc, computed };
    });
  }, [headerCells, cells, blockValues]);

  // Публикуем значения для других блоков
  const publishOutput = useMemo(() => {
    const numericCells: number[] = [];
    cells.forEach((row) => {
      row.forEach((raw) => {
        const n = parseFloat(raw);
        if (Number.isFinite(n)) numericCells.push(n);
      });
    });
    const sum = numericCells.reduce((s, n) => s + n, 0);
    return { value: sum, sum, count: numericCells.length, label: title };
  }, [cells, title]);
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
    setCells((prev) => {
      const next = prev.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row
      );
      saveConfig({ cells: next });
      return next;
    });
  }

  function handleCellClick(r: number, c: number) {
    if (activeCell?.r === r && activeCell?.c === c && editing) return;
    setActiveCell({ r, c });
    setEditing(true);
    setEditValue(cells[r][c]);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }

  function commitEdit() {
    if (activeCell && editing) {
      updateCell(activeCell.r, activeCell.c, editValue);
      setEditing(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!activeCell) return;
    if (e.key === 'Enter') {
      commitEdit();
      setActiveCell((prev) => prev ? { r: Math.min(prev.r + 1, cfg.rows - 1), c: prev.c } : null);
      setEditing(true);
      setEditValue(cells[Math.min(activeCell.r + 1, cfg.rows - 1)]?.[activeCell.c] ?? '');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      const nextC = e.shiftKey ? Math.max(0, activeCell.c - 1) : Math.min(activeCell.c + 1, cfg.cols - 1);
      setActiveCell({ r: activeCell.r, c: nextC });
      setEditing(true);
      setEditValue(cells[activeCell.r]?.[nextC] ?? '');
    } else if (e.key === 'Escape') {
      setEditing(false);
      setEditValue(cells[activeCell.r]?.[activeCell.c] ?? '');
    }
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
      setColWidths((current) => {
        saveConfig({ colWidths: current });
        return current;
      });
      resizingCol.current = null;
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
      setRowHeights((current) => {
        saveConfig({ rowHeights: current });
        return current;
      });
      resizingRow.current = null;
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
    <Card className="flex h-full flex-col overflow-hidden">
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
                className="h-5 w-full truncate border-0 bg-transparent p-0 text-xs font-semibold tabular-nums outline-none focus:ring-0"
                style={accent ? { color: accent } : undefined}
                value={hc.value.startsWith('=') ? (hc as { computed?: string }).computed ?? '' : hc.value}
                onChange={(e) => updateHeaderCell(hc.id, { value: e.target.value })}
                title={hc.value.startsWith('=') ? `Формула: ${hc.value}` : undefined}
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
      {cfg.showFormulaBar && activeCell && (
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/20 px-2 py-1">
          <span className="flex h-5 min-w-[36px] items-center justify-center rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
            {cellAddress(activeCell.r, activeCell.c)}
          </span>
          <FunctionSquare className="h-3 w-3 text-muted-foreground/60" />
          <input
            ref={editInputRef}
            className="h-5 flex-1 border-0 bg-transparent p-0 text-xs outline-none focus:ring-0"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            placeholder="Введите значение или формулу (=SUM(A1:A5))"
          />
          {cells[activeCell.r]?.[activeCell.c]?.startsWith('=') && (
            <span className="text-[10px] text-blue-500">fx</span>
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
                      onClick={() => handleCellClick(r, c)}
                      style={{ height: rowHeights[r] ?? DEFAULT_ROW_HEIGHT }}
                    >
                      {isActive && editing ? (
                        <input
                          ref={editInputRef}
                          className="h-full w-full border-0 bg-background px-1.5 text-xs outline-none"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                          autoFocus
                        />
                      ) : (
                        <div
                          className={
                            'flex h-full items-center truncate px-1.5 tabular-nums ' +
                            (isFormula ? 'text-blue-700 dark:text-blue-400' : '')
                          }
                          title={isFormula ? `Формула: ${rawValue}` : undefined}
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
  defaultSize: { w: 8, h: 7 },
  minSize: { w: 3, h: 3 },
  minContentSize: { w: 240, h: 160 },
  pages: ['*'],
  supportsDependencies: true,
  configSchema: SheetConfig,
  defaultConfig: () => ({
    title: 'Таблица',
    rows: 10,
    cols: 5,
    cells: emptyCells(10, 5),
    colWidths: Array(5).fill(DEFAULT_COL_WIDTH),
    rowHeights: Array(10).fill(DEFAULT_ROW_HEIGHT),
    headerCells: [
      { id: makeHeaderId(), label: 'Название', value: 'Таблица', width: 200 },
      { id: makeHeaderId(), label: 'Итого', value: '=SUM(A1:A10)', width: 150 },
    ],
    showHeader: true,
    showFormulaBar: true,
    blockRefs: {},
  }),
  SettingsForm: SheetSettings,
  Render: RenderSheet,
};
