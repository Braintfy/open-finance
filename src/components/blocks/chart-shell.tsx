// PURPOSE: Универсальная обёртка над Recharts для line/area/bar чартов.
// Принимает data: Array<{date: string, [key]: number}> и series-описание.
// Поддерживает compare-overlay прошлым периодом (пунктир).

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
  yAxisId?: 'left' | 'right';
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
  /** Форматтеры. */
  formatY?: (value: number) => string;
  formatYRight?: (value: number) => string;
  formatTooltipValue?: (value: unknown, name: unknown) => string;
};

export function ChartShell({
  data,
  series,
  xKey = 'date',
  height = 280,
  compare,
  showRightAxis = false,
  formatY,
  formatYRight,
  formatTooltipValue,
}: ChartShellProps) {
  // Определяем тип контейнера: если все серии bar — BarChart, area — AreaChart,
  // иначе LineChart с потенциальными mixed-типами.
  const allBar = series.length > 0 && series.every((s) => s.type === 'bar');
  const allArea = series.length > 0 && series.every((s) => s.type === 'area');
  const ChartCmp = allBar ? BarChart : allArea ? AreaChart : LineChart;

  // Объединяем data + compare data в одну ось X. compare-серии получают
  // префикс _compare для уникальности dataKey.
  const merged: Array<Record<string, unknown>> = data.map((d) => ({ ...d }));
  if (compare) {
    for (let i = 0; i < compare.data.length; i += 1) {
      const c = compare.data[i];
      // Привязываем к индексу: i-й точкой compare идёт под i-й текущей.
      if (i < merged.length) {
        for (const s of series) {
          merged[i][`${s.key}__compare`] = c[s.key];
        }
      }
    }
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ChartCmp data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={formatY}
          />
          {showRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={formatYRight}
            />
          )}
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
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
          {series.map((s) => renderSeries(s, false))}
          {compare && series.map((s) => renderSeries(s, true, compare.suffix))}
        </ChartCmp>
      </ResponsiveContainer>
    </div>
  );
}

function renderSeries(s: ChartSeries, isCompare: boolean, compareSuffix?: string) {
  const key = isCompare ? `${s.key}__compare` : s.key;
  const label = isCompare ? `${s.label} (${compareSuffix ?? 'прошлый'})` : s.label;
  const yId = s.yAxisId ?? 'left';
  // key передаём напрямую в JSX, чтобы не было React-warning'а
  // про key внутри spread-props.
  const props = {
    dataKey: key,
    yAxisId: yId,
    name: label,
    stroke: s.color,
    fill: s.color,
    strokeDasharray: isCompare ? '4 4' : undefined,
    strokeOpacity: isCompare ? 0.5 : 1,
    fillOpacity: isCompare ? 0.1 : s.type === 'area' ? 0.2 : 1,
    isAnimationActive: false,
  } as const;

  if (s.type === 'bar') return <Bar key={key} {...props} />;
  if (s.type === 'area')
    return <Area key={key} type="monotone" {...props} strokeWidth={1.5} />;
  return <Line key={key} type="monotone" {...props} strokeWidth={2} dot={false} />;
}
