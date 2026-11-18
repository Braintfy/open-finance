// PURPOSE: Smoke-тест формул метрик src/lib/metrics/formulas.ts: сквозной пример с руками
// посчитанными значениями, правило неизвестной себестоимости, null-условия, контрольные статьи.
// Запуск: pnpm -s tsx scripts/test-metrics-formulas.ts

import { computeMetrics, netRevenue, profit, type LineSum, type LineTotals } from '../src/lib/metrics/formulas';

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

function s(amountKopecks: number | null, qty = 0, baseQty = qty, unknownCount = 0): LineSum {
  return { amountKopecks, qty, baseQty, unknownCount };
}

function base(): LineTotals {
  return {
    revenue: s(100000, 10),
    returns: s(-20000, 2),
    commission: s(-15000),
    logistics: s(-8000),
    ads: s(-5000),
    cogs: s(-30000),
    tax: s(-3000),
  };
}

console.log('\n=== Сквозной пример ===');
{
  // netRevenue = 100000 - 20000 = 80000
  // profit = 80000 - 15000 - 8000 - 5000 - 30000 - 3000 = 19000
  // margin = 19000/80000 = 23.75 %; drr = 5000/80000 = 6.25 %; buyout = 8/10 = 80 %
  // roi = 19000/30000 = 63.333 %; fees = 23000/80000 = 28.75 %
  // avgCheck = 80000/8 = 10000; unitProfit = 19000/8 = 2375
  const m = computeMetrics(base());
  eq('netRevenue', m.netRevenue, { value: 80000, complete: true });
  eq('profit', m.profit, { value: 19000, complete: true });
  eq('marginPct', m.marginPct, { value: 23.75, complete: true });
  eq('drrPct', m.drrPct, { value: 6.25, complete: true });
  eq('buyoutPct', m.buyoutPct, { value: 80, complete: true });
  ok('roiPct ~ 63.3333', Math.abs((m.roiPct.value as number) - 63.333333) < 1e-4 && m.roiPct.complete);
  eq('feesPct', m.feesPct, { value: 28.75, complete: true });
  eq('avgCheck', m.avgCheck, { value: 10000, complete: true });
  eq('unitProfit', m.unitProfit, { value: 2375, complete: true });
}

console.log('\n=== Округление денег ===');
{
  const t = base();
  t.revenue = s(100001, 10);
  // netRevenue 80001 / 8 = 10000.125 -> 10000; profit 19001 / 8 = 2375.125 -> 2375
  eq('avgCheck округляется', computeMetrics(t).avgCheck.value, 10000);
  eq('unitProfit округляется', computeMetrics(t).unitProfit.value, 2375);
  t.returns = s(-20000, 3, 3); // 7 чистых: 80001/7 = 11428.714 -> 11429
  eq('avgCheck округляется вверх', computeMetrics(t).avgCheck.value, 11429);
}

console.log('\n=== Неизвестная себестоимость ===');
{
  const unk: LineTotals = { ...base(), cogs: s(null) };
  const m = computeMetrics(unk);
  eq('profit null/incomplete', m.profit, { value: null, complete: false });
  eq('marginPct null/incomplete', m.marginPct, { value: null, complete: false });
  eq('roiPct null/incomplete', m.roiPct, { value: null, complete: false });
  eq('unitProfit null/incomplete', m.unitProfit, { value: null, complete: false });
  eq('netRevenue не зависит от cogs', m.netRevenue, { value: 80000, complete: true });
  eq('drrPct не зависит от cogs', m.drrPct, { value: 6.25, complete: true });
  eq('buyoutPct не зависит от cogs', m.buyoutPct, { value: 80, complete: true });
  eq('feesPct не зависит от cogs', m.feesPct, { value: 28.75, complete: true });
  eq('avgCheck не зависит от cogs', m.avgCheck, { value: 10000, complete: true });

  const partial: LineTotals = { ...base(), cogs: s(-30000, 0, 0, 2) };
  eq('unknownCount>0 при известной сумме: profit null', profit(partial), { value: null, complete: false });
  eq('unknownCount>0: roi null', computeMetrics(partial).roiPct, { value: null, complete: false });
}

console.log('\n=== Неопределённость деления ===');
{
  const neg: LineTotals = { revenue: s(10000, 1), returns: s(-20000, 1), cogs: s(-1000) };
  const m = computeMetrics(neg);
  eq('netRevenue<=0: margin', m.marginPct, { value: null, complete: true });
  eq('netRevenue<=0: drr', m.drrPct, { value: null, complete: true });
  eq('netRevenue<=0: fees', m.feesPct, { value: null, complete: true });
  eq('netRevenue<=0: profit всё равно считается', m.profit, { value: -11000, complete: true });
  eq('netRevenue=0: margin null', computeMetrics({ revenue: s(0, 1), cogs: s(-1) }).marginPct, { value: null, complete: true });

  const noQty: LineTotals = { revenue: s(5000, 0), cogs: s(-1000) };
  const m2 = computeMetrics(noQty);
  eq('qty(revenue)=0: buyout', m2.buyoutPct, { value: null, complete: true });
  eq('qty(revenue)=0: avgCheck', m2.avgCheck, { value: null, complete: true });
  eq('qty(revenue)=0: unitProfit', m2.unitProfit, { value: null, complete: true });

  const allReturned: LineTotals = { revenue: s(10000, 2), returns: s(-10000, 2), cogs: s(-500) };
  eq('всё возвращено: avgCheck null', computeMetrics(allReturned).avgCheck, { value: null, complete: true });
  eq('всё возвращено: buyout 0', computeMetrics(allReturned).buyoutPct, { value: 0, complete: true });

  eq('cogs=0: roi null/complete', computeMetrics({ revenue: s(1000, 1) }).roiPct, { value: null, complete: true });
}

console.log('\n=== Пустой LineTotals ===');
{
  const m = computeMetrics({});
  eq('netRevenue 0', m.netRevenue, { value: 0, complete: true });
  eq('profit 0', m.profit, { value: 0, complete: true });
  eq('margin null', m.marginPct, { value: null, complete: true });
  eq('drr null', m.drrPct, { value: null, complete: true });
  eq('buyout null', m.buyoutPct, { value: null, complete: true });
  eq('roi null', m.roiPct, { value: null, complete: true });
  eq('fees null', m.feesPct, { value: null, complete: true });
  eq('avgCheck null', m.avgCheck, { value: null, complete: true });
  eq('unitProfit null', m.unitProfit, { value: null, complete: true });
}

console.log('\n=== Контрольные статьи и меры вне прибыли ===');
{
  const t = base();
  t.rlz_revenue = s(999999, 50);
  t.rlz_returns = s(-5555, 5);
  t.rlz_commission = s(-77777);
  t.rlz_topup = s(1234);
  t.ads_settled = s(-4000);
  t.ads_bonus = s(-1000);
  t.ordered = s(0, 40);
  t.views = s(0, 1000);
  t.cart_adds = s(0, 100);
  eq('profit не меняется', profit(t), { value: 19000, complete: true });
  eq('все метрики не меняются', computeMetrics(t), computeMetrics(base()));
}

console.log('\n=== mp_topup, opex, unclassified, compensation ===');
{
  const t = base();
  t.mp_topup = s(5000);
  eq('mp_topup входит в netRevenue', netRevenue(t), { value: 85000, complete: true });
  eq('mp_topup входит в profit', profit(t), { value: 24000, complete: true });
  t.opex = s(-1000);
  t.unclassified = s(-500);
  t.compensation = s(2000);
  eq('opex, unclassified, compensation входят в profit', profit(t), { value: 24500, complete: true });
  eq('feesPct не включает compensation/opex', computeMetrics(t).feesPct.value, (23000 * 100) / 85000);
  t.storage = s(-1000);
  t.penalties = s(-500);
  eq('все удержания в feesPct', computeMetrics(t).feesPct.value, (24500 * 100) / 85000);
}

console.log('\n=== baseQty отдельно от qty ===');
{
  const t: LineTotals = { revenue: s(100000, 10, 40), returns: s(-20000, 2, 8), cogs: s(-30000) };
  // чистых базовых 32; profit = 80000 - 30000 = 50000; 50000/32 = 1562.5 -> 1563
  eq('unitProfit по baseQty', computeMetrics(t).unitProfit, { value: 1563, complete: true });
  eq('avgCheck по qty', computeMetrics(t).avgCheck, { value: 10000, complete: true });
}

console.log(`\nИтого: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
