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
import type { BlockAppearance, BlockDef, BlockDependencies, BlockInstance } from '@/lib/blocks/types';
import { ACCENT_COLORS, ICON_NAMES } from '@/lib/blocks/types';
import { resolveIcon } from '@/lib/blocks/icon-resolver';
import { cn } from '@/lib/utils';
import { BlockReferencePicker } from './block-reference-picker';

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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Настройки блока</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{def.displayName}</span> —{' '}
            <span className="text-muted-foreground">{def.description}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 border-b px-6">
          <div className="flex gap-1">
            {TABS.map((t) => {
              if (t.key === 'params' && !def.SettingsForm) return null;
              if (t.key === 'links' && !def.supportsDependencies) return null;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'px-3 py-2 text-sm font-medium transition border-b-2',
                    tab === t.key
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pt-2">
          {tab === 'params' && def.SettingsForm && (
            <def.SettingsForm
              config={instance.config ?? {}}
              instance={instance}
              onChange={(config) => onChange({ config })}
            />
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
              onChange={(aiPrompt) =>
                onChange({ aiPrompt: aiPrompt.length > 0 ? aiPrompt : undefined })
              }
            />
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      {/* Live preview */}
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Превью
        </div>
        <div
          className="mt-1.5 flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm"
          style={{ borderColor: previewBorder }}
        >
          <PreviewIcon className="h-4 w-4 shrink-0" style={{ color: previewAccent }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" style={{ color: previewAccent }}>
              {appearance.title || defaultTitle}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {w} × {h} ячеек grid
            </div>
          </div>
        </div>
      </div>

      {/* Заголовок */}
      <div className="space-y-1.5">
        <Label htmlFor="block-title">Заголовок</Label>
        <Input
          id="block-title"
          value={appearance.title ?? ''}
          placeholder={defaultTitle}
          onChange={(e) => setAppearance('title', e.target.value || undefined)}
        />
      </div>

      {/* Цвета */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Цвет рамки</Label>
          <ColorPalette
            value={appearance.borderColor}
            onChange={(v) => setAppearance('borderColor', v || undefined)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Цвет акцента</Label>
          <ColorPalette
            value={appearance.accentColor}
            onChange={(v) => setAppearance('accentColor', v || undefined)}
          />
          <p className="text-[11px] text-muted-foreground">Иконки и значения внутри блока</p>
        </div>
      </div>

      {/* Иконка */}
      <div className="space-y-1.5">
        <Label>Иконка</Label>
        <IconPalette
          value={appearance.icon}
          onChange={(v) => setAppearance('icon', v || undefined)}
        />
        <p className="text-[11px] text-muted-foreground">
          По умолчанию:{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{defaultIcon}</code>
        </p>
      </div>

      {/* Размер */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Размер
          </Label>
          <div className="flex gap-1">
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
                      : 'bg-muted text-muted-foreground hover:bg-accent',
                  )}
                  title={`${p.w}×${p.h}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <SizeRow
          label="Ширина (колонок из 12)"
          value={w}
          min={minW}
          max={12}
          onChange={(v) => onSizeChange({ w: v, h })}
        />
        <SizeRow
          label="Высота (строк grid'а)"
          value={h}
          min={minH}
          max={20}
          onChange={(v) => onSizeChange({ w, h: v })}
        />
        <p className="text-[11px] text-muted-foreground">
          Размер влияет на плотность контента блока (xs/sm/md/lg). Большинство блоков
          сами выбирают компактный вид при маленьком размере.
        </p>
      </div>
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
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
          className="h-7 w-16 rounded-md border border-input bg-background px-2 text-right text-xs tabular-nums"
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
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>min: {min}</span>
        <span>max: {max}</span>
      </div>
    </div>
  );
}

// ============================================================================
// AI / Master prompt
// ============================================================================

const PROMPT_TIPS: Record<string, string> = {
  'custom.data':
    'AI получит таблицу с label-колонкой и N value-колонок. Подскажи модель, какие данные тут хранятся, и как заполнять/пересчитывать строки.',
  sheet:
    'AI получит формулы и значения ячеек. Опиши назначение таблицы и допустимые операции.',
  'excel.cell':
    'AI получит формулу ячейки и связанные блоки. Опиши, какое значение должна вычислять ячейка.',
  'ai.micro-agent':
    'Базовый промпт ассистента. Описывай тон, фокус и формат ответов AI для этого блока.',
};

function AiPromptForm({
  blockTypeLabel,
  blockType,
  value,
  onChange,
}: {
  blockTypeLabel: string;
  blockType: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const tip = PROMPT_TIPS[blockType];
  const len = value.length;
  const approxTokens = Math.ceil(len / 4);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] text-muted-foreground">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div>
          <div className="font-medium text-foreground">Master-промпт блока</div>
          <p className="mt-0.5">
            Этот текст добавляется к запросу AI при любом обращении к блоку.
            AI прочитает его перед обработкой запроса пользователя. Глобальные
            дефолты по типу блока появятся позже.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="block-prompt">Текст промпта</Label>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              title="Очистить и использовать шаблон по умолчанию"
            >
              <RotateCcw className="h-3 w-3" />
              Сбросить
            </button>
          )}
        </div>
        <textarea
          id="block-prompt"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          placeholder={
            tip ??
            `Доп. инструкция для AI при работе с блоком "${blockTypeLabel}". Например: что хранится, как считать, в каком тоне отвечать.`
          }
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] leading-relaxed shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            Шаблон по типу блока: <code className="rounded bg-muted px-1">{blockType}</code>
            {' '}— ещё не задан
          </span>
          <span className="tabular-nums">
            {len} симв · ≈ {approxTokens} токенов
          </span>
        </div>
      </div>

      {tip && (
        <div className="rounded-md bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Подсказка:</span> {tip}
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

      <div className="space-y-1.5">
        <Label>Цвет рамки</Label>
        <ColorPalette
          value={appearance.borderColor}
          onChange={(v) => set('borderColor', v || undefined)}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Цвет акцента</Label>
        <ColorPalette
          value={appearance.accentColor}
          onChange={(v) => set('accentColor', v || undefined)}
        />
        <p className="text-[11px] text-muted-foreground">
          Используется для иконок и значений внутри блока
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Иконка</Label>
        <IconPalette
          value={appearance.icon}
          onChange={(v) => set('icon', v || undefined)}
        />
        <p className="text-[11px] text-muted-foreground">
          По умолчанию: <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{defaultIcon}</code>
        </p>
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
        return (
          <button
            key={c.name}
            type="button"
            onClick={() => onChange(c.value)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded border transition',
              active ? 'ring-2 ring-primary ring-offset-1' : 'hover:scale-110'
            )}
            style={{
              backgroundColor: c.value || 'transparent',
              borderColor: c.value ? c.value : 'hsl(var(--border))',
            }}
            title={c.name}
          >
            {active && (
              <Check
                className="h-3 w-3"
                style={{ color: c.value ? 'white' : 'currentColor' }}
              />
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

  return (
    <>
      <div className="grid grid-cols-10 gap-1">
        <button
          type="button"
          onClick={() => onChange('')}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded border text-xs text-muted-foreground transition',
            !value ? 'ring-2 ring-primary' : 'hover:bg-accent'
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
                'flex h-8 w-8 items-center justify-center rounded border transition',
                active ? 'ring-2 ring-primary' : 'hover:bg-accent'
              )}
              title={n}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 w-full"
        onClick={() => setModalOpen(true)}
      >
        <Grid3X3 className="h-3.5 w-3.5" />
        Выбрать из каталога ({'>'}1500 иконок)
      </Button>
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
