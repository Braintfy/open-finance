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
 * Знаки «минус», которые приходят из чужих выгрузок вместо ASCII-дефиса:
 * U+2212 (математический минус — им печатает Excel и кабинет WB), U+2013/U+2014
 * (тире), U+2012 (цифровое тире), U+FF0D (полноширинный минус).
 *
 * Эскейпами, а не литералами: в исходнике все они визуально неотличимы от
 * дефиса и вырождаются в него при копировании кода — тест «проходил» бы вхолостую.
 *
 * ОДИН набор на модуль. Пока его знал только parseSignedQty, строка возврата
 * разъезжалась внутри себя: количество с таким минусом читалось как -1, а сумма
 * в соседней колонке молча становилась 0 (Number с юникод-минусом даёт NaN, а
 * NaN мы гасим нулём). Возврат гасил штуки и НЕ гасил выручку.
 */
const MINUS_SIGNS = /[\u2212\u2013\u2014\u2012\uFF0D]/g;

/**
 * Рубли из текстового поля → копейки («1234,56» → 123456).
 *
 * Убирает ЛЮБЫЕ пробелы (`\s` покрывает и обычный, и неразрывный U+00A0 из
 * Intl-форматирования, и узкий U+202F), валютные хвосты и разделитель-запятую,
 * приводит юникод-минусы к ASCII-дефису.
 * Некорректный ввод — 0, а не NaN: NaN, попавший в сумму документа, приводит к
 * `null` в bigint-колонке и падению проводки.
 */
export function rublesToKopecks(input: string): number {
  const normalized = String(input ?? '')
    .replace(CURRENCY_NOISE, '')
    .replace(/\s/g, '')
    .replace(MINUS_SIGNS, '-')
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
  const value = Number(
    String(input ?? '')
      .replace(/\s/g, '')
      // Юникод-минус тем же набором, что и в деньгах: «U+2212 5» обязан отброситься
      // как отрицательное количество, а не как «мусор» — причина одна и та же.
      .replace(MINUS_SIGNS, '-')
      .replace(',', '.'),
  );
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

/**
 * ЗНАКОВОЕ количество из ячейки файла — для импорта продаж WB/ЯМ, где возврат
 * приходит либо строкой «-1», либо отдельным типом документа. Тем же парсером,
 * что и деньги, гасятся пробелы (включая неразрывный U+00A0 из Excel),
 * юникод-минусы (MINUS_SIGNS — ОДИН набор на модуль) и запятая-разделитель.
 * Мусор → 0, а не NaN: NaN в количестве роняет проводку.
 */
export function parseSignedQty(input: string | number): number {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.trunc(input) : 0;
  }
  const normalized = String(input ?? '')
    .replace(/\s/g, '')
    .replace(MINUS_SIGNS, '-')
    .replace(',', '.');
  if (normalized === '' || normalized === '-') return 0;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return 0;
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
