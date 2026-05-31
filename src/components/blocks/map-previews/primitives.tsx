// PURPOSE: Презентационные примитивы мини-превью блоков для режима «Карта».
// Без доступа к store/сети — получают готовые props. Используются реестром
// MAP_PREVIEWS (index.tsx), который мапит published-значения блока в эти props.
'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { StatCard, type StatCardFormat, type StatCardDelta } from '@/components/blocks/stat-card';

export type PreviewAccent = 'emerald' | 'rose' | 'amber' | 'sky' | 'violet';

/** Обёртка тела превью — заполняет узел, лёгкий padding. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="h-full w-full p-2">{children}</div>;
}

/** Одна крупная метрика (число + label + delta + опц. sparkline). */
export function MetricPreview({
  label,
  value,
  format,
  delta,
  sparkline,
  accent = 'sky',
  icon,
  iconColor,
}: {
  label: string;
  value: number | string;
  format?: StatCardFormat;
  delta?: StatCardDelta | null;
  sparkline?: number[] | null;
  accent?: PreviewAccent;
  icon?: LucideIcon;
  iconColor?: string;
}) {
  return (
    <Frame>
      <StatCard
        variant="inner"
        label={label}
        value={value}
        format={format}
        delta={delta}
        sparkline={sparkline}
        accent={accent}
        icon={icon}
        iconColor={iconColor}
      />
    </Frame>
  );
}

/** Несколько мелких метрик в ряд/сетку (KPI-сетка, мульти-показатели). */
export function MultiMetricPreview({
  items,
}: {
  items: Array<{ label: string; value: number | string; format?: StatCardFormat }>;
}) {
  const shown = items.slice(0, 4);
  const cols =
    shown.length >= 4
      ? 'grid-cols-2'
      : shown.length === 3
        ? 'grid-cols-3'
        : shown.length === 2
          ? 'grid-cols-2'
          : 'grid-cols-1';
  return (
    <Frame>
      <div className={`grid h-full ${cols} gap-1.5`}>
        {shown.map((it, i) => (
          <div key={i} className="min-w-0 rounded-md bg-slate-50 px-2 py-1.5">
            <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">
              {it.label}
            </div>
            <div className="truncate text-base font-semibold tabular-nums text-slate-800">
              {fmt(it.value, it.format)}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Компактная таблица: заголовки + несколько строк + футер. */
export function MiniTablePreview({
  columns,
  rows,
  footer,
}: {
  columns: string[];
  rows: string[][];
  footer?: string;
}) {
  const cols = columns.slice(0, 4);
  return (
    <Frame>
      <div className="flex h-full flex-col overflow-hidden rounded-md border border-slate-100">
        <div className="flex gap-2 border-b border-slate-100 bg-slate-50 px-2 py-1">
          {cols.map((c, i) => (
            <div key={i} className="flex-1 truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">
              {c}
            </div>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {rows.slice(0, 4).map((r, ri) => (
            <div key={ri} className="flex gap-2 border-b border-slate-50 px-2 py-1 last:border-0">
              {r.slice(0, cols.length).map((cell, ci) => (
                <div key={ci} className="flex-1 truncate text-[11px] text-slate-700">
                  {cell}
                </div>
              ))}
            </div>
          ))}
        </div>
        {footer && (
          <div className="border-t border-slate-100 bg-slate-50/70 px-2 py-1 text-center text-[10px] text-slate-500">
            {footer}
          </div>
        )}
      </div>
    </Frame>
  );
}

/** Сводка списка: счётчик + последние позиции. */
export function ListSummaryPreview({
  count,
  countLabel,
  items,
  icon: Icon,
  accentColor,
}: {
  count: number | null;
  countLabel: string;
  items: string[];
  icon?: LucideIcon;
  accentColor?: string;
}) {
  return (
    <Frame>
      <div className="flex h-full flex-col">
        <div className="flex items-baseline gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" style={accentColor ? { color: accentColor } : undefined} />}
          <span className="text-xl font-semibold tabular-nums text-slate-800">{count ?? '—'}</span>
          <span className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{countLabel}</span>
        </div>
        <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-hidden">
          {items.slice(0, 3).map((it, i) => (
            <div key={i} className="truncate rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
              {it}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/** Статус: иконка + пилюля OK/проблема. */
export function StatusPreview({
  icon: Icon,
  title,
  ok,
  statusText,
  accentColor,
}: {
  icon: LucideIcon;
  title: string;
  ok: boolean | null;
  statusText: string;
  accentColor?: string;
}) {
  const tone =
    ok === null
      ? 'bg-slate-100 text-slate-600'
      : ok
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-amber-100 text-amber-700';
  return (
    <Frame>
      <div className="flex h-full flex-col items-start justify-center gap-1.5">
        <div className="flex items-center gap-1.5">
          <Icon className="h-4 w-4 shrink-0" style={accentColor ? { color: accentColor } : undefined} />
          <span className="truncate text-xs font-semibold text-slate-800">{title}</span>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
          {ok === null ? null : ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {statusText}
        </span>
      </div>
    </Frame>
  );
}

/** Иконка + заголовок + подзаголовок (navigate.card и т.п.). */
export function IconTitlePreview({
  icon: Icon,
  title,
  subtitle,
  accentColor,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  accentColor?: string;
}) {
  return (
    <Frame>
      <div className="flex h-full flex-col items-start justify-center gap-1">
        <Icon className="h-5 w-5 shrink-0" style={accentColor ? { color: accentColor } : undefined} />
        <span className="truncate text-sm font-semibold text-slate-800">{title}</span>
        {subtitle && <span className="line-clamp-2 text-[11px] text-slate-500">{subtitle}</span>}
      </div>
    </Frame>
  );
}

/** Текстовая выдержка: заголовок + счётчики/строки. */
export function TextExcerptPreview({
  title,
  stats,
  excerpt,
  icon: Icon,
  accentColor,
}: {
  title: string;
  stats?: Array<{ label: string; value: string | number }>;
  excerpt?: string;
  icon?: LucideIcon;
  accentColor?: string;
}) {
  return (
    <Frame>
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" style={accentColor ? { color: accentColor } : undefined} />}
          <span className="truncate text-xs font-semibold text-slate-800">{title}</span>
        </div>
        {excerpt && <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{excerpt}</p>}
        {stats && stats.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-x-3 gap-y-0.5 pt-1 text-[10px] text-slate-400">
            {stats.map((s, i) => (
              <span key={i} className="tabular-nums">
                <span className="font-semibold text-slate-600">{s.value}</span> {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}

/* ── format helper ── */

export function fmt(value: number | string, format?: StatCardFormat): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';
  if (format === 'rub') {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
  }
  if (format === 'pct') return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}
