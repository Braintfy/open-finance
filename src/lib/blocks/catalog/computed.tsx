// PURPOSE: Computed-блоки — агрегируют значения других блоков (Excel-style cell references).
// Используют `dependencies` поле BlockInstance + reactive store useBlockDependencyResult.
'use client';

import { Calculator, Sigma } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { useBlockDensity } from '@/components/blocks/block-size';
import {
  useBlockDependencyResult,
  useBlockValuePublisher,
} from '../values';

function refFieldName(ref: string): string {
  const source = ref.includes(':') ? ref.slice(ref.lastIndexOf(':') + 1) : ref;
  const dot = source.lastIndexOf('.');
  return dot >= 0 ? source.slice(dot + 1) : 'value';
}

function refIsPlainNumber(ref: string): boolean {
  const field = refFieldName(ref);
  return /^[A-Z]+\d+$/.test(field) || ['count', 'raw', 'label'].includes(field);
}

function formatPlainNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

// ============================================================================
// computed.sum — агрегация значений N других блоков
// ============================================================================

const ComputedConfig = z.object({
  showKopecks: z.boolean().nullable().default(null),
});

function RenderComputedSum({ instance }: BlockRenderProps) {
  const density = useBlockDensity();
  const cfg = ComputedConfig.safeParse(instance.config ?? {});
  const { settings } = useFormatSettings();
  const showKopecks = (cfg.success ? cfg.data.showKopecks : null) ?? settings.showKopecks;
  const moneyAggregation = (instance.dependencies?.sources ?? []).some((src) => !refIsPlainNumber(`${src.blockId}.${src.field ?? 'value'}`));
  const fmt = (v: number) => moneyAggregation ? formatRublesWithSettings(v, showKopecks) : formatPlainNumber(v);
  const { value, sourceValues, missing } = useBlockDependencyResult(instance.dependencies);
  const accent = instance.appearance?.accentColor;
  const title = instance.appearance?.title ?? 'Агрегация';
  const noSources = !instance.dependencies || instance.dependencies.sources.length === 0;
  const aggregation = instance.dependencies?.aggregation ?? 'sum';

  // Сами публикуем результат — другие computed-блоки могут использовать нас как источник
  useBlockValuePublisher(instance.id, { value: value ?? 0, label: title });

  const aggregationLabel: Record<string, string> = {
    sum: 'Сумма',
    avg: 'Среднее',
    min: 'Минимум',
    max: 'Максимум',
    count: 'Количество',
    formula: 'Формула',
    ai: 'AI',
  };

  // XS — только результат
  if (density === 'xs') {
    return (
      <Card className="flex h-full flex-col justify-center p-1">
        <div
          className="truncate text-center text-sm font-semibold tabular-nums tracking-tight"
          style={accent ? { color: accent } : undefined}
        >
          {value !== null ? fmt(value) : '—'}
        </div>
      </Card>
    );
  }

  // SM — заголовок + результат
  if (density === 'sm') {
    return (
      <Card className="flex h-full flex-col justify-center p-2.5">
        <div className="flex items-center gap-1">
          <Sigma className="h-3.5 w-3.5 shrink-0" style={accent ? { color: accent } : undefined} />
          <span className="truncate text-[11px] font-medium text-muted-foreground">{title}</span>
        </div>
        <div
          className="mt-0.5 truncate text-base font-semibold tabular-nums tracking-tight"
          style={accent ? { color: accent } : undefined}
          title={value !== null ? fmt(value) : undefined}
        >
          {value !== null ? fmt(value) : '—'}
        </div>
      </Card>
    );
  }

  // MD/LG — полный вид с пояснениями
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-1.5">
        <CardTitle className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <Sigma className="h-4 w-4" style={accent ? { color: accent } : undefined} />
          <span className="line-clamp-1">{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center gap-1">
        {noSources ? (
          <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-center text-xs text-muted-foreground">
            <Calculator className="mx-auto mb-1 h-4 w-4" />
            Нет источников. Откройте «Настройки → Связи» и выберите блоки для агрегации.
          </div>
        ) : (
          <>
            <div
              className={`truncate ${density === 'lg' ? 'text-2xl' : 'text-xl'} font-semibold tabular-nums tracking-tight`}
              style={accent ? { color: accent } : undefined}
            >
              {value !== null ? fmt(value) : '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              {aggregationLabel[aggregation]} из {sourceValues.length}{' '}
              {sourceValues.length === 1 ? 'источника' : 'источников'}
              {missing > 0 && (
                <span className="ml-1 text-amber-600">
                  ({missing} {missing === 1 ? 'недоступен' : 'недоступны'})
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ComputedSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const cfg = ComputedConfig.parse(config ?? {});
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Копейки</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Показывать копейки</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.showKopecks === null
                ? 'Глобальная настройка'
                : cfg.showKopecks
                  ? '1 234,56 ₽'
                  : '1 235 ₽'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {cfg.showKopecks !== null && (
              <button
                type="button"
                onClick={() => onChange({ ...cfg, showKopecks: null })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Сбросить
              </button>
            )}
            <Switch
              checked={cfg.showKopecks ?? false}
              onCheckedChange={(v) => onChange({ ...cfg, showKopecks: v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const ComputedSumBlock: BlockDef = {
  type: 'computed.sum',
  displayName: 'Агрегация (формула)',
  description:
    'Считает сумму/среднее/мин/макс из значений других блоков. Excel-style ссылки между блоками.',
  category: 'custom',
  icon: Sigma,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 2, h: 1 },
  minContentSize: { w: 100, h: 60 },
  pages: ['*'],
  configSchema: ComputedConfig,
  defaultConfig: () => ({ showKopecks: null }),
  supportsDependencies: true,
  SettingsForm: ComputedSettingsForm,
  Render: RenderComputedSum,
};
