// PURPOSE: Чистый реплей ленты ОДНОГО товара — правило «откуда берётся стоимость
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
// ПРАВИЛО (docs/STOCK_MODULE_DESIGN.md §4):
//   1. сторно (reverses_move_id) → стоимость, обратная ПЕРЕСЧИТАННОЙ стоимости
//      оригинала в этом же прогоне, а не его снимку;
//   2. приход → landed-сумма СТРОКИ документа (stock_doc_lines.value_kopecks):
//      она не зависит от пула, поэтому реплей воспроизводим;
//   3. расход → стоимость НЕ задаётся: её считает пул (доля от остаточной
//      стоимости, §4.2).
//
// Порядок — строго (doc_date, seq), тот же, что sortEvents() в costing.ts.

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
}

/** Пересчитанные costing-поля одного движения. */
export interface ReplayedMove {
  id: string;
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

/** Тот же порядок, что sortEvents() в costing.ts: (doc_date, seq). */
export function sortLedgerRows(rows: readonly LedgerMoveRow[]): LedgerMoveRow[] {
  return [...rows].sort((a, b) => {
    if (a.docDate !== b.docDate) return a.docDate < b.docDate ? -1 : 1;
    return a.seq - b.seq;
  });
}

/**
 * Переигрывает ленту товара с нуля и возвращает пересчитанные значения движений
 * плюс итоговое состояние пула (оно ложится в кэш stock_items через poolToCache).
 *
 * ЧИСТАЯ функция: ничего не пишет и не читает БД. Вызывающий (posting.ts)
 * применяет результат в той же транзакции, где читал строки.
 */
export function replayLedger(
  rows: readonly LedgerMoveRow[],
  opts: { itemId?: string; initial?: PoolState } = {},
): LedgerReplayResult {
  let pool = createPool(opts.initial ?? {});
  const moves: ReplayedMove[] = [];
  const warnings: CostingWarning[] = [];
  /** id движения → его ПЕРЕСЧИТАННАЯ value_delta (нужно сторно). */
  const computedDelta = new Map<string, number>();

  for (const row of sortLedgerRows(rows)) {
    const qty = Math.abs(row.qtyDelta);
    // Движение с нулевым количеством — данные повреждены; молча пропускаем,
    // иначе applyEvent бросит и пересчёт всего товара станет невозможен.
    if (qty === 0) continue;

    const direction = row.qtyDelta > 0 ? 'in' : 'out';
    const isReversal = row.reversesMoveId != null;

    let valueKopecks: number | null = null;
    if (isReversal) {
      // Правило 1. Fallback на снимок — только если оригинал не попал в выборку
      // (не должно случаться: FK cascade держит их в одной ленте товара).
      const originalDelta =
        computedDelta.get(row.reversesMoveId as string) ?? -row.valueDeltaKopecks;
      // applyEvent даёт valueDelta = -value для расхода и +value для прихода,
      // поэтому знак подбирается так, чтобы сумма с оригиналом была ровно 0.
      valueKopecks = direction === 'out' ? originalDelta : -originalDelta;
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
      itemId: opts.itemId,
    });

    pool = applied.pool;
    computedDelta.set(row.id, applied.move.valueDeltaKopecks);
    warnings.push(...applied.move.warnings);

    moves.push({
      id: row.id,
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

  return { pool, moves, warnings };
}
