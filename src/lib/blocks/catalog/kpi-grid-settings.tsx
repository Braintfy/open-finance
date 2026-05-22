// PURPOSE: Settings form для kpi.grid — раскладка, DnD-список ячеек,
// inline-редактор и быстрые add-кнопки. Превью справа.

'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ListOrdered,
  Wallet,
  Plus,
  X,
  GripVertical,
  Settings2,
} from 'lucide-react';
import { z } from 'zod';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BlockSettingsFormProps, BlockInstance, SourceBinding } from '../types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PeriodPicker, type PeriodPreset, type PeriodValue } from '@/components/blocks/period-picker';
import { SourceFilterChips, SOURCE_LABELS } from '@/components/blocks/source-filter-chips';
import { SourceBindingPicker } from '@/components/blocks/source-binding-picker';
import { readSourceBindingField } from '../source-binding';

// Локальная копия schema (избегаем циклической зависимости с kpi-grid.tsx).
const PeriodPresetSchema = z.enum([
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  'mtd',
  'custom',
]);
const MetricSchema = z.enum(['income', 'expense', 'balance', 'count']);
const FormatSchema = z.enum(['rub', 'number', 'percent', 'compact']);
const LayoutSchema = z.enum(['row', 'column', 'grid-2col', 'grid-3col']);

const SourceBindingSchema = z.union([
  z.object({ mode: z.literal('empty') }),
  z.object({ mode: z.literal('global') }),
  z.object({
    mode: z.literal('block'),
    blockId: z.string(),
    pageKey: z.string().optional(),
  }),
]);

const CellSchema = z.object({
  id: z.string(),
  metric: MetricSchema.default('income'),
  label: z.string().optional(),
  periodOverride: z
    .object({
      preset: PeriodPresetSchema.default('mtd'),
      customFrom: z.string().nullable().default(null),
      customTo: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
  sourceOverride: z.string().nullable().optional(),
  sourceBindingOverride: SourceBindingSchema.optional(),
  categoryName: z.string().optional(),
  counterparty: z.string().optional(),
  format: FormatSchema.default('rub'),
  accentColor: z.string().optional(),
});

const ConfigSchema = z.object({
  title: z.string().default('KPI'),
  layout: LayoutSchema.default('row'),
  cells: z.array(CellSchema).min(0).max(6).default([]),
  defaultPeriodOverride: z
    .object({
      preset: PeriodPresetSchema.default('mtd'),
      customFrom: z.string().nullable().default(null),
      customTo: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
  defaultSourceBinding: SourceBindingSchema.optional(),
});

type Config = z.infer<typeof ConfigSchema>;
type Cell = z.infer<typeof CellSchema>;
type Layout = Config['layout'];
type Metric = Cell['metric'];

function parseConfig(raw: unknown): Config {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return { title: 'KPI', layout: 'row', cells: [], defaultPeriodOverride: null };
}

function makeId(): string {
  return 'c' + Math.random().toString(36).slice(2, 9);
}

const METRIC_LABELS: Record<Metric, { label: string; icon: typeof Wallet; accent: string }> = {
  income: { label: 'Доходы', icon: ArrowDown, accent: '#10b981' },
  expense: { label: 'Расходы', icon: ArrowUp, accent: '#ef4444' },
  balance: { label: 'Баланс', icon: Wallet, accent: '#3b82f6' },
  count: { label: 'Кол-во', icon: ListOrdered, accent: '#64748b' },
};

const LAYOUT_OPTIONS: Array<{ value: Layout; label: string; description: string }> = [
  { value: 'row', label: 'Горизонталь', description: 'Все ячейки в строку' },
  { value: 'column', label: 'Вертикаль', description: 'Одна колонка сверху вниз' },
  { value: 'grid-2col', label: '2 колонки', description: '2×N сетка' },
  { value: 'grid-3col', label: '3 колонки', description: '3×N сетка' },
];

const FORMAT_OPTIONS: Array<{ value: Cell['format']; label: string }> = [
  { value: 'rub', label: 'Рубли (₽)' },
  { value: 'number', label: 'Число' },
  { value: 'compact', label: 'Компактно (1,2 млн)' },
  { value: 'percent', label: '%' },
];

export function KpiGridSettings({
  config,
  onChange,
  instance,
  allBlocks,
  blockLabels,
  pageKey,
}: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  const [expandedCellId, setExpandedCellId] = useState<string | null>(null);
  const defaultBinding: SourceBinding =
    parsed.defaultSourceBinding ?? { mode: 'empty' };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function update(next: Partial<Config>) {
    onChange({ ...parsed, ...next } as unknown as Record<string, unknown>);
  }

  function updateCell(cellId: string, patch: Partial<Cell>) {
    update({
      cells: parsed.cells.map((c) => (c.id === cellId ? { ...c, ...patch } : c)),
    });
  }

  function removeCell(cellId: string) {
    update({ cells: parsed.cells.filter((c) => c.id !== cellId) });
  }

  function addCell(metric: Metric) {
    if (parsed.cells.length >= 6) return;
    const newCell: Cell = {
      id: makeId(),
      metric,
      format: metric === 'count' ? 'number' : 'rub',
    };
    update({ cells: [...parsed.cells, newCell] });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = parsed.cells.findIndex((c) => c.id === active.id);
    const newIndex = parsed.cells.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    update({ cells: arrayMove(parsed.cells, oldIndex, newIndex) });
  }

  const canAdd = parsed.cells.length < 6;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Заголовок блока</Label>
        <Input
          value={parsed.title}
          onChange={(e) => update({ title: e.target.value })}
          className="h-8 text-xs"
          placeholder="Например: Cashflow KPI"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Раскладка</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ layout: opt.value })}
              className={
                'flex items-start gap-2 rounded-md border p-2 text-left transition ' +
                (parsed.layout === opt.value
                  ? 'border-primary/60 bg-primary/5'
                  : 'border-border/60 hover:bg-accent/40')
              }
            >
              <LayoutIcon layout={opt.value} active={parsed.layout === opt.value} />
              <div className="min-w-0">
                <div className="text-xs font-medium">{opt.label}</div>
                <div className="text-[10px] text-muted-foreground">{opt.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <Label className="text-xs">Период по умолчанию</Label>
            <div className="text-[10px] text-muted-foreground">
              {parsed.defaultPeriodOverride
                ? 'Используется ячейками без собственного периода'
                : 'Ячейки наследуют период страницы'}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              update({
                defaultPeriodOverride: parsed.defaultPeriodOverride
                  ? null
                  : { preset: 'mtd' as PeriodPreset, customFrom: null, customTo: null },
              })
            }
            className="text-[10px] text-primary hover:underline"
          >
            {parsed.defaultPeriodOverride ? 'Использовать глобальный' : 'Задать локальный'}
          </button>
        </div>
        {parsed.defaultPeriodOverride && (
          <PeriodPicker
            value={parsed.defaultPeriodOverride as PeriodValue}
            onChange={(v) =>
              update({
                defaultPeriodOverride: {
                  preset: v.preset,
                  customFrom: v.customFrom ?? null,
                  customTo: v.customTo ?? null,
                },
              })
            }
          />
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">
            Ячейки <span className="text-muted-foreground">({parsed.cells.length}/6)</span>
          </Label>
          {canAdd && (
            <div className="flex items-center gap-1">
              {(['income', 'expense', 'balance', 'count'] as Metric[]).map((m) => {
                const meta = METRIC_LABELS[m];
                const Icon = meta.icon;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => addCell(m)}
                    className="inline-flex h-6 items-center gap-1 rounded border border-border/60 px-1.5 text-[10px] font-medium transition hover:bg-accent/40"
                    title={`Добавить «${meta.label}»`}
                  >
                    <Plus className="h-2.5 w-2.5" />
                    <Icon className="h-2.5 w-2.5" style={{ color: meta.accent }} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {parsed.cells.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-[11px] text-muted-foreground">
            Добавьте первую ячейку через кнопки выше.
          </div>
        ) : (
          <DndContext id="kpi-grid-settings:cells" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={parsed.cells.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {parsed.cells.map((cell) => (
                  <SortableCellRow
                    key={cell.id}
                    cell={cell}
                    expanded={expandedCellId === cell.id}
                    onToggleExpand={() =>
                      setExpandedCellId(expandedCellId === cell.id ? null : cell.id)
                    }
                    onPatch={(p) => updateCell(cell.id, p)}
                    onRemove={() => removeCell(cell.id)}
                    selfBlockId={instance?.id}
                    allBlocks={allBlocks}
                    blockLabels={blockLabels}
                    pageKey={pageKey}
                    defaultBinding={defaultBinding}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function LayoutIcon({ layout, active }: { layout: Layout; active: boolean }) {
  const cls = active ? 'fill-primary/50 stroke-primary' : 'fill-muted stroke-muted-foreground';
  if (layout === 'row') {
    return (
      <svg viewBox="0 0 24 12" className={'h-6 w-12 shrink-0 ' + cls}>
        <rect x="0.5" y="0.5" width="7" height="11" rx="1" />
        <rect x="8.5" y="0.5" width="7" height="11" rx="1" />
        <rect x="16.5" y="0.5" width="7" height="11" rx="1" />
      </svg>
    );
  }
  if (layout === 'column') {
    return (
      <svg viewBox="0 0 12 24" className={'h-6 w-12 shrink-0 ' + cls}>
        <rect x="0.5" y="0.5" width="11" height="7" rx="1" />
        <rect x="0.5" y="8.5" width="11" height="7" rx="1" />
        <rect x="0.5" y="16.5" width="11" height="7" rx="1" />
      </svg>
    );
  }
  if (layout === 'grid-2col') {
    return (
      <svg viewBox="0 0 16 16" className={'h-6 w-12 shrink-0 ' + cls}>
        <rect x="0.5" y="0.5" width="7" height="7" rx="1" />
        <rect x="8.5" y="0.5" width="7" height="7" rx="1" />
        <rect x="0.5" y="8.5" width="7" height="7" rx="1" />
        <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 16" className={'h-6 w-12 shrink-0 ' + cls}>
      <rect x="0.5" y="0.5" width="7" height="7" rx="1" />
      <rect x="8.5" y="0.5" width="7" height="7" rx="1" />
      <rect x="16.5" y="0.5" width="7" height="7" rx="1" />
      <rect x="0.5" y="8.5" width="7" height="7" rx="1" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
      <rect x="16.5" y="8.5" width="7" height="7" rx="1" />
    </svg>
  );
}

function SortableCellRow({
  cell,
  expanded,
  onToggleExpand,
  onPatch,
  onRemove,
  selfBlockId,
  allBlocks,
  blockLabels,
  pageKey,
  defaultBinding,
}: {
  cell: Cell;
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<Cell>) => void;
  onRemove: () => void;
  selfBlockId?: string;
  allBlocks?: BlockInstance[];
  blockLabels?: Record<string, string>;
  pageKey?: string;
  defaultBinding: SourceBinding;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cell.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const meta = METRIC_LABELS[cell.metric];
  const Icon = meta.icon;
  const overrideBadge: string[] = [];
  if (cell.periodOverride) overrideBadge.push('Период');
  if (cell.sourceOverride !== undefined)
    overrideBadge.push(cell.sourceOverride ? (SOURCE_LABELS[cell.sourceOverride]?.label ?? 'Источник') : 'Все источники');
  if (cell.sourceBindingOverride !== undefined) {
    const b = cell.sourceBindingOverride;
    overrideBadge.push(
      b.mode === 'empty'
        ? 'Источник: пусто'
        : b.mode === 'global'
          ? 'Источник: глобально'
          : 'Источник: блок',
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded-md border border-border/60 bg-card">
      <div className="flex items-center gap-1.5 p-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          title="Перетащить"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: cell.accentColor ?? meta.accent }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">
            {cell.label ?? meta.label}
          </div>
          {overrideBadge.length > 0 && (
            <div className="truncate text-[10px] text-muted-foreground">
              override: {overrideBadge.join(' · ')}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          className={
            'inline-flex h-6 w-6 items-center justify-center rounded transition hover:bg-accent ' +
            (expanded ? 'bg-accent/50' : '')
          }
          title="Настройки ячейки"
        >
          <Settings2 className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          title="Удалить"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-border/40 bg-muted/20 p-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Метрика</Label>
              <select
                value={cell.metric}
                onChange={(e) => onPatch({ metric: e.target.value as Metric })}
                className="h-7 w-full rounded border border-border/60 bg-background px-1.5 text-xs"
              >
                {(['income', 'expense', 'balance', 'count'] as Metric[]).map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Формат</Label>
              <select
                value={cell.format}
                onChange={(e) => onPatch({ format: e.target.value as Cell['format'] })}
                className="h-7 w-full rounded border border-border/60 bg-background px-1.5 text-xs"
              >
                {FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Подпись (override)</Label>
            <Input
              value={cell.label ?? ''}
              onChange={(e) => onPatch({ label: e.target.value || undefined })}
              className="h-7 text-xs"
              placeholder={METRIC_LABELS[cell.metric].label}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">Период</Label>
              <button
                type="button"
                onClick={() =>
                  onPatch({
                    periodOverride: cell.periodOverride
                      ? null
                      : { preset: 'mtd' as PeriodPreset, customFrom: null, customTo: null },
                  })
                }
                className="text-[10px] text-primary hover:underline"
              >
                {cell.periodOverride ? 'Использовать глобальный' : 'Локальный'}
              </button>
            </div>
            {cell.periodOverride && (
              <PeriodPicker
                value={cell.periodOverride as PeriodValue}
                onChange={(v) =>
                  onPatch({
                    periodOverride: {
                      preset: v.preset,
                      customFrom: v.customFrom ?? null,
                      customTo: v.customTo ?? null,
                    },
                  })
                }
              />
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">Источник</Label>
              <button
                type="button"
                onClick={() =>
                  onPatch({
                    sourceOverride: cell.sourceOverride === undefined ? null : undefined,
                  })
                }
                className="text-[10px] text-primary hover:underline"
              >
                {cell.sourceOverride === undefined ? 'Локальный' : 'Использовать глобальный'}
              </button>
            </div>
            {cell.sourceOverride !== undefined && (
              <SourceFilterChips
                value={cell.sourceOverride}
                onChange={(v) => onPatch({ sourceOverride: v })}
                size="xs"
              />
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">Источник данных (override)</Label>
              {cell.sourceBindingOverride !== undefined && (
                <button
                  type="button"
                  onClick={() => onPatch({ sourceBindingOverride: undefined })}
                  className="text-[10px] text-primary hover:underline"
                >
                  Наследовать
                </button>
              )}
            </div>
            {cell.sourceBindingOverride === undefined ? (
              <div className="rounded-md border border-dashed border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground">
                Ячейка наследует block-level binding (
                {defaultBinding.mode === 'empty'
                  ? 'пусто'
                  : defaultBinding.mode === 'global'
                    ? 'глобально'
                    : `блок ${defaultBinding.blockId.slice(0, 6)}…`}
                ).{' '}
                <button
                  type="button"
                  onClick={() =>
                    onPatch({ sourceBindingOverride: { mode: 'global' } })
                  }
                  className="text-primary hover:underline"
                >
                  Задать свой
                </button>
              </div>
            ) : (
              <SourceBindingPicker
                value={cell.sourceBindingOverride}
                onChange={(next) => onPatch({ sourceBindingOverride: next })}
                selfBlockId={selfBlockId}
                allBlocks={allBlocks}
                blockLabels={blockLabels}
                pageKey={pageKey}
                showResetToInherit
                onResetToInherit={() => onPatch({ sourceBindingOverride: undefined })}
                inheritedLabel={
                  defaultBinding.mode === 'empty'
                    ? 'пусто'
                    : defaultBinding.mode === 'global'
                      ? 'глобально'
                      : 'блок'
                }
              />
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Акцент (HEX)</Label>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={cell.accentColor ?? METRIC_LABELS[cell.metric].accent}
                onChange={(e) => onPatch({ accentColor: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-border/60"
              />
              {cell.accentColor && (
                <button
                  type="button"
                  onClick={() => onPatch({ accentColor: undefined })}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Сбросить
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Категория (опц.)</Label>
              <Input
                value={cell.categoryName ?? ''}
                onChange={(e) => onPatch({ categoryName: e.target.value || undefined })}
                className="h-7 text-xs"
                placeholder="Например: Маркетинг"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Контрагент (опц.)</Label>
              <Input
                value={cell.counterparty ?? ''}
                onChange={(e) => onPatch({ counterparty: e.target.value || undefined })}
                className="h-7 text-xs"
                placeholder="ИП Иванов"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
