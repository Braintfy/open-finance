// PURPOSE: Smoke-тест реестра статей src/lib/metrics/lines.ts: уникальность кодов,
// согласованность производных списков, isLineCode, что контроль и меры не в прибыли.
// Запуск: pnpm -s tsx scripts/test-metrics-lines.ts

import {
  LINES,
  LINE_BY_CODE,
  MP_FEE_LINES,
  PROFIT_LINES,
  isLineCode,
  type LineCode,
} from '../src/lib/metrics/lines';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, hint?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}${hint ? ' — ' + hint : ''}`);
    failed += 1;
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(label, same, same ? undefined : `получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`);
}

console.log('\n=== Реестр ===');
{
  const codes = LINES.map((l) => l.code);
  eq('26 статей', codes.length, 26);
  eq('коды уникальны', new Set(codes).size, codes.length);
  ok('LINE_BY_CODE покрывает все коды', codes.every((c) => LINE_BY_CODE[c]?.code === c));
  eq('LINE_BY_CODE без лишних ключей', Object.keys(LINE_BY_CODE).length, codes.length);
  ok('названия непустые', LINES.every((l) => l.title.length > 0));
}

console.log('\n=== Прибыль и удержания ===');
{
  const expectedProfit: LineCode[] = [
    'revenue', 'returns', 'mp_topup',
    'commission', 'logistics', 'return_logistics', 'last_mile', 'storage', 'acquiring', 'penalties', 'other_fees',
    'compensation', 'ads', 'cogs', 'tax', 'opex', 'unclassified',
  ];
  eq('PROFIT_LINES ровно по списку (в порядке водопада)', [...PROFIT_LINES], expectedProfit);
  eq('PROFIT_LINES == inProfit', [...PROFIT_LINES], LINES.filter((l) => l.inProfit).map((l) => l.code));
  eq('MP_FEE_LINES — 8 статей группы mp_fees', [...MP_FEE_LINES], [
    'commission', 'logistics', 'return_logistics', 'last_mile', 'storage', 'acquiring', 'penalties', 'other_fees',
  ]);
  ok('MP_FEE_LINES входят в PROFIT_LINES', MP_FEE_LINES.every((c) => PROFIT_LINES.includes(c)));
  ok(
    'ни одна control/measure не в прибыли',
    LINES.filter((l) => l.group === 'control' || l.group === 'measure').every(
      (l) => !l.inProfit && !PROFIT_LINES.includes(l.code),
    ),
  );
  ok(
    'статьи в прибыли не из control/measure',
    LINES.filter((l) => l.inProfit).every((l) => l.group !== 'control' && l.group !== 'measure'),
  );
}

console.log('\n=== hasQty ===');
{
  eq(
    'hasQty ровно у 7 статей',
    LINES.filter((l) => l.hasQty).map((l) => l.code).sort(),
    ['cart_adds', 'ordered', 'returns', 'revenue', 'rlz_returns', 'rlz_revenue', 'views'],
  );
}

console.log('\n=== isLineCode ===');
{
  ok('известный код', isLineCode('revenue'));
  ok('последний код', isLineCode('cart_adds'));
  ok('неизвестный код', !isLineCode('foo'));
  ok('пустая строка', !isLineCode(''));
  ok('регистр важен', !isLineCode('Revenue'));
  ok('унаследованные свойства не коды', !isLineCode('toString') && !isLineCode('constructor'));
}

console.log(`\nИтого: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
