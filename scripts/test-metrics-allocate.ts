// PURPOSE: Smoke-тесты src/lib/metrics/allocate.ts — сохранение итога при разнесении копеек.
// Запуск: pnpm -s tsx scripts/test-metrics-allocate.ts

import { allocate, allocateCapped } from '../src/lib/metrics/allocate';

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

const sum = (xs: { amountKopecks: number }[]) => xs.reduce((a, x) => a + x.amountKopecks, 0);

console.log('\n=== allocate: базовые случаи ===');
{
  const r = allocate(1, [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }]);
  eq('1 копейка на двоих: Σ=1, достаётся первому', r.parts, [
    { key: 'a', amountKopecks: 1 },
    { key: 'b', amountKopecks: 0 },
  ]);
  eq('нулевая часть остаётся в результате', r.parts.length, 2);
  eq('unallocated = 0', r.unallocatedKopecks, 0);
}
{
  const w = [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }, { key: 'c', weight: 1 }];
  eq('100 / три равных → 34/33/33', allocate(100, w).parts.map((p) => p.amountKopecks), [34, 33, 33]);
  eq('-100 / три равных → -34/-33/-33', allocate(-100, w).parts.map((p) => p.amountKopecks), [-34, -33, -33]);
}
{
  const big = 10_000_000_000_000;
  const r = allocate(big, [{ key: 'a', weight: 3 }, { key: 'b', weight: 7 }, { key: 'c', weight: 1e9 + 0.5 }]);
  eq('Σ = 10^13 точно', sum(r.parts), big);
  const rn = allocate(-big - 1, [{ key: 'a', weight: 123456789.123 }, { key: 'b', weight: 987654321.987 }]);
  eq('Σ = −(10^13+1) точно', sum(rn.parts), -big - 1);
  ok('все части отрицательны или 0', rn.parts.every((p) => p.amountKopecks <= 0));
}
{
  const r = allocate(0, [{ key: 'a', weight: 2 }, { key: 'b', weight: 1 }]);
  eq('total = 0 → все нули', r.parts, [
    { key: 'a', amountKopecks: 0 },
    { key: 'b', amountKopecks: 0 },
  ]);
  ok('нули без знака минус (не -0)', r.parts.every((p) => Object.is(p.amountKopecks, 0)));
}
{
  let threw = false;
  try {
    allocate(10.5, [{ key: 'a', weight: 1 }]);
  } catch {
    threw = true;
  }
  ok('нецелый total → throw', threw);
}

console.log('\n=== allocate: негодные веса и дубли ===');
{
  const r = allocate(500, []);
  eq('пустые веса', r, { parts: [], unallocatedKopecks: 500 });
  const r2 = allocate(-500, [
    { key: 'a', weight: 0 },
    { key: 'b', weight: -3 },
    { key: 'c', weight: NaN },
    { key: 'd', weight: Infinity },
  ]);
  eq('только негодные веса → всё не разнесено', r2, { parts: [], unallocatedKopecks: -500 });
  const r3 = allocate(100, [
    { key: 'a', weight: -1 },
    { key: 'b', weight: 1 },
    { key: 'c', weight: NaN },
  ]);
  eq('годный вес один — получает всё', r3.parts, [{ key: 'b', amountKopecks: 100 }]);
}
{
  const r = allocate(90, [
    { key: 'a', weight: 1 },
    { key: 'b', weight: 1 },
    { key: 'a', weight: 1 },
  ]);
  eq('дубли ключей складываются: a=2, b=1 → 60/30', r.parts, [
    { key: 'a', amountKopecks: 60 },
    { key: 'b', amountKopecks: 30 },
  ]);
}

console.log('\n=== allocate: свойство Σ = total на 200 наборах ===');
{
  let state = 123456789;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  let bad = 0;
  let badSign = 0;
  for (let i = 0; i < 200; i++) {
    const total = Math.round((rnd() - 0.5) * 2 * 10 ** Math.floor(rnd() * 13));
    const n = 1 + Math.floor(rnd() * 12);
    const ws = Array.from({ length: n }, (_, j) => ({
      key: `k${Math.floor(rnd() * 8)}_${j % 5}`,
      weight: rnd() < 0.15 ? 0 : rnd() * 10 ** Math.floor(rnd() * 9),
    }));
    const r = allocate(total, ws);
    if (r.parts.length === 0) {
      if (r.unallocatedKopecks !== total) bad++;
      continue;
    }
    if (sum(r.parts) !== total || r.unallocatedKopecks !== 0) bad++;
    if (r.parts.some((p) => Math.sign(p.amountKopecks) * Math.sign(total) < 0)) badSign++;
  }
  eq('нарушений сохранения суммы', bad, 0);
  eq('нарушений знака', badSign, 0);
}

console.log('\n=== allocateCapped ===');
{
  const r = allocateCapped(-500, [
    { key: 'a', amountKopecks: -100 },
    { key: 'b', amountKopecks: -150 },
  ]);
  eq('под лимитом: прямые как есть, остаток −250', r, {
    direct: [
      { key: 'a', amountKopecks: -100 },
      { key: 'b', amountKopecks: -150 },
    ],
    remainderKopecks: -250,
    overflowKopecks: 0,
  });
}
{
  const r = allocateCapped(-500, [
    { key: 'a', amountKopecks: -200 },
    { key: 'b', amountKopecks: -300 },
  ]);
  eq('ровно лимит: остаток 0', [r.remainderKopecks, r.overflowKopecks], [0, 0]);
  ok('остаток не -0', Object.is(r.remainderKopecks, 0));
}
{
  const r = allocateCapped(-500, [
    { key: 'a', amountKopecks: -560 },
    { key: 'b', amountKopecks: -500 },
  ]);
  eq('превышение: Σ прямых ужата до итога', sum(r.direct), -500);
  eq('остаток 0', r.remainderKopecks, 0);
  eq('overflow = Σdirect − total = −560', r.overflowKopecks, -560);
  eq('пропорционально 560:500', r.direct.map((d) => d.amountKopecks), [-264, -236]);
}
{
  const r = allocateCapped(-500, [
    { key: 'a', amountKopecks: 100 },
    { key: 'b', amountKopecks: 0 },
    { key: 'c', amountKopecks: -200 },
  ]);
  eq('противоположный знак и ноль отброшены', r, {
    direct: [{ key: 'c', amountKopecks: -200 }],
    remainderKopecks: -300,
    overflowKopecks: 0,
  });
  const p = allocateCapped(300, [{ key: 'x', amountKopecks: 100 }, { key: 'y', amountKopecks: -50 }]);
  eq('положительный итог: остаток 200', p, {
    direct: [{ key: 'x', amountKopecks: 100 }],
    remainderKopecks: 200,
    overflowKopecks: 0,
  });
}
{
  let state = 42;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  let bad = 0;
  for (let i = 0; i < 100; i++) {
    const total = -Math.floor(rnd() * 100000);
    const ds = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, j) => ({
      key: `s${j}`,
      amountKopecks: -Math.floor(rnd() * 50000),
    }));
    const r = allocateCapped(total, ds);
    if (sum(r.direct) + r.remainderKopecks !== total) bad++;
  }
  eq('инвариант Σdirect_out + remainder = total на 100 наборах', bad, 0);
}
{
  const r = allocateCapped(0, [{ key: 'a', amountKopecks: -10 }]);
  eq('нулевой итог: всё превышение в overflow', r, { direct: [], remainderKopecks: 0, overflowKopecks: -10 });
  const r2 = allocateCapped(0, [{ key: 'a', amountKopecks: -560 }, { key: 'b', amountKopecks: 0 }]);
  eq('нулевой итог, -560 → overflow -560', r2, { direct: [], remainderKopecks: 0, overflowKopecks: -560 });
}
{
  const r = allocate(100, [{ key: 'a', weight: 1e-9 }, { key: 'b', weight: 2e-9 }, { key: 'c', weight: 1e-9 }]);
  eq('малые веса 1e-9/2e-9/1e-9 → 25/50/25', r.parts.map((p) => p.amountKopecks), [25, 50, 25]);
  const r2 = allocate(10_000_000_000_000, [{ key: 'a', weight: 1.0000001 }, { key: 'b', weight: 1.0000004 }]);
  eq('различия мельче 1e-6 не схлопываются', r2.parts[1].amountKopecks > r2.parts[0].amountKopecks, true);
  const r3 = allocate(100, [{ key: 'a', weight: 1e308 }, { key: 'b', weight: 0.5 }]);
  eq('1e308 рядом с 0.5: не падает, 100/0', r3.parts.map((p) => p.amountKopecks), [100, 0]);
  const r4 = allocate(100, [{ key: 'a', weight: 0.1 }, { key: 'a', weight: 0.2 }, { key: 'b', weight: 0.3 }]);
  eq('дубли дробных весов складываются точно → 50/50', r4.parts.map((p) => p.amountKopecks), [50, 50]);
}

console.log(`\nИтого: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
