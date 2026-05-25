// PURPOSE: Универсальная KPI-карточка для блоков аналитики.
// Поддерживает: основное значение, delta vs предыдущий период,
// мини-sparkline (Recharts AreaChart ~40px), подстрочник (hint),
// цветовой тон (tone). Адаптируется к плотности блока через useBlockDensity.

'use client';

import { useId } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, Tooltip as RechartsTooltip } from 'recharts';
import { useBlockDensity } from '@/components/blocks/block-size';

export type StatCardFormat = 'rub' | 'pct' | 'int' | 'rub-detailed' | 'days';

export type StatCardDelta = {
  /** Абсолютная или %-разница vs прошлый период. */
  value: number;
  /** Если задано — суффикс отображается явно (например 'п.п.' для процентных пунктов). */
  suffix?: string;
  /** Направление улучшения: для расхода/ДРР рост = ниже = хорошо, для выручки наоборот. */
  goodDirection?: 'up' | 'down';
  /** Подпись delta: «vs прошлый период», «vs вчера» и т.д. */
  label?: string;
  /** Tooltip (HTML title) для подробного объяснения бейджа. */
  tooltip?: string;
};

export type StatCardProps = {
  label: string;
  value: number | string;
  format?: StatCardFormat;
  delta?: StatCardDelta | null;
  /** Данные для мини-спарклайна (значения за период). */
  sparkline?: number[] | null;
  /** Подписи к точкам спарклайна (даты, метки) — отображаются в tooltip. */
  sparklineLabels?: string[] | null;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  /** Цвет линии спарклайна / акцент. */
  accent?: 'emerald' | 'rose' | 'amber' | 'sky' | 'violet';
  loading?: boolean;
  /**
   * Variant:
   *   - `standalone` (default) — внешняя обёртка `rounded-lg border bg-card p-2.5/3`.
   *   - `inner` — без border / bg / padding, чтобы класть внутрь родительского Card
   *     (например, в `StatKpiBlock` или `kpi.grid`). Заполняет высоту контейнера.
   */
  variant?: 'standalone' | 'inner';
  /** Override иконка слева от label (только для `inner` варианта). */
  icon?: import('lucide-react').LucideIcon;
  /** Цвет иконки (HEX) — accentColor. */
  iconColor?: string;
};

function formatValue(value: number | string, format: StatCardFormat | undefined): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';
  if (format === 'rub') {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (format === 'rub-detailed') {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === 'pct') {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%';
  }
  if (format === 'days') {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + ' дн.';
  }
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

const ACCENT_STROKE: Record<NonNullable<StatCardProps['accent']>, string> = {
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
};

export function StatCard({
  label,
  value,
  format,
  delta,
  sparkline,
  sparklineLabels,
  hint,
  tone = 'default',
  accent = 'emerald',
  loading = false,
  variant = 'standalone',
  icon: Icon,
  iconColor,
}: StatCardProps) {
  const density = useBlockDensity();
  const gradientId = useId();

  const toneClass =
    tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-700 dark:text-rose-400'
        : tone === 'warning'
          ? 'text-amber-700 dark:text-amber-400'
          : '';

  const deltaTone = deltaToneClass(delta);
  const stroke = ACCENT_STROKE[accent];

  const isCompact = density === 'xs' || density === 'sm';
  const containerClass =
    variant === 'inner'
      ? 'flex h-full min-h-0 flex-col justify-between'
      : 'flex flex-col justify-between rounded-lg border border-border/60 bg-card ' +
        (isCompact ? 'p-2.5' : 'p-3');

  return (
    <div className={containerClass}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {Icon ? (
            <Icon className="h-3.5 w-3.5 shrink-0" style={iconColor ? { color: iconColor } : undefined} />
          ) : null}
          <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
        </div>
        {delta && (
          <div
            className={
              'flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ' +
              deltaTone
            }
            title={delta.tooltip ?? delta.label}
          >
            <DeltaIcon delta={delta} />
            {Math.abs(delta.value).toFixed(1)}
            {delta.suffix ?? '%'}
          </div>
        )}
      </div>
      <div className="mt-1 min-w-0">
        <div
          className={
            'tabular-nums font-semibold ' +
            (isCompact ? 'text-lg' : 'text-2xl') +
            ' ' +
            toneClass
          }
        >
          {loading ? '—' : formatValue(value, format)}
        </div>
        {hint && (
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</div>
        )}
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-1.5 h-8 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={sparkline.map((v, i) => ({ i, v, label: sparklineLabels?.[i] ?? null }))}
              margin={{ top: 1, right: 0, bottom: 1, left: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <RechartsTooltip
                isAnimationActive={false}
                cursor={{ stroke: stroke, strokeWidth: 1, strokeDasharray: '3 2', strokeOpacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0] as {
                    value: number;
                    payload: { label: string | null };
                  };
                  return (
                    <div className="pointer-events-none rounded-md border border-border/60 bg-popover px-2 py-1 text-[11px] shadow-md">
                      {p.payload.label && (
                        <div className="mb-0.5 text-[10px] text-muted-foreground">
                          {p.payload.label}
                        </div>
                      )}
                      <div className="font-semibold" style={{ color: stroke }}>
                        {formatValue(p.value, format)}
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={stroke}
                fill={`url(#${gradientId})`}
                strokeWidth={1.5}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: stroke }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function DeltaIcon({ delta }: { delta: StatCardDelta }) {
  if (delta.value === 0) return <Minus className="h-2.5 w-2.5" />;
  const up = delta.value > 0;
  return up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />;
}

function deltaToneClass(delta: StatCardDelta | null | undefined): string {
  if (!delta) return '';
  if (delta.value === 0) return 'bg-muted text-muted-foreground';
  const isUp = delta.value > 0;
  const isGood =
    delta.goodDirection === 'down' ? !isUp : delta.goodDirection === 'up' ? isUp : true;
  if (delta.goodDirection === undefined) {
    return isUp
      ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
      : 'bg-muted text-muted-foreground';
  }
  return isGood
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300';
}
