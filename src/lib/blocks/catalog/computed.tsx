// PURPOSE: Computed-блоки — агрегируют значения других блоков (Excel-style cell references).
// Используют `dependencies` поле BlockInstance + reactive store useBlockDependencyResult.
'use client';

import { Calculator, Sigma } from 'lucide-react';
import type { BlockDef, BlockRenderProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRubles } from '@/lib/utils';
import { useBlockDensity } from '@/components/blocks/block-size';
import {
  useBlockDependencyResult,
  useBlockValuePublisher,
} from '../values';

// ============================================================================
// computed.sum — агрегация значений N других блоков
// ============================================================================

function RenderComputedSum({ instance }: BlockRenderProps) {
  const density = useBlockDensity();
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
          {value !== null ? formatRubles(value) : '—'}
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
          title={value !== null ? formatRubles(value) : undefined}
        >
          {value !== null ? formatRubles(value) : '—'}
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
              {value !== null ? formatRubles(value) : '—'}
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
  pages: ['*'], // доступен на любой странице
  supportsDependencies: true,
  Render: RenderComputedSum,
};
