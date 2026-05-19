// PURPOSE: Таблица per-product Ozon-аналитики.
// Колонки: Артикул, Название, Цена, Себестоимость, Маржа, Заказов,
// Выручка, Реклама, ДРР, Остаток, Дней остатков.
// Сортировка по любой колонке, баджи (ДРР цвета, остаток), формат рублей.
// Опционально: миниатюра товара (28×28) слева от названия — toggle в SettingsForm.

'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowDownUp, ImageOff } from 'lucide-react';
import type { OzonAnalyticsRow } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import { cn } from '@/lib/utils';

export type TableColumnKey =
  | 'article'
  | 'name'
  | 'sku'
  | 'priceRub'
  | 'costRub'
  | 'marginRub'
  | 'delivered'
  | 'deliveredFbo'
  | 'deliveredFbs'
  | 'qtyDelivered'
  | 'cancelled'
  | 'returned'
  | 'returnPct'
  | 'revenueRub'
  | 'adsRub'
  | 'drrPct'
  | 'stock'
  | 'daysOfStock'
  | 'buyoutPct'
  | 'views'
  | 'clicks'
  | 'ctr'
  | 'cartAdds'
  | 'cpc'
  | 'cpm'
  | 'salesPerDay'
  | 'salesShare';

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
  /** Минимальная ширина в пикселях. */
  minPx: number;
  /** Дефолтная ширина в пикселях. */
  defaultPx: number;
  /** Можно ли сортировать. */
  sortable: boolean;
};

export const COLUMN_DEFS: ColumnDef[] = [
  { key: 'article', label: 'Артикул', align: 'left', minPx: 80, defaultPx: 140, sortable: true },
  { key: 'name', label: 'Название', align: 'left', minPx: 120, defaultPx: 220, sortable: true },
  { key: 'sku', label: 'SKU', align: 'left', minPx: 80, defaultPx: 120, sortable: true },
  { key: 'priceRub', label: 'Цена', align: 'right', minPx: 70, defaultPx: 90, sortable: true },
  { key: 'costRub', label: 'Себест.', align: 'right', minPx: 70, defaultPx: 90, sortable: true },
  { key: 'marginRub', label: 'Маржа', hint: 'price − cost', align: 'right', minPx: 70, defaultPx: 90, sortable: true },
  { key: 'delivered', label: 'Заказы', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'deliveredFbo', label: 'ФБО', hint: 'со склада Ozon', align: 'right', minPx: 50, defaultPx: 64, sortable: true },
  { key: 'deliveredFbs', label: 'ФБС', hint: 'со склада продавца', align: 'right', minPx: 50, defaultPx: 64, sortable: true },
  { key: 'qtyDelivered', label: 'Штук', align: 'right', minPx: 50, defaultPx: 64, sortable: true },
  { key: 'cancelled', label: 'Отмены', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'returned', label: 'Возвраты', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'returnPct', label: '% возвр.', hint: 'returned / (del+ret)', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'revenueRub', label: 'Выручка', align: 'right', minPx: 80, defaultPx: 110, sortable: true },
  { key: 'adsRub', label: 'Расход', hint: 'рекламный бюджет (CPC + CPO ≅)', align: 'right', minPx: 70, defaultPx: 110, sortable: true },
  { key: 'drrPct', label: 'ДРР', hint: '%', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'stock', label: 'Остаток', align: 'right', minPx: 60, defaultPx: 80, sortable: true },
  { key: 'daysOfStock', label: 'Дней', hint: 'хватит остатка', align: 'right', minPx: 50, defaultPx: 64, sortable: true },
  { key: 'buyoutPct', label: 'Выкуп', hint: '%', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'views', label: 'Показы', hint: 'рекламные', align: 'right', minPx: 60, defaultPx: 80, sortable: true },
  { key: 'clicks', label: 'Клики', hint: 'рекламные', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'ctr', label: 'CTR', hint: '% клик/показы', align: 'right', minPx: 50, defaultPx: 64, sortable: true },
  { key: 'cartAdds', label: 'В корзину', hint: 'из рекламы', align: 'right', minPx: 56, defaultPx: 80, sortable: true },
  { key: 'cpc', label: 'CPC', hint: '₽ за клик', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'cpm', label: 'CPM', hint: '₽ за 1000 показов', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'salesPerDay', label: 'Прод/день', hint: 'среднее', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
  { key: 'salesShare', label: 'Доля %', hint: 'от общей выручки', align: 'right', minPx: 56, defaultPx: 72, sortable: true },
];

function getCellValue(
  row: OzonAnalyticsRow,
  key: TableColumnKey,
  ctx?: { totalRevenue?: number; periodDays?: number },
): number | string | null {
  switch (key) {
    case 'article':
      return row.article ?? '';
    case 'name':
      return row.name;
    case 'sku':
      return row.sku ?? '';
    case 'priceRub':
      return row.priceRub;
    case 'costRub':
      return row.costRub;
    case 'marginRub':
      return row.priceRub - row.costRub;
    case 'delivered':
      return row.delivered;
    case 'deliveredFbo':
      return row.deliveredFbo;
    case 'deliveredFbs':
      return row.deliveredFbs;
    case 'qtyDelivered':
      return row.qtyDelivered;
    case 'cancelled':
      return row.cancelled;
    case 'returned':
      return row.returned;
    case 'returnPct': {
      const total = row.delivered + row.returned;
      return total > 0 ? (row.returned / total) * 100 : null;
    }
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
    case 'views':
      return row.views;
    case 'clicks':
      return row.clicks;
    case 'ctr':
      return row.views > 0 ? (row.clicks / row.views) * 100 : null;
    case 'cartAdds':
      return row.cartAdds;
    case 'cpc':
      return row.clicks > 0 ? row.adsRub / row.clicks : null;
    case 'cpm':
      return row.views > 0 ? (row.adsRub / row.views) * 1000 : null;
    case 'salesPerDay': {
      const days = ctx?.periodDays ?? 1;
      return days > 0 ? row.qtyDelivered / days : 0;
    }
    case 'salesShare': {
      const total = ctx?.totalRevenue ?? 0;
      return total > 0 ? (row.revenueRub / total) * 100 : null;
    }
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

/**
 * Миниатюра товара 28×28. При отсутствии URL или ошибке загрузки —
 * нейтральный плейсхолдер с иконкой. Lazy-loaded, referrerPolicy=no-referrer
 * (некоторые Ozon-CDN блокируют hot-linking без правильного referrer'а).
 */
function ProductThumb({ url, name }: { url: string | null; name: string }) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) {
    return (
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        title={name || 'Без изображения'}
      >
        <ImageOff className="h-3 w-3" />
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt={name}
      width={28}
      height={28}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className="h-7 w-7 shrink-0 rounded-md object-cover bg-muted"
    />
  );
}

export function OzonAnalyticsTable({
  rows,
  enabledColumns,
  sort,
  onSortChange,
  totalRevenue = 0,
  periodDays = 1,
  showProductImage = false,
  showDrrColor = true,
  showStockColor = true,
}: {
  rows: OzonAnalyticsRow[];
  enabledColumns: TableColumnKey[];
  sort: TableSort;
  onSortChange: (sort: TableSort) => void;
  totalRevenue?: number;
  periodDays?: number;
  /** Показывать миниатюру товара 28×28 слева от названия (по умолчанию false). */
  showProductImage?: boolean;
  /** Цветная подсветка ячейки ДРР. По умолчанию true. */
  showDrrColor?: boolean;
  /** Цветная подсветка ячейки «Остаток» и «Дней». По умолчанию true. */
  showStockColor?: boolean;
}) {
  const columns = useMemo(
    () => COLUMN_DEFS.filter((c) => enabledColumns.includes(c.key)),
    [enabledColumns],
  );

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  // Column widths state: initialized from defaultPx, user can resize via drag.
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const col of COLUMN_DEFS) init[col.key] = col.defaultPx;
    return init;
  });

  // --- Drag-to-resize logic ---
  const resizingRef = useRef<{
    key: string;
    startX: number;
    startW: number;
    minW: number;
  } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, key: TableColumnKey) => {
      e.preventDefault();
      e.stopPropagation();
      const col = COLUMN_DEFS.find((c) => c.key === key);
      if (!col) return;
      resizingRef.current = {
        key,
        startX: e.clientX,
        startW: colWidths[key] ?? col.defaultPx,
        minW: col.minPx,
      };
      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = ev.clientX - resizingRef.current.startX;
        const newW = Math.max(resizingRef.current.minW, resizingRef.current.startW + delta);
        setColWidths((prev) => ({ ...prev, [resizingRef.current!.key]: newW }));
      };
      const onUp = () => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [colWidths],
  );

  function toggleSort(key: TableColumnKey) {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ key, dir: 'desc' });
    }
  }

  const totalWidth = columns.reduce((sum, col) => sum + (colWidths[col.key] ?? col.defaultPx), 0);

  return (
    <div className="relative w-full overflow-auto">
      <table className="border-collapse text-[12px]" style={{ width: `${totalWidth}px`, tableLayout: 'fixed' }}>
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            {columns.map((col) => {
              const active = sort.key === col.key;
              const w = colWidths[col.key] ?? col.defaultPx;
              return (
                <th
                  key={col.key}
                  className={cn(
                    'relative select-none whitespace-nowrap border-b border-border/60 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.sortable ? 'cursor-pointer hover:bg-accent/30' : '',
                  )}
                  style={{ width: `${w}px` }}
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
                  {/* Resize handle */}
                  <span
                    className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize hover:bg-primary/20"
                    onMouseDown={(e) => handleResizeStart(e, col.key)}
                  />
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
              const ctrVal = row.views > 0 ? (row.clicks / row.views) * 100 : null;
              const cpcVal = row.clicks > 0 ? row.adsRub / row.clicks : null;
              const cpmVal = row.views > 0 ? (row.adsRub / row.views) * 1000 : null;
              const returnPctVal = (row.delivered + row.returned) > 0 ? (row.returned / (row.delivered + row.returned)) * 100 : null;
              const salesPerDayVal = periodDays > 0 ? row.qtyDelivered / periodDays : 0;
              const salesShareVal = totalRevenue > 0 ? (row.revenueRub / totalRevenue) * 100 : null;
              return (
                <tr key={row.productId} className="hover:bg-accent/20">
                  {columns.map((col) => {
                    let body: React.ReactNode = '—';
                    let extraClass = '';
                    switch (col.key) {
                      case 'article':
                        body = (
                          <span className="block truncate" title={row.article ?? undefined}>
                            {row.article ?? '—'}
                          </span>
                        );
                        break;
                      case 'name':
                        body = showProductImage ? (
                          <div className="flex items-center gap-2 min-w-0">
                            <ProductThumb url={row.primaryImage} name={row.name} />
                            <span className="block truncate" title={row.name}>
                              {row.name || '—'}
                            </span>
                          </div>
                        ) : (
                          <span className="block truncate" title={row.name}>
                            {row.name || '—'}
                          </span>
                        );
                        break;
                      case 'sku':
                        body = row.sku ? (
                          <a
                            href={`https://www.ozon.ru/product/${row.sku}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline dark:text-blue-400"
                            title="Открыть на Ozon"
                          >
                            {row.sku}
                          </a>
                        ) : '—';
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
                      case 'deliveredFbo':
                        body = formatInt(row.deliveredFbo);
                        break;
                      case 'deliveredFbs':
                        body = formatInt(row.deliveredFbs);
                        break;
                      case 'qtyDelivered':
                        body = formatInt(row.qtyDelivered);
                        break;
                      case 'cancelled':
                        body = formatInt(row.cancelled);
                        break;
                      case 'returned':
                        body = formatInt(row.returned);
                        break;
                      case 'returnPct':
                        body = formatPct(returnPctVal);
                        break;
                      case 'revenueRub':
                        body = row.revenueRub > 0 ? formatRub(row.revenueRub) : '—';
                        break;
                      case 'adsRub':
                        body = row.adsRub > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            {formatRub(row.adsRub)}
                            {row.adsHasCpo && (
                              <span
                                className="inline-flex h-4 items-center rounded-sm bg-blue-100 px-1 text-[9px] font-medium text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                                title={`CPC: ${formatRub(row.adsCpcRub)} + CPO: ${formatRub(row.adsCpoAllocRub)} (распределён пропорционально выручке)`}
                              >
                                ≅
                              </span>
                            )}
                          </span>
                        ) : '—';
                        break;
                      case 'drrPct':
                        body = (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className={cn(
                                showDrrColor
                                  ? 'inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium'
                                  : 'tabular-nums',
                                showDrrColor && TONE_BG[dt],
                                showDrrColor && TONE_CLASSES[dt],
                              )}
                            >
                              {formatPct(row.drrPct)}
                            </span>
                            {row.adsHasCpo && (
                              <span
                                className="inline-flex h-4 items-center rounded-sm bg-blue-100 px-1 text-[9px] font-medium text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                                title="ДРР включает CPO-расход (распределён пропорционально выручке — оценка)"
                              >
                                ≅
                              </span>
                            )}
                          </span>
                        );
                        break;
                      case 'stock':
                        body = showStockColor ? (
                          <span
                            className={cn(
                              'inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                              TONE_BG[st],
                              TONE_CLASSES[st],
                            )}
                          >
                            {formatInt(stock)}
                          </span>
                        ) : (
                          formatInt(stock)
                        );
                        break;
                      case 'daysOfStock':
                        body = row.daysOfStock !== null ? `${row.daysOfStock}` : '—';
                        extraClass =
                          showStockColor && (st === 'danger' || st === 'warning')
                            ? TONE_CLASSES[st]
                            : '';
                        break;
                      case 'buyoutPct':
                        body = formatPct(row.buyoutPct);
                        break;
                      case 'views':
                        body = formatInt(row.views);
                        break;
                      case 'clicks':
                        body = formatInt(row.clicks);
                        break;
                      case 'ctr':
                        body = formatPct(ctrVal);
                        break;
                      case 'cartAdds':
                        body = formatInt(row.cartAdds);
                        break;
                      case 'cpc':
                        body = cpcVal !== null ? formatRub(cpcVal, false) : '—';
                        break;
                      case 'cpm':
                        body = cpmVal !== null ? formatRub(cpmVal) : '—';
                        break;
                      case 'salesPerDay':
                        body = salesPerDayVal > 0 ? salesPerDayVal.toFixed(1) : '—';
                        break;
                      case 'salesShare':
                        body = formatPct(salesShareVal);
                        break;
                    }
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          'whitespace-nowrap overflow-hidden border-b border-border/30 px-2 py-1 align-middle tabular-nums',
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
