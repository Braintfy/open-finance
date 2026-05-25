// PURPOSE: Shared UI primitives for block SettingsForm components.
// Guarantees visual consistency across all settings dialogs:
//   SettingsSection — label section wrapper
//   SettingsToggleRow — bordered row with Switch + optional Reset
//   KopecksRow — money toggle with null/true/false semantics
//   SettingsSegmented — button grid for mutually-exclusive options
//   SettingsSliderRow — range + number-input combo
'use client';

import type { ReactNode } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

// ─── SettingsSection ──────────────────────────────────────────────────────────
/** Wrapper with uppercase tracking-wide micro-label and optional inline hint. */
export function SettingsSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── SettingsToggleRow ────────────────────────────────────────────────────────
/** Bordered row with label, optional description, a Switch and optional Reset button. */
export function SettingsToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  onReset,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium">{label}</div>
        {description !== undefined && (
          <div className="text-[11px] text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Сбросить
          </button>
        )}
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  );
}

// ─── KopecksRow ───────────────────────────────────────────────────────────────
/**
 * Specialised toggle for showKopecks:
 *   null/undefined → "Глобальная настройка" (Reset button hidden)
 *   true           → "1 234,56 ₽"
 *   false          → "1 235 ₽"
 * Passing null via onChange resets to global.
 */
export function KopecksRow({
  value,
  onChange,
}: {
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
}) {
  const description =
    value === null || value === undefined
      ? 'Глобальная настройка'
      : value
        ? '1 234,56 ₽'
        : '1 235 ₽';

  return (
    <SettingsToggleRow
      label="Показывать копейки"
      description={description}
      checked={value ?? false}
      onCheckedChange={(v) => onChange(v)}
      onReset={
        value !== null && value !== undefined ? () => onChange(null) : undefined
      }
    />
  );
}

// ─── SettingsSegmented ────────────────────────────────────────────────────────
/**
 * Button grid for selecting one option from a small set (3–12 items).
 * Uses shadcn Button variant="default" (active) / "outline" (inactive).
 * `cols` controls grid columns; defaults to min(options.length, 4).
 */
export function SettingsSegmented<T extends string>({
  value,
  onChange,
  options,
  cols,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; hint?: string; disabled?: boolean }>;
  cols?: number;
}) {
  const colCount = cols ?? Math.min(options.length, 4);
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => (
        <Button
          key={opt.value}
          type="button"
          size="sm"
          variant={value === opt.value ? 'default' : 'outline'}
          onClick={() => onChange(opt.value)}
          disabled={opt.disabled}
          title={opt.hint}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

// ─── SettingsSliderRow ────────────────────────────────────────────────────────
/**
 * Labelled range slider + numeric input.
 * Pattern matches SizeRow in block-settings-dialog.tsx.
 */
export function SettingsSliderRow({
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
        <Label className="text-xs">
          {label}: <span className="font-semibold tabular-nums">{value}</span>
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
