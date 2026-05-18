// PURPOSE: Таблица per-product Ozon-аналитики.
// Колонки: Артикул, Название, Цена, Себестоимость, Маржа, Заказов,
// Выручка, Реклама, ДРР, Остаток, Дней остатков.
// Сортировка по любой колонке, баджи (ДРР цвета, остаток), формат рублей.

'use client';

import { useMemo } from 'react';
import { ArrowDown, ArrowUp, ArrowDownUp } from 'lucide-react';
import type { OzonAnalyticsRow } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import { cn } from '@/lib/utils';
import { autoColumnWidth } from '@/lib/blocks/auto-column-width';

export type TableColumnKey =
  | 'article'
  | 'name'
  | 'priceRub'
  | 'costRub'
  | 'marginRub'
  | 'delivered'
  | 'qtyDelivered'
  | 'revenueRub'
  | 'adsRub'
  | 'drrPct'
  | 'stock'
  | 'daysOfStock'
  | 'buyoutPct';

export type TableSort = {
  key: TableColumnKey;
  dir: 'asc' | 'desc';
};

type ColumnDef = {
  key: TableColumnKey;
  label: string;
  /** Подсказка под заголовком (опционально). */
  hint?: string;
  align: 'left' | 'right';
  /** Минимальная ширина в пикселях (для авторасчёта). */
  minPx: number;
  /** Максимальная ширина в пикселях (cap). */
  maxPx: number;
  /** Можно ли сортировать. */
  sortable: boolean;
};

export const COLUMN_DEFS: ColumnDef[] = [
  { key: 'article', label: 'Артикул', align: 'left', minPx: 80, maxPx: 200, sortable: true },
  { key: 'name', label: 'Название', align: 'left', minPx: 160, maxPx: 360, sortable: true },
  { key: 'priceRub', label: 'Цена', align: 'right', minPx: 70, maxPx: 130, sortable: true },
  { key: 'costRub', label: 'Себест.', align: 'right', minPx: 70, maxPx: 130, sortable: true },
  { key: 'marginRub', label: 'Маржа', hint: 'price − cost', align: 'right', minPx: 70, maxPx: 130, sortable: true },
  { key: 'delivered', label: 'Заказы', align: 'right', minPx: 60, maxPx: 100, sortable: true },
  { key: 'qtyDelivered', label: 'Штук', align: 'right', minPx: 56, maxPx: 100, sortable: true },
  { key: 'revenueRub', label: 'Выручка', align: 'right', minPx: 90, maxPx: 160, sortable: true },
  { key: 'adsRub', label: 'Реклама', align: 'right', minPx: 80, maxPx: 140, sortable: true },
  { key: 'drrPct', label: 'ДРР', hint: '%', align: 'right', minPx: 60, maxPx: 100, sortable: true },
  { key: 'stock', label: 'Остаток', align: 'right', minPx: 70, maxPx: 120, sortable: true },
  { key: 'daysOfStock', label: 'Дней', hint: 'хватит остатка', align: 'right', minPx: 60, maxPx: 100, sortable: true },
  { key: 'buyoutPct', label: 'Выкуп', hint: '%', align: 'right', minPx: 60, maxPx: 100, sortable: true },
];

function getCellValue(
  row: OzonAnalyticsRow,
  key: TableColumnKey,
): number | string | null {
  switch (key) {
    case 'article':
      return row.article ?? '';
    case 'name':
      return row.name;
    case 'priceRub':
      return row.priceRub;
    case 'costRub':
      return row.costRub;
    case 'marginRub':
      return row.priceRub - row.costRub;
    case 'delivered':
      return row.delivered;
    case 'qtyDelivered':
      return row.qtyDelivered;
    case 'revenueRub':
      return row.revenueRub;
    case 'adsRub':
      return row.adsRub;
    case 'drrPct':
      return row.drrPct;
    case 'stock':
      return row.stockMarketplace + row.stockOwn;
    case 'daysOfStock':
      return row.daysOfStock;
    case 'buyoutPct':
      return row.buyoutPct;
    default:
      return null;
  }
}

export function sortRows(
  rows: OzonAnalyticsRow[],
  sort: TableSort,
): OzonAnalyticsRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const av = getCellValue(a, sort.key);
    const bv = getCellValue(b, sort.key);
    const aNull = av === null || av === '';
    const bNull = bv === null || bv === '';
    if (aNull && bNull) return 0;
    if (aNull) return 1; // null/empty always at the end
    if (bNull) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return sort.dir === 'asc' ? av - bv : bv - av;
    }
    const as = String(av);
    const bs = String(bv);
    return sort.dir === 'asc' ? as.localeCompare(bs, 'ru') : bs.localeCompare(as, 'ru');
  });
  return sorted;
}

function formatRub(value: number, hideKopecks = true): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = hideKopecks ? Math.round(value) : value;
  return rounded.toLocaleString('ru-RU') + ' ₽';
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(value >= 100 ? 0 : 1) + '%';
}

function formatInt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU');
}

type DrrTone = 'good' | 'ok' | 'warning' | 'danger';

function drrTone(drr: number | null): DrrTone {
  if (drr === null) return 'ok';
  if (drr < 10) return 'good';
  if (drr < 20) return 'ok';
  if (drr < 50) return 'warning';
  return 'danger';
}

function stockTone(daysOfStock: number | null, stock: number): DrrTone {
  if (stock === 0) return 'danger';
  if (daysOfStock === null) return 'ok';
  if (daysOfStock < 7) return 'danger';
  if (daysOfStock < 14) return 'warning';
  if (daysOfStock < 30) return 'ok';
  return 'good';
}

const TONE_CLASSES: Record<DrrTone, string> = {
  good: 'text-emerald-700 dark:text-emerald-300',
  ok: 'text-foreground',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-red-700 dark:text-red-300',
};

const TONE_BG: Record<DrrTone, string> = {
  good: 'bg-emerald-100 dark:bg-emerald-950/40',
  ok: 'bg-muted/30',
  warning: 'bg-amber-100 dark:bg-amber-950/40',
  danger: 'bg-red-100 dark:bg-red-950/40',
};

export function OzonAnalyticsTable({
  rows,
  enabledColumns,
  sort,
  onSortChange,
}: {
  rows: OzonAnalyticsRow[];
  enabledColumns: TableColumnKey[];
  sort: TableSort;
  onSortChange: (sort: TableSort) => void;
}) {
  const columns = useMemo(
    () => COLUMN_DEFS.filter((c) => enabledColumns.includes(c.key)),
    [enabledColumns],
  );

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  // Авторасчёт ширин: измеряем заголовок (uppercase, bold) и
  // форматированные значения — берём максимум, клипаем к min/max каждой
  // колонки. Пересчитывается при изменении набора колонок и rows.
  const widths = useMemo(() => {
    const out: Record<TableColumnKey, number> = {} as Record<TableColumnKey, number>;
    for (const col of columns) {
      const samples = sorted.map((row) => {
        const v = getCellValue(row, col.key);
        if (v === null) return '';
        if (typeof v === 'number') {
          // Денежные / процент колонки имеют суффикс — учитываем его длину.
          switch (col.key) {
            case 'priceRub':
            case 'costRub':
            case 'marginRub':
            case 'revenueRub':
            case 'adsRub':
              return Math.round(v).toLocaleString('ru-RU') + ' ₽';
            case 'drrPct':
            case 'buyoutPct':
              return v.toFixed(v >= 100 ? 0 : 1) + '%';
            default:
              return v.toLocaleString('ru-RU');
          }
        }
        return String(v);
      });
      out[col.key] = autoColumnWidth(col.label, samples, {
        min: col.minPx,
        max: col.maxPx,
      });
    }
    return out;
  }, [columns, sorted]);

  function toggleSort(key: TableColumnKey) {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ key, dir: 'desc' });
    }
  }

  return (
    <div className="relative w-full overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            {columns.map((col) => {
              const active = sort.key === col.key;
              return (
                <th
                  key={col.key}
                  className={cn(
                    'select-none border-b border-border/60 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.sortable ? 'cursor-pointer hover:bg-accent/30' : '',
                  )}
                  style={{
                    width: `${widths[col.key]}px`,
                    minWidth: `${widths[col.key]}px`,
                  }}
                  onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  title={col.hint}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable &&
                      (active ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowDownUp className="h-3 w-3 opacity-40" />
                      ))}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-[12px] text-muted-foreground"
              >
                Нет данных для отображения.
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const margin = row.priceRub - row.costRub;
              const stock = row.stockMarketplace + row.stockOwn;
              const dt = drrTone(row.drrPct);
              const st = stockTone(row.daysOfStock, stock);
              return (
                <tr key={row.productId} className="hover:bg-accent/20">
                  {columns.map((col) => {
                    let body: React.ReactNode = '—';
                    let extraClass = '';
                    switch (col.key) {
                      case 'article':
                        body = row.article ?? '—';
                        break;
                      case 'name':
                        body = (
                          <span className="truncate" title={row.name}>
                            {row.name || '—'}
                          </span>
                        );
                        break;
                      case 'priceRub':
                        body = row.priceRub > 0 ? formatRub(row.priceRub) : '—';
                        break;
                      case 'costRub':
                        body = row.costRub > 0 ? formatRub(row.costRub) : '—';
                        break;
                      case 'marginRub':
                        body = row.costRub > 0 ? formatRub(margin) : '—';
                        extraClass = margin <= 0 && row.costRub > 0 ? 'text-red-600' : '';
                        break;
                      case 'delivered':
                        body = formatInt(row.delivered);
                        break;
                      case 'qtyDelivered':
                        body = formatInt(row.qtyDelivered);
                        break;
                      case 'revenueRub':
                        body = row.revenueRub > 0 ? formatRub(row.revenueRub) : '—';
                        break;
                      case 'adsRub':
                        body = row.adsRub > 0 ? formatRub(row.adsRub) : '—';
                        break;
                      case 'drrPct':
                        body = (
                          <span
                            className={cn(
                              'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                              TONE_BG[dt],
                              TONE_CLASSES[dt],
                            )}
                          >
                            {formatPct(row.drrPct)}
                          </span>
                        );
                        break;
                      case 'stock':
                        body = (
                          <span
                            className={cn(
                              'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                              TONE_BG[st],
                              TONE_CLASSES[st],
                            )}
                          >
                            {formatInt(stock)}
                          </span>
                        );
                        break;
                      case 'daysOfStock':
                        body = row.daysOfStock !== null ? `${row.daysOfStock}` : '—';
                        extraClass = st === 'danger' || st === 'warning' ? TONE_CLASSES[st] : '';
                        break;
                      case 'buyoutPct':
                        body = formatPct(row.buyoutPct);
                        break;
                    }
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          'border-b border-border/30 px-2 py-1 align-middle tabular-nums',
                          col.align === 'right' ? 'text-right' : 'text-left',
                          extraClass,
                        )}
                      >
                        {body}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
