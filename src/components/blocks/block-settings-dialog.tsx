// PURPOSE: Универсальная настройка существующего блока (внешний вид + размер + параметры)
'use client';

import { useState } from 'react';
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
import { Check, Square } from 'lucide-react';
import type { BlockAppearance, BlockDef, BlockInstance } from '@/lib/blocks/types';
import { ACCENT_COLORS, ICON_NAMES } from '@/lib/blocks/types';
import { resolveIcon } from '@/lib/blocks/icon-resolver';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'params', label: 'Параметры' },
  { key: 'appearance', label: 'Внешний вид' },
  { key: 'size', label: 'Размер' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function BlockSettingsDialog({
  open,
  onClose,
  def,
  instance,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  def: BlockDef;
  instance: BlockInstance;
  onChange: (next: Partial<BlockInstance>) => void;
}) {
  const [tab, setTab] = useState<TabKey>(def.SettingsForm ? 'params' : 'appearance');

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
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
              const disabled = t.key === 'params' && !def.SettingsForm;
              if (disabled) return null;
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
              onChange={(config) => onChange({ config })}
            />
          )}

          {tab === 'appearance' && (
            <AppearanceForm
              defaultTitle={def.displayName}
              defaultIcon={def.icon.displayName ?? 'Square'}
              appearance={instance.appearance ?? {}}
              onChange={(appearance) => onChange({ appearance })}
            />
          )}

          {tab === 'size' && (
            <SizeForm
              w={instance.w}
              h={instance.h}
              minW={def.minSize.w}
              minH={def.minSize.h}
              onChange={({ w, h }) => onChange({ w, h })}
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
// Appearance form (универсально для всех блоков)
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
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="block-title">Заголовок</Label>
        <Input
          id="block-title"
          value={appearance.title ?? ''}
          placeholder={defaultTitle}
          onChange={(e) => set('title', e.target.value || undefined)}
        />
      </div>

      <div className="space-y-2">
        <Label>Цвет рамки</Label>
        <ColorPalette
          value={appearance.borderColor}
          onChange={(v) => set('borderColor', v || undefined)}
        />
      </div>

      <div className="space-y-2">
        <Label>Цвет акцента</Label>
        <p className="text-xs text-muted-foreground">
          Используется для иконок и прогресс-баров внутри блока
        </p>
        <ColorPalette
          value={appearance.accentColor}
          onChange={(v) => set('accentColor', v || undefined)}
        />
      </div>

      <div className="space-y-2">
        <Label>Иконка</Label>
        <p className="text-xs text-muted-foreground">
          Заменяет иконку внутри блока (если блок её показывает). По умолчанию: <code>{defaultIcon}</code>
        </p>
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
    <div className="flex flex-wrap gap-2">
      {ACCENT_COLORS.map((c) => {
        const active = (value ?? '') === c.value;
        return (
          <button
            key={c.name}
            type="button"
            onClick={() => onChange(c.value)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-md border transition',
              active ? 'ring-2 ring-primary ring-offset-2' : 'hover:scale-105'
            )}
            style={{
              backgroundColor: c.value || 'transparent',
              borderColor: c.value ? c.value : 'var(--border)',
            }}
            title={c.name}
          >
            {active && (
              <Check
                className="h-4 w-4"
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
  return (
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
  );
}

// ============================================================================
// Size form
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
