// PURPOSE: Чистый реплей ленты движений — правило «откуда берётся стоимость
// каждого движения». Вынесено из posting.ts отдельным модулем БЕЗ импорта db,
// чтобы это можно было проверить тестом: scripts/test-stock-replay.ts.
//
// Почему именно это вынесено: арифметику пула считает costing.ts (98 тестов), но
// РЕШЕНИЕ, какое значение подать в applyEvent, живёт здесь — и ошибиться в нём
// так же дорого. Особенно в сторно: если брать стоимость сторно-движения из
// снимка на диске, то после ввода документа ЗАДНИМ ЧИСЛОМ (он меняет среднюю, а
// значит и стоимость исходного расхода) сторно перестанет гасить оригинал, и
// инвариант §4.8.8 «Σ оригинала + сторно == 0» тихо развалится.
//
// ПРАВИЛА (docs/STOCK_MODULE_DESIGN.md §4):
//   1. сторно (reverses_move_id) → стоимость, обратная ПЕРЕСЧИТАННОЙ стоимости
//      оригинала в этом же прогоне, а не его снимку;
//   2. приход → landed-сумма СТРОКИ документа (stock_doc_lines.value_kopecks):
//      она не зависит от пула, поэтому реплей воспроизводим;
//   3. расход → стоимость НЕ задаётся: её считает пул (доля от остаточной
//      стоимости, §4.2);
//   4. ПАРНАЯ НОГА (pair_move_id, Релиз 2) → стоимость, равная ПЕРЕСЧИТАННОЙ
//      стоимости своей расходной ноги. Так стоимость ПЕРЕНОСИТСЯ между местами
//      (own → transit_ozon) и между позициями (пересортица), а Σ value_delta
//      по документу остаётся нулём даже после ввода поставки задним числом.
//
// Порядок — строго (doc_date, seq), тот же, что sortEvents() в costing.ts.
//
// МУЛЬТИТОВАРНЫЙ ПРОХОД. Пересортица связывает ленты РАЗНЫХ товаров: приходная
// нога товара B берёт стоимость у расходной ноги товара A. Поэтому реплей умеет
// идти по нескольким товарам одним хронологическим проходом, держа по пулу на
// товар (replayLedgerMulti). Реплей одного товара — частный случай.

import {
  applyEvent,
  createPool,
  type CostBasis,
  type CostingDocKind,
  type CostingReason,
  type CostingWarning,
  type PoolState,
} from './costing';

/** Строка stock_moves + подтянутые поля строки документа и шапки. */
export interface LedgerMoveRow {
  id: string;
  seq: number;
  /** 'YYYY-MM-DD' */
  docDate: string;
  /** Знаковое: > 0 приход, < 0 расход. */
  qtyDelta: number;
  /** Снимок на диске — используется только как fallback. */
  valueDeltaKopecks: number;
  unitValueKopecks: number;
  uncoveredQty: number;
  deficitSettledKopecks: number;
  kind: CostingDocKind;
  reason: CostingReason | null;
  /** id оригинального движения, если это сторно. */
  reversesMoveId: string | null;
  /** stock_doc_lines.value_kopecks — landed-сумма приходной строки. */
  lineValueKopecks: number | null;
  lineIsEstimated: boolean | null;
  /** stock_docs.cost_basis — базис НДС документа (§12.2). */
  docCostBasis: CostBasis | null;
  /**
   * id расходной ноги-пары (stock_moves.pair_move_id). Заполнен только у
   * ПРИХОДНОЙ ноги перемещения/приёмки/пересортицы — правило 4.
   */
  pairMoveId?: string | null;
  /**
   * Товар движения. Обязателен для мультитоварного прохода (пересортица);
   * при реплее одного товара его подставляет replayLedger().
   */
  itemId?: string | null;
}

/** Пересчитанные costing-поля одного движения. */
export interface ReplayedMove {
  id: string;
  itemId: string;
  valueDeltaKopecks: number;
  unitValueKopecks: number;
  uncoveredQty: number;
  deficitSettledKopecks: number;
  /** Отличается ли от того, что лежит в БД — только такие строки надо UPDATE'ить. */
  changed: boolean;
}

export interface LedgerReplayResult {
  pool: PoolState;
  moves: ReplayedMove[];
  warnings: CostingWarning[];
}

export interface LedgerMultiReplayResult {
  /** itemId → итоговый пул (ложится в кэш stock_items через poolToCache). */
  pools: Map<string, PoolState>;
  /** Все пересчитанные движения в хронологическом порядке. */
  moves: ReplayedMove[];
  warnings: CostingWarning[];
}

/** Тот же порядок, что sortEvents() в costing.ts: (doc_date, seq). */
export function sortLedgerRows(rows: readonly LedgerMoveRow[]): LedgerMoveRow[] {
  return [...rows].sort((a, b) => {
    if (a.docDate !== b.docDate) return a.docDate < b.docDate ? -1 : 1;
    return a.seq - b.seq;
  });
}

/**
 * Мультитоварный реплей: один хронологический проход, по пулу на товар.
 *
 * Порядок общий по (doc_date, seq), а не по товарам, ровно ради правила 4:
 * приходная нога пересортицы обязана увидеть УЖЕ пересчитанную стоимость своей
 * расходной ноги, которая лежит в ленте ДРУГОГО товара. Внутри одного товара
 * результат при этом побитово совпадает с одиночным реплеем — сортировка
 * стабильна относительно подмножества.
 *
 * ЧИСТАЯ функция: ничего не пишет и не читает БД.
 */
export function replayLedgerMulti(
  rows: readonly LedgerMoveRow[],
  opts: { initialByItem?: ReadonlyMap<string, PoolState> } = {},
): LedgerMultiReplayResult {
  const pools = new Map<string, PoolState>();
  const moves: ReplayedMove[] = [];
  const warnings: CostingWarning[] = [];
  /** id движения → его ПЕРЕСЧИТАННАЯ value_delta (нужна сторно и парной ноге). */
  const computedDelta = new Map<string, number>();

  for (const row of sortLedgerRows(rows)) {
    const qty = Math.abs(row.qtyDelta);
    // Движение с нулевым количеством — данные повреждены; молча пропускаем,
    // иначе applyEvent бросит и пересчёт всего товара станет невозможен.
    if (qty === 0) continue;

    const itemId = row.itemId ?? '';
    const pool = pools.get(itemId) ?? createPool(opts.initialByItem?.get(itemId) ?? {});

    const direction = row.qtyDelta > 0 ? 'in' : 'out';
    const isReversal = row.reversesMoveId != null;
    const isPaired = !isReversal && direction === 'in' && row.pairMoveId != null;

    let valueKopecks: number | null = null;
    if (isReversal) {
      // Правило 1. Fallback на снимок — только если оригинал не попал в выборку
      // (не должно случаться: FK cascade держит их в одной ленте товара).
      const originalDelta =
        computedDelta.get(row.reversesMoveId as string) ?? -row.valueDeltaKopecks;
      // applyEvent даёт valueDelta = -value для расхода и +value для прихода,
      // поэтому знак подбирается так, чтобы сумма с оригиналом была ровно 0.
      valueKopecks = direction === 'out' ? originalDelta : -originalDelta;
    } else if (isPaired) {
      // Правило 4. Расходная нога уже посчитана в этом же проходе: её
      // value_delta отрицательна, приходная забирает её по модулю.
      const donor = computedDelta.get(row.pairMoveId as string);
      if (donor === undefined) {
        // Пара вне выборки — считать по средней нельзя (это создало бы
        // стоимость из воздуха), поэтому берём снимок и громко предупреждаем:
        // реплей запущен по неполному замыканию товаров.
        valueKopecks = row.valueDeltaKopecks;
        warnings.push({
          code: 'pair_unresolved',
          seq: row.seq,
          qty,
          valueKopecks: row.valueDeltaKopecks,
          message:
            'приходная нога не нашла свою расходную (реплей по неполному набору ' +
            'товаров) — взят снимок с диска, Σ по документу может не сойтись в ноль',
        });
      } else {
        valueKopecks = -donor;
      }
    } else if (direction === 'in') {
      // Правило 2.
      valueKopecks = row.lineValueKopecks ?? row.valueDeltaKopecks;
    }
    // Правило 3: для расхода valueKopecks остаётся null — считает пул.

    const applied = applyEvent(pool, {
      docDate: row.docDate,
      seq: row.seq,
      direction,
      qty,
      kind: row.kind,
      reason: row.reason,
      valueKopecks,
      costBasis: row.docCostBasis ?? undefined,
      isEstimated: row.lineIsEstimated ?? false,
      isReversal,
      isPaired,
      itemId: itemId || undefined,
    });

    pools.set(itemId, applied.pool);
    computedDelta.set(row.id, applied.move.valueDeltaKopecks);
    warnings.push(...applied.move.warnings);

    moves.push({
      id: row.id,
      itemId,
      valueDeltaKopecks: applied.move.valueDeltaKopecks,
      unitValueKopecks: applied.move.unitValueKopecks,
      uncoveredQty: applied.move.uncoveredQty,
      deficitSettledKopecks: applied.move.deficitSettledKopecks,
      changed:
        applied.move.valueDeltaKopecks !== row.valueDeltaKopecks ||
        applied.move.unitValueKopecks !== row.unitValueKopecks ||
        applied.move.uncoveredQty !== row.uncoveredQty ||
        applied.move.deficitSettledKopecks !== row.deficitSettledKopecks,
    });
  }

  return { pools, moves, warnings };
}

/**
 * Реплей ленты ОДНОГО товара — частный случай replayLedgerMulti.
 * Возвращает итоговый пул и пересчитанные значения его движений.
 */
export function replayLedger(
  rows: readonly LedgerMoveRow[],
  opts: { itemId?: string; initial?: PoolState } = {},
): LedgerReplayResult {
  const key = opts.itemId ?? '';
  const result = replayLedgerMulti(
    rows.map((r) => ({ ...r, itemId: key })),
    opts.initial ? { initialByItem: new Map([[key, opts.initial]]) } : {},
  );
  return {
    pool: result.pools.get(key) ?? createPool(opts.initial ?? {}),
    moves: result.moves,
    warnings: result.warnings,
  };
}
