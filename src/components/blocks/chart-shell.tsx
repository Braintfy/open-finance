// PURPOSE: Универсальная обёртка над Recharts для line/area/bar чартов.
// Принимает data: Array<{date: string, [key]: number}> и series-описание.
// Поддерживает compare-overlay прошлым периодом (пунктир).
//
// Variant'ы:
//   - 'compact' (default) — лёгкий вариант для маленьких карточек: одна
//     левая ось, простой tooltip, без gradient.
//   - 'rich' — дашбордный вариант: gradient area, rich-tooltip с цветными
//     dots и max-width, **несколько Y-осей** (цветные ticks/axisLine
//     соответствуют сериям). Используется в Ozon · Динамика.

'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  type?: 'line' | 'area' | 'bar';
  yAxisId?: 'left' | 'right' | string;
};

export type ChartYAxis = {
  id: string;
  color: string;
  orientation?: 'left' | 'right';
  formatter?: (value: number) => string;
  /** Сделать ось «осью этой серии» (ticks/axisLine цветные). */
  colored?: boolean;
};

export type ChartShellProps = {
  data: Array<Record<string, unknown>>;
  series: ChartSeries[];
  /** Имя поля X — обычно 'date'. */
  xKey?: string;
  /** Высота в px (default 280). */
  height?: number;
  /** Compare series — overlay прошлого периода с тем же набором ключей. */
  compare?: { data: Array<Record<string, unknown>>; suffix?: string };
  /** Y-axis правый — для серий с yAxisId='right' (другой масштаб, обычно %). */
  showRightAxis?: boolean;
  /** Variant отрисовки (compact / rich). */
  variant?: 'compact' | 'rich';
  /**
   * Несколько Y-осей с цветной типографикой (для variant='rich').
   * Если задан — переопределяет дефолтные left/right оси.
   * Указанные `id` должны совпадать с `series[].yAxisId`.
   */
  yAxes?: ChartYAxis[];
  /** Формат значения в tooltip. */
  formatTooltipValue?: (value: unknown, name: unknown) => string;
  /** Формат даты для tooltip-заголовка (variant='rich'). */
  formatTooltipLabel?: (label: unknown) => string;
  /** Форматтеры для дефолтных осей (variant='compact'). */
  formatY?: (value: number) => string;
  formatYRight?: (value: number) => string;
};

export function ChartShell({
  data,
  series,
  xKey = 'date',
  height = 280,
  compare,
  showRightAxis = false,
  variant = 'compact',
  yAxes,
  formatTooltipValue,
  formatTooltipLabel,
  formatY,
  formatYRight,
}: ChartShellProps) {
  const allBar = series.length > 0 && series.every((s) => s.type === 'bar');
  const allArea = series.length > 0 && series.every((s) => s.type === 'area');
  const ChartCmp = allBar ? BarChart : allArea ? AreaChart : LineChart;

  // Compare: добавляем поля `${key}__compare` в data.
  const merged: Array<Record<string, unknown>> = data.map((d) => ({ ...d }));
  if (compare) {
    for (let i = 0; i < compare.data.length; i += 1) {
      const c = compare.data[i];
      if (i < merged.length) {
        for (const s of series) {
          merged[i][`${s.key}__compare`] = c[s.key];
        }
      }
    }
  }

  const isRich = variant === 'rich';

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ChartCmp data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          {isRich && (
            <defs>
              {series
                .filter((s) => s.type === 'area' || allArea)
                .map((s) => (
                  <linearGradient
                    key={`gradient-${s.key}`}
                    id={`gradient-${s.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
            </defs>
          )}
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={isRich ? 'hsl(var(--border) / 0.4)' : 'hsl(var(--border) / 0.5)'}
            vertical={isRich}
          />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={isRich ? { stroke: 'hsl(var(--border))' } : false}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          />
          {/* Y-оси */}
          {yAxes && yAxes.length > 0 ? (
            yAxes.map((ax) => (
              <YAxis
                key={`y-${ax.id}`}
                yAxisId={ax.id}
                orientation={ax.orientation ?? 'left'}
                tickLine={
                  ax.colored
                    ? { stroke: ax.color, strokeOpacity: 0.4 }
                    : false
                }
                axisLine={
                  ax.colored
                    ? { stroke: ax.color, strokeOpacity: 0.4 }
                    : false
                }
                tick={{
                  fontSize: 11,
                  fill: ax.colored ? ax.color : 'hsl(var(--muted-foreground))',
                }}
                tickFormatter={ax.formatter}
                width={56}
              />
            ))
          ) : (
            <>
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={formatY}
              />
              {showRightAxis && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={formatYRight}
                />
              )}
            </>
          )}
          {isRich ? (
            <Tooltip
              cursor={{ stroke: 'hsl(var(--muted-foreground) / 0.3)' }}
              content={((props: unknown) => {
                const p = props as RichTooltipProps;
                return (
                  <RichTooltipContent
                    active={p.active}
                    label={p.label}
                    payload={p.payload}
                    formatValue={formatTooltipValue}
                    formatLabel={formatTooltipLabel}
                  />
                );
              }) as never}
            />
          ) : (
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 6,
                fontSize: 11,
              }}
              formatter={
                formatTooltipValue
                  ? ((value: unknown, name: unknown) =>
                      formatTooltipValue(value, name)) as never
                  : undefined
              }
            />
          )}
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
          {series.map((s) => renderSeries(s, false, isRich))}
          {compare && series.map((s) => renderSeries(s, true, isRich, compare.suffix))}
        </ChartCmp>
      </ResponsiveContainer>
    </div>
  );
}

function renderSeries(
  s: ChartSeries,
  isCompare: boolean,
  isRich: boolean,
  compareSuffix?: string,
) {
  const key = isCompare ? `${s.key}__compare` : s.key;
  const label = isCompare ? `${s.label} (${compareSuffix ?? 'прошлый'})` : s.label;
  const yId = (s.yAxisId ?? 'left') as 'left' | 'right';

  if (s.type === 'bar') {
    return (
      <Bar
        key={key}
        dataKey={key}
        yAxisId={yId}
        name={label}
        fill={s.color}
        fillOpacity={isCompare ? 0.4 : isRich ? 0.8 : 1}
        isAnimationActive={false}
      />
    );
  }
  if (s.type === 'area') {
    return (
      <Area
        key={key}
        type="monotone"
        dataKey={key}
        yAxisId={yId}
        name={label}
        stroke={s.color}
        strokeWidth={2}
        strokeDasharray={isCompare ? '4 4' : undefined}
        strokeOpacity={isCompare ? 0.5 : 1}
        fill={isRich ? `url(#gradient-${s.key})` : s.color}
        fillOpacity={isCompare ? 0.05 : isRich ? 1 : 0.2}
        dot={false}
        activeDot={{ r: 4, stroke: s.color, strokeWidth: 2, fill: 'hsl(var(--card))' }}
        isAnimationActive={false}
      />
    );
  }
  return (
    <Line
      key={key}
      type="monotone"
      dataKey={key}
      yAxisId={yId}
      name={label}
      stroke={s.color}
      strokeWidth={2}
      strokeDasharray={isCompare ? '4 4' : undefined}
      strokeOpacity={isCompare ? 0.5 : 1}
      dot={false}
      activeDot={{ r: 4, stroke: s.color, strokeWidth: 2, fill: 'hsl(var(--card))' }}
      isAnimationActive={false}
    />
  );
}

// -- Rich tooltip -----------------------------------------------------------

type RichTooltipProps = {
  active?: boolean;
  label?: unknown;
  payload?: ReadonlyArray<{
    name: string;
    value: number | string;
    color: string;
    dataKey?: string;
  }>;
  formatValue?: (value: unknown, name: unknown) => string;
  formatLabel?: (label: unknown) => string;
};

function RichTooltipContent({
  active,
  label,
  payload,
  formatValue,
  formatLabel,
}: RichTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="max-w-[260px] rounded-xl border border-border/60 bg-card p-3"
      style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
    >
      <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        {formatLabel ? formatLabel(label) : String(label ?? '')}
      </div>
      <div className="space-y-1">
        {payload.map((item, i) => (
          <div
            key={`${item.dataKey ?? item.name}-${i}`}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[11px] text-muted-foreground">{item.name}</span>
            </div>
            <span className="text-[11px] font-medium tabular-nums text-foreground">
              {formatValue ? formatValue(item.value, item.name) : String(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
