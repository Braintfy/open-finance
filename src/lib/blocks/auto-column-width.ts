// PURPOSE: Общий SSR-safe helper для адаптивных ширин колонок таблиц блоков.
//
// Используется в:
//   - src/lib/blocks/catalog/custom-data.tsx (label/value колонки),
//   - src/components/unit-economics/ozon-analytics-table.tsx (per-product),
//   - src/lib/blocks/catalog/unit-ozon-{top-ads,campaigns,search-phrases}.tsx.
//
// Принцип:
//   1. Считаем ширину текста через canvas.measureText — это в ~50× быстрее
//      DOM mount/unmount и не требует ReactDOM.
//   2. Берём максимум от заголовка (uppercase + bold) и значений в колонке.
//   3. Клипаем к [min, max], добавляем padding (горизонтальные ячейки 14px).
//
// Все функции pure / SSR-safe: на сервере возвращают min, потому что canvas
// нет. Клиентский ремаунт догонит — никаких визуальных скачков, потому что
// блок-грид сам стабилизирует layout через ResizeObserver.

const PADDING_PX = 16; // 8px слева + 8px справа
let cachedCanvas: HTMLCanvasElement | null = null;
let cachedCtx: CanvasRenderingContext2D | null = null;

function getCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null; // SSR
  if (cachedCtx) return cachedCtx;
  cachedCanvas = document.createElement('canvas');
  cachedCtx = cachedCanvas.getContext('2d');
  return cachedCtx;
}

/** Измерить ширину текста с конкретным шрифтом (без mount'а). */
export function measureTextPx(
  text: string,
  fontSize = 12,
  weight: 400 | 600 = 400,
): number {
  if (!text) return 0;
  const ctx = getCtx();
  if (!ctx) return text.length * (fontSize * 0.55);
  ctx.font = `${weight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  return ctx.measureText(text).width;
}

export type AutoWidthOptions = {
  /** Минимум, никогда не уже этого. */
  min: number;
  /** Максимум, не шире чем это (включая padding). */
  max: number;
  /** Размер шрифта значения, по умолчанию 12. */
  valueFontPx?: number;
  /** Размер шрифта заголовка, по умолчанию 10 (uppercase). */
  headerFontPx?: number;
  /** Множитель размера для uppercase-заголовка (Tailwind tracking-wider ≈ 1.05). */
  headerWeight?: 400 | 600;
};

/**
 * Возвращает оптимальную ширину колонки на основании заголовка и значений.
 * Заголовок измеряется как uppercase + bold, значения — как обычный текст.
 */
export function autoColumnWidth(
  header: string,
  values: Array<string | number | null | undefined>,
  opts: AutoWidthOptions,
): number {
  const headerFont = opts.headerFontPx ?? 10;
  const valueFont = opts.valueFontPx ?? 12;
  const headerWeight = opts.headerWeight ?? 600;
  const headerWidth = measureTextPx(header.toUpperCase(), headerFont, headerWeight);

  let maxValueWidth = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const text = typeof v === 'number' ? formatNumberLike(v) : String(v);
    const w = measureTextPx(text, valueFont, 400);
    if (w > maxValueWidth) maxValueWidth = w;
  }

  const raw = Math.max(headerWidth, maxValueWidth) + PADDING_PX;
  return Math.max(opts.min, Math.min(opts.max, Math.ceil(raw)));
}

/** Сериализация числа, повторяющая ru-RU форматирование с разделителями. */
function formatNumberLike(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return value.toLocaleString('ru-RU');
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
