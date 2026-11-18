// PURPOSE: Тест costSeries (src/lib/stock/costing.ts): паритет с costAtDate на
// ручных и 100 псевдослучайных лентах плюс замер скорости 2000 событий × 365 дат.
// Запуск: pnpm -s tsx scripts/test-stock-cost-series.ts

import {
  buildReversalEvents,
  costAtDate,
  costSeries,
  replay,
  type CostingEvent,
} from '../src/lib/stock/costing';

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

let seqCounter = 0;
function ev(partial: Partial<CostingEvent> & Pick<CostingEvent, 'direction' | 'qty'>): CostingEvent {
  seqCounter += 1;
  return {
    docDate: partial.docDate ?? '2026-01-01',
    seq: partial.seq ?? seqCounter,
    direction: partial.direction,
    qty: partial.qty,
    kind: partial.kind ?? (partial.direction === 'in' ? 'purchase' : 'sale'),
    reason: partial.reason ?? null,
    valueKopecks: partial.valueKopecks,
    costBasis: partial.costBasis,
    isEstimated: partial.isEstimated,
    isReversal: partial.isReversal,
    itemId: partial.itemId,
  };
}

const DAY = 86_400_000;
function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
}

/** Все даты от (мин − 2 дня) до (макс + 2 дня) с шагом 1 день. */
function rangeFor(events: readonly CostingEvent[]): string[] {
  const ds = events.map((e) => e.docDate).sort();
  const out: string[] = [];
  for (let d = addDays(ds[0], -2); d <= addDays(ds[ds.length - 1], 2); d = addDays(d, 1)) out.push(d);
  return out;
}

/** Возвращает число несовпавших дат (0 = паритет). */
function parityMismatches(events: readonly CostingEvent[]): { bad: number; first?: string } {
  const dates = rangeFor(events);
  const series = costSeries(events, dates);
  let bad = 0;
  let first: string | undefined;
  for (const d of dates) {
    const a = JSON.stringify(series.get(d));
    const b = JSON.stringify(costAtDate(events, d));
    if (a !== b) {
      bad += 1;
      first ??= `${d}: ${a} vs ${b}`;
    }
  }
  return { bad, first };
}

function parity(label: string, events: readonly CostingEvent[]) {
  const r = parityMismatches(events);
  ok(`паритет: ${label}`, r.bad === 0, r.first);
}

console.log('\n=== Крайние случаи ===');
{
  eq('пустой isoDates → пустая Map', costSeries([ev({ direction: 'in', qty: 1, valueKopecks: 100 })], []).size, 0);
  const empty = costSeries([], ['2026-01-01', '2026-01-02']);
  eq('пустая лента → все null', [...empty.values()], [null, null]);
  const dup = costSeries(
    [ev({ direction: 'in', qty: 1, valueKopecks: 100, docDate: '2026-01-02' })],
    ['2026-01-03', '2026-01-03'],
  );
  eq('дубли дат → один ключ', dup.size, 1);
  const unsorted = costSeries(
    [ev({ direction: 'in', qty: 2, valueKopecks: 200, docDate: '2026-01-05' })],
    ['2026-01-09', '2026-01-01', '2026-01-05'],
  );
  eq('неотсортированные даты: до события null', unsorted.get('2026-01-01'), null);
  eq('дата ровно в день события включительно', unsorted.get('2026-01-05')?.avgCostKopecks, 100);
  eq('после события то же', unsorted.get('2026-01-09')?.qty, 2);
}

console.log('\n=== Обязательные кейсы ===');
{
  const e = [ev({ direction: 'in', qty: 10, valueKopecks: 1000, docDate: '2026-02-10' })];
  eq('дата до первого события = null', costSeries(e, ['2026-02-09']).get('2026-02-09'), null);
  parity('одно событие', e);
}
{
  const e = [
    ev({ direction: 'out', qty: 3, docDate: '2026-02-10' }),
    ev({ direction: 'out', qty: 1, docDate: '2026-02-12' }),
  ];
  parity('лента из одних расходов', e);
  eq('одни расходы: null на всех датах', [...costSeries(e, rangeFor(e)).values()].every((v) => v === null), true);
}
{
  const e = [
    ev({ direction: 'in', qty: 10, valueKopecks: 1000, docDate: '2026-03-01' }),
    ev({ direction: 'out', qty: 10, docDate: '2026-03-03' }),
    ev({ direction: 'in', qty: 5, valueKopecks: 1500, docDate: '2026-03-07' }),
  ];
  parity('пул исчерпан, затем новый приход', e);
  const s = costSeries(e, ['2026-03-04']).get('2026-03-04');
  ok('исчерпанный пул: средняя сохраняется', s?.qty === 0 && s.avgCostKopecks === 100, JSON.stringify(s));
}
{
  const e = [
    ev({ direction: 'in', qty: 10, valueKopecks: 1000, docDate: '2026-04-01', seq: 10 }),
    ev({ direction: 'out', qty: 4, docDate: '2026-04-05', seq: 12 }),
    ev({ direction: 'in', qty: 10, valueKopecks: 3000, docDate: '2026-04-05', seq: 11 }),
    ev({ direction: 'out', qty: 2, docDate: '2026-04-05', seq: 13 }),
  ];
  parity('несколько событий в один день (порядок по seq)', e);
}
{
  const e = [
    ev({ direction: 'in', qty: 10, valueKopecks: 1000, docDate: '2026-05-10', seq: 1 }),
    ev({ direction: 'out', qty: 5, docDate: '2026-05-12', seq: 2 }),
    ev({ direction: 'in', qty: 10, valueKopecks: 5000, docDate: '2026-05-03', seq: 3 }),
  ];
  parity('документ задним числом', e);
}
{
  const e = [
    ev({ direction: 'in', qty: 10, valueKopecks: 1000, costBasis: 'gross', docDate: '2026-06-01' }),
    ev({ direction: 'in', qty: 10, valueKopecks: 1200, costBasis: 'net', docDate: '2026-06-05' }),
    ev({ direction: 'out', qty: 3, docDate: '2026-06-08' }),
  ];
  parity('смена базиса gross → mixed', e);
  eq('базис mixed виден', costSeries(e, ['2026-06-06']).get('2026-06-06')?.basis, 'mixed');
}
{
  const purchase = ev({ direction: 'in', qty: 10, valueKopecks: 1000, docDate: '2026-07-01', seq: 1 });
  const sale = ev({ direction: 'out', qty: 4, docDate: '2026-07-03', seq: 2 });
  const moves = replay([purchase, sale]).moves;
  const rev = buildReversalEvents(moves.slice(1), { docDate: '2026-07-06', startSeq: 100 });
  const e = [purchase, sale, ...rev];
  parity('сторно продажи', e);
  const ret = ev({ direction: 'in', qty: 2, kind: 'return_in', valueKopecks: 200, docDate: '2026-07-08' });
  parity('возврат', [...e, ret]);
}

console.log('\n=== Свойство: 100 случайных лент ===');
{
  let state = 12345;
  const rnd = (n: number) => {
    // LCG (Numerical Recipes), детерминированный
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  let badTapes = 0;
  let firstBad = '';
  for (let t = 0; t < 100; t += 1) {
    const n = 5 + rnd(36);
    const events: CostingEvent[] = [];
    for (let k = 0; k < n; k += 1) {
      const isIn = rnd(10) < 5;
      const qty = 1 + rnd(20);
      events.push({
        docDate: addDays('2026-01-01', rnd(60)),
        seq: 1000 * t + k + 1,
        direction: isIn ? 'in' : 'out',
        qty,
        kind: isIn ? 'purchase' : 'sale',
        reason: null,
        valueKopecks: isIn ? qty * (50 + rnd(500)) : undefined,
        costBasis: isIn ? (rnd(4) === 0 ? 'net' : 'gross') : undefined,
      });
    }
    const r = parityMismatches(events);
    if (r.bad > 0) {
      badTapes += 1;
      firstBad ||= `лента ${t}: ${r.first}`;
    }
  }
  ok('100 лент: паритет на всех датах', badTapes === 0, firstBad);
}

console.log('\n=== Замер: 2000 событий × 365 дат ===');
{
  let state = 777;
  const rnd = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  const events: CostingEvent[] = [];
  for (let k = 0; k < 2000; k += 1) {
    const isIn = k % 3 === 0;
    const qty = 1 + rnd(10);
    events.push({
      docDate: addDays('2026-01-01', rnd(365)),
      seq: k + 1,
      direction: isIn ? 'in' : 'out',
      qty,
      kind: isIn ? 'purchase' : 'sale',
      reason: null,
      valueKopecks: isIn ? qty * (100 + rnd(300)) : undefined,
    });
  }
  const dates: string[] = [];
  for (let i = 0; i < 365; i += 1) dates.push(addDays('2026-01-01', i));

  const t0 = performance.now();
  const series = costSeries(events, dates);
  const tSeries = performance.now() - t0;

  const t1 = performance.now();
  const loop = dates.map((d) => costAtDate(events, d));
  const tLoop = performance.now() - t1;

  console.log(`  costSeries: ${tSeries.toFixed(1)} мс; 365 × costAtDate: ${tLoop.toFixed(1)} мс`);
  ok('costSeries не медленнее цикла costAtDate', tSeries <= tLoop, `${tSeries} > ${tLoop}`);
  eq('результаты замера совпадают', dates.map((d) => series.get(d)), loop);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
