// PURPOSE: Smoke-тесты чистого разбора выгрузок продаж WB / Яндекс.Маркета
// (src/lib/stock/import-sales.ts). Канон — docs/STOCK_MODULE_DESIGN.md §12.3
// (каналы учитываются с первого дня), §4.3 (возвраты), §4.8.9 (идемпотентность).
//
// Что здесь дороже всего и потому проверяется отдельно:
//   • колонки ищутся по заголовкам — не та колонка «Количество» уводит склад
//     молча, поэтому проверяются реальные шапки WB и ЯМ, включая мусорные
//     строки перед заголовком;
//   • деньги разбираются ЕДИНСТВЕННЫМ парсером money.ts — «1 200,50» с
//     НЕРАЗРЫВНЫМ пробелом (U+00A0) обязан дать 120050 копеек;
//   • дата приводится к календарному дню МОСКВЫ — ночная продажа не имеет
//     права уехать в соседний день;
//   • возвраты гасят продажи того же дня, а не создают приход из воздуха;
//   • ключ идемпотентности — канал + ДЕНЬ, поэтому перекрывающиеся выгрузки
//     не задваивают движения.
//
// Юникод-пробелы в тестовых данных задаются ЭСКЕЙПАМИ (\u00A0, \u202F):
// литеральные символы в исходнике вырождаются в обычный пробел при
// копировании и тест перестаёт проверять то, ради чего написан.
//
// Запуск: pnpm tsx scripts/test-stock-sales-import.ts

import {
  aggregateSales,
  buildSalesDocPlans,
  detectColumnMap,
  isReturnDocType,
  normalizeHeader,
  parseSaleDate,
  parseSalesSheet,
  salesDocRef,
  salesDocSource,
  type ParsedSaleRow,
} from '../src/lib/stock/import-sales';
import { filterNewDocs, importKey } from '../src/lib/stock/costing';
import { parseSignedQty } from '../src/lib/stock/money';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, hint?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}${hint ? ` — ${hint}` : ''}`);
    failed += 1;
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(
    label,
    same,
    same
      ? undefined
      : `получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`,
  );
}

const NBSP = '\u00A0';
const NNBSP = '\u202F';

// ===========================================================================
console.log('\n=== Нормализация заголовков ===');
// ===========================================================================
{
  eq('регистр не значим', normalizeHeader('Дата Продажи'), 'датапродажи');
  eq('ё приводится к е', normalizeHeader('Кол-во, шт.'), 'колво,шт.'.replace(/[^a-zа-я0-9]+/g, ''));
  eq('пунктуация выкидывается', normalizeHeader('Кол-во, шт.'), 'колвошт');
  eq('неразрывный пробел не мешает', normalizeHeader(`Дата${NBSP}продажи`), 'датапродажи');
  eq('пустой заголовок', normalizeHeader('   '), '');
}

// ===========================================================================
console.log('\n=== Wildberries: типовая выгрузка «Продажи» ===');
// ===========================================================================
{
  const table = [
    ['Отчёт о продажах', '', '', '', '', ''],
    ['период: 01.08.2026 — 07.08.2026', '', '', '', '', ''],
    [
      'Дата продажи',
      'Артикул поставщика',
      'Номенклатура',
      'Предмет',
      'Кол-во, шт.',
      'К перечислению продавцу',
      'Тип документа',
    ],
    ['01.08.2026', 'SPD-60', '123456789', 'БАД', '2', `1${NBSP}200,50`, 'Продажа'],
    ['01.08.2026', 'SPD-60', '123456789', 'БАД', '1', '600,25', 'Продажа'],
    ['02.08.2026', 'RST-30', '987654321', 'БАД', '4', `2${NNBSP}000`, 'Продажа'],
    ['02.08.2026', 'SPD-60', '123456789', 'БАД', '1', '600,25', 'Возврат'],
  ];
  const res = parseSalesSheet(table, { channel: 'wb' });
  if (!res.ok) {
    ok('файл разобран', false, res.error);
  } else {
    eq('заголовок найден на 3-й строке', res.headerRowNo, 3);
    eq(
      'колонка даты',
      res.mapping.find((m) => m.field === 'date')?.header,
      'Дата продажи',
    );
    eq(
      'колонка артикула — артикул ПОСТАВЩИКА, а не номенклатура',
      res.mapping.find((m) => m.field === 'externalId')?.header,
      'Артикул поставщика',
    );
    eq(
      'колонка количества',
      res.mapping.find((m) => m.field === 'qty')?.header,
      'Кол-во, шт.',
    );
    eq(
      'колонка выручки',
      res.mapping.find((m) => m.field === 'revenue')?.header,
      'К перечислению продавцу',
    );
    eq('строк разобрано', res.rows.length, 4);
    eq('дата приведена к ISO', res.rows[0].date, '2026-08-01');
    eq('неразрывный пробел в сумме не сломал парсер', res.rows[0].revenueKopecks, 120_050);
    eq('узкий неразрывный пробел тоже', res.rows[2].revenueKopecks, 200_000);
    eq('номенклатура ушла во второй ключ', res.rows[0].externalSku, '123456789');
    eq('возврат стал отрицательным', res.rows[3].qty, -1);
    eq('и выручка возврата тоже', res.rows[3].revenueKopecks, -60_025);
    eq('ничего не пропущено', res.skipped.length, 0);
  }
}

{
  // Возврат минусом в количестве, без колонки «Тип документа»:
  // знак не должен инвертироваться дважды.
  const table = [
    ['Дата', 'Артикул поставщика', 'Количество', 'Сумма'],
    ['03.08.2026', 'SPD-60', '-2', '-1200'],
  ];
  const res = parseSalesSheet(table, { channel: 'wb' });
  ok('файл разобран', res.ok);
  if (res.ok) {
    eq('минус сохранён', res.rows[0].qty, -2);
    eq('выручка отрицательная', res.rows[0].revenueKopecks, -120_000);
  }
}

{
  // Тот же возврат, но и минус, и слово «Возврат» — двойной инверсии быть не должно.
  const table = [
    ['Дата', 'Артикул поставщика', 'Количество', 'Тип документа'],
    ['03.08.2026', 'SPD-60', '-2', 'Возврат'],
  ];
  const res = parseSalesSheet(table, { channel: 'wb' });
  if (res.ok) eq('знак не инвертирован дважды', res.rows[0].qty, -2);
}

// ===========================================================================
console.log('\n=== Яндекс.Маркет: своя шапка ===');
// ===========================================================================
{
  const table = [
    ['Дата заказа', 'Ваш SKU', 'SKU на Маркете', 'Название товара', 'Количество', 'Стоимость товаров'],
    ['2026-08-01', 'SPD-60', 'ym-1', 'Спермидин 60', '3', '2 700,00'],
    ['2026-08-01T23:40:00+03:00', 'SPD-60', 'ym-1', 'Спермидин 60', '1', '900'],
  ];
  const res = parseSalesSheet(table, { channel: 'yandex' });
  if (!res.ok) {
    ok('файл разобран', false, res.error);
  } else {
    eq('ключ сшивки — «Ваш SKU»', res.mapping.find((m) => m.field === 'externalId')?.header, 'Ваш SKU');
    eq('строк', res.rows.length, 2);
    eq('ISO-дата', res.rows[0].date, '2026-08-01');
    eq('дата со смещением МСК осталась своим днём', res.rows[1].date, '2026-08-01');
    eq('сумма с обычным пробелом', res.rows[0].revenueKopecks, 270_000);
  }
}

// ===========================================================================
console.log('\n=== Даты: календарный день Москвы ===');
// ===========================================================================
{
  eq('DD.MM.YYYY', parseSaleDate('05.08.2026'), '2026-08-05');
  eq('D.M.YYYY', parseSaleDate('5.8.2026'), '2026-08-05');
  eq('YYYY-MM-DD', parseSaleDate('2026-08-05'), '2026-08-05');
  eq('дата-время без зоны — день из строки', parseSaleDate('2026-08-05 23:40:00'), '2026-08-05');
  // 2026-08-05T22:30Z = 2026-08-06 01:30 по Москве: день ДРУГОЙ.
  eq('UTC-полночь переводится в МСК', parseSaleDate('2026-08-05T22:30:00Z'), '2026-08-06');
  eq('смещение +03:00 остаётся в своём дне', parseSaleDate('2026-08-05T23:30:00+03:00'), '2026-08-05');
  eq('мусор не превращается в дату', parseSaleDate('итого'), null);
  eq('пустая ячейка', parseSaleDate(''), null);
  eq('серийный номер Excel', parseSaleDate('46239'), '2026-08-05');
}

// ===========================================================================
console.log('\n=== Количество и признак возврата ===');
// ===========================================================================
{
  eq('целое', parseSignedQty('3'), 3);
  eq('минус', parseSignedQty('-2'), -2);
  eq(`типографское тире как минус`, parseSignedQty('\u22122'), -2);
  eq('неразрывный пробел внутри числа', parseSignedQty(`1${NBSP}200`), 1200);
  eq('дробное усекается', parseSignedQty('2,7'), 2);
  eq('мусор — ноль, а не NaN', parseSignedQty('шт'), 0);
  ok('«Возврат» распознан', isReturnDocType('Возврат'));
  ok('«Логистика» — не возврат', !isReturnDocType('Логистика'));
  ok('«Продажа» — не возврат', !isReturnDocType('Продажа'));
}

// ===========================================================================
console.log('\n=== Ошибки разбора не молчат ===');
// ===========================================================================
{
  const res = parseSalesSheet([['Итого', 'по', 'отчёту'], ['1', '2', '3']], {
    channel: 'wb',
  });
  ok('файл без нужных колонок отвергнут', res.ok === false);
  if (!res.ok) {
    ok('в ошибке перечислены найденные заголовки', res.error.includes('Итого'));
  }
}

{
  const table = [
    ['Дата', 'Артикул поставщика', 'Количество'],
    ['01.08.2026', 'SPD-60', '2'],
    ['итого', '', '5'],
    ['02.08.2026', '', '1'],
    ['02.08.2026', 'SPD-60', '0'],
  ];
  const res = parseSalesSheet(table, { channel: 'wb' });
  if (res.ok) {
    eq('разобрана одна строка', res.rows.length, 1);
    eq('пропущено три', res.skipped.length, 3);
    ok(
      'у каждого пропуска есть причина',
      res.skipped.every((s) => s.reason.length > 0 && s.rowNo > 0),
    );
  }
}

{
  // Ручная раскладка колонок: человек поправил автоподбор в диалоге.
  const table = [
    ['A', 'B', 'C'],
    ['01.08.2026', 'SPD-60', '7'],
  ];
  const res = parseSalesSheet(table, {
    channel: 'wb',
    mapping: { date: 0, externalId: 1, qty: 2 },
  });
  ok('ручная раскладка принята', res.ok);
  if (res.ok) eq('строка разобрана по ней', res.rows[0].qty, 7);
}

// ===========================================================================
console.log('\n=== Свёртка: возврат гасит продажу того же дня ===');
// ===========================================================================
function row(patch: Partial<ParsedSaleRow> & { qty: number }): ParsedSaleRow {
  return {
    rowNo: patch.rowNo ?? 1,
    date: patch.date ?? '2026-08-01',
    externalId: patch.externalId ?? 'SPD-60',
    externalSku: patch.externalSku ?? null,
    name: patch.name ?? null,
    qty: patch.qty,
    revenueKopecks: patch.revenueKopecks ?? 0,
  };
}

{
  const agg = aggregateSales([
    row({ qty: 2, revenueKopecks: 120_000 }),
    row({ qty: 1, revenueKopecks: 60_000 }),
    row({ qty: -1, revenueKopecks: -60_000 }),
    row({ qty: 5, externalId: 'RST-30', revenueKopecks: 250_000 }),
    row({ qty: 3, date: '2026-08-02', revenueKopecks: 180_000 }),
  ]);
  eq('свёрнуто в три позиции', agg.length, 3);
  eq('нетто по SPD-60 за 1 августа', agg.find((a) => a.externalId === 'SPD-60')?.qty, 2);
  eq(
    'выручка сложилась с учётом возврата',
    agg.find((a) => a.externalId === 'SPD-60')?.revenueKopecks,
    120_000,
  );
  eq('порядок детерминирован (дата, артикул)', agg.map((a) => `${a.date}/${a.externalId}`), [
    '2026-08-01/RST-30',
    '2026-08-01/SPD-60',
    '2026-08-02/SPD-60',
  ]);
}

{
  // Продажа и возврат полностью погасились — движения быть не должно.
  const agg = aggregateSales([
    row({ qty: 1, revenueKopecks: 60_000 }),
    row({ qty: -1, revenueKopecks: -60_000 }),
  ]);
  eq('нулевое нетто выпадает', agg.length, 0);
}

{
  // Возвратов больше, чем продаж → отдельный приходный документ.
  const plans = buildSalesDocPlans(
    aggregateSales([
      row({ qty: 1, revenueKopecks: 60_000 }),
      row({ qty: -3, revenueKopecks: -180_000 }),
      row({ qty: 4, externalId: 'RST-30', revenueKopecks: 200_000 }),
    ]),
    'wb',
  );
  eq('два документа за день', plans.length, 2);
  const sale = plans.find((p) => p.kind === 'sale');
  const ret = plans.find((p) => p.kind === 'return_in');
  eq('продажа — RST-30', sale?.lines[0].externalId, 'RST-30');
  eq('в продаже 4 шт', sale?.qtyTotal, 4);
  eq('возврат — SPD-60', ret?.lines[0].externalId, 'SPD-60');
  eq('в возврате 2 шт (нетто)', ret?.qtyTotal, 2);
  ok('количества в строках всегда положительные', (ret?.lines ?? []).every((l) => l.qty > 0));
  eq('цена продажи за штуку', sale?.lines[0].unitPriceKopecks, 50_000);
}

// ===========================================================================
console.log('\n=== Идемпотентность (§4.8.9): ключ — канал + ДЕНЬ ===');
// ===========================================================================
{
  eq('source канала', salesDocSource('wb'), 'import:wb');
  eq('ref дня', salesDocRef('wb', '2026-08-01'), 'wb:sales:2026-08-01');
  ok('каналы не пересекаются', salesDocRef('wb', '2026-08-01') !== salesDocRef('yandex', '2026-08-01'));

  const plans = buildSalesDocPlans(
    aggregateSales([
      row({ qty: 2, revenueKopecks: 120_000 }),
      row({ qty: 3, date: '2026-08-02', revenueKopecks: 180_000 }),
    ]),
    'wb',
  );
  eq('документа два — по дню на каждый', plans.length, 2);
  ok(
    'ключи документов различаются',
    plans[0].sourceRef !== plans[1].sourceRef,
  );

  // Повторный импорт перекрывающего файла: 1 августа уже в базе.
  const existing = [importKey({ source: 'import:wb', sourceRef: 'wb:sales:2026-08-01' })!];
  const { fresh, skipped } = filterNewDocs(existing, plans);
  eq('заново импортируется только 2 августа', fresh.length, 1);
  eq('и это именно 2 августа', fresh[0].date, '2026-08-02');
  eq('пропущен один документ', skipped.length, 1);

  // Полный повтор того же файла не создаёт НИ ОДНОГО документа.
  const allKeys = plans.map((p) => importKey(p)!);
  const second = filterNewDocs(allKeys, plans);
  eq('повторный импорт пуст', second.fresh.length, 0);
  eq('и всё помечено пропущенным', second.skipped.length, 2);

  // Дубли внутри одной пачки тоже отсекаются (§4.8.9).
  const dupes = filterNewDocs([], [...plans, ...plans]);
  eq('дубли внутри пачки отсечены', dupes.fresh.length, 2);
}

// ===========================================================================
console.log('\n=== Автоподбор колонок отдельно (для диалога) ===');
// ===========================================================================
{
  const map = detectColumnMap(
    ['Дата продажи', 'Артикул поставщика', 'Номенклатура', 'Кол-во', 'Сумма'],
    'wb',
  );
  eq('дата', map.date, 0);
  eq('артикул', map.externalId, 1);
  eq('количество', map.qty, 3);
  eq('выручка', map.revenue, 4);
  eq(
    'номенклатура во втором ключе',
    (map as Record<string, number>).externalSku,
    2,
  );
}

console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
