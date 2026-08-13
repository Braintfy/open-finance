// PURPOSE: Smoke-тесты денежного парсера склада (src/lib/stock/money.ts).
// Регресс, ради которого файл существует: превью «Итого» в диалогах считало
// сумму своим выражением `Number(priceRub.replace(',', '.'))`, а payload —
// rublesToKopecks. На строке «1 200» (вставка из накладной / Excel, и тем более
// копипаст собственного вывода formatMoney с НЕРАЗРЫВНЫМ пробелом) превью
// показывало 0 ₽, а документ проводился на 1200 ₽.
// Запуск: pnpm tsx scripts/test-stock-money.ts

import {
  formatMoney,
  kopecksToRublesInput,
  linesTotalKopecks,
  parseQty,
  rublesToKopecks,
} from '../src/lib/stock/money';

let passed = 0;
let failed = 0;

function eq(actual: unknown, expected: unknown, name: string): void {
  if (Object.is(actual, expected)) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${name}\n  ожидалось: ${String(expected)}\n  получено:  ${String(actual)}`);
}

// Юникодные пробелы задаём ЭСКЕЙПАМИ, а не литералами: в исходнике они
// неотличимы от обычного пробела, и тест «проходил» бы по ошибке.
const NBSP = '\u00A0'; // им Intl.NumberFormat('ru-RU') разделяет разряды
const NNBSP = '\u202F'; // узкий неразрывный — приходит из части источников
const THINSP = '\u2009'; // тонкий

// ── 1. Базовая конверсия ────────────────────────────────────────────────────
eq(rublesToKopecks('19,90'), 1990, 'запятая как разделитель');
eq(rublesToKopecks('19.90'), 1990, 'точка как разделитель');
eq(rublesToKopecks('1234,56'), 123456, 'без разрядов');
eq(rublesToKopecks('0'), 0, 'ноль');
eq(rublesToKopecks(''), 0, 'пустая строка');
eq(rublesToKopecks('-'), 0, 'один минус — не NaN');
eq(rublesToKopecks('abc'), 0, 'мусор — 0, а не NaN');
eq(rublesToKopecks('-19,90'), -1990, 'отрицательное');

// float-дрейф: 19.9 * 100 === 1989.9999999999998
eq(rublesToKopecks('19,90') * 3, 5970, 'нет float-дрейфа при умножении');

// ── 2. Разряды пробелами — ядро регресса ────────────────────────────────────
eq(rublesToKopecks('1 200'), 120000, 'обычный пробел: «1 200» → 1200 ₽');
eq(rublesToKopecks(`1${NBSP}200`), 120000, 'неразрывный пробел U+00A0');
eq(rublesToKopecks(`1${NNBSP}200`), 120000, 'узкий неразрывный пробел U+202F');
eq(rublesToKopecks(`1${THINSP}200`), 120000, 'тонкий пробел U+2009');
eq(rublesToKopecks(`1${NBSP}234,56`), 123456, 'разряды + копейки');
eq(rublesToKopecks(' 19,90 '), 1990, 'обрамляющие пробелы');

// Round-trip: то, что напечатал formatMoney, обязано вернуться тем же числом.
for (const kopecks of [120000, 123456, 100, 999999999, 5, 0]) {
  eq(
    rublesToKopecks(formatMoney(kopecks, true)),
    kopecks,
    `round-trip formatMoney(${kopecks}, true) → rublesToKopecks`,
  );
}
eq(
  formatMoney(120000, false).includes(NBSP) || formatMoney(120000, false).includes(NNBSP),
  true,
  'formatMoney действительно печатает неразрывный пробел (иначе тест выше холостой)',
);

// ── 3. Копипаст с валютой ───────────────────────────────────────────────────
eq(rublesToKopecks(`1${NBSP}234,56 ₽`), 123456, 'хвост «₽» не ломает разбор');
eq(rublesToKopecks('1200 руб.'), 120000, 'хвост «руб.»');
eq(rublesToKopecks('1200р.'), 120000, 'хвост «р.»');

// ── 4. Количество ───────────────────────────────────────────────────────────
eq(parseQty('3'), 3, 'целое количество');
eq(parseQty('3,7'), 3, 'дробное усекается (сервер принимает int)');
eq(parseQty('0'), 0, 'ноль');
eq(parseQty('-5'), 0, 'отрицательное количество отбрасывается');
eq(parseQty(''), 0, 'пустое количество');
eq(parseQty('abc'), 0, 'мусор в количестве');

// ── 5. Итог строк = payload ─────────────────────────────────────────────────
eq(
  linesTotalKopecks([
    { qty: '2', priceRub: '1 200' },
    { qty: '3', priceRub: `1${NBSP}200` },
  ]),
  600000,
  'итог по строкам с разрядами: 2×1200 + 3×1200 = 6000 ₽',
);
eq(
  linesTotalKopecks([
    { qty: '1', priceRub: '19,90' },
    { qty: '0', priceRub: '999' },
    { qty: '', priceRub: '999' },
  ]),
  1990,
  'строки с нулевым/пустым количеством в итог не входят (как и в payload)',
);
eq(linesTotalKopecks([]), 0, 'пустой документ');

// Именно это расхождение и было багом: старое превью дало бы 0.
eq(
  Number(('1 200').replace(',', '.')) || 0,
  0,
  'контроль: старое выражение превью на «1 200» действительно давало 0',
);

// ── 6. Формат и обратный ввод ───────────────────────────────────────────────
eq(formatMoney(123456, true), `1${NBSP}234,56`, 'formatMoney с копейками');
eq(formatMoney(123456, false), `1${NBSP}235`, 'formatMoney без копеек — округление, не усечение');
eq(formatMoney(0, true), '0,00', 'ноль с копейками');
eq(kopecksToRublesInput(120000), '1200', 'целые рубли — без хвоста ,00');
eq(kopecksToRublesInput(123456), '1234.56', 'дробные — точкой (это value инпута)');
eq(kopecksToRublesInput(0), '', 'ноль → пустой инпут');
eq(
  rublesToKopecks(kopecksToRublesInput(123456)),
  123456,
  'round-trip kopecksToRublesInput → rublesToKopecks',
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
