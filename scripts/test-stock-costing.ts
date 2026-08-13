// PURPOSE: Smoke-тесты чистого ядра себестоимости склада (src/lib/stock/costing.ts).
// Покрывают 9 инвариантов docs/STOCK_MODULE_DESIGN.md §4.8 плюс четыре
// требования сверх дизайна: реплей == кэш, нулевой дрейф при исчерпании пула,
// сторно возвращает ровно исходные суммы, смешение базисов НДС не молчит.
// Запуск: pnpm tsx scripts/test-stock-costing.ts

import {
  allocateExtraCost,
  allocateLots,
  applyEvent,
  buildReversalEvents,
  computeDocTotals,
  computeLineValues,
  costAtDate,
  createPool,
  divRound,
  filterNewDocs,
  importKey,
  mulDivRound,
  poolToCache,
  replay,
  sortEvents,
  type CostBasis,
  type CostedMove,
  type CostingDocKind,
  type CostingEvent,
  type CostingReason,
  type ExtraAllocMethod,
  type LotPolicy,
  type PoolState,
} from '../src/lib/stock/costing';

// Компилятор проверяет, что локальные юнионы ядра совпадают с типами схемы.
// Импорты только типовые — Drizzle в рантайме не грузится.
import type {
  StockCostBasis,
  StockPoolBasis,
} from '../src/lib/db/schema/stock';
import type {
  StockDocKind,
  StockDocReason,
  StockExtraAlloc,
  StockLotPolicy,
} from '../src/lib/db/schema/stock-ledger';

const _kindParity: StockDocKind = 'purchase' satisfies CostingDocKind;
const _reasonParity: StockDocReason = 'mp_shortage' satisfies CostingReason;
const _basisParity: StockCostBasis = 'gross' satisfies CostBasis;
const _poolBasisParity: StockPoolBasis = 'mixed';
const _allocParity: StockExtraAlloc = 'by_value' satisfies ExtraAllocMethod;
const _lotParity: StockLotPolicy = 'fefo' satisfies LotPolicy;
void [_kindParity, _reasonParity, _basisParity, _poolBasisParity, _allocParity, _lotParity];

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
    kind: partial.kind ?? (partial.direction === 'in' ? 'purchase' : 'writeoff'),
    reason: partial.reason ?? null,
    valueKopecks: partial.valueKopecks,
    costBasis: partial.costBasis,
    isEstimated: partial.isEstimated,
    isReversal: partial.isReversal,
    itemId: partial.itemId,
  };
}

/** Независимый пересчёт «кэша» stock_items прямо из ленты движений. */
function cacheFromMoves(moves: readonly CostedMove[]) {
  let qty = 0;
  let value = 0;
  for (const m of moves) {
    qty += m.qtyDelta;
    value += m.valueDeltaKopecks;
  }
  return { qty, value };
}

// ===========================================================================
console.log('\n=== Целочисленная арифметика (детерминизм копеек) ===');
// ===========================================================================
eq('mulDivRound(1000, 1, 3) = 333', mulDivRound(1000, 1, 3), 333);
eq('mulDivRound(667, 1, 2) = 334 (половина округляется ОТ нуля)', mulDivRound(667, 1, 2), 334);
eq('divRound(-667, 2) = -334', divRound(-667, 2), -334);
eq('деление на ноль не взрывается', mulDivRound(100, 5, 0), 0);
ok(
  'BigInt-путь: копейки × штуки за пределами 2^53 не теряют точность',
  mulDivRound(9_007_199_254_740_991, 4, 2) === 18014398509481982,
);

// ===========================================================================
console.log('\n=== Инвариант 1 + «реплей == кэш»: Σ движений == пул ===');
// ===========================================================================
{
  seqCounter = 0;
  const events: CostingEvent[] = [
    ev({ direction: 'in', qty: 10, valueKopecks: 100_000, kind: 'purchase' }),
    ev({ direction: 'in', qty: 5, valueKopecks: 60_000, kind: 'purchase' }),
    ev({ direction: 'out', qty: 4, kind: 'accept' }),
    ev({ direction: 'out', qty: 2, kind: 'writeoff', reason: 'expired' }),
    ev({ direction: 'in', qty: 3, valueKopecks: 39_000, kind: 'purchase' }),
  ];
  const r = replay(events);
  const cache = cacheFromMoves(r.moves);

  eq('Σ qty_delta == qty_pool', cache.qty, r.pool.qty);
  eq('Σ value_delta == value_pool_kopecks', cache.value, r.pool.valueKopecks);
  eq('poolToCache отдаёт то же, что лента', poolToCache(r.pool).valuePoolKopecks, cache.value);
  eq('avg == round(V / Q)', r.pool.avgCostKopecks, divRound(r.pool.valueKopecks, r.pool.qty));
  eq(
    'lastCost — цена последней ЗАКУПКИ, а не средняя',
    r.pool.lastCostKopecks,
    divRound(39_000, 3),
  );
  ok('приходы/расходы разошлись по totals', r.totals.inQty === 18 && r.totals.outQty === 6);
}

// ===========================================================================
console.log('\n=== Инвариант 2 + нулевой дрейф при полном исчерпании пула ===');
// ===========================================================================
{
  seqCounter = 0;
  // 1000 коп на 3 штуки = 333.33… — самый злой случай для округления.
  const events: CostingEvent[] = [
    ev({ direction: 'in', qty: 3, valueKopecks: 1000, kind: 'purchase' }),
    ev({ direction: 'out', qty: 1, kind: 'accept' }),
    ev({ direction: 'out', qty: 1, kind: 'accept' }),
    ev({ direction: 'out', qty: 1, kind: 'accept' }),
  ];
  const r = replay(events);
  const outs = r.moves.filter((m) => m.direction === 'out').map((m) => m.valueDeltaKopecks);

  eq('доли от остаточной стоимости, а не qty × unit_cost', outs, [-333, -334, -333]);
  eq('пул опустел по штукам', r.pool.qty, 0);
  eq('ИНВАРИАНТ 2: qty_pool == 0 ⇒ value_pool == 0 (нулевой дрейф)', r.pool.valueKopecks, 0);
  eq('Σ списаний == сумме прихода до копейки', -outs.reduce((s, v) => s + v, 0), 1000);
  eq('средняя «липкая» после исчерпания', r.pool.avgCostKopecks, 333);

  // Контроль: наивное qty × avg дало бы дрейф.
  const naive = 3 * 333;
  ok('наивный qty × unit_cost потерял бы копейку (1000 != 999)', naive !== 1000);
}

// ===========================================================================
console.log('\n=== Инвариант 3: суммы документа и разнесение доп. расходов ===');
// ===========================================================================
{
  const doc = computeDocTotals(
    { priceIncludesVat: true, costBasis: 'gross', extraCostKopecks: 100, extraAlloc: 'by_value' },
    [
      { lineNo: 1, qty: 1, unitPriceKopecks: 1000, vatRateBp: 500 },
      { lineNo: 2, qty: 1, unitPriceKopecks: 1000, vatRateBp: 500 },
      { lineNo: 3, qty: 1, unitPriceKopecks: 1000, vatRateBp: 500 },
    ],
  );
  const allocSum = doc.lines.reduce((s, l) => s + l.extraAllocKopecks, 0);
  const lineSum = doc.lines.reduce((s, l) => s + l.valueKopecks, 0);

  eq('Σ extra_alloc == extra_cost РОВНО (метод наибольших остатков)', allocSum, 100);
  eq('остаток достаётся первой строке детерминированно', doc.lines.map((l) => l.extraAllocKopecks), [34, 33, 33]);
  eq('Σ lines.value_kopecks == docs.total_kopecks', lineSum, doc.totalKopecks);
  eq('НДС 5 % «в цене»: 1000 коп → 48 коп НДС', doc.lines[0].vatKopecks, 48);
  eq('vat_total_kopecks == Σ строк', doc.vatTotalKopecks, doc.lines.reduce((s, l) => s + l.vatKopecks, 0));
}
{
  const byQty = allocateExtraCost(
    1000,
    [
      { qty: 1, baseValueKopecks: 100 },
      { qty: 2, baseValueKopecks: 100 },
      { qty: 4, baseValueKopecks: 100 },
    ],
    'by_qty',
  );
  eq('by_qty разносит пропорционально штукам', byQty, [143, 286, 571]);
  eq('by_qty: сумма сходится ровно', byQty.reduce((s, v) => s + v, 0), 1000);

  eq(
    "extra_alloc='none' не разносит ничего",
    allocateExtraCost(1000, [{ qty: 1, baseValueKopecks: 100 }], 'none'),
    [0],
  );
  eq(
    'нулевая база делится поровну, а не теряется',
    allocateExtraCost(10, [
      { qty: 0, baseValueKopecks: 0 },
      { qty: 0, baseValueKopecks: 0 },
      { qty: 0, baseValueKopecks: 0 },
    ]),
    [4, 3, 3],
  );
  eq(
    'отрицательный extra (скидка) тоже сходится ровно',
    allocateExtraCost(-100, [
      { qty: 1, baseValueKopecks: 100 },
      { qty: 1, baseValueKopecks: 100 },
      { qty: 1, baseValueKopecks: 100 },
    ]).reduce((s, v) => s + v, 0),
    -100,
  );
  const mixedDirs = allocateExtraCost(
    90,
    [
      { qty: 1, baseValueKopecks: 100, direction: 'out' },
      { qty: 1, baseValueKopecks: 100, direction: 'in' },
      { qty: 1, baseValueKopecks: 200, direction: 'in' },
    ],
    'by_value',
  );
  eq('доп. расходы садятся только на приходные строки', mixedDirs, [0, 30, 60]);
}

// ===========================================================================
console.log('\n=== Инвариант 4: партии несут штуки (Σ qty_left == qty_pool) ===');
// ===========================================================================
{
  const batches = [
    { id: 'b-late', receivedAt: '2026-01-01', expiresAt: '2027-01-01', qtyLeft: 5 },
    { id: 'b-soon', receivedAt: '2026-02-01', expiresAt: '2026-06-01', qtyLeft: 4 },
    { id: 'b-none', receivedAt: '2026-03-01', expiresAt: null, qtyLeft: 3 },
  ];
  const fefo = allocateLots(batches, 6, 'fefo');
  eq('FEFO берёт сначала истекающую партию', fefo.alloc, [
    { batchId: 'b-soon', qty: 4 },
    { batchId: 'b-late', qty: 2 },
  ]);
  eq('FEFO ничего не теряет', fefo.alloc.reduce((s, a) => s + a.qty, 0) + fefo.shortfall, 6);

  const fifo = allocateLots(batches, 6, 'fifo');
  eq('FIFO берёт по дате прихода', fifo.alloc, [
    { batchId: 'b-late', qty: 5 },
    { batchId: 'b-soon', qty: 1 },
  ]);

  const poolQty = batches.reduce((s, b) => s + b.qtyLeft, 0);
  const left = poolQty - fefo.alloc.reduce((s, a) => s + a.qty, 0);
  eq('Σ qty_left после списания == остатку пула', left, poolQty - 6);

  const drained = allocateLots([{ id: 'b1', receivedAt: '2026-01-01', qtyLeft: 2 }], 2);
  eq('закрытая партия отдаёт ровно свой остаток', drained.alloc, [{ batchId: 'b1', qty: 2 }]);
  eq('закрытая партия ⇒ qty_left = 0', 2 - drained.alloc[0].qty, 0);

  const short = allocateLots([{ id: 'b1', receivedAt: '2026-01-01', qtyLeft: 2 }], 5);
  eq('нехватка партий видна явно, а не молча', short.shortfall, 3);
  eq('партии без срока уходят в конец FEFO', allocateLots(batches, 13, 'fefo').alloc.at(-1)?.batchId, 'b-none');
}

// ===========================================================================
console.log('\n=== Инвариант 5: возврат восстанавливает РОВНО списанную сумму ===');
// ===========================================================================
{
  seqCounter = 0;
  const inbound = ev({ direction: 'in', qty: 10, valueKopecks: 100_003, kind: 'purchase' });
  const pool0 = applyEvent(createPool(), inbound).pool;

  const outApplied = applyEvent(pool0, ev({ direction: 'out', qty: 3, kind: 'accept' }));
  const written = -outApplied.move.valueDeltaKopecks;
  eq('списано долей от остатка', written, mulDivRound(100_003, 3, 10));

  // return_in ссылается на исходное движение и приходует ровно его стоимость.
  const back = applyEvent(
    outApplied.pool,
    ev({ direction: 'in', qty: 3, valueKopecks: written, kind: 'return_in' }),
  );
  eq('после возврата qty вернулось', back.pool.qty, pool0.qty);
  eq('после возврата value вернулось ДО КОПЕЙКИ', back.pool.valueKopecks, pool0.valueKopecks);
  eq('средняя не поехала', back.pool.avgCostKopecks, pool0.avgCostKopecks);
  ok(
    'return_in не считается закупкой (lastCost не переписан)',
    back.pool.lastCostKopecks === pool0.lastCostKopecks,
  );
}

// ===========================================================================
console.log('\n=== Инвариант 6: пересортица не создаёт и не съедает прибыль ===');
// ===========================================================================
{
  seqCounter = 0;
  const poolA = applyEvent(
    createPool(),
    ev({ direction: 'in', qty: 10, valueKopecks: 100_000, itemId: 'A' }),
  ).pool;

  const outA = applyEvent(
    poolA,
    ev({ direction: 'out', qty: 3, kind: 'regrade', itemId: 'A' }),
  );
  const inB = applyEvent(
    createPool(),
    ev({
      direction: 'in',
      qty: 3,
      // ровно то, что списано с A
      valueKopecks: -outA.move.valueDeltaKopecks,
      kind: 'regrade',
      itemId: 'B',
    }),
  );

  const docSum = outA.move.valueDeltaKopecks + inB.move.valueDeltaKopecks;
  eq('Σ value_delta по документу regrade == 0', docSum, 0);
  eq('товар B получил стоимость товара A', inB.pool.valueKopecks, 30_000);
  eq('обе ноги — один документ, штуки сохранились', outA.move.qtyDelta + inB.move.qtyDelta, 0);
}

// ===========================================================================
console.log('\n=== Инвариант 7: реплей детерминирован (в т.ч. ввод задним числом) ===');
// ===========================================================================
{
  seqCounter = 0;
  const events: CostingEvent[] = [
    ev({ direction: 'in', qty: 7, valueKopecks: 70_007, docDate: '2026-03-10' }),
    ev({ direction: 'out', qty: 2, docDate: '2026-03-12', kind: 'accept' }),
    // документ введён позже (больший seq), но датирован раньше — сортировка
    // по (doc_date, seq) обязана поставить его первым.
    ev({ direction: 'in', qty: 4, valueKopecks: 41_111, docDate: '2026-03-01' }),
    ev({ direction: 'out', qty: 3, docDate: '2026-03-20', kind: 'writeoff', reason: 'damaged' }),
  ];

  const first = replay(events);
  const second = replay(events);
  eq('повторный реплей побайтово идентичен', JSON.stringify(second.moves), JSON.stringify(first.moves));

  const shuffled = [events[3], events[0], events[2], events[1]];
  const third = replay(shuffled);
  eq('порядок входного массива не влияет', JSON.stringify(third.moves), JSON.stringify(first.moves));
  eq(
    'сортировка ставит документ задним числом первым',
    sortEvents(events).map((e) => e.docDate),
    ['2026-03-01', '2026-03-10', '2026-03-12', '2026-03-20'],
  );

  const at = costAtDate(events, '2026-03-11');
  ok('costAtDate считает среднюю на дату', at !== null && at.qty === 11);
  eq('costAtDate до первой поставки — «неизвестно», а не ноль', costAtDate(events, '2025-12-31'), null);
}

// ===========================================================================
console.log('\n=== Инвариант 8: сторно возвращает ровно исходные суммы ===');
// ===========================================================================
{
  seqCounter = 0;
  const before = applyEvent(
    createPool(),
    ev({ direction: 'in', qty: 20, valueKopecks: 200_000, kind: 'purchase' }),
  ).pool;

  // Документ поставки: две строки прихода + расход внутри того же дня.
  const docEvents: CostingEvent[] = [
    ev({ direction: 'in', qty: 5, valueKopecks: 55_555, kind: 'purchase', docDate: '2026-04-01' }),
    ev({ direction: 'out', qty: 4, kind: 'writeoff', reason: 'damaged', docDate: '2026-04-01' }),
  ];
  const posted = replay(docEvents, before);
  const reversal = buildReversalEvents(posted.moves, { docDate: '2026-04-05', startSeq: 900 });
  const after = replay(reversal, posted.pool);

  const originalSum = posted.moves.reduce((s, m) => s + m.valueDeltaKopecks, 0);
  const reversalSum = after.moves.reduce((s, m) => s + m.valueDeltaKopecks, 0);
  eq('Σ value_delta оригинала + сторно == 0', originalSum + reversalSum, 0);
  eq('штуки вернулись к исходным', after.pool.qty, before.qty);
  eq('стоимость вернулась к исходной ДО КОПЕЙКИ', after.pool.valueKopecks, before.valueKopecks);
  eq('средняя вернулась', after.pool.avgCostKopecks, before.avgCostKopecks);
  ok(
    'сторно применяется дословно, без пересчёта по средней',
    after.moves.every((m) => m.uncoveredQty === 0 && m.deficitSettledKopecks === 0),
  );
}

// ===========================================================================
console.log('\n=== Инвариант 9: идемпотентность импорта по (source, source_ref) ===');
// ===========================================================================
{
  const batch = [
    { source: 'site:shopb', sourceRef: 'order:42' },
    { source: 'site:shopb', sourceRef: 'order:43' },
    { source: 'import', sourceRef: null },
  ];
  const firstPull = filterNewDocs([], batch);
  eq('первый импорт берёт всё', firstPull.fresh.length, 3);

  const keys = firstPull.fresh.map(importKey).filter((k): k is string => k !== null);
  const secondPull = filterNewDocs(keys, batch);
  eq('повторный pull не создаёт дублей', secondPull.fresh.map(importKey).filter(Boolean).length, 0);
  eq('пропущенные видны явно', secondPull.skipped.length, 2);

  const withDupes = filterNewDocs([], [batch[0], batch[0], batch[1]]);
  eq('дубли внутри одной пачки тоже отсекаются', withDupes.fresh.length, 2);
  eq(
    'ключ совпадает с частичным уникальным индексом (source, source_ref)',
    importKey(batch[0]),
    '["site:shopb","order:42"]',
  );
  ok(
    'склейка не даёт коллизий между разными парами (source, ref)',
    importKey({ source: 'a:b', sourceRef: 'c' }) !== importKey({ source: 'a', sourceRef: 'b:c' }),
  );
  eq('без source_ref идемпотентности нет (ключ null)', importKey(batch[2]), null);
}

// ===========================================================================
console.log('\n=== §12.2 ДВА базиса НДС: смешение партий не молчит ===');
// ===========================================================================
{
  seqCounter = 0;
  // Один и тот же товар: 1100 коп с НДС 10 % — в gross ляжет 1100, в net 1000.
  const grossLine = computeLineValues(
    { lineNo: 1, qty: 10, unitPriceKopecks: 1100, vatRateBp: 1000 },
    { priceIncludesVat: true, costBasis: 'gross' },
  );
  const netLine = computeLineValues(
    { lineNo: 1, qty: 10, unitPriceKopecks: 1100, vatRateBp: 1000 },
    { priceIncludesVat: true, costBasis: 'net' },
  );
  eq('gross: в себестоимость идёт сумма с НДС', grossLine.baseValueKopecks, 11_000);
  eq('net: в себестоимость идёт сумма без НДС', netLine.baseValueKopecks, 10_000);
  eq('НДС выделен одинаково в обоих базисах', grossLine.vatKopecks, netLine.vatKopecks);

  const exclusive = computeLineValues(
    { lineNo: 1, qty: 10, unitPriceKopecks: 1000, vatRateBp: 1000 },
    { priceIncludesVat: false, costBasis: 'gross' },
  );
  eq('цена без НДС: НДС начисляется сверху', exclusive.grossKopecks, 11_000);
  eq('цена без НДС: netto == введённой сумме', exclusive.netKopecks, 10_000);

  // Переключение режима действует ТОЛЬКО ВПЕРЁД: старые приходы сохраняют базис.
  const events: CostingEvent[] = [
    ev({ direction: 'in', qty: 10, valueKopecks: 11_000, costBasis: 'gross' }),
    ev({ direction: 'in', qty: 10, valueKopecks: 10_000, costBasis: 'net' }),
  ];
  const mixed = replay(events);
  eq('пул помечен как смешанный', mixed.pool.basis, 'mixed');
  ok('флаг cost_basis_mixed поднят', poolToCache(mixed.pool).costBasisMixed);
  ok(
    'смешение не молчит: есть warning mixed_cost_basis',
    mixed.warnings.some((w) => w.code === 'mixed_cost_basis'),
  );
  eq('но суммы всё равно сошлись', mixed.pool.valueKopecks, 21_000);

  const sameBasis = replay([
    ev({ direction: 'in', qty: 10, valueKopecks: 11_000, costBasis: 'gross' }),
    ev({ direction: 'in', qty: 10, valueKopecks: 12_000, costBasis: 'gross' }),
  ]);
  eq('однородный пул остаётся gross', sameBasis.pool.basis, 'gross');
  ok('и без предупреждений', !sameBasis.warnings.some((w) => w.code === 'mixed_cost_basis'));

  // После полного исчерпания пул принимает базис нового прихода.
  const drained = replay([
    ev({ direction: 'in', qty: 5, valueKopecks: 5000, costBasis: 'gross' }),
    ev({ direction: 'out', qty: 5, kind: 'accept' }),
    ev({ direction: 'in', qty: 5, valueKopecks: 4000, costBasis: 'net' }),
  ]);
  eq('исчерпанный пул перенимает базис нового поступления', drained.pool.basis, 'net');
  ok('смешения нет — партии не пересеклись', !drained.pool.basisMixed);
}

// ===========================================================================
console.log('\n=== §1.8 потери ≠ COGS и §1.10 молчаливого нуля не бывает ===');
// ===========================================================================
{
  seqCounter = 0;
  const r = replay([
    ev({ direction: 'in', qty: 10, valueKopecks: 100_000, kind: 'purchase' }),
    ev({ direction: 'out', qty: 2, kind: 'writeoff', reason: 'expired' }),
    ev({ direction: 'out', qty: 3, kind: 'writeoff', reason: 'mp_shortage' }),
    ev({ direction: 'out', qty: 1, kind: 'accept' }),
  ]);
  eq('потери посчитаны отдельной статьёй', r.totals.lossValueKopecks, 50_000);
  ok('потери не равны всему расходу', r.totals.outValueKopecks > r.totals.lossValueKopecks);
  eq(
    'недостача маркетплейса видна суммой',
    r.moves.find((m) => m.reason === 'mp_shortage')?.valueDeltaKopecks,
    -30_000,
  );
}
{
  seqCounter = 0;
  const empty = replay([ev({ direction: 'out', qty: 5, kind: 'accept' })]);
  eq('расход при пустом пуле не трогает стоимость', empty.pool.valueKopecks, 0);
  eq('штуки ушли в минус (allow_negative)', empty.pool.qty, -5);
  eq('непокрытые штуки записаны в движение', empty.moves[0].uncoveredQty, 5);
  ok(
    'карантин, а не «COGS = 0»: есть warning uncovered_qty',
    empty.warnings.some((w) => w.code === 'uncovered_qty'),
  );
  ok('отрицательный остаток подсвечен', empty.warnings.some((w) => w.code === 'negative_pool'));

  // Забытая поставка введена позже: закрывает долг, но НЕ становится остатком.
  const settled = applyEvent(
    empty.pool,
    ev({ direction: 'in', qty: 5, valueKopecks: 60_000, kind: 'purchase' }),
  );
  eq('долг закрыт, штук снова ноль', settled.pool.qty, 0);
  eq('ИНВАРИАНТ 2 держится и после отрицательного пула', settled.pool.valueKopecks, 0);
  eq('стоимость ушла в ретро-COGS отдельным полем', settled.move.deficitSettledKopecks, 60_000);
  eq('в value_delta ретро-COGS не попал', settled.move.valueDeltaKopecks, 0);
  ok(
    'закрытие дефицита не молчит',
    settled.move.warnings.some((w) => w.code === 'deficit_settled'),
  );

  const partial = applyEvent(
    empty.pool,
    ev({ direction: 'in', qty: 8, valueKopecks: 96_000, kind: 'purchase' }),
  );
  eq('частичное покрытие: остаток пула = только «лишние» штуки', partial.pool.qty, 3);
  eq('и только их стоимость', partial.pool.valueKopecks, 36_000);
  eq('Σ value_delta по-прежнему == V', partial.pool.valueKopecks, partial.move.valueDeltaKopecks);
}

// ===========================================================================
console.log('\n=== Оценочная цена и «липкая» средняя ===');
// ===========================================================================
{
  seqCounter = 0;
  const est = replay([
    ev({ direction: 'in', qty: 4, valueKopecks: 40_000, kind: 'opening', isEstimated: true }),
  ]);
  ok(
    'документ opening с оценочной ценой помечен',
    est.warnings.some((w) => w.code === 'estimated_value'),
  );
  eq('opening обновляет «цену последней закупки»', est.pool.lastCostKopecks, 10_000);

  const sticky: PoolState = createPool({ qty: 0, valueKopecks: 0, avgCostKopecks: 777 });
  const afterIn = applyEvent(sticky, ev({ direction: 'in', qty: 0 + 1, valueKopecks: 900 }));
  eq('приход в пустой пул пересчитывает среднюю', afterIn.pool.avgCostKopecks, 900);
  const stuck = applyEvent(sticky, ev({ direction: 'out', qty: 1, kind: 'accept' }));
  eq('расход из пустого пула сохраняет липкую среднюю', stuck.pool.avgCostKopecks, 777);
  eq('и оценивает непокрытую штуку по ней (для отчёта)', stuck.move.unitValueKopecks, 777);
}

// ===========================================================================
console.log('\n=== Защита от мусорного ввода ===');
// ===========================================================================
{
  let threw = false;
  try {
    applyEvent(createPool(), ev({ direction: 'in', qty: 0, valueKopecks: 100 }));
  } catch {
    threw = true;
  }
  ok('qty = 0 отвергается', threw);

  threw = false;
  try {
    applyEvent(createPool(), ev({ direction: 'in', qty: 1, valueKopecks: 10.5 }));
  } catch {
    threw = true;
  }
  ok('дробные копейки отвергаются', threw);

  threw = false;
  try {
    applyEvent(createPool(), ev({ direction: 'out', qty: -3, kind: 'accept' }));
  } catch {
    threw = true;
  }
  ok('отрицательное qty в строке отвергается (знак задаёт direction)', threw);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
