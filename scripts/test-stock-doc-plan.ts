// PURPOSE: Smoke-тесты ПАРНЫХ НОГ склада (Релиз 2) — раскладка документа на
// движения (src/lib/stock/doc-plan.ts) и перенос стоимости между ними
// (правило 4 в src/lib/stock/replay-plan.ts).
//
// Что здесь доказывается (docs/STOCK_MODULE_DESIGN.md §1, §4.5, §5):
//   1. перемещение между ledger-местами НЕ меняет стоимость пула:
//      Σ value_delta по документу == 0 ровно, до копейки;
//   2. отгрузка на склад маркетплейса (external) — ОДНА расходная нога:
//      положительной строки на стороне Ozon не бывает никогда (§3);
//   3. приёмка с недостачей относит разницу в ПОТЕРИ (reason='mp_shortage'),
//      а не в себестоимость проданного (§1.8);
//   4. пересортица сходится в ноль между РАЗНЫМИ товарами;
//   5. цепочка own → transit → приёмка сохраняет стоимость на каждом шаге,
//      а потерянное маркетплейсом видно отдельной суммой;
//   6. перенос стоимости переживает ввод поставки ЗАДНИМ ЧИСЛОМ: приходная
//      нога пересчитывается вместе с расходной (иначе перемещение молча
//      рождает или съедает прибыль).
//
// Запуск: pnpm tsx scripts/test-stock-doc-plan.ts

import {
  defaultDirectionFor,
  planDocLegs,
  type PlanDoc,
  type PlanLine,
  type PlanPlace,
  type PlannedLeg,
} from '../src/lib/stock/doc-plan';
import {
  replayLedgerMulti,
  type LedgerMoveRow,
} from '../src/lib/stock/replay-plan';
import { StockError } from '../src/lib/stock/errors';
import type { StockDocKind } from '../src/lib/db/schema/stock-ledger';

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

function throws(label: string, fn: () => unknown, expectCode = 'bad_request') {
  try {
    fn();
    ok(label, false, 'исключения не было');
  } catch (e) {
    ok(
      label,
      e instanceof StockError && e.code === expectCode,
      `получено ${String(e)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Места (§3): own/transit/loss ведёт журнал, ozon_fbo — маркетплейс
// ---------------------------------------------------------------------------

const OWN: PlanPlace = { id: 'p-own', code: 'own', authority: 'ledger' };
const TRANSIT: PlanPlace = { id: 'p-transit', code: 'transit_ozon', authority: 'ledger' };
const FBO: PlanPlace = { id: 'p-fbo', code: 'ozon_fbo', authority: 'external' };
const LOSS: PlanPlace = { id: 'p-loss', code: 'loss', authority: 'ledger' };
const WB: PlanPlace = { id: 'p-wb', code: 'wb', authority: 'ledger' };

const ITEM_A = 'item-A';
const ITEM_B = 'item-B';

function doc(patch: Partial<PlanDoc> & { kind: StockDocKind }): PlanDoc {
  return {
    kind: patch.kind,
    reason: patch.reason ?? null,
    fromPlace: patch.fromPlace ?? null,
    toPlace: patch.toPlace ?? null,
    ownPlace: patch.ownPlace ?? OWN,
    lossPlace: patch.lossPlace ?? LOSS,
  };
}

function line(patch: Partial<PlanLine> & { lineNo: number; qty: number }): PlanLine {
  return {
    lineNo: patch.lineNo,
    lineId: patch.lineId ?? `L${patch.lineNo}`,
    itemId: patch.itemId ?? ITEM_A,
    direction: patch.direction ?? 'out',
    qty: patch.qty,
    countedQty: patch.countedQty ?? null,
    pairLineNo: patch.pairLineNo ?? null,
  };
}

// ---------------------------------------------------------------------------
// Мост «план → лента»: ровно то, что делает postDoc (движения в порядке ног,
// pairLegIndex превращается в pair_move_id уже вставленной расходной ноги).
// ---------------------------------------------------------------------------

let seqCounter = 0;

interface LedgerDoc {
  docDate: string;
  costBasis?: 'gross' | 'net';
  /** landed-суммы приходных СТРОК (для покупок), ключ — lineNo. */
  lineValues?: Record<number, number>;
}

function legsToRows(legs: readonly PlannedLeg[], d: LedgerDoc): LedgerMoveRow[] {
  const ids: string[] = [];
  return legs.map((leg, i) => {
    const id = `mv${(seqCounter += 1)}`;
    ids.push(id);
    return {
      id,
      itemId: leg.itemId,
      seq: seqCounter,
      docDate: d.docDate,
      qtyDelta: leg.direction === 'in' ? leg.qty : -leg.qty,
      valueDeltaKopecks: 0,
      unitValueKopecks: 0,
      uncoveredQty: 0,
      deficitSettledKopecks: 0,
      kind: leg.kind,
      reason: leg.reason,
      reversesMoveId: null,
      pairMoveId: leg.pairLegIndex != null ? ids[leg.pairLegIndex] : null,
      lineValueKopecks: d.lineValues?.[leg.lineNo] ?? null,
      lineIsEstimated: false,
      docCostBasis: d.costBasis ?? 'gross',
    };
  });
}

/** Поступление: приходная нога с готовой landed-суммой (правило 2 реплея). */
function purchaseRows(
  itemId: string,
  qty: number,
  valueKopecks: number,
  docDate = '2026-03-01',
): LedgerMoveRow[] {
  const legs = planDocLegs(doc({ kind: 'purchase', toPlace: OWN }), [
    line({ lineNo: 1, itemId, direction: 'in', qty }),
  ]);
  return legsToRows(legs, { docDate, lineValues: { 1: valueKopecks } });
}

function sumDelta(moves: Array<{ valueDeltaKopecks: number }>): number {
  return moves.reduce((s, m) => s + m.valueDeltaKopecks, 0);
}

function deltaOf(
  result: ReturnType<typeof replayLedgerMulti>,
  ids: readonly string[],
): number {
  return result.moves
    .filter((m) => ids.includes(m.id))
    .reduce((s, m) => s + m.valueDeltaKopecks, 0);
}

// ===========================================================================
console.log('\n=== Направление строк по умолчанию ===');
// ===========================================================================
{
  eq('поступление приходует', defaultDirectionFor('purchase'), 'in');
  eq('списание расходует', defaultDirectionFor('writeoff'), 'out');
  eq('перемещение расходует', defaultDirectionFor('transfer'), 'out');
  eq('приёмка расходует «в пути»', defaultDirectionFor('accept'), 'out');
  eq('продажа расходует', defaultDirectionFor('sale'), 'out');
}

// ===========================================================================
console.log('\n=== Перемещение ledger → ledger: ДВЕ ноги, стоимость переезжает ===');
// ===========================================================================
{
  const legs = planDocLegs(
    doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }),
    [line({ lineNo: 1, qty: 4 })],
  );
  eq('ног ровно две', legs.length, 2);
  eq('первая — расход со своего склада', legs[0].placeId, OWN.id);
  eq('вторая — приход в «в пути»', legs[1].placeId, TRANSIT.id);
  eq('приходная нога знает свою пару', legs[1].pairLegIndex, 0);
  ok('расходная нога идёт РАНЬШЕ приходной', legs[0].direction === 'out');
  ok(
    'партии не трогаются: пул товара не изменился',
    legs[0].touchesBatches === false && legs[1].touchesBatches === false,
  );
  eq('counter расходной — приёмник', legs[0].counterPlaceId, TRANSIT.id);
  eq('counter приходной — источник', legs[1].counterPlaceId, OWN.id);
}

{
  // Главный инвариант §1: Σ value_delta по документу перемещения == 0.
  seqCounter = 0;
  const rows = [
    ...purchaseRows(ITEM_A, 10, 100_000, '2026-03-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
        line({ lineNo: 1, qty: 4 }),
      ]),
      { docDate: '2026-03-05' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  const transferMoves = res.moves.filter((m) => m.id !== 'mv1');
  eq('расходная нога списала 4/10 стоимости', transferMoves[0].valueDeltaKopecks, -40_000);
  eq('приходная нога получила РОВНО столько же', transferMoves[1].valueDeltaKopecks, 40_000);
  eq('Σ value_delta документа == 0', sumDelta(transferMoves), 0);

  const pool = res.pools.get(ITEM_A)!;
  eq('пул по штукам не изменился', pool.qty, 10);
  eq('пул по деньгам не изменился', pool.valueKopecks, 100_000);
  eq('средняя не поехала', pool.avgCostKopecks, 10_000);
}

{
  // Нечётное деление: 3 шт из 7 по 100 001 коп. Переносится ровно та копейка,
  // что списана, — округление не имеет права разойтись между ногами.
  seqCounter = 0;
  const rows = [
    ...purchaseRows(ITEM_A, 7, 100_001, '2026-03-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
        line({ lineNo: 1, qty: 3 }),
      ]),
      { docDate: '2026-03-05' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  const out = res.moves[1].valueDeltaKopecks;
  const back = res.moves[2].valueDeltaKopecks;
  // round(100001 × 3 / 7) = 42 858 — половина округляется ОТ нуля.
  eq('нечётная доля списана', out, -42_858);
  eq('и приходована без потери копейки', back, 42_858);
  eq('Σ == 0 на нечётном делении', out + back, 0);
  eq('стоимость пула цела', res.pools.get(ITEM_A)!.valueKopecks, 100_001);
}

{
  // Перемещение ВСЕГО остатка: расход забирает пул целиком (нулевой дрейф),
  // приход возвращает его же — «липкая» средняя не должна создать разницы.
  seqCounter = 0;
  const rows = [
    ...purchaseRows(ITEM_A, 3, 10_000, '2026-03-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
        line({ lineNo: 1, qty: 3 }),
      ]),
      { docDate: '2026-03-05' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  eq('Σ == 0 при переносе всего остатка', sumDelta(res.moves.slice(1)), 0);
  eq('пул цел', res.pools.get(ITEM_A)!.valueKopecks, 10_000);
  eq('штуки целы', res.pools.get(ITEM_A)!.qty, 3);
}

{
  // Базис НДС документа перемещения НЕ имеет права пометить пул смешанным:
  // это тот же товар той же партии, а не новое поступление (§12.2).
  seqCounter = 0;
  const rows = [
    ...purchaseRows(ITEM_A, 10, 100_000, '2026-03-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
        line({ lineNo: 1, qty: 4 }),
      ]),
      { docDate: '2026-03-05', costBasis: 'net' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  eq('базис пула не тронут', res.pools.get(ITEM_A)!.basis, 'gross');
  ok(
    'предупреждения о смешении базисов нет',
    !res.warnings.some((w) => w.code === 'mixed_cost_basis'),
  );
}

{
  // Перемещение при отрицательном пуле: приходная нога НЕ гасит дефицит,
  // иначе часть перенесённой стоимости ушла бы в ретро-COGS и Σ != 0.
  seqCounter = 0;
  const rows = [
    ...legsToRows(
      planDocLegs(doc({ kind: 'writeoff', fromPlace: OWN }), [
        line({ lineNo: 1, qty: 5 }),
      ]),
      { docDate: '2026-03-01' },
    ),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
        line({ lineNo: 1, qty: 2 }),
      ]),
      { docDate: '2026-03-02' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  eq('Σ перемещения == 0 даже в минусовом пуле', sumDelta(res.moves.slice(1)), 0);
  eq(
    'дефицит перемещением не «закрывается»',
    res.moves[2].deficitSettledKopecks,
    0,
  );
}

// ===========================================================================
console.log('\n=== Перемещение ledger → external: ОДНА нога (§3) ===');
// ===========================================================================
{
  const legs = planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: FBO }), [
    line({ lineNo: 1, qty: 6 }),
  ]);
  eq('нога одна', legs.length, 1);
  eq('на своём складе', legs[0].placeId, OWN.id);
  eq('вторая сторона — склад Ozon', legs[0].counterPlaceId, FBO.id);
  ok('партии списываются: пул реально уменьшился', legs[0].touchesBatches === true);
}

{
  seqCounter = 0;
  const rows = [
    ...purchaseRows(ITEM_A, 10, 100_000, '2026-03-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: FBO }), [
        line({ lineNo: 1, qty: 4 }),
      ]),
      { docDate: '2026-03-05' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  eq('стоимость вышла из журнала', sumDelta(res.moves.slice(1)), -40_000);
  eq('в пуле осталось 6 шт', res.pools.get(ITEM_A)!.qty, 6);
  eq('и 60 000 коп.', res.pools.get(ITEM_A)!.valueKopecks, 60_000);
}

// ===========================================================================
console.log('\n=== Приёмка с недостачей: разница в потери, а не в COGS (§1.8) ===');
// ===========================================================================
{
  const legs = planDocLegs(
    doc({ kind: 'accept', fromPlace: TRANSIT, toPlace: FBO }),
    [line({ lineNo: 1, qty: 100, countedQty: 95 })],
  );
  eq('две ноги: принято и недостача', legs.length, 2);
  eq('принято 95', legs[0].qty, 95);
  eq('нога приёмки списывает «в пути»', legs[0].placeId, TRANSIT.id);
  eq('её вторая сторона — склад Ozon', legs[0].counterPlaceId, FBO.id);
  eq('недостача 5', legs[1].qty, 5);
  eq('нога недостачи помечена списанием', legs[1].kind, 'writeoff');
  eq('с причиной mp_shortage', legs[1].reason, 'mp_shortage');
  eq('и уходит в место потерь', legs[1].counterPlaceId, LOSS.id);
}

{
  seqCounter = 0;
  // 100 шт по 10 ₽ отгружены на Ozon, принято 95.
  const rows = [
    ...purchaseRows(ITEM_A, 100, 100_000, '2026-03-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
        line({ lineNo: 1, qty: 100 }),
      ]),
      { docDate: '2026-03-02' },
    ),
    ...legsToRows(
      planDocLegs(doc({ kind: 'accept', fromPlace: TRANSIT, toPlace: FBO }), [
        line({ lineNo: 1, qty: 100, countedQty: 95 }),
      ]),
      { docDate: '2026-03-10' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  const accepted = res.moves.find((m) => m.id === 'mv4')!;
  const shortage = res.moves.find((m) => m.id === 'mv5')!;
  eq('принятое ушло по своей стоимости', accepted.valueDeltaKopecks, -95_000);
  eq('недостача оценена по той же средней', shortage.valueDeltaKopecks, -5_000);
  eq('журнал опустел по штукам', res.pools.get(ITEM_A)!.qty, 0);
  eq('и по деньгам (нулевой дрейф)', res.pools.get(ITEM_A)!.valueKopecks, 0);
  eq(
    'вся стоимость поставки распределена без остатка',
    sumDelta(res.moves),
    0,
  );
}

{
  // Приняли больше, чем отгрузили, — это не приёмка, а штуки из ниоткуда.
  throws('излишек приёмки отвергается', () =>
    planDocLegs(doc({ kind: 'accept', fromPlace: TRANSIT, toPlace: FBO }), [
      line({ lineNo: 1, qty: 10, countedQty: 12 }),
    ]),
  );
  throws('отрицательное «принято» отвергается', () =>
    planDocLegs(doc({ kind: 'accept', fromPlace: TRANSIT, toPlace: FBO }), [
      line({ lineNo: 1, qty: 10, countedQty: -1 }),
    ]),
  );
  throws('приёмка без приёмника отвергается', () =>
    planDocLegs(doc({ kind: 'accept', fromPlace: TRANSIT }), [
      line({ lineNo: 1, qty: 10 }),
    ]),
  );
}

{
  // Принято ВСЁ: ноги недостачи быть не должно (пустая строка потерь испортила
  // бы отчёт «сколько съел маркетплейс»).
  const legs = planDocLegs(doc({ kind: 'accept', fromPlace: TRANSIT, toPlace: FBO }), [
    line({ lineNo: 1, qty: 10, countedQty: 10 }),
  ]);
  eq('нога одна', legs.length, 1);
  eq('и это приёмка', legs[0].kind, 'accept');
}

{
  // Не принято НИЧЕГО: остаётся только нога потерь.
  const legs = planDocLegs(doc({ kind: 'accept', fromPlace: TRANSIT, toPlace: FBO }), [
    line({ lineNo: 1, qty: 10, countedQty: 0 }),
  ]);
  eq('нога одна', legs.length, 1);
  eq('и это потеря', legs[0].kind, 'writeoff');
  eq('на все 10 шт', legs[0].qty, 10);
}

// ===========================================================================
console.log('\n=== Цепочка own → transit → приёмка: где именно осели потери ===');
// ===========================================================================
{
  seqCounter = 0;
  // Поставка 200 шт на 240 000 коп (1200 коп/шт), отгрузка 120, принято 117.
  const rows = [
    ...purchaseRows(ITEM_A, 200, 240_000, '2026-04-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
        line({ lineNo: 1, qty: 120 }),
      ]),
      { docDate: '2026-04-05' },
    ),
    ...legsToRows(
      planDocLegs(doc({ kind: 'accept', fromPlace: TRANSIT, toPlace: FBO }), [
        line({ lineNo: 1, qty: 120, countedQty: 117 }),
      ]),
      { docDate: '2026-04-12' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  const byId = new Map(res.moves.map((m) => [m.id, m]));

  eq('отгрузка: списано со своего склада', byId.get('mv2')!.valueDeltaKopecks, -144_000);
  eq('отгрузка: приходовано в «в пути»', byId.get('mv3')!.valueDeltaKopecks, 144_000);
  eq('перемещение не тронуло капитализацию', sumDelta([byId.get('mv2')!, byId.get('mv3')!]), 0);

  eq('приёмка: у Ozon 117 шт', byId.get('mv4')!.valueDeltaKopecks, -140_400);
  eq('потеряно маркетплейсом 3 шт', byId.get('mv5')!.valueDeltaKopecks, -3_600);
  eq('потеря помечена mp_shortage', byId.get('mv5')!.itemId, ITEM_A);

  const pool = res.pools.get(ITEM_A)!;
  eq('в журнале остались 80 шт своего склада', pool.qty, 80);
  eq('и ровно их стоимость', pool.valueKopecks, 96_000);
  eq('средняя не поехала за всю цепочку', pool.avgCostKopecks, 1_200);
}

// ===========================================================================
console.log('\n=== Пересортица: ноль между РАЗНЫМИ товарами (§4.5) ===');
// ===========================================================================
{
  const legs = planDocLegs(doc({ kind: 'regrade', fromPlace: OWN }), [
    line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 5 }),
    line({ lineNo: 2, itemId: ITEM_B, direction: 'in', qty: 5, pairLineNo: 1 }),
  ]);
  eq('две ноги', legs.length, 2);
  eq('сначала расходная', legs[0].direction, 'out');
  eq('потом приходная', legs[1].direction, 'in');
  eq('приходная знает донора', legs[1].pairLegIndex, 0);
  ok('партии товара A списываются', legs[0].touchesBatches === true);
  ok('партию товару B заводит документ, не нога', legs[1].touchesBatches === false);
}

{
  seqCounter = 0;
  const rows = [
    ...purchaseRows(ITEM_A, 10, 33_333, '2026-05-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'regrade', fromPlace: OWN }), [
        line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 3 }),
        line({ lineNo: 2, itemId: ITEM_B, direction: 'in', qty: 3, pairLineNo: 1 }),
      ]),
      { docDate: '2026-05-04' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  const out = res.moves.find((m) => m.itemId === ITEM_A && m.id === 'mv2')!;
  const inLeg = res.moves.find((m) => m.itemId === ITEM_B)!;
  eq('списано с A по доле остаточной стоимости', out.valueDeltaKopecks, -10_000);
  eq('B получил РОВНО столько же', inLeg.valueDeltaKopecks, 10_000);
  eq('Σ по документу == 0', out.valueDeltaKopecks + inLeg.valueDeltaKopecks, 0);
  eq('A: осталось 7 шт', res.pools.get(ITEM_A)!.qty, 7);
  eq('A: осталось 23 333 коп.', res.pools.get(ITEM_A)!.valueKopecks, 23_333);
  eq('B: появилось 3 шт', res.pools.get(ITEM_B)!.qty, 3);
  eq('B: на 10 000 коп.', res.pools.get(ITEM_B)!.valueKopecks, 10_000);
  eq(
    'капитализация двух товаров не изменилась',
    res.pools.get(ITEM_A)!.valueKopecks + res.pools.get(ITEM_B)!.valueKopecks,
    33_333,
  );
  ok(
    'пересорт не считается закупкой товара B',
    res.pools.get(ITEM_B)!.lastCostKopecks === 0,
  );
}

{
  // Пересортица «в обе стороны» одним документом: две пары, обе сходятся.
  seqCounter = 0;
  const rows = [
    ...purchaseRows(ITEM_A, 10, 50_000, '2026-05-01'),
    ...purchaseRows(ITEM_B, 10, 90_000, '2026-05-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'regrade', fromPlace: OWN }), [
        line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 2 }),
        line({ lineNo: 2, itemId: ITEM_B, direction: 'out', qty: 3 }),
        line({ lineNo: 3, itemId: ITEM_B, direction: 'in', qty: 2, pairLineNo: 1 }),
        line({ lineNo: 4, itemId: ITEM_A, direction: 'in', qty: 3, pairLineNo: 2 }),
      ]),
      { docDate: '2026-05-06' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  const regrade = res.moves.filter((m) => !['mv1', 'mv2'].includes(m.id));
  eq('ног четыре', regrade.length, 4);
  eq('Σ документа == 0', sumDelta(regrade), 0);
  eq(
    'общая капитализация цела',
    res.pools.get(ITEM_A)!.valueKopecks + res.pools.get(ITEM_B)!.valueKopecks,
    140_000,
  );
  eq('A: 10 - 2 + 3', res.pools.get(ITEM_A)!.qty, 11);
  eq('B: 10 - 3 + 2', res.pools.get(ITEM_B)!.qty, 9);
}

{
  throws('пересортица без приходной стороны отвергается', () =>
    planDocLegs(doc({ kind: 'regrade', fromPlace: OWN }), [
      line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 5 }),
    ]),
  );
  throws('разное количество сторон отвергается', () =>
    planDocLegs(doc({ kind: 'regrade', fromPlace: OWN }), [
      line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 5 }),
      line({ lineNo: 2, itemId: ITEM_B, direction: 'in', qty: 4, pairLineNo: 1 }),
    ]),
  );
  throws('пересорт товара сам в себя отвергается', () =>
    planDocLegs(doc({ kind: 'regrade', fromPlace: OWN }), [
      line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 5 }),
      line({ lineNo: 2, itemId: ITEM_A, direction: 'in', qty: 5, pairLineNo: 1 }),
    ]),
  );
  throws('одна расходная строка на две приходных отвергается', () =>
    planDocLegs(doc({ kind: 'regrade', fromPlace: OWN }), [
      line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 4 }),
      line({ lineNo: 2, itemId: ITEM_A, direction: 'out', qty: 4 }),
      line({ lineNo: 3, itemId: ITEM_B, direction: 'in', qty: 4, pairLineNo: 1 }),
      line({ lineNo: 4, itemId: ITEM_B, direction: 'in', qty: 4, pairLineNo: 1 }),
    ]),
  );
  throws('пересортица в двух разных местах отвергается', () =>
    planDocLegs(doc({ kind: 'regrade', fromPlace: OWN, toPlace: TRANSIT }), [
      line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 1 }),
      line({ lineNo: 2, itemId: ITEM_B, direction: 'in', qty: 1, pairLineNo: 1 }),
    ]),
  );
}

{
  // Неявное сопоставление по порядку — когда UI не проставил pair_line_no.
  const legs = planDocLegs(doc({ kind: 'regrade', fromPlace: OWN }), [
    line({ lineNo: 1, itemId: ITEM_A, direction: 'out', qty: 2 }),
    line({ lineNo: 2, itemId: ITEM_B, direction: 'in', qty: 2 }),
  ]);
  eq('пара найдена по порядку', legs[1].pairLegIndex, 0);
}

// ===========================================================================
console.log('\n=== Задним числом: пара пересчитывается ВМЕСТЕ (§4.7) ===');
// ===========================================================================
{
  seqCounter = 0;
  const base = [
    ...purchaseRows(ITEM_A, 10, 100_000, '2026-06-10'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
        line({ lineNo: 1, qty: 4 }),
      ]),
      { docDate: '2026-06-20' },
    ),
  ];
  const before = replayLedgerMulti(base);
  eq('до вставки перенесено 40 000', deltaOf(before, ['mv2']), -40_000);

  // Забытая поставка от 5 июня: дешевле, средняя падает → стоимость
  // перемещения обязана пересчитаться, и приходная нога вместе с ней.
  const withBackdated = [...base, ...purchaseRows(ITEM_A, 10, 60_000, '2026-06-05')];
  const after = replayLedgerMulti(withBackdated);
  const byId = new Map(after.moves.map((m) => [m.id, m]));
  eq('перемещение пересчитано по новой средней', byId.get('mv2')!.valueDeltaKopecks, -32_000);
  eq('приходная нога пересчитана вместе с ним', byId.get('mv3')!.valueDeltaKopecks, 32_000);
  eq(
    'Σ по документу перемещения остался нулём',
    byId.get('mv2')!.valueDeltaKopecks + byId.get('mv3')!.valueDeltaKopecks,
    0,
  );
  ok('обе ноги помечены изменёнными', byId.get('mv2')!.changed && byId.get('mv3')!.changed);
  eq('итоговый пул', after.pools.get(ITEM_A)!.valueKopecks, 160_000);
}

{
  // Пара вне выборки: молчать нельзя — движок берёт снимок и предупреждает.
  seqCounter = 0;
  const rows = legsToRows(
    planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
      line({ lineNo: 1, qty: 4 }),
    ]),
    { docDate: '2026-06-20' },
  );
  rows[1].valueDeltaKopecks = 12_345;
  const res = replayLedgerMulti([rows[1]]);
  eq('взят снимок с диска', res.moves[0].valueDeltaKopecks, 12_345);
  ok(
    'есть предупреждение pair_unresolved',
    res.warnings.some((w) => w.code === 'pair_unresolved'),
  );
}

// ===========================================================================
console.log('\n=== Односторонние документы Релиза 1 не изменились ===');
// ===========================================================================
{
  const purchase = planDocLegs(doc({ kind: 'purchase' }), [
    line({ lineNo: 1, direction: 'in', qty: 5 }),
  ]);
  eq('поступление: одна нога на свой склад', purchase[0].placeId, OWN.id);
  eq('без второй стороны', purchase[0].counterPlaceId, null);

  const writeoff = planDocLegs(doc({ kind: 'writeoff', reason: 'expired' }), [
    line({ lineNo: 1, qty: 2 }),
  ]);
  eq('списание уходит в место потерь', writeoff[0].counterPlaceId, LOSS.id);
  eq('с причиной документа', writeoff[0].reason, 'expired');

  const sale = planDocLegs(doc({ kind: 'sale', fromPlace: OWN }), [
    line({ lineNo: 1, qty: 3 }),
  ]);
  eq('продажа списывает со своего склада', sale[0].placeId, OWN.id);
  eq('продажа НЕ уходит в потери', sale[0].counterPlaceId, null);
  eq('и помечена как продажа', sale[0].kind, 'sale');

  const saleWb = planDocLegs(doc({ kind: 'sale', fromPlace: WB }), [
    line({ lineNo: 1, qty: 3 }),
  ]);
  eq('продажа со склада WB списывает с него', saleWb[0].placeId, WB.id);
}

{
  // Продажа считается себестоимостью проданного, а не потерей (§1.8).
  seqCounter = 0;
  const rows = [
    ...purchaseRows(ITEM_A, 10, 100_000, '2026-07-01'),
    ...legsToRows(
      planDocLegs(doc({ kind: 'sale', fromPlace: OWN }), [line({ lineNo: 1, qty: 2 })]),
      { docDate: '2026-07-03' },
    ),
    ...legsToRows(
      planDocLegs(doc({ kind: 'writeoff', reason: 'expired', fromPlace: OWN }), [
        line({ lineNo: 1, qty: 1 }),
      ]),
      { docDate: '2026-07-04' },
    ),
  ];
  const res = replayLedgerMulti(rows);
  eq('продажа списала 20 000', res.moves[1].valueDeltaKopecks, -20_000);
  eq('списание — 10 000', res.moves[2].valueDeltaKopecks, -10_000);
  eq('в пуле 7 шт', res.pools.get(ITEM_A)!.qty, 7);
  eq('и 70 000 коп.', res.pools.get(ITEM_A)!.valueKopecks, 70_000);
}

{
  throws('движение по external-месту как источнику отвергается', () =>
    planDocLegs(doc({ kind: 'transfer', fromPlace: FBO, toPlace: OWN }), [
      line({ lineNo: 1, qty: 1 }),
    ]),
  );
  throws('перемещение в то же самое место отвергается', () =>
    planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: OWN }), [
      line({ lineNo: 1, qty: 1 }),
    ]),
  );
  throws('перемещение без строк отвергается', () =>
    planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), []),
  );
  throws('приходная строка в перемещении отвергается', () =>
    planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
      line({ lineNo: 1, direction: 'in', qty: 1 }),
    ]),
  );
  throws('дробное количество отвергается', () =>
    planDocLegs(doc({ kind: 'transfer', fromPlace: OWN, toPlace: TRANSIT }), [
      line({ lineNo: 1, qty: 1.5 }),
    ]),
  );
}

console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
