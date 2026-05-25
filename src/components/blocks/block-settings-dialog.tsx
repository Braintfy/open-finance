// PURPOSE: Универсальная настройка существующего блока (параметры + связи + стиль/размер + AI-промпт)
'use client';

import { useState, lazy, Suspense } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Check, Square, Grid3X3, Sparkles, RotateCcw } from 'lucide-react';
import type {
  BlockAppearance,
  BlockDef,
  BlockDependencies,
  BlockInstance,
  SourceBinding,
} from '@/lib/blocks/types';
import { ACCENT_COLORS, ICON_NAMES } from '@/lib/blocks/types';
import { resolveIcon } from '@/lib/blocks/icon-resolver';
import { cn } from '@/lib/utils';
import { BlockReferencePicker } from './block-reference-picker';
import { SourceBindingPicker } from './source-binding-picker';
import { isBoundBlockType, readSourceBindingField } from '@/lib/blocks/source-binding';

const IconPickerModal = lazy(() =>
  import('./icon-picker-modal').then((m) => ({ default: m.IconPickerModal }))
);

const TABS = [
  { key: 'params', label: 'Параметры' },
  { key: 'links', label: 'Связи' },
  { key: 'style', label: 'Стиль и размер' },
  { key: 'ai', label: 'AI / Промпт' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function BlockSettingsDialog({
  open,
  onClose,
  def,
  instance,
  blockLabels,
  allBlocks,
  pageKey,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  def: BlockDef;
  instance: BlockInstance;
  /** Map blockId → label всех блоков страницы (для BlockReferencePicker) */
  blockLabels?: Record<string, string>;
  /** Все блоки на странице — для cycle detection в BlockReferencePicker */
  allBlocks?: BlockInstance[];
  /** Текущая страница — для аннотации pageKey в SourceBinding (cross-page). */
  pageKey?: string;
  onChange: (next: Partial<BlockInstance>) => void;
}) {
  const initialTab: TabKey = def.SettingsForm
    ? 'params'
    : def.supportsDependencies
      ? 'links'
      : 'style';
  const [tab, setTab] = useState<TabKey>(initialTab);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        {/* Header — компактный, описание блока на одну строку с тултипом */}
        <DialogHeader className="border-b border-border/60 px-5 py-3">
          <DialogTitle className="text-sm font-semibold">Настройки блока</DialogTitle>
          <DialogDescription className="line-clamp-1 text-[11px]">
            <span className="font-medium text-foreground">{def.displayName}</span>
            <span className="mx-1 text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{def.description}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Tabs — тонкая панель без double padding */}
        <div className="border-b border-border/60 bg-muted/20 px-5">
          <div className="flex gap-0.5">
            {TABS.map((t) => {
              if (t.key === 'params' && !def.SettingsForm) return null;
              if (t.key === 'links' && !def.supportsDependencies) return null;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'relative px-3 py-2 text-xs font-medium transition',
                    tab === t.key
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                  {tab === t.key && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-t bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
          {tab === 'params' && def.SettingsForm && (
            <div className="space-y-4">
              {isBoundBlockType(def.type) && (
                <SourceBindingSection
                  blockType={def.type}
                  config={(instance.config ?? {}) as Record<string, unknown>}
                  instanceId={instance.id}
                  allBlocks={allBlocks}
                  blockLabels={blockLabels}
                  pageKey={pageKey}
                  onConfigChange={(nextConfig) =>
                    onChange({ config: nextConfig })
                  }
                />
              )}
              <def.SettingsForm
                config={instance.config ?? {}}
                instance={instance}
                pageKey={pageKey}
                allBlocks={allBlocks}
                blockLabels={blockLabels}
                onChange={(config) => onChange({ config })}
              />
            </div>
          )}

          {tab === 'links' && def.supportsDependencies && (
            <BlockReferencePicker
              value={instance.dependencies}
              config={instance.config}
              selfBlockId={instance.id}
              allBlocks={allBlocks}
              blockLabels={blockLabels}
              onChange={(deps: BlockDependencies) => onChange({ dependencies: deps })}
            />
          )}

          {tab === 'style' && (
            <StyleAndSizeForm
              defaultTitle={def.displayName}
              defaultIcon={def.iconName ?? def.icon?.displayName ?? 'Square'}
              appearance={instance.appearance ?? {}}
              w={instance.w}
              h={instance.h}
              minW={def.minSize.w}
              minH={def.minSize.h}
              onAppearanceChange={(appearance) => onChange({ appearance })}
              onSizeChange={({ w, h }) => onChange({ w, h })}
            />
          )}

          {tab === 'ai' && (
            <AiPromptForm
              blockTypeLabel={def.displayName}
              blockType={def.type}
              value={instance.aiPrompt ?? ''}
              supplementValue={instance.aiPromptSupplement ?? ''}
              onChangeCompat={(aiPrompt) =>
                onChange({ aiPrompt: aiPrompt.length > 0 ? aiPrompt : undefined })
              }
              onChangeSupplement={(supplement) =>
                onChange({ aiPromptSupplement: supplement.length > 0 ? supplement.slice(0, 500) : undefined })
              }
            />
          )}
        </div>

        <DialogFooter className="border-t border-border/60 bg-muted/20 px-5 py-2.5">
          <Button size="sm" onClick={onClose}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Source binding section (общая для BOUND_BLOCK_TYPES)
// ============================================================================

/**
 * Универсальная секция «Источник данных» для всех cashflow-консьюмеров.
 *
 * Особенность: для `kpi.grid` сохраняем в config `defaultSourceBinding`
 * (по аналогии с `defaultPeriodOverride`), для остальных блоков —
 * в config `sourceBinding`.
 *
 * Это позволяет избежать дублирования UI секции в каждой `SettingsForm`,
 * сохраняя кастомизацию per-cell (kpi.grid делает свой кастомный per-cell
 * UI в `kpi-grid-settings.tsx`).
 */
function SourceBindingSection({
  blockType,
  config,
  instanceId,
  allBlocks,
  blockLabels,
  pageKey,
  onConfigChange,
}: {
  blockType: string;
  config: Record<string, unknown>;
  instanceId: string;
  allBlocks?: BlockInstance[];
  blockLabels?: Record<string, string>;
  pageKey?: string;
  onConfigChange: (nextConfig: Record<string, unknown>) => void;
}) {
  const fieldName = blockType === 'kpi.grid' ? 'defaultSourceBinding' : 'sourceBinding';
  const current: SourceBinding =
    readSourceBindingField(config, fieldName) ?? { mode: 'empty' };
  return (
    <SourceBindingPicker
      value={current}
      onChange={(next) =>
        onConfigChange({
          ...config,
          [fieldName]: next,
        })
      }
      selfBlockId={instanceId}
      allBlocks={allBlocks}
      pageKey={pageKey}
      blockLabels={blockLabels}
    />
  );
}

// ============================================================================
// Style & size — объединённая вкладка
// ============================================================================

const SIZE_PRESETS: Array<{ id: string; label: string; w: number; h: number }> = [
  { id: 'small', label: 'Маленький', w: 3, h: 2 },
  { id: 'medium', label: 'Средний', w: 4, h: 3 },
  { id: 'large', label: 'Большой', w: 6, h: 4 },
  { id: 'wide', label: 'Широкий', w: 12, h: 4 },
];

function StyleAndSizeForm({
  defaultTitle,
  defaultIcon,
  appearance,
  w,
  h,
  minW,
  minH,
  onAppearanceChange,
  onSizeChange,
}: {
  defaultTitle: string;
  defaultIcon: string;
  appearance: BlockAppearance;
  w: number;
  h: number;
  minW: number;
  minH: number;
  onAppearanceChange: (next: BlockAppearance) => void;
  onSizeChange: (size: { w: number; h: number }) => void;
}) {
  const PreviewIcon = resolveIcon(appearance.icon ?? defaultIcon, Square);
  const previewBorder = appearance.borderColor || 'hsl(var(--border))';
  const previewAccent = appearance.accentColor || 'hsl(var(--primary))';

  function setAppearance<K extends keyof BlockAppearance>(key: K, value: BlockAppearance[K]) {
    onAppearanceChange({ ...appearance, [key]: value });
  }

  return (
    <div className="space-y-4">
      {/* Header row — preview + title side-by-side для плотности */}
      <div className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
        {/* Live preview — компактный chip */}
        <div className="flex flex-col">
          <Label className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Превью
          </Label>
          <div
            className="flex flex-1 items-center gap-2 rounded-md border bg-card px-2.5 py-2 shadow-sm"
            style={{ borderColor: previewBorder }}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ background: `${previewAccent}1a` }}
            >
              <PreviewIcon className="h-4 w-4" style={{ color: previewAccent }} />
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-xs font-semibold"
                style={{ color: previewAccent }}
              >
                {appearance.title || defaultTitle}
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {w}×{h} grid
              </div>
            </div>
          </div>
        </div>

        {/* Title input */}
        <div className="flex flex-col">
          <Label htmlFor="block-title" className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Заголовок
          </Label>
          <Input
            id="block-title"
            value={appearance.title ?? ''}
            placeholder={defaultTitle}
            onChange={(e) => setAppearance('title', e.target.value || undefined)}
            className="h-9"
          />
        </div>
      </div>

      {/* Colors — две палитры в одной плоскости */}
      <div className="grid gap-3 md:grid-cols-2">
        <ColorSection
          label="Цвет рамки"
          value={appearance.borderColor}
          onChange={(v) => setAppearance('borderColor', v || undefined)}
        />
        <ColorSection
          label="Цвет акцента"
          hint="Иконки и значения"
          value={appearance.accentColor}
          onChange={(v) => setAppearance('accentColor', v || undefined)}
        />
      </div>

      {/* Иконка */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Иконка
          </Label>
          <span className="text-[10px] text-muted-foreground">
            По умолч.{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[9px]">
              {defaultIcon}
            </code>
          </span>
        </div>
        <IconPalette
          value={appearance.icon}
          onChange={(v) => setAppearance('icon', v || undefined)}
        />
      </div>

      {/* Размер */}
      <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Размер · {w}×{h}
          </Label>
          <div className="flex gap-0.5">
            {SIZE_PRESETS.map((p) => {
              const active = w === p.w && h === p.h;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSizeChange({ w: Math.max(minW, p.w), h: Math.max(minH, p.h) })}
                  className={cn(
                    'h-6 rounded px-2 text-[10px] font-medium transition',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground ring-1 ring-border hover:bg-accent hover:text-foreground',
                  )}
                  title={`${p.w}×${p.h}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SizeRow
            label="Ширина"
            value={w}
            min={minW}
            max={12}
            onChange={(v) => onSizeChange({ w: v, h })}
          />
          <SizeRow
            label="Высота"
            value={h}
            min={minH}
            max={20}
            onChange={(v) => onSizeChange({ w, h: v })}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Размер влияет на плотность контента (xs/sm/md/lg) — большинство блоков сами
          переключают вид.
        </p>
      </div>
    </div>
  );
}

function ColorSection({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      <ColorPalette value={value} onChange={onChange} />
    </div>
  );
}

function SizeRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] text-muted-foreground">
          {label} <span className="text-muted-foreground/60">({min}–{max})</span>
        </Label>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(Math.min(max, Math.max(min, n)));
          }}
          className="h-6 w-12 rounded-md border border-input bg-background px-1.5 text-right text-xs tabular-nums"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

// ============================================================================
// AI / Master prompt
// ============================================================================

/** Ленивая загрузка BLOCK_SKILLS — избегаем server/client bundle проблем */
function useBlockSkill(blockType: string): string {
  // Синхронно читаем из глобального реестра через динамический import невозможно в sync коде,
  // поэтому используем встроенную таблицу типов из block-capabilities (уже в client bundle).
  // Полный BLOCK_SKILLS доступен только на сервере — для UI достаточно подсказки по типу.
  const SKILL_HINTS: Record<string, string> = {
    'stat.income': 'Анализирует входящие транзакции, сравнивает периоды, выявляет аномалии.',
    'stat.expense': 'Анализирует расходы, находит крупные статьи, предлагает оптимизацию.',
    'stat.balance': 'Анализирует баланс (доходы − расходы), тренды cash flow.',
    'stat.custom': 'KPI с фильтрами по категории/контрагенту. Сравнивает с бенчмарками.',
    'cashflow.top-categories': 'Топ категорий расходов/доходов. Выявляет основные статьи.',
    'cashflow.transactions': 'Список операций. Помогает с категоризацией и поиском.',
    'chart.cashflow': 'Временные ряды денежного потока. Находит сезонность и тренды.',
    'kpi.grid': 'Настраиваемая сетка KPI с ячейками и формулами.',
    'sheet': 'Excel-таблица с ячейками и формулами. Помогает писать =SUM, =AVG и т.д.',
    'excel.cell': 'Одна ячейка с формулой или значением. Проверяет формульные цепочки.',
    'custom.data': 'Многоколоночная таблица данных (Notion-style). Формулы и привязки.',
    'computed.sum': 'Агрегирует данные из других блоков (sum/avg/min/max/formula).',
    'unit.ozon-kpi': 'KPI Ozon: выручка, заказы, ДРР, AOV, CPO. Сравнивает периоды.',
    'unit.ozon-analytics': 'Per-SKU аналитика Ozon. Находит лучшие и худшие товары.',
    'unit.ozon-campaigns': 'Рекламные кампании Ozon. ROI, расходы, эффективность.',
    'unit.ozon-chart': 'Временные ряды Ozon. Выявляет тренды и аномалии.',
    'unit.ozon-calculator': 'Калькулятор юнит-экономики SKU. Маржа, ROI, точка безубыточности.',
    'unit.ozon-abc': 'ABC-анализ SKU по выручке. Приоритизация ассортимента.',
    'unit.yandex-calculator': 'Юнит-экономика Яндекс Маркет. Сравнивает с Ozon.',
    'inbox.channel-feed': 'Лента входящих писем. Категоризация и распознавание документов.',
    'currency.rates': 'Курсы ЦБ. Конвертации, влияние на бизнес-показатели.',
    'ai.micro-agent': 'AI-ассистент. Описывай тон, фокус и формат ответов для этого блока.',
  };
  return SKILL_HINTS[blockType] ?? `Помогает анализировать данные блока типа «${blockType}».`;
}

function AiPromptForm({
  blockTypeLabel,
  blockType,
  value,
  supplementValue,
  onChangeCompat,
  onChangeSupplement,
}: {
  blockTypeLabel: string;
  blockType: string;
  /** @deprecated legacy aiPrompt */
  value: string;
  supplementValue: string;
  /** @deprecated onChange для legacy поля */
  onChangeCompat: (next: string) => void;
  onChangeSupplement: (next: string) => void;
}) {
  const masterSkill = useBlockSkill(blockType);
  const len = supplementValue.length;
  const MAX = 500;
  const nearLimit = len > MAX * 0.8;
  const overLimit = len > MAX;

  const hasLegacy = value.trim().length > 0 && supplementValue.trim().length === 0;

  return (
    <div className="space-y-4">
      {/* Секция 1: Master (read-only) */}
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-foreground">Универсальный навык блока</div>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">read-only</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{masterSkill}</p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Тип: <code className="rounded bg-muted px-1 font-mono text-[9px]">{blockType}</code>
              {' · '}Задаётся администратором в AI Настройках
            </p>
          </div>
        </div>
      </div>

      {/* Секция 2: User supplement */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="block-supplement" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Ваше дополнение
          </Label>
          {supplementValue.length > 0 && (
            <button
              type="button"
              onClick={() => onChangeSupplement('')}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Сбросить
            </button>
          )}
        </div>
        <textarea
          id="block-supplement"
          value={supplementValue}
          onChange={(e) => onChangeSupplement(e.target.value)}
          rows={5}
          maxLength={MAX + 50}
          placeholder={`Доп. инструкция для AI при работе с блоком "${blockTypeLabel}". До ${MAX} символов.`}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] leading-relaxed shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Добавляется поверх навыка блока в каждый AI-запрос</span>
          <span className={`tabular-nums ${overLimit ? 'text-destructive font-semibold' : nearLimit ? 'text-orange-500' : ''}`}>
            {len}/{MAX}
          </span>
        </div>
        {overLimit && (
          <p className="text-[10px] text-destructive">Превышен лимит {MAX} символов. Текст будет обрезан при сохранении.</p>
        )}
      </div>

      {/* Секция 3: Legacy migration notice */}
      {hasLegacy && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-2.5 text-[11px] dark:border-orange-900 dark:bg-orange-950">
          <div className="font-medium text-orange-800 dark:text-orange-300">Устаревший промпт</div>
          <p className="mt-0.5 text-orange-700 dark:text-orange-400">
            У этого блока есть старый промпт. Он используется как fallback. Перенесите его в поле «Ваше дополнение» выше и очистите старый через сброс ниже.
          </p>
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => {
                onChangeSupplement(value.slice(0, MAX));
                onChangeCompat('');
              }}
              className="text-[10px] font-medium text-orange-700 underline underline-offset-2 hover:text-orange-900 dark:text-orange-400"
            >
              Перенести в дополнение →
            </button>
            {' · '}
            <button
              type="button"
              onClick={() => onChangeCompat('')}
              className="text-[10px] text-orange-600 underline underline-offset-2 hover:text-orange-800 dark:text-orange-500"
            >
              Удалить старый
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Appearance form (legacy export — используется AddBlockDialog)
// ============================================================================

export function AppearanceForm({
  defaultTitle,
  defaultIcon,
  appearance,
  onChange,
}: {
  defaultTitle: string;
  defaultIcon: string;
  appearance: BlockAppearance;
  onChange: (next: BlockAppearance) => void;
}) {
  function set<K extends keyof BlockAppearance>(key: K, value: BlockAppearance[K]) {
    onChange({ ...appearance, [key]: value });
  }

  return (
    <div className="space-y-3.5">
      <div className="space-y-1.5">
        <Label htmlFor="block-title">Заголовок</Label>
        <Input
          id="block-title"
          value={appearance.title ?? ''}
          placeholder={defaultTitle}
          onChange={(e) => set('title', e.target.value || undefined)}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ColorSection
          label="Цвет рамки"
          value={appearance.borderColor}
          onChange={(v) => set('borderColor', v || undefined)}
        />
        <ColorSection
          label="Цвет акцента"
          hint="Иконки и значения"
          value={appearance.accentColor}
          onChange={(v) => set('accentColor', v || undefined)}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Иконка
          </Label>
          <span className="text-[10px] text-muted-foreground">
            По умолч.{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[9px]">
              {defaultIcon}
            </code>
          </span>
        </div>
        <IconPalette
          value={appearance.icon}
          onChange={(v) => set('icon', v || undefined)}
        />
      </div>
    </div>
  );
}

function ColorPalette({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ACCENT_COLORS.map((c) => {
        const active = (value ?? '') === c.value;
        const isDefault = !c.value;
        // Активная ячейка: яркое 2px кольцо ЦВЕТА палитры + 2px gap до фона.
        // Это даёт честный визуальный акцент даже когда цвет тёмный
        // (например #0f172a) и сливается с фоном.
        const activeRing = active
          ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${
              c.value || 'hsl(var(--primary))'
            }`
          : undefined;
        return (
          <button
            key={c.name}
            type="button"
            onClick={() => onChange(c.value)}
            className={cn(
              'relative flex h-5 w-5 shrink-0 items-center justify-center rounded transition',
              isDefault
                ? 'border border-dashed border-border bg-background'
                : 'shadow-sm hover:scale-110',
            )}
            style={{
              ...(isDefault ? null : { backgroundColor: c.value }),
              ...(activeRing ? { boxShadow: activeRing } : null),
            }}
            title={c.name}
            aria-label={c.name}
          >
            {active && (
              <Check
                className={cn(
                  'h-2.5 w-2.5',
                  isDefault ? 'text-foreground' : 'text-white drop-shadow',
                )}
                strokeWidth={3}
              />
            )}
            {!active && isDefault && (
              <span className="text-[9px] leading-none text-muted-foreground/60">
                ×
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function IconPalette({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const totalIcons = ICON_NAMES.length;

  return (
    <>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange('')}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] transition',
            !value
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
          )}
          title="По умолчанию"
        >
          —
        </button>
        {ICON_NAMES.map((n) => {
          const Icon = resolveIcon(n, Square);
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition',
                active
                  ? 'border-primary bg-primary/10 text-primary shadow-sm'
                  : 'border-transparent bg-muted/40 text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground',
              )}
              title={n}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {totalIcons} в палитре
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setModalOpen(true)}
        >
          <Grid3X3 className="h-3 w-3" />
          Каталог · 1500+
        </Button>
      </div>
      {modalOpen && (
        <Suspense fallback={null}>
          <IconPickerModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            value={value}
            onChange={onChange}
          />
        </Suspense>
      )}
    </>
  );
}

// ============================================================================
// Size form (legacy export — используется AddBlockDialog)
// ============================================================================

export function SizeForm({
  w,
  h,
  minW,
  minH,
  onChange,
}: {
  w: number;
  h: number;
  minW: number;
  minH: number;
  onChange: (size: { w: number; h: number }) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Ширина (колонок из 12)</Label>
          <span className="text-sm font-medium tabular-nums">{w}</span>
        </div>
        <input
          type="range"
          min={minW}
          max={12}
          value={w}
          onChange={(e) => onChange({ w: Number(e.target.value), h })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>min: {minW}</span>
          <span>max: 12</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Высота (строк grid'а)</Label>
          <span className="text-sm font-medium tabular-nums">{h}</span>
        </div>
        <input
          type="range"
          min={minH}
          max={20}
          value={h}
          onChange={(e) => onChange({ w, h: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>min: {minH}</span>
          <span>max: 20</span>
        </div>
      </div>

      <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
        Минимальные размеры — это нижний предел при ресайзе мышью. Через слайдеры можно поставить
        любое значение в пределах диапазона.
      </div>
    </div>
  );
}
