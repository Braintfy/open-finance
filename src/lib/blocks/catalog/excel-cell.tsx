// PURPOSE: Excel Cell block — минимальный single-cell Excel-like блок с формулами и @refs.
'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, ChevronDown, ChevronRight, FunctionSquare, Wallet } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card } from '@/components/ui/card';
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
import { BlockValuesContext, useAvailableBlockSources, useBlockValuePublisher } from '../values';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import FormulaParser from 'fast-formula-parser';
import { useCashflowKpiLite } from '../virtual-sources';
import { PeriodPicker, type PeriodPreset } from '@/components/blocks/period-picker';
import { SourceFilterChips, SOURCE_LABELS } from '@/components/blocks/source-filter-chips';

type SourceField = {
  name: string;
  label: string;
  value: number | string | null;
  format?: 'money' | 'number' | 'text';
  /** 'Ячейки' for per-cell fields from custom.data, or Ozon group label */
  group?: string;
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

/** Module-level cache for /api/blocks/sources — avoids refetch on every dialog open. */
const _sourcePagesCache: { data: SourcePage[] | null } = { data: null };

const PeriodPresetSchema = z.enum([
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  'mtd',
  'custom',
]);

const ConfigSchema = z.object({
  title: z.string().default('Доходы'),
  value: z.string().default(''),
  showFormulaBar: z.boolean().default(true),
  showKopecks: z.boolean().nullable().default(null),
  blockRefs: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
  moneyRefs: z.record(z.string(), z.boolean()).optional(),
  // Per-cell cashflow override. Активируется только если value ссылается
  // на @__virtual:cashflow.kpi.* и пользователь явно включил локальные настройки.
  cashflowOverride: z
    .object({
      enabled: z.boolean().default(false),
      period: z
        .object({
          preset: PeriodPresetSchema.default('mtd'),
          customFrom: z.string().nullable().default(null),
          customTo: z.string().nullable().default(null),
        })
        .nullable()
        .optional(),
      source: z.string().nullable().optional(),
    })
    .optional(),
});

type Config = z.infer<typeof ConfigSchema>;

function parseConfig(raw: unknown): Config {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return { title: 'Доходы', value: '', showFormulaBar: true, showKopecks: null };
}

function hasVirtualCashflowRef(value: string): boolean {
  return /@__virtual:cashflow\.kpi\.(income|expense|balance)/.test(value);
}

function parseCellNumber(value: string): number | null {
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

function refFieldName(ref: string): string {
  const source = ref.includes(':') ? ref.slice(ref.lastIndexOf(':') + 1) : ref;
  const dot = source.lastIndexOf('.');
  return dot >= 0 ? source.slice(dot + 1) : 'value';
}

function refIsPlainNumber(ref: string): boolean {
  const field = refFieldName(ref);
  return /^[A-Z]+\d+$/.test(field) || ['count', 'raw', 'label'].includes(field);
}

function formulaReferencesMoney(raw: string, moneyRefs?: Record<string, boolean>): boolean {
  const refs = raw.matchAll(/@([A-Za-z0-9_.:-]+)/g);
  for (const match of refs) {
    const ref = match[1];
    if (moneyRefs && ref in moneyRefs) {
      if (moneyRefs[ref]) return true;
      continue;
    }
    if (!refIsPlainNumber(ref)) return true;
  }
  return false;
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

function moneyFieldSet(blockId: string, values: Record<string, number | string | null>): Set<string> {
  const raw = values[`${blockId}.__money`];
  return new Set(String(raw ?? '').split(',').map((field) => field.trim()).filter(Boolean));
}

/** Reads __cellFields marker to identify per-cell (rowId.colId) published fields. */
function cellFieldSet(blockId: string, values: Record<string, number | string | null>): Set<string> {
  const raw = values[`${blockId}.__cellFields`];
  if (!raw || typeof raw !== 'string') return new Set();
  return new Set(raw.split(',').map((f) => f.trim()).filter(Boolean));
}

function mergeLiveFields(
  block: SourceBlock,
  liveFields: string[] | undefined,
  liveValues: Record<string, number | string | null>,
  liveLabels?: Record<string, string>,
): SourceBlock {
  if (!liveFields) return block;
  const moneyFields = moneyFieldSet(block.blockId, liveValues);
  const cellFields = cellFieldSet(block.blockId, liveValues);
  const byName = new Map(block.fields.map((field) => [field.name, field]));
  liveFields.forEach((name) => {
    const key = name === 'value' ? block.blockId : `${block.blockId}.${name}`;
    const current = byName.get(name);
    byName.set(name, {
      name,
      label: liveLabels?.[name] ?? current?.label ?? sourceFieldLabel(name),
      value: liveValues[key] ?? current?.value ?? null,
      format: moneyFields.has(name) ? 'money' : current?.format,
      group: current?.group ?? (cellFields.has(name) ? 'Ячейки' : undefined),
    });
  });
  return { ...block, fields: Array.from(byName.values()) };
}

function previewSourceValue(field: SourceField, showKopecks: boolean): string {
  if (field.value === null || field.value === undefined) return '—';
  if (field.format === 'money' && typeof field.value === 'number') return formatKopecksValue(field.value, showKopecks);
  return String(field.value).slice(0, 16);
}

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
  }, [api, tick]);
}

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

function evaluateValue(
  raw: string,
  blockValues: Record<string, number | string | null>,
  showKopecks: boolean,
  moneyRefs?: Record<string, boolean>,
): { display: string; value: number | string } {
  if (!raw.startsWith('=')) {
    const parsed = parseCellNumber(raw);
    return { display: raw, value: parsed ?? raw };
  }

  let expr = raw.slice(1);
  const blockRefPattern = /@([A-Za-z0-9_.:-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRefPattern.exec(raw)) !== null) {
    const refName = m[1];
    const val = blockValues[refName];
    expr = expr.replace(m[0], val !== null && val !== undefined ? String(val) : '0');
  }

  const money = formulaReferencesMoney(raw, moneyRefs);
  const result = simpleMathEval(expr);
  if (result !== null) {
    return {
      display: money ? formatKopecksValue(result, showKopecks) : formatPlainNumber(result),
      value: result,
    };
  }

  try {
    const parser = new FormulaParser();
    const parsed = parser.parse(expr, { row: 1, col: 1, sheet: 'Sheet1' });
    if (typeof parsed === 'number') {
      return {
        display: money ? formatKopecksValue(parsed, showKopecks) : formatPlainNumber(parsed),
        value: parsed,
      };
    }
    if (typeof parsed === 'string') return { display: parsed, value: parsed };
    if (typeof parsed === 'boolean') return { display: parsed ? 'TRUE' : 'FALSE', value: parsed ? 1 : 0 };
  } catch {
    return { display: '#ERR', value: '#ERR' };
  }

  return {
    display: '#ERR',
    value: '#ERR',
  };
}

function CashflowOverrideValues({
  enabled,
  period,
  source,
  onValues,
}: {
  enabled: boolean;
  period: { preset: PeriodPreset; customFrom: string | null; customTo: string | null };
  source: string | null;
  onValues: (values: Record<string, number | string | null>) => void;
}) {
  const income = useCashflowKpiLite('income', period, source);
  const expense = useCashflowKpiLite('expense', period, source);
  const balance = useCashflowKpiLite('balance', period, source);

  useEffect(() => {
    if (!enabled) {
      onValues({});
      return;
    }
    const out: Record<string, number | string | null> = {};
    if (income) {
      out['__virtual:cashflow.kpi.income'] = income.current;
      out['__virtual:cashflow.kpi.income.current'] = income.current;
      out['__virtual:cashflow.kpi.income.previous'] = income.previous;
      out['__virtual:cashflow.kpi.income.count'] = income.count;
      out['__virtual:cashflow.kpi.income.prevCount'] = income.prevCount;
      out['__virtual:cashflow.kpi.income.deltaPct'] = income.deltaPct;
    }
    if (expense) {
      out['__virtual:cashflow.kpi.expense'] = expense.current;
      out['__virtual:cashflow.kpi.expense.current'] = expense.current;
      out['__virtual:cashflow.kpi.expense.previous'] = expense.previous;
      out['__virtual:cashflow.kpi.expense.count'] = expense.count;
      out['__virtual:cashflow.kpi.expense.prevCount'] = expense.prevCount;
      out['__virtual:cashflow.kpi.expense.deltaPct'] = expense.deltaPct;
    }
    if (balance) {
      out['__virtual:cashflow.kpi.balance'] = balance.current;
      out['__virtual:cashflow.kpi.balance.current'] = balance.current;
      out['__virtual:cashflow.kpi.balance.previous'] = balance.previous;
      out['__virtual:cashflow.kpi.balance.count'] = balance.count;
      out['__virtual:cashflow.kpi.balance.prevCount'] = balance.prevCount;
      out['__virtual:cashflow.kpi.balance.deltaPct'] = balance.deltaPct;
    }
    onValues(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, income, expense, balance]);

  return null;
}

function RenderExcelCell({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const density = useBlockDensity();
  const { settings: globalSettings } = useFormatSettings();
  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;
  const availableBlocks = useAvailableBlockSources();
  const liveValues = useAllBlockValues();
  const [overrideValues, setOverrideValues] = useState<Record<string, number | string | null>>({});
  const overrideEnabled =
    !!config.cashflowOverride?.enabled && hasVirtualCashflowRef(config.value);
  const overridePeriod = config.cashflowOverride?.period ?? {
    preset: 'mtd' as PeriodPreset,
    customFrom: null,
    customTo: null,
  };
  const overrideSource = config.cashflowOverride?.source ?? null;
  const [draft, setDraft] = useState(config.value);
  const [editing, setEditing] = useState(false);
  const [caretPos, setCaretPos] = useState<number | null>(null);
  const [blockPickerOpen, setBlockPickerOpen] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [selectedSourceGroup, setSelectedSourceGroup] = useState('all');
  const [sourcePages, setSourcePages] = useState<SourcePage[]>(() => _sourcePagesCache.data ?? []);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const openingBlockPickerRef = useRef(false);

  const toggleExpandBlock = useCallback((blockId: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);
  const accent = instance.appearance?.accentColor;
  const title = config.title;

  const blockValues = useMemo(() => {
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
    Object.entries(config.blockRefs ?? {}).forEach(([name, val]) => {
      // Live store always wins — snapshot is fallback for when source block isn't mounted yet
      result[name] = liveValues[name] ?? val ?? null;
    });
    if (overrideEnabled) {
      Object.entries(overrideValues).forEach(([k, v]) => {
        result[k] = v;
      });
    }
    return result;
  }, [config.blockRefs, liveValues, sourcePages, overrideEnabled, overrideValues]);

  const moneyRefs = useMemo(() => {
    const result: Record<string, boolean> = { ...(config.moneyRefs ?? {}) };
    sourcePages.forEach((page) => {
      page.blocks.forEach((block) => {
        block.fields.forEach((field) => {
          const money = sourceFieldIsMoney(block, field);
          const scopedKey = `${block.pageKey}:${block.blockId}.${field.name}`;
          const localKey = field.name === 'value' ? block.blockId : `${block.blockId}.${field.name}`;
          if (!(scopedKey in result)) result[scopedKey] = money;
          if (!(localKey in result)) result[localKey] = money;
        });
      });
    });
    return result;
  }, [config.moneyRefs, sourcePages]);

  const computed = useMemo(() => evaluateValue(config.value, blockValues, showKopecks, moneyRefs), [config.value, blockValues, showKopecks, moneyRefs]);
  const computedIsMoney = useMemo(
    () => config.value.startsWith('=') && formulaReferencesMoney(config.value, moneyRefs),
    [config.value, moneyRefs],
  );

  useBlockValuePublisher(instance.id, {
    value: typeof computed.value === 'number' ? computed.value : null,
    raw: config.value,
    label: title,
    __money: computedIsMoney ? 'value' : '',
  });

  useEffect(() => {
    if (!editing) setDraft(config.value);
  }, [config.value, editing]);

  useEffect(() => {
    if (!blockPickerOpen) return;
    // If cache is warm: apply immediately (no loading indicator)
    if (_sourcePagesCache.data) {
      setSourcePages(_sourcePagesCache.data);
      return;
    }
    // Background fetch — live blocks on current page already show immediately
    let cancelled = false;
    setSourceLoading(true);
    fetch('/api/blocks/sources')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.pages)) {
          _sourcePagesCache.data = data.pages as SourcePage[];
          setSourcePages(data.pages as SourcePage[]);
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

  const blockSourcePages = useMemo<SourcePage[]>(() => {
    const liveById = new Map(availableBlocks.map((block) => [block.blockId, block.fields]));
    const labelsById = new Map(availableBlocks.map((block) => [block.blockId, block.labels]));
    const liveBlocks: SourceBlock[] = availableBlocks
      .filter((b) => b.blockId !== instance.id)
      .map((b) => {
        const cellFields = cellFieldSet(b.blockId, liveValues);
        const moneyFields = moneyFieldSet(b.blockId, liveValues);
        return {
          blockId: b.blockId,
          pageKey: 'current',
          pageLabel: 'Текущая страница',
          typeLabel: 'Live block',
          category: 'Текущая страница',
          label: String(liveValues[`${b.blockId}.label`] ?? `Блок ${b.blockId.slice(0, 8)}`),
          fields: b.fields.map((field) => ({
            name: field,
            label: b.labels[field] ?? sourceFieldLabel(field),
            value: liveValues[field === 'value' ? b.blockId : `${b.blockId}.${field}`] ?? null,
            format: moneyFields.has(field) ? 'money' as const : undefined,
            group: cellFields.has(field) ? 'Ячейки' : undefined,
          })),
        };
      });
    const pages = sourcePages.map((page) => ({
      ...page,
      blocks: page.blocks
        .filter((block) => block.blockId !== instance.id)
        .map((block) => mergeLiveFields(
          block,
          liveById.get(block.blockId),
          liveValues,
          labelsById.get(block.blockId),
        )),
    }));
    return liveBlocks.length > 0
      ? [{ pageKey: 'current', pageLabel: 'Текущая страница', blocks: liveBlocks }, ...pages]
      : pages;
  }, [availableBlocks, instance.id, liveValues, sourcePages]);

  const sourceGroups = useMemo(() => {
    const total = blockSourcePages.reduce((acc, page) => acc + page.blocks.length, 0);
    return [
      { id: 'all', label: 'Все блоки', count: total },
      ...blockSourcePages.filter((page) => page.blocks.length > 0).map((page) => ({
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
          const blockText = [page.pageLabel, block.category, block.typeLabel, block.label, block.blockId].join(' ').toLowerCase();
          if (blockText.includes(q)) return true;
          // Also search through field labels (including cell labels like "Row · Column")
          return block.fields.some((f) => f.label.toLowerCase().includes(q));
        }),
      }))
      .filter((page) => page.blocks.length > 0);
  }, [blockSearch, blockSourcePages, selectedSourceGroup]);

  function save(patch: Partial<Config>) {
    onConfigChange?.({ ...config, ...patch } as Record<string, unknown>);
  }

  function commit() {
    save({ value: draft });
    setEditing(false);
    setCaretPos(null);
  }

  function cancel() {
    setDraft(config.value);
    setEditing(false);
    setCaretPos(null);
  }

  function insertBlockField(block: SourceBlock, field: SourceField) {
    const ref = block.pageKey === 'current'
      ? field.name === 'value' ? block.blockId : `${block.blockId}.${field.name}`
      : `${block.pageKey}:${block.blockId}.${field.name}`;
    const token = `@${ref}`;
    const input = inputRef.current;
    let base = draft;
    let pos = caretPos ?? input?.selectionStart ?? base.length;
    if (!base.startsWith('=')) {
      base = `=${base}`;
      pos += 1;
    }
    pos = Math.max(1, Math.min(pos, base.length));
    const nextValue = base.slice(0, pos) + token + base.slice(pos);
    const nextRefs = { ...(config.blockRefs ?? {}), [ref]: field.value };
    const nextMoneyRefs = { ...(config.moneyRefs ?? {}), [ref]: sourceFieldIsMoney(block, field) };
    setDraft(nextValue);
    save({ value: nextValue, blockRefs: nextRefs, moneyRefs: nextMoneyRefs });
    setBlockPickerOpen(false);
    setBlockSearch('');
    const newPos = pos + token.length;
    setCaretPos(newPos);
    setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(newPos, newPos);
    }, 0);
  }

  const overrideExecutor = (
    <CashflowOverrideValues
      enabled={overrideEnabled}
      period={overridePeriod}
      source={overrideSource}
      onValues={setOverrideValues}
    />
  );

  if (density === 'xs') {
    return (
      <Card className="flex h-full items-center justify-center p-1">
        {overrideExecutor}
        <div className="truncate text-sm font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
          {computed.display || '—'}
        </div>
      </Card>
    );
  }

  const compact = density === 'sm';

  return (
    <Card className={compact ? 'flex h-full flex-col p-2' : 'flex h-full flex-col p-3'}>
      {overrideExecutor}
      <div className="flex items-center gap-1.5">
        <Calculator className={compact ? 'h-3.5 w-3.5 shrink-0 text-muted-foreground' : 'h-4 w-4 shrink-0 text-muted-foreground'} style={accent ? { color: accent } : undefined} />
        <Input
          value={title}
          onChange={(e) => save({ title: e.target.value })}
          className={compact ? 'h-6 min-w-0 border-0 bg-transparent px-0 text-xs font-medium text-muted-foreground shadow-none focus-visible:ring-0' : 'h-7 min-w-0 border-0 bg-transparent px-0 text-sm font-medium text-muted-foreground shadow-none focus-visible:ring-0'}
          placeholder="Название"
        />
      </div>

      <div className={compact ? 'mt-1 flex flex-1 items-center' : 'mt-2 flex flex-1 items-center'}>
        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCaretPos(e.target.selectionStart);
            }}
            onSelect={(e) => setCaretPos((e.target as HTMLInputElement).selectionStart)}
            onBlur={() => {
              if (openingBlockPickerRef.current || blockPickerOpen) return;
              commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
            className={compact ? 'h-8 border-0 bg-muted/30 px-2 text-xl font-semibold tabular-nums shadow-none focus-visible:bg-background' : 'h-10 border-0 bg-muted/30 px-2 text-2xl font-semibold tabular-nums shadow-none focus-visible:bg-background'}
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setDraft(config.value);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className={compact ? 'w-full truncate rounded-md px-1 py-0.5 text-left text-xl font-semibold tabular-nums transition hover:bg-accent/30' : 'w-full truncate rounded-md px-1 py-1 text-left text-3xl font-semibold tabular-nums transition hover:bg-accent/30'}
            style={accent ? { color: accent } : undefined}
            title={config.value.startsWith('=') ? `Формула: ${config.value}` : undefined}
          >
            {computed.display || '—'}
          </button>
        )}
      </div>

      {config.showFormulaBar && editing && (
        <div className={compact ? 'mt-1 flex items-center gap-1 border-t border-border/40 pt-1' : 'mt-2 flex items-center gap-1 border-t border-border/40 pt-2'}>
          <FunctionSquare className={compact ? 'h-3 w-3 text-muted-foreground' : 'h-3.5 w-3.5 text-muted-foreground'} />
          <span className={compact ? 'min-w-0 flex-1 truncate text-[10px] text-muted-foreground' : 'min-w-0 flex-1 truncate text-[11px] text-muted-foreground'}>{draft}</span>
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
              className={compact ? 'h-5 shrink-0 rounded bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400' : 'h-6 shrink-0 rounded bg-amber-50 px-2 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400'}
            >
              @связать
            </button>
            <DialogContent
              className="w-[min(94vw,640px)] max-w-none gap-0 overflow-hidden p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                openingBlockPickerRef.current = false;
                inputRef.current?.focus();
              }}
            >
              <DialogHeader className="border-b border-border/60 px-4 py-3">
                <DialogTitle className="text-sm">Связать ячейку с источником</DialogTitle>
                <DialogDescription className="text-[11px]">Выберите блок, поле или ячейку таблицы</DialogDescription>
              </DialogHeader>
              <div className="grid min-h-[320px] grid-cols-[180px_minmax(0,1fr)]">
                <aside className="border-r border-border/60 bg-muted/20">
                  <div className="border-b border-border/40 px-3 py-2">
                    <Input placeholder="Поиск..." value={blockSearch} onChange={(e) => setBlockSearch(e.target.value)} className="h-7 text-xs" />
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
                  {filteredSourcePages.length === 0 ? (
                    <p className="py-12 text-center text-xs text-muted-foreground">
                      {sourceLoading ? 'Загружаю источники…' : 'Нет доступных блоков.'}
                    </p>
                  ) : (
                    filteredSourcePages.map((page) => (
                      <section key={page.pageKey}>
                        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground">{page.pageLabel}</span>
                          {sourceLoading && page.pageKey !== 'current' && (
                            <span className="text-[10px] text-muted-foreground/60">загрузка…</span>
                          )}
                        </div>
                        {page.blocks.map((block) => {
                          const periodKey = typeof liveValues[`${block.blockId}.__periodKey`] === 'string'
                            ? (liveValues[`${block.blockId}.__periodKey`] as string) : null;
                          const mainFields = block.fields.filter(
                            (f) => f.name !== 'label' && f.name !== 'raw' && f.group !== 'Ячейки',
                          );
                          const cellFields = block.fields.filter((f) => f.group === 'Ячейки');
                          const hasCells = cellFields.length > 0;
                          const isExpanded = expandedBlocks.has(block.blockId);
                          return (
                            <div key={`${block.pageKey}:${block.blockId}`} className="border-b border-border/30 px-3 py-2 last:border-b-0">
                              {/* Block header */}
                              <div className="mb-1.5 flex items-start justify-between gap-1">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium text-foreground">{block.label}</div>
                                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                    <span className="truncate">{block.typeLabel}</span>
                                    {periodKey && (
                                      <span className="shrink-0 rounded bg-sky-50 px-1 py-0.5 font-medium text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                                        {periodKey}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {/* Main fields */}
                              {mainFields.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {mainFields.map((field) => {
                                    const preview = previewSourceValue(field, showKopecks);
                                    return (
                                      <button
                                        key={field.name}
                                        type="button"
                                        className="inline-flex max-w-[190px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition hover:bg-primary/10 hover:ring-primary/40"
                                        onClick={() => insertBlockField(block, field)}
                                        title={`${field.label} = ${preview}`}
                                      >
                                        <span className="shrink-0 font-medium text-primary">{field.label}</span>
                                        <span className="min-w-0 truncate text-muted-foreground">{preview}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              {/* Cells section (collapsible) */}
                              {hasCells && (
                                <div className="mt-1.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleExpandBlock(block.blockId)}
                                    className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                                  >
                                    {isExpanded
                                      ? <ChevronDown className="h-3 w-3 shrink-0" />
                                      : <ChevronRight className="h-3 w-3 shrink-0" />
                                    }
                                    <span>Ячейки ({cellFields.length})</span>
                                  </button>
                                  {isExpanded && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {cellFields.map((field) => {
                                        const preview = previewSourceValue(field, showKopecks);
                                        return (
                                          <button
                                            key={field.name}
                                            type="button"
                                            className="inline-flex max-w-[200px] items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[11px] ring-1 ring-border/50 transition hover:bg-primary/10 hover:ring-primary/40"
                                            onClick={() => insertBlockField(block, field)}
                                            title={`${field.label} = ${preview}`}
                                          >
                                            <span className="shrink-0 font-medium text-primary/80">{field.label}</span>
                                            <span className="min-w-0 truncate text-muted-foreground">{preview}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </section>
                    ))
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Card>
  );
}

function ExcelCellSettings({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  const { settings: globalSettings } = useFormatSettings();
  const showKopecks = parsed.showKopecks ?? globalSettings.showKopecks;
  const availableBlocks = useAvailableBlockSources();
  const liveValues = useAllBlockValues();
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [sourcePages, setSourcePages] = useState<SourcePage[]>(() => _sourcePagesCache.data ?? []);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [selectedSourceGroup, setSelectedSourceGroup] = useState('all');
  const [expandedBlocksSett, setExpandedBlocksSett] = useState<Set<string>>(new Set());

  const toggleExpandBlockSett = useCallback((blockId: string) => {
    setExpandedBlocksSett((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  function set<K extends keyof Config>(key: K, value: Config[K]) {
    onChange({ ...parsed, [key]: value } as unknown as Record<string, unknown>);
  }

  useEffect(() => {
    if (!linkPickerOpen) return;
    if (_sourcePagesCache.data) {
      setSourcePages(_sourcePagesCache.data);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    fetch('/api/blocks/sources')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.pages)) {
          _sourcePagesCache.data = data.pages as SourcePage[];
          setSourcePages(data.pages as SourcePage[]);
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
  }, [linkPickerOpen]);

  const blockSourcePages = useMemo<SourcePage[]>(() => {
    const liveById = new Map(availableBlocks.map((block) => [block.blockId, block.fields]));
    const labelsById = new Map(availableBlocks.map((block) => [block.blockId, block.labels]));
    const liveBlocks: SourceBlock[] = availableBlocks.map((b) => {
      const cellFields = cellFieldSet(b.blockId, liveValues);
      const moneyFields = moneyFieldSet(b.blockId, liveValues);
      return {
        blockId: b.blockId,
        pageKey: 'current',
        pageLabel: 'Текущая страница',
        typeLabel: 'Live block',
        category: 'Текущая страница',
        label: String(liveValues[`${b.blockId}.label`] ?? `Блок ${b.blockId.slice(0, 8)}`),
        fields: b.fields.map((field) => ({
          name: field,
          label: b.labels[field] ?? sourceFieldLabel(field),
          value: liveValues[field === 'value' ? b.blockId : `${b.blockId}.${field}`] ?? null,
          format: moneyFields.has(field) ? 'money' as const : undefined,
          group: cellFields.has(field) ? 'Ячейки' : undefined,
        })),
      };
    });
    const pages = sourcePages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => mergeLiveFields(
        block,
        liveById.get(block.blockId),
        liveValues,
        labelsById.get(block.blockId),
      )),
    }));
    return liveBlocks.length > 0
      ? [{ pageKey: 'current', pageLabel: 'Текущая страница', blocks: liveBlocks }, ...pages]
      : pages;
  }, [availableBlocks, liveValues, sourcePages]);

  const sourceGroups = useMemo(() => {
    const total = blockSourcePages.reduce((acc, page) => acc + page.blocks.length, 0);
    return [
      { id: 'all', label: 'Все блоки', count: total },
      ...blockSourcePages.filter((page) => page.blocks.length > 0).map((page) => ({
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
          const blockText = [page.pageLabel, block.category, block.typeLabel, block.label, block.blockId].join(' ').toLowerCase();
          if (blockText.includes(q)) return true;
          return block.fields.some((f) => f.label.toLowerCase().includes(q));
        }),
      }))
      .filter((page) => page.blocks.length > 0);
  }, [blockSearch, blockSourcePages, selectedSourceGroup]);

  function insertLinkedField(block: SourceBlock, field: SourceField) {
    const ref = block.pageKey === 'current'
      ? field.name === 'value' ? block.blockId : `${block.blockId}.${field.name}`
      : `${block.pageKey}:${block.blockId}.${field.name}`;
    const token = `@${ref}`;
    const base = parsed.value.startsWith('=') ? parsed.value : `=${parsed.value}`;
    const spacer = base.length > 1 && !/[+\-*/(]$/.test(base) ? '+' : '';
    onChange({
      ...parsed,
      value: `${base}${spacer}${token}`,
      blockRefs: { ...(parsed.blockRefs ?? {}), [ref]: field.value },
      moneyRefs: { ...(parsed.moneyRefs ?? {}), [ref]: sourceFieldIsMoney(block, field) },
    } as unknown as Record<string, unknown>);
    setLinkPickerOpen(false);
    setBlockSearch('');
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Название</Label>
        <Input value={parsed.title} onChange={(e) => set('title', e.target.value)} className="h-8 text-xs" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Значение / формула</Label>
          <Dialog open={linkPickerOpen} onOpenChange={setLinkPickerOpen}>
            <button
              type="button"
              onClick={() => setLinkPickerOpen(true)}
              className="h-6 rounded-md bg-amber-50 px-2 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400"
            >
              @связать
            </button>
            <DialogContent className="w-[min(94vw,640px)] max-w-none gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b border-border/60 px-4 py-3">
                <DialogTitle className="text-sm">Связать ячейку с источником</DialogTitle>
                <DialogDescription className="text-[11px]">
                  Выберите блок, поле или ячейку — ссылка будет добавлена в формулу значения.
                </DialogDescription>
              </DialogHeader>
              <div className="grid min-h-[320px] grid-cols-[180px_minmax(0,1fr)]">
                <aside className="border-r border-border/60 bg-muted/20">
                  <div className="border-b border-border/40 px-3 py-2">
                    <Input placeholder="Поиск..." value={blockSearch} onChange={(e) => setBlockSearch(e.target.value)} className="h-7 text-xs" />
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
                  {filteredSourcePages.length === 0 ? (
                    <p className="py-12 text-center text-xs text-muted-foreground">
                      {sourceLoading ? 'Загружаю источники…' : 'Нет доступных источников.'}
                    </p>
                  ) : (
                    filteredSourcePages.map((page) => (
                      <section key={page.pageKey}>
                        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground">{page.pageLabel}</span>
                          {sourceLoading && page.pageKey !== 'current' && (
                            <span className="text-[10px] text-muted-foreground/60">загрузка…</span>
                          )}
                        </div>
                        {page.blocks.map((block) => {
                          const periodKey = typeof liveValues[`${block.blockId}.__periodKey`] === 'string'
                            ? (liveValues[`${block.blockId}.__periodKey`] as string) : null;
                          const mainFields = block.fields.filter(
                            (f) => f.name !== 'label' && f.name !== 'raw' && f.group !== 'Ячейки',
                          );
                          const cellFields = block.fields.filter((f) => f.group === 'Ячейки');
                          const hasCells = cellFields.length > 0;
                          const isExpanded = expandedBlocksSett.has(block.blockId);
                          return (
                            <div key={`${block.pageKey}:${block.blockId}`} className="border-b border-border/30 px-3 py-2 last:border-b-0">
                              <div className="mb-1.5 flex items-start gap-1">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium text-foreground">{block.label}</div>
                                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                    <span className="truncate">{block.typeLabel}</span>
                                    {periodKey && (
                                      <span className="shrink-0 rounded bg-sky-50 px-1 py-0.5 font-medium text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                                        {periodKey}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {mainFields.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {mainFields.map((field) => {
                                    const preview = previewSourceValue(field, showKopecks);
                                    return (
                                      <button
                                        key={field.name}
                                        type="button"
                                        className="inline-flex max-w-[190px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition hover:bg-primary/10 hover:ring-primary/40"
                                        onClick={() => insertLinkedField(block, field)}
                                        title={`${field.label} = ${preview}`}
                                      >
                                        <span className="shrink-0 font-medium text-primary">{field.label}</span>
                                        <span className="min-w-0 truncate text-muted-foreground">{preview}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              {hasCells && (
                                <div className="mt-1.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleExpandBlockSett(block.blockId)}
                                    className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                                  >
                                    {isExpanded
                                      ? <ChevronDown className="h-3 w-3 shrink-0" />
                                      : <ChevronRight className="h-3 w-3 shrink-0" />
                                    }
                                    <span>Ячейки ({cellFields.length})</span>
                                  </button>
                                  {isExpanded && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {cellFields.map((field) => {
                                        const preview = previewSourceValue(field, showKopecks);
                                        return (
                                          <button
                                            key={field.name}
                                            type="button"
                                            className="inline-flex max-w-[200px] items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[11px] ring-1 ring-border/50 transition hover:bg-primary/10 hover:ring-primary/40"
                                            onClick={() => insertLinkedField(block, field)}
                                            title={`${field.label} = ${preview}`}
                                          >
                                            <span className="shrink-0 font-medium text-primary/80">{field.label}</span>
                                            <span className="min-w-0 truncate text-muted-foreground">{preview}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </section>
                    ))
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <Input value={parsed.value} onChange={(e) => set('value', e.target.value)} className="h-8 font-mono text-xs" placeholder="=1+2 или =@block.value" />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div>
          <div className="text-xs font-medium">Строка формул</div>
          <div className="text-[11px] text-muted-foreground">Показывает @связать picker при редактировании формулы</div>
        </div>
        <Switch checked={parsed.showFormulaBar} onCheckedChange={(v) => set('showFormulaBar', v)} />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">Показывать копейки</div>
          <div className="text-[11px] text-muted-foreground">
            {parsed.showKopecks === null
              ? 'Используется глобальная настройка'
              : parsed.showKopecks
                ? 'Включено (1 234,56)'
                : 'Выключено (1 235)'}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {parsed.showKopecks !== null && (
            <button type="button" onClick={() => set('showKopecks', null)} className="text-[10px] text-muted-foreground hover:text-foreground">
              Сбросить
            </button>
          )}
          <Switch checked={parsed.showKopecks ?? false} onCheckedChange={(v) => set('showKopecks', v)} />
        </div>
      </div>

      {hasVirtualCashflowRef(parsed.value) && (
        <CashflowFilterSection parsed={parsed} onChange={onChange} />
      )}
    </div>
  );
}

function CashflowFilterSection({
  parsed,
  onChange,
}: {
  parsed: Config;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const override = parsed.cashflowOverride ?? { enabled: false };
  const enabled = !!override.enabled;
  const period = override.period ?? { preset: 'mtd' as PeriodPreset, customFrom: null, customTo: null };
  const source = override.source ?? null;

  function patch(next: Partial<NonNullable<Config['cashflowOverride']>>) {
    onChange({
      ...parsed,
      cashflowOverride: { ...override, ...next },
    } as unknown as Record<string, unknown>);
  }

  return (
    <div className="space-y-2 rounded-md border border-emerald-200/60 bg-emerald-50/50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <Wallet className="h-3.5 w-3.5" />
            Cashflow-фильтр
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {enabled
              ? 'Ячейка использует локальный период / источник (а не общий со страницы)'
              : 'По умолчанию ячейка наследует период и источник страницы'}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => patch({ enabled: v })} />
      </div>
      {enabled && (
        <div className="space-y-2 pt-1">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Период</Label>
            <PeriodPicker
              value={period}
              onChange={(v) =>
                patch({
                  period: {
                    preset: v.preset,
                    customFrom: v.customFrom ?? null,
                    customTo: v.customTo ?? null,
                  },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Источник</Label>
            <SourceFilterChips value={source} onChange={(v) => patch({ source: v })} size="xs" />
            {source && SOURCE_LABELS[source] && (
              <div className="text-[10px] text-muted-foreground">
                Выбрано: {SOURCE_LABELS[source].label}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const ExcelCellBlock: BlockDef = {
  type: 'excel.cell',
  displayName: 'Excel-ячейка',
  description: 'Минимальный блок как одна ячейка Excel: текст, числа, формулы и связи с блоками/ячейками.',
  category: 'tables',
  icon: Calculator,
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 150, h: 70 },
  pages: ['*'],
  supportsDependencies: true,
  configSchema: ConfigSchema,
  defaultConfig: () => ({ title: 'Доходы', value: '', showFormulaBar: true, showKopecks: null }),
  SettingsForm: ExcelCellSettings,
  Render: RenderExcelCell,
};
