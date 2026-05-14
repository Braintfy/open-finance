// PURPOSE: Универсальный data-блок (custom.data) — Excel-style ячейка с произвольными данными.
// User может вручную добавлять/редактировать строки; в будущем — AI-функция автозаполнения.
// Каждая строка имеет label + value (number/string), сам блок публикует агрегаты как output.
'use client';

import { useState } from 'react';
import { Database, Plus, Trash2, Sparkles } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { CurrencyInput } from '@/components/ui/currency-input';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useBlockValuePublisher } from '../values';

// ============================================================================
// Конфиг
// ============================================================================

const RowSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number(),
});
type Row = z.infer<typeof RowSchema>;

const ConfigSchema = z.object({
  rows: z.array(RowSchema).default([]),
  /** Что публикуется в output: 'sum' | 'avg' | 'count' | 'last' */
  publishMode: z.enum(['sum', 'avg', 'count', 'last']).default('sum'),
  /** Формат значений: 'rubles' (₽) | 'number' | 'percent' */
  format: z.enum(['rubles', 'number', 'percent']).default('rubles'),
  /** Показывать копейки (per-block override, null = использовать глобальную настройку) */
  showKopecks: z.boolean().nullable().default(null),
});
type Config = z.infer<typeof ConfigSchema>;

function parseConfig(raw: unknown): Config {
  const r = ConfigSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  return { rows: [], publishMode: 'sum', format: 'rubles', showKopecks: null };
}

function formatValue(v: number, format: Config['format'], showKopecks: boolean): string {
  if (format === 'rubles') return formatRublesWithSettings(v, showKopecks);
  if (format === 'percent') return `${(v / 100).toFixed(1)}%`;
  return v.toLocaleString('ru-RU');
}

function computePublishValue(rows: Row[], mode: Config['publishMode']): number {
  if (rows.length === 0) return 0;
  switch (mode) {
    case 'sum':
      return rows.reduce((s, r) => s + r.value, 0);
    case 'avg':
      return rows.reduce((s, r) => s + r.value, 0) / rows.length;
    case 'count':
      return rows.length;
    case 'last':
      return rows[rows.length - 1]?.value ?? 0;
  }
}

function makeRowId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

// ============================================================================
// Render
// ============================================================================

function RenderCustomData({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const density = useBlockDensity();
  const { settings: globalSettings } = useFormatSettings();
  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;
  const accent = instance.appearance?.accentColor;
  const title = instance.appearance?.title ?? 'Данные';
  const publishValue = computePublishValue(config.rows, config.publishMode);
  const total = config.rows.reduce((s, r) => s + r.value, 0);

  // Публикуем агрегированное значение для других блоков
  useBlockValuePublisher(instance.id, {
    value: publishValue,
    sum: total,
    count: config.rows.length,
    label: title,
    // money только если формат рублёвый. value money, только если publishMode != 'count'
    __money:
      config.format === 'rubles'
        ? config.publishMode === 'count'
          ? 'sum'
          : 'value,sum'
        : '',
  });

  function addRow() {
    const next: Config = {
      ...config,
      rows: [...config.rows, { id: makeRowId(), label: 'Новая строка', value: 0 }],
    };
    onConfigChange?.(next as unknown as Record<string, unknown>);
  }

  function updateRow(id: string, patch: Partial<Row>) {
    const next: Config = {
      ...config,
      rows: config.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    };
    onConfigChange?.(next as unknown as Record<string, unknown>);
  }

  function removeRow(id: string) {
    const next: Config = { ...config, rows: config.rows.filter((r) => r.id !== id) };
    onConfigChange?.(next as unknown as Record<string, unknown>);
  }

  // XS — только итог
  if (density === 'xs') {
    return (
      <Card className="flex h-full flex-col justify-center p-1">
        <div
          className="truncate text-center text-sm font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {formatValue(publishValue, config.format, showKopecks)}
        </div>
      </Card>
    );
  }

  // SM — title + итог
  if (density === 'sm') {
    return (
      <Card className="flex h-full flex-col justify-center p-2">
        <div className="flex items-center gap-1">
          <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium text-muted-foreground">{title}</span>
        </div>
        <div
          className="mt-0.5 truncate text-lg font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {formatValue(publishValue, config.format, showKopecks)}
        </div>
      </Card>
    );
  }

  // MD/LG — полный вид с таблицей
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Database className="h-4 w-4" style={accent ? { color: accent } : undefined} />
          <span className="line-clamp-1">{title}</span>
        </CardTitle>
        <div
          className="text-base font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {formatValue(publishValue, config.format, showKopecks)}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-1.5 overflow-y-auto pb-3 pt-1">
        {config.rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-center text-xs text-muted-foreground">
            <Database className="mx-auto mb-1 h-4 w-4" />
            Нет данных. Добавьте строки или используйте AI-автозаполнение.
          </div>
        ) : (
          <div className="space-y-1">
            {config.rows.map((row) => (
              <div
                key={row.id}
                className="group/row flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 px-2 py-1"
              >
                <Input
                  value={row.label}
                  onChange={(e) => updateRow(row.id, { label: e.target.value })}
                  className="h-7 flex-1 border-none bg-transparent px-1 text-xs shadow-none focus-visible:bg-background"
                  placeholder="Название"
                />
                <CurrencyInput
                  value={row.value}
                  showKopecks={config.format === 'rubles' ? showKopecks : false}
                  onChange={(v) => updateRow(row.id, { value: v })}
                  className="h-7 w-24 border-none bg-transparent px-1 text-right text-xs tabular-nums shadow-none focus-visible:bg-background"
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="opacity-0 transition group-hover/row:opacity-100"
                  aria-label="Удалить строку"
                >
                  <Trash2 className="h-3 w-3 text-red-500" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-1 pt-1">
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
            className="h-7 text-xs"
            disabled
            title="AI-автозаполнение из истории операций (скоро)"
          >
            <Sparkles className="h-3 w-3" /> AI
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// SettingsForm — параметры (publishMode + format)
// ============================================================================

function CustomDataSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);

  function set<K extends keyof Config>(key: K, value: Config[K]) {
    onChange({ ...parsed, [key]: value } as unknown as Record<string, unknown>);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Что публиковать как значение блока</Label>
        <div className="flex flex-wrap gap-1">
          {(['sum', 'avg', 'count', 'last'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set('publishMode', m)}
              className={
                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors ' +
                (parsed.publishMode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent')
              }
            >
              {m === 'sum' && 'Сумма'}
              {m === 'avg' && 'Среднее'}
              {m === 'count' && 'Количество'}
              {m === 'last' && 'Последнее'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Это значение будет доступно другим блокам (computed.sum) как источник.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Формат значений</Label>
        <div className="flex flex-wrap gap-1">
          {(['rubles', 'number', 'percent'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => set('format', f)}
              className={
                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors ' +
                (parsed.format === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent')
              }
            >
              {f === 'rubles' && '₽ Рубли'}
              {f === 'number' && '# Число'}
              {f === 'percent' && '% Процент'}
            </button>
          ))}
        </div>
      </div>

      {parsed.format === 'rubles' && (
        <div className="space-y-1.5">
          <Label>Копейки</Label>
          <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium">Показывать копейки</div>
              <div className="text-[11px] text-muted-foreground">
                {parsed.showKopecks === null
                  ? 'Используется глобальная настройка'
                  : parsed.showKopecks
                    ? 'Включено (1 234,56 ₽)'
                    : 'Выключено (1 235 ₽)'}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {parsed.showKopecks !== null && (
                <button
                  type="button"
                  onClick={() => set('showKopecks', null)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Сбросить
                </button>
              )}
              <Switch
                checked={parsed.showKopecks ?? false}
                onCheckedChange={(v) => set('showKopecks', v)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
        Строки данных редактируются прямо в блоке (нажмите на текст или число). AI-автозаполнение
        из истории операций — в разработке.
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
    'Произвольные строки label + значение. Excel-style ячейка для ручного ввода или AI-автозаполнения.',
  category: 'custom',
  icon: Database,
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  minContentSize: { w: 200, h: 100 },
  pages: ['*'],
  configSchema: ConfigSchema,
  defaultConfig: () => ({ rows: [], publishMode: 'sum', format: 'rubles', showKopecks: null }),
  supportsDependencies: false, // сам публикует значения, но не зависит от других
  SettingsForm: CustomDataSettingsForm,
  Render: RenderCustomData,
};
