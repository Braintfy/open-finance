// PURPOSE: Smoke-тесты правила реплея ленты движений (src/lib/stock/replay-plan.ts).
// Арифметику пула проверяет scripts/test-stock-costing.ts; здесь проверяется
// РЕШЕНИЕ, какое значение подаётся в applyEvent для каждого движения:
//   1. сторно → обратная ПЕРЕСЧИТАННАЯ стоимость оригинала (а не снимок с диска);
//   2. приход → landed-сумма строки документа;
//   3. расход → считает пул;
//   4. парная нога (pair_move_id) → ровно то, что списала её расходная нога.
// Именно эти правила держат §4.8.8 (Σ оригинала + сторно == 0) и §4.5
// (Σ по документу перемещения == 0) при вводе документов задним числом —
// самый дорогой способ ошибиться молча.
//
// Раскладку документа на ноги и сквозные сценарии перемещения/приёмки/
// пересортицы проверяет соседний scripts/test-stock-doc-plan.ts.
// Запуск: pnpm tsx scripts/test-stock-replay.ts

import {
  replayLedger,
  replayLedgerMulti,
  sortLedgerRows,
  type LedgerMoveRow,
} from '../src/lib/stock/replay-plan';

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
  ok(label, Object.is(actual, expected), `получено ${String(actual)}, ожидалось ${String(expected)}`);
}

let autoSeq = 0;
function row(patch: Partial<LedgerMoveRow> & { qtyDelta: number }): LedgerMoveRow {
  autoSeq += 1;
  return {
    id: patch.id ?? `m${autoSeq}`,
    seq: patch.seq ?? autoSeq,
    docDate: patch.docDate ?? '2026-01-01',
    qtyDelta: patch.qtyDelta,
    valueDeltaKopecks: patch.valueDeltaKopecks ?? 0,
    unitValueKopecks: patch.unitValueKopecks ?? 0,
    uncoveredQty: patch.uncoveredQty ?? 0,
    deficitSettledKopecks: patch.deficitSettledKopecks ?? 0,
    kind: patch.kind ?? (patch.qtyDelta > 0 ? 'purchase' : 'writeoff'),
    reason: patch.reason ?? null,
    reversesMoveId: patch.reversesMoveId ?? null,
    pairMoveId: patch.pairMoveId ?? null,
    itemId: patch.itemId ?? null,
    lineValueKopecks: patch.lineValueKopecks ?? null,
    lineIsEstimated: patch.lineIsEstimated ?? null,
    docCostBasis: patch.docCostBasis ?? 'gross',
  };
}

function sumDelta(moves: Array<{ valueDeltaKopecks: number }>): number {
  return moves.reduce((s, m) => s + m.valueDeltaKopecks, 0);
}

// ===========================================================================
console.log('\n=== Правило 2: приход берёт landed-сумму СТРОКИ, а не снимок движения ===');
// ===========================================================================
{
  // Снимок на диске врёт (0) — реплей обязан взять сумму строки документа.
  const rows = [
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000, valueDeltaKopecks: 0 }),
  ];
  const res = replayLedger(rows);
  eq('value_delta из строки документа', res.moves[0].valueDeltaKopecks, 100_000);
  eq('unit_value = round(value/qty)', res.moves[0].unitValueKopecks, 10_000);
  eq('пул: штук', res.pool.qty, 10);
  eq('пул: стоимость', res.pool.valueKopecks, 100_000);
  ok('движение помечено как изменённое', res.moves[0].changed);
}

// ===========================================================================
console.log('\n=== Правило 3: расход считает пул (доля от ОСТАТОЧНОЙ стоимости) ===');
// ===========================================================================
{
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000 }),
    row({ id: 'out1', qtyDelta: -3 }),
  ];
  const res = replayLedger(rows);
  eq('списано 3/10 стоимости', res.moves[1].valueDeltaKopecks, -30_000);
  eq('пул после: штук', res.pool.qty, 7);
  eq('пул после: стоимость', res.pool.valueKopecks, 70_000);
  eq('средняя не поехала', res.pool.avgCostKopecks, 10_000);
}

{
  autoSeq = 0;
  // Нулевой дрейф: два прихода по нечётной цене, полное исчерпание пула.
  const rows = [
    row({ id: 'in1', qtyDelta: 3, lineValueKopecks: 10_000 }),
    row({ id: 'in2', qtyDelta: 3, lineValueKopecks: 20_001 }),
    row({ id: 'out1', qtyDelta: -1 }),
    row({ id: 'out2', qtyDelta: -5 }),
  ];
  const res = replayLedger(rows);
  eq('пул исчерпан по штукам', res.pool.qty, 0);
  eq('пул исчерпан по деньгам (нулевой дрейф)', res.pool.valueKopecks, 0);
  eq('Σ value_delta == 0', sumDelta(res.moves), 0);
}

// ===========================================================================
console.log('\n=== Правило 1: сторно гасит оригинал РОВНО (§4.8.8) ===');
// ===========================================================================
{
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000 }),
    // Сторно прихода: направление перевёрнуто, ссылка на оригинал.
    row({ id: 'rev1', qtyDelta: -10, reversesMoveId: 'in1' }),
  ];
  const res = replayLedger(rows);
  eq('сторно прихода = минус оригинал', res.moves[1].valueDeltaKopecks, -100_000);
  eq('Σ == 0', sumDelta(res.moves), 0);
  eq('пул пуст по штукам', res.pool.qty, 0);
  eq('пул пуст по деньгам', res.pool.valueKopecks, 0);
}

{
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000 }),
    row({ id: 'out1', qtyDelta: -4 }),
    // Сторно расхода: приход обратно на ту же сумму.
    row({ id: 'rev1', qtyDelta: 4, reversesMoveId: 'out1' }),
  ];
  const res = replayLedger(rows);
  eq('расход списал 40 000', res.moves[1].valueDeltaKopecks, -40_000);
  eq('сторно расхода вернуло ровно 40 000', res.moves[2].valueDeltaKopecks, 40_000);
  eq('пул вернулся к исходному', res.pool.valueKopecks, 100_000);
  eq('штуки вернулись', res.pool.qty, 10);
}

// ===========================================================================
console.log('\n=== Ключевой случай: документ ЗАДНИМ ЧИСЛОМ перед оригиналом ===');
// ===========================================================================
{
  // Сценарий из §4.7: расход провели, потом сторнировали, а ПОТОМ ввели
  // забытую поставку задним числом. Она меняет среднюю, значит и стоимость
  // расхода — сторно обязано пересчитаться вместе с ним, иначе Σ != 0.
  autoSeq = 0;
  const original = [
    row({ id: 'in1', docDate: '2026-03-10', seq: 1, qtyDelta: 10, lineValueKopecks: 100_000 }),
    row({ id: 'out1', docDate: '2026-03-20', seq: 2, qtyDelta: -4 }),
    row({ id: 'rev1', docDate: '2026-03-20', seq: 3, qtyDelta: 4, reversesMoveId: 'out1' }),
  ];
  const before = replayLedger(original);
  eq('до вставки: расход 40 000', before.moves[1].valueDeltaKopecks, -40_000);

  // Забытая поставка от 5 марта (seq больше — введена позже, но дата раньше).
  const withBackdated = [
    ...original,
    row({ id: 'in0', docDate: '2026-03-05', seq: 4, qtyDelta: 10, lineValueKopecks: 60_000 }),
  ];
  const after = replayLedger(withBackdated);
  const byId = new Map(after.moves.map((m) => [m.id, m]));

  eq('порядок: задним числом идёт первым', after.moves[0].id, 'in0');
  // Пул на момент расхода: 10 шт по 60 000 + 10 шт по 100 000 = 20 шт / 160 000.
  // Расход 4 шт = round(160000 * 4 / 20) = 32 000.
  eq('расход пересчитан по новой средней', byId.get('out1')?.valueDeltaKopecks, -32_000);
  eq(
    'сторно пересчиталось ВМЕСТЕ с оригиналом',
    byId.get('rev1')?.valueDeltaKopecks,
    32_000,
  );
  eq(
    'Σ оригинала + сторно == 0 (§4.8.8)',
    (byId.get('out1')?.valueDeltaKopecks ?? 0) + (byId.get('rev1')?.valueDeltaKopecks ?? 0),
    0,
  );
  eq('итоговая стоимость пула', after.pool.valueKopecks, 160_000);
  eq('итоговые штуки', after.pool.qty, 20);
  ok(
    'сторно помечено изменённым (снимок на диске устарел)',
    byId.get('rev1')?.changed === true,
  );
}

// ===========================================================================
console.log('\n=== Детерминизм и порядок ===');
// ===========================================================================
{
  autoSeq = 0;
  const rows = [
    row({ id: 'c', docDate: '2026-02-02', seq: 30, qtyDelta: -2 }),
    row({ id: 'a', docDate: '2026-01-01', seq: 20, qtyDelta: 5, lineValueKopecks: 50_000 }),
    row({ id: 'b', docDate: '2026-01-01', seq: 10, qtyDelta: 3, lineValueKopecks: 33_000 }),
  ];
  const sorted = sortLedgerRows(rows).map((r) => r.id);
  eq('сортировка (doc_date, seq)', sorted.join(','), 'b,a,c');

  const first = replayLedger(rows);
  const second = replayLedger([...rows].reverse());
  eq(
    'реплей не зависит от порядка входа',
    JSON.stringify(first.moves),
    JSON.stringify(second.moves),
  );
  eq(
    'повторный реплей даёт тот же пул (§4.8.7)',
    JSON.stringify(first.pool),
    JSON.stringify(second.pool),
  );
}

{
  // Идемпотентность: если значения уже верные, changed=false и UPDATE не нужен.
  autoSeq = 0;
  const rows = [row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000 })];
  const first = replayLedger(rows);
  const applied: LedgerMoveRow[] = rows.map((r) => ({
    ...r,
    valueDeltaKopecks: first.moves[0].valueDeltaKopecks,
    unitValueKopecks: first.moves[0].unitValueKopecks,
    uncoveredQty: first.moves[0].uncoveredQty,
    deficitSettledKopecks: first.moves[0].deficitSettledKopecks,
  }));
  const second = replayLedger(applied);
  ok('второй прогон не помечает движение изменённым', second.moves[0].changed === false);
}

// ===========================================================================
console.log('\n=== Карантин: расход без покрытия не даёт «COGS = 0» молча (§1.10) ===');
// ===========================================================================
{
  autoSeq = 0;
  const rows = [row({ id: 'out1', qtyDelta: -5 })];
  const res = replayLedger(rows);
  eq('непокрытых штук', res.moves[0].uncoveredQty, 5);
  eq('пул ушёл в минус по штукам', res.pool.qty, -5);
  eq('пул НЕ ушёл в минус по деньгам', res.pool.valueKopecks, 0);
  ok(
    'есть предупреждение uncovered_qty',
    res.warnings.some((w) => w.code === 'uncovered_qty'),
  );
}

{
  // Приход, закрывающий отрицательный пул: часть суммы — ретро-COGS, не остаток.
  autoSeq = 0;
  const rows = [
    row({ id: 'out1', qtyDelta: -4 }),
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000 }),
  ];
  const res = replayLedger(rows);
  eq('дефицит закрыт на 4/10 суммы', res.moves[1].deficitSettledKopecks, 40_000);
  eq('в пул легло только 60 000', res.moves[1].valueDeltaKopecks, 60_000);
  eq('штук в пуле', res.pool.qty, 6);
  eq('стоимость пула', res.pool.valueKopecks, 60_000);
  ok(
    'есть предупреждение deficit_settled',
    res.warnings.some((w) => w.code === 'deficit_settled'),
  );
}

// ===========================================================================
console.log('\n=== Мусорный ввод не роняет пересчёт всего товара ===');
// ===========================================================================
{
  autoSeq = 0;
  const rows = [
    row({ id: 'zero', qtyDelta: 0, lineValueKopecks: 999 }),
    row({ id: 'in1', qtyDelta: 2, lineValueKopecks: 20_000 }),
  ];
  const res = replayLedger(rows);
  eq('движение с qty=0 пропущено', res.moves.length, 1);
  eq('остальные посчитаны', res.pool.valueKopecks, 20_000);
}

{
  // Сторно, чей оригинал не попал в выборку: fallback на снимок движения.
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000 }),
    row({ id: 'orphan', qtyDelta: -2, reversesMoveId: 'missing', valueDeltaKopecks: -15_000 }),
  ];
  const res = replayLedger(rows);
  eq('использован снимок оригинала', res.moves[1].valueDeltaKopecks, -15_000);
}

// ===========================================================================
console.log('\n=== Правило 4: парная нога забирает РОВНО списанное (§4.5) ===');
// ===========================================================================
{
  // Перемещение внутри одного товара: расход по средней, приход — на ту же
  // сумму. Пул не должен заметить, что товар сменил место.
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000 }),
    row({ id: 'out1', qtyDelta: -4, kind: 'transfer' }),
    row({ id: 'in2', qtyDelta: 4, kind: 'transfer', pairMoveId: 'out1' }),
  ];
  const res = replayLedger(rows);
  eq('расходная нога списала 40 000', res.moves[1].valueDeltaKopecks, -40_000);
  eq('приходная нога взяла ровно её', res.moves[2].valueDeltaKopecks, 40_000);
  eq('Σ по документу == 0', sumDelta(res.moves.slice(1)), 0);
  eq('пул по деньгам не изменился', res.pool.valueKopecks, 100_000);
  eq('пул по штукам не изменился', res.pool.qty, 10);
}

{
  // Парная нога НЕ обновляет «цену последней закупки»: перемещение — не закупка.
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000, kind: 'purchase' }),
    row({ id: 'out1', qtyDelta: -10, kind: 'transfer' }),
    row({ id: 'in2', qtyDelta: 10, kind: 'transfer', pairMoveId: 'out1' }),
  ];
  const res = replayLedger(rows);
  eq('цена последней закупки прежняя', res.pool.lastCostKopecks, 10_000);
  eq('Σ == 0 при переносе всего пула', sumDelta(res.moves.slice(1)), 0);
}

{
  // Парная нога поверх lineValueKopecks: если строка документа что-то несёт,
  // побеждает ПАРА — иначе стоимость взялась бы из двух источников сразу.
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 6, lineValueKopecks: 60_000 }),
    row({ id: 'out1', qtyDelta: -2, kind: 'regrade' }),
    row({
      id: 'in2',
      qtyDelta: 2,
      kind: 'regrade',
      pairMoveId: 'out1',
      lineValueKopecks: 999_999,
    }),
  ];
  const res = replayLedger(rows);
  eq('строка документа проигнорирована', res.moves[2].valueDeltaKopecks, 20_000);
}

{
  // Мультитоварный проход: пересортица A → B. Донор в ленте ДРУГОГО товара.
  autoSeq = 0;
  const rows = [
    row({ id: 'inA', itemId: 'A', qtyDelta: 10, lineValueKopecks: 100_000, seq: 1 }),
    row({ id: 'outA', itemId: 'A', qtyDelta: -4, kind: 'regrade', seq: 2 }),
    row({ id: 'inB', itemId: 'B', qtyDelta: 4, kind: 'regrade', pairMoveId: 'outA', seq: 3 }),
  ];
  const res = replayLedgerMulti(rows);
  eq('A отдал 40 000', res.moves[1].valueDeltaKopecks, -40_000);
  eq('B получил 40 000', res.moves[2].valueDeltaKopecks, 40_000);
  eq('пул A', res.pools.get('A')?.valueKopecks, 60_000);
  eq('пул B', res.pools.get('B')?.valueKopecks, 40_000);
  eq('Σ по документу == 0', sumDelta(res.moves.slice(1)), 0);
}

{
  // Сторно документа с парными ногами: обе ноги гасятся своими сторно,
  // и общий итог остаётся нулевым (§4.8.8 + §4.5 вместе).
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 10, lineValueKopecks: 100_000, seq: 1 }),
    row({ id: 'out1', qtyDelta: -4, kind: 'transfer', seq: 2 }),
    row({ id: 'in2', qtyDelta: 4, kind: 'transfer', pairMoveId: 'out1', seq: 3 }),
    row({ id: 'rev-out', qtyDelta: 4, kind: 'transfer', reversesMoveId: 'out1', seq: 4 }),
    row({ id: 'rev-in', qtyDelta: -4, kind: 'transfer', reversesMoveId: 'in2', seq: 5 }),
  ];
  const res = replayLedger(rows);
  const byId = new Map(res.moves.map((m) => [m.id, m]));
  eq('сторно расходной ноги', byId.get('rev-out')?.valueDeltaKopecks, 40_000);
  eq('сторно приходной ноги', byId.get('rev-in')?.valueDeltaKopecks, -40_000);
  eq('Σ всех четырёх ног == 0', sumDelta(res.moves.slice(1)), 0);
  eq('пул вернулся к поставке', res.pool.valueKopecks, 100_000);
  eq('штуки на месте', res.pool.qty, 10);
}

// ===========================================================================
console.log('\n=== Базис НДС документа доходит до пула (§12.2) ===');
// ===========================================================================
{
  autoSeq = 0;
  const rows = [
    row({ id: 'in1', qtyDelta: 5, lineValueKopecks: 50_000, docCostBasis: 'gross' }),
    row({ id: 'in2', qtyDelta: 5, lineValueKopecks: 40_000, docCostBasis: 'net' }),
  ];
  const res = replayLedger(rows);
  eq('пул помечен смешанным', res.pool.basis, 'mixed');
  ok('флаг basisMixed выставлен', res.pool.basisMixed === true);
  ok(
    'есть предупреждение mixed_cost_basis',
    res.warnings.some((w) => w.code === 'mixed_cost_basis'),
  );
}

console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
