// PURPOSE: Единственный парсер и единственный форматтер денег модуля «Склад».
// Чистый модуль (без React/db) — им пользуются и клиентские диалоги, и
// scripts/test-stock-money.ts.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Раньше конверсия «рубли из инпута → копейки» жила в
// components/stock/stock-api.ts, а превью «Итого» в диалогах считало сумму
// СВОИМ выражением `Number(priceRub.replace(',', '.'))`. Два парсера расходятся
// ровно там, где пользователь вставляет строку из накладной или Excel:
// «1 200» → превью 0 ₽, а документ проводится на 1200 ₽. Плюс собственный
// formatMoney печатает разряды НЕРАЗРЫВНЫМ пробелом (U+00A0) — скопировал
// показанное, вставил обратно, получил другую цифру.
//
// Инвариант: любая строка с деньгами разбирается ТОЛЬКО rublesToKopecks,
// любая сумма показывается ТОЛЬКО formatMoney. Превью считается в копейках
// (целыми), а не во float-рублях.

/** Валютные хвосты, которые пользователь приносит вместе с числом при копипасте. */
const CURRENCY_NOISE = /[₽$€]|руб\.?|р\.|rub/giu;

/**
 * Рубли из текстового поля → копейки («1234,56» → 123456).
 *
 * Убирает ЛЮБЫЕ пробелы (`\s` покрывает и обычный, и неразрывный U+00A0 из
 * Intl-форматирования, и узкий U+202F), валютные хвосты и разделитель-запятую.
 * Некорректный ввод — 0, а не NaN: NaN, попавший в сумму документа, приводит к
 * `null` в bigint-колонке и падению проводки.
 */
export function rublesToKopecks(input: string): number {
  const normalized = String(input ?? '')
    .replace(CURRENCY_NOISE, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  if (normalized === '' || normalized === '-' || normalized === '.') return 0;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** Копейки → строка для инпута («123456» → «1234.56», «120000» → «1200»). */
export function kopecksToRublesInput(kopecks: number): string {
  if (!kopecks) return '';
  return kopecks % 100 === 0 ? String(kopecks / 100) : (kopecks / 100).toFixed(2);
}

/** Количество из инпута: целое, неотрицательное (сервер принимает только int). */
export function parseQty(input: string): number {
  const value = Number(String(input ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

/**
 * Сумма строк документа в копейках — ровно то, что уйдёт на сервер.
 * Строки без товара/количества не считаются: их отбрасывает и submit.
 */
export function linesTotalKopecks(
  lines: ReadonlyArray<{ qty: string; priceRub: string }>,
): number {
  let total = 0;
  for (const line of lines) {
    const qty = parseQty(line.qty);
    if (qty <= 0) continue;
    total += qty * rublesToKopecks(line.priceRub);
  }
  return total;
}

// Конструирование Intl.NumberFormat дорогое, а formatMoney вызывается на каждую
// ячейку каждого рендера таблиц склада — держим два инстанса на модуле
// (тот же приём, что и кэш форматтеров в catalog/custom-data.tsx).
const RUB_INT = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const RUB_KOP = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Копейки → «1 234,56» / «1 235» (без символа валюты — его ставит вызывающий). */
export function formatMoney(kopecks: number, showKopecks = false): string {
  if (!Number.isFinite(kopecks)) return showKopecks ? '0,00' : '0';
  return showKopecks
    ? RUB_KOP.format(kopecks / 100)
    : RUB_INT.format(Math.round(kopecks / 100));
}
