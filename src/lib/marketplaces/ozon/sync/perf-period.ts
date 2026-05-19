// PURPOSE: Pure-helpers для построения [from, to] окна Performance API.
// Никаких db/env импортов — чтобы можно было тестировать smoke-скриптом.
//
// Грабли:
// 1. Ozon Performance API считает «период» по календарю Москвы (UTC+3). Если
//    мы строим окно `new Date()` на UTC-машинке, около полуночи `dateTo`
//    может попасть на завтра по MSC и Ozon вернёт 400 «Некорректный период».
// 2. Для async-отчётов Ozon не принимает незавершённые дни, поэтому `dateTo`
//    строим как today(MSC) - completeDayLag.
// 3. Окно у `all_sku_promo/products/generate` максимум ~62 дня — больше
//    запрашивать смысла нет, отчёт всё равно режется. Ограничиваем сверху.

/** Жёсткий потолок окна async-отчёта Performance API. */
export const MAX_PERF_WINDOW_DAYS = 62;

/** Минимальный диапазон, имеющий смысл (хотя бы 1 день). */
export const MIN_PERF_WINDOW_DAYS = 1;

export type PerfPeriod = {
  /** YYYY-MM-DD в Europe/Moscow, включительно. */
  dateFrom: string;
  /** YYYY-MM-DD в Europe/Moscow, включительно. */
  dateTo: string;
  /** Фактический размер окна в днях (после clamp). */
  windowDays: number;
};

/** Возвращает YYYY-MM-DD в Europe/Moscow (UTC+3 без переходов). */
export function moscowDateString(now: Date): string {
  const msc = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return msc.toISOString().slice(0, 10);
}

/** Сдвигает YYYY-MM-DD на N дней (можно отрицательное). */
export function shiftIsoDate(iso: string, deltaDays: number): string {
  // Парсим как UTC, чтобы не цеплять локальный TZ.
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Строит безопасное окно для Performance API.
 * - `dateTo` — today(MSC) - completeDayLag, чтобы не цеплять незавершённый день.
 * - `dateFrom` — `dateTo - (windowDays - 1)`, чтобы окно реально было `windowDays`.
 * - Ограничивает окно `[MIN_PERF_WINDOW_DAYS, MAX_PERF_WINDOW_DAYS]`.
 */
export function buildPerfPeriod(
  windowDays: number,
  now: Date = new Date(),
  completeDayLag = 1,
): PerfPeriod {
  const clamped = Math.max(
    MIN_PERF_WINDOW_DAYS,
    Math.min(MAX_PERF_WINDOW_DAYS, Math.floor(Number.isFinite(windowDays) ? windowDays : 30)),
  );
  const lag = Math.max(1, Math.floor(Number.isFinite(completeDayLag) ? completeDayLag : 1));
  const dateTo = shiftIsoDate(moscowDateString(now), -lag);
  const dateFrom = shiftIsoDate(dateTo, -(clamped - 1));
  return { dateFrom, dateTo, windowDays: clamped };
}

/** Форматирует период для отображения пользователю в ошибках/предупреждениях. */
export function describePeriod(p: PerfPeriod): string {
  return `${p.dateFrom}…${p.dateTo} (${p.windowDays}d, MSC)`;
}
