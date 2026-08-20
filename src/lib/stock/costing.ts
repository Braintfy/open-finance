// PURPOSE: Чистое ядро себестоимости модуля «Склад · Поставки · Себестоимость».
// БЕЗ единого импорта — ни db-клиента, ни Drizzle, ни Next. Только арифметика.
// Канон — docs/STOCK_MODULE_DESIGN.md §4 (модель себестоимости) и §1 (инварианты).
// Тесты — scripts/test-stock-costing.ts (там же проверяется совместимость типов
// с src/lib/db/schema/stock-ledger.ts).
//
// Зачем отдельный чистый модуль: это единственное место модуля, где можно
// ошибиться МОЛЧА — расхождение в копейку не падает, а годами копится в
// «Деньгах в товаре». Поэтому арифметика отделена от постинга и покрыта тестом
// до всякого UI (§9, Релиз 1, шаг 2).
//
// ГЛАВНЫЕ ПРАВИЛА (нарушение = баг):
//   1. Стоимость хранится СУММОЙ (value_kopecks), цена за штуку — производная.
//   2. Списание = ДОЛЯ ОТ ОСТАТОЧНОЙ стоимости пула, НЕ qty × unit_cost.
//      При q >= Q забирается весь остаток V целиком → нулевой дрейф.
//   3. value_delta_kopecks движения — это ФАКТИЧЕСКОЕ изменение V. Поэтому
//      «Σ moves.value_delta == stock_items.value_pool_kopecks» верно
//      по построению, а не по договорённости.
//   4. Потери (writeoff) считаются отдельной статьёй, НЕ COGS (§1.8).
//   5. Молчаливого нуля не бывает (§1.10): расход при пустом пуле даёт
//      uncoveredQty + warning, а не «COGS = 0» без следа.
//   6. НДС (§12.2): у каждого прихода СВОЙ базис (gross|net). Смешение партий
//      разных базисов в одном пуле помечается basis='mixed' + warning —
//      молча суммировать нельзя.
//   7. ПАРНЫЕ НОГИ (§4.5, Релиз 2): приходная нога перемещения/пересортицы
//      получает РОВНО ту сумму, что списана с расходной (isPaired). Стоимость
//      при этом ПЕРЕНОСИТСЯ, а не создаётся: никакого пересмотра базиса,
//      «цены последней закупки» и закрытия дефицита — иначе Σ value_delta по
//      документу перестала бы быть нулём и перемещение молча родило бы прибыль.

// ---------------------------------------------------------------------------
// Типы. Зеркалят строковые юнионы src/lib/db/schema/stock*.ts — специально
// продублированы, чтобы модуль не тянул за собой Drizzle (совместимость
// проверяется компилятором в scripts/test-stock-costing.ts).
// ---------------------------------------------------------------------------

/** Базис себестоимости: с НДС (по умолчанию) или без. */
export type CostBasis = 'gross' | 'net';

/** Базис пула: 'mixed' — в пуле лежат приходы обоих базисов. */
export type PoolBasis = CostBasis | 'mixed';

export type MoveDirection = 'in' | 'out';

export type CostingDocKind =
  | 'opening'
  | 'purchase'
  | 'transfer'
  | 'accept'
  | 'writeoff'
  | 'adjust'
  | 'return_in'
  | 'regrade'
  /**
   * Продажа вне Ozon (WB / Яндекс.Маркет / сайты), заведённая импортом файла
   * (§12.3). ОТДЕЛЬНЫЙ вид, а не writeoff: §1.8 запрещает смешивать потери и
   * себестоимость проданного, а «списание» с точки зрения отчётов — потеря.
   */
  | 'sale';

export type CostingReason =
  | 'expired'
  | 'damaged'
  | 'lost'
  | 'sample'
  | 'mp_shortage'
  | 'recount';

export type ExtraAllocMethod = 'by_value' | 'by_qty' | 'none';

export type LotPolicy = 'fifo' | 'fefo';

export type CostingWarningCode =
  /** Расход при пустом/недостаточном пуле — карантин блока stock.gaps. */
  | 'uncovered_qty'
  /** Пул ушёл в минус (allow_negative=true) — подсветка в «Пробелах». */
  | 'negative_pool'
  /** В пул легли приходы разных базисов НДС — отчёты обязаны это пометить. */
  | 'mixed_cost_basis'
  /** Приход закрыл отрицательный пул: его стоимость — ретро-COGS, не остаток. */
  | 'deficit_settled'
  /** Стоимость оценочная (цена «по памяти»). */
  | 'estimated_value'
  /**
   * Приходная нога не нашла свою расходную (пара вне выборки реплея) —
   * взят снимок с диска. Σ value_delta документа перемещения может не сойтись
   * в ноль: это сигнал, что реплей запущен по неполному набору товаров.
   */
  | 'pair_unresolved';

export interface CostingWarning {
  code: CostingWarningCode;
  /** seq движения, на котором сработало предупреждение. */
  seq: number;
  qty?: number;
  valueKopecks?: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Целочисленная арифметика (детерминированная, без float-дрейфа)
// ---------------------------------------------------------------------------

/**
 * round(a * b / c) с округлением половины ОТ НУЛЯ. Считает через BigInt:
 * копейки × штуки легко перелезают 2^53, а Number молча теряет точность.
 */
export function mulDivRound(a: number, b: number, c: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
    throw new Error(`mulDivRound: нечисловой аргумент (${a}, ${b}, ${c})`);
  }
  if (c === 0) return 0;
  const num = BigInt(Math.trunc(a)) * BigInt(Math.trunc(b));
  const den = BigInt(Math.trunc(c));
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const whole = absNum / absDen;
  const rest = absNum % absDen;
  const rounded = rest * 2n >= absDen ? whole + 1n : whole;
  return Number(negative ? -rounded : rounded);
}

/** round(a / b), половина от нуля. */
export function divRound(a: number, b: number): number {
  return mulDivRound(a, 1, b);
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}: ожидалось целое > 0, получено ${value}`);
  }
}

function assertInt(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label}: ожидалось целое, получено ${value}`);
  }
}

// ---------------------------------------------------------------------------
// Состояние пула товара
// ---------------------------------------------------------------------------

export interface PoolState {
  /** Q — штук в местах с authority='ledger'. Может быть отрицательным. */
  qty: number;
  /** V — стоимость пула, копейки. В авто-режиме никогда не уходит ниже нуля. */
  valueKopecks: number;
  /** round(V / Q); при пустом пуле — «липкая», сохраняет прежнее значение. */
  avgCostKopecks: number;
  /** Цена последней ЗАКУПКИ за единицу (opening/purchase), для «цена выросла на X%». */
  lastCostKopecks: number;
  /** Базис текущего пула; 'mixed' — смешаны gross и net. */
  basis: PoolBasis;
  /** Дубль-флаг для дешёвой фильтрации отчётов. */
  basisMixed: boolean;
  /** Базис последнего прихода — к нему возвращается пул после полного исчерпания. */
  lastInBasis: CostBasis;
}

export function createPool(init: Partial<PoolState> = {}): PoolState {
  return {
    qty: init.qty ?? 0,
    valueKopecks: init.valueKopecks ?? 0,
    avgCostKopecks: init.avgCostKopecks ?? 0,
    lastCostKopecks: init.lastCostKopecks ?? 0,
    basis: init.basis ?? 'gross',
    basisMixed: init.basisMixed ?? false,
    lastInBasis: init.lastInBasis ?? 'gross',
  };
}

/** Проекция пула на кэш-колонки stock_items (то, что пишет posting.ts). */
export interface ItemCostCache {
  qtyPool: number;
  valuePoolKopecks: number;
  avgCostKopecks: number;
  lastCostKopecks: number;
  costBasis: PoolBasis;
  costBasisMixed: boolean;
}

export function poolToCache(pool: PoolState): ItemCostCache {
  return {
    qtyPool: pool.qty,
    valuePoolKopecks: pool.valueKopecks,
    avgCostKopecks: pool.avgCostKopecks,
    lastCostKopecks: pool.lastCostKopecks,
    costBasis: pool.basis,
    costBasisMixed: pool.basisMixed,
  };
}

// ---------------------------------------------------------------------------
// События реплея и результат
// ---------------------------------------------------------------------------

export interface CostingEvent {
  /** 'YYYY-MM-DD' — дата хозоперации (stock_docs.doc_date). */
  docDate: string;
  /** Монотонный порядковый номер проводки (stock_moves.seq). Уникален. */
  seq: number;
  direction: MoveDirection;
  /** Всегда > 0; знак задаёт direction. */
  qty: number;
  kind: CostingDocKind;
  reason?: CostingReason | null;
  /**
   * Приход: landed-сумма (обязательна). Расход: если задано — списывается
   * РОВНО эта сумма (сторно, возврат по конкретному движению, приходная
   * сторона regrade, вторая нога внутреннего перемещения). Если не задано —
   * движок считает долю от остаточной стоимости пула.
   */
  valueKopecks?: number | null;
  /** Базис прихода (§12.2). Для расхода игнорируется. */
  costBasis?: CostBasis;
  /** Цена «по памяти» — тянется в отчёты. */
  isEstimated?: boolean;
  /**
   * Сторно/реверс: применяется ДОСЛОВНО — без покрытия отрицательного пула,
   * без обновления «цены последней закупки» и без пересмотра базиса.
   * Нужно, чтобы Σ(оригинал) + Σ(сторно) == 0 сходилась побайтово (§4.8.8).
   */
  isReversal?: boolean;
  /**
   * ПАРНАЯ НОГА документа перемещения/приёмки/пересортицы (§4.5). Как и сторно,
   * применяется ДОСЛОВНО: valueKopecks обязателен и равен сумме, списанной
   * расходной ногой. Отличие от обычного прихода принципиальное —
   *   • дефицит НЕ гасится: иначе часть перенесённой стоимости ушла бы в
   *     ретро-COGS и Σ value_delta документа перестала бы быть нулём;
   *   • «цена последней закупки» НЕ обновляется: перемещение — не закупка;
   *   • базис НДС НЕ пересматривается: это тот же товар той же партии, а не
   *     новое поступление (иначе перемещение помечало бы пул mixed).
   */
  isPaired?: boolean;
  /** Необязательная метка товара — для сообщений и группировки. */
  itemId?: string;
}

export interface CostedMove {
  seq: number;
  docDate: string;
  direction: MoveDirection;
  kind: CostingDocKind;
  reason: CostingReason | null;
  itemId: string | null;
  /** Знаковое количество (stock_moves.qty_delta). */
  qtyDelta: number;
  /** Знаковое изменение V (stock_moves.value_delta_kopecks). */
  valueDeltaKopecks: number;
  /** Снимок себестоимости единицы на момент проводки. */
  unitValueKopecks: number;
  /** Штук, которые пул не смог покрыть (карантин, §1.10). */
  uncoveredQty: number;
  /** Ретро-COGS: часть прихода, ушедшая на закрытие отрицательного пула. */
  deficitSettledKopecks: number;
  /** Снимок пула ПОСЛЕ проводки — для recalcFrom, отладки и «объясни цену». */
  poolQtyAfter: number;
  poolValueAfterKopecks: number;
  avgCostAfterKopecks: number;
  basisAfter: PoolBasis;
  warnings: CostingWarning[];
}

export interface ReplayTotals {
  inQty: number;
  outQty: number;
  /** Сумма приходов, реально легшая в пул (без ретро-COGS). */
  inValueKopecks: number;
  /** Сумма расходов, ушедшая из пула (модуль величины). */
  outValueKopecks: number;
  /**
   * Из outValueKopecks: потери (writeoff, в т.ч. reason='mp_shortage').
   * ИНВАРИАНТ §1.8: это ОТДЕЛЬНАЯ СТАТЬЯ, в COGS не попадает.
   */
  lossValueKopecks: number;
  /**
   * Из outValueKopecks: себестоимость ПРОДАННОГО (kind='sale' — продажи WB/ЯМ
   * и сайтов, заведённые импортом). Держится отдельно от lossValueKopecks
   * ровно потому, что §1.8 запрещает их смешивать: списанная просрочка и
   * проданный товар — разные строки будущего P&L.
   */
  cogsValueKopecks: number;
  /** Ретро-COGS по закрытым дефицитам. */
  deficitSettledKopecks: number;
  /** Всего непокрытых штук за реплей. */
  uncoveredQty: number;
}

export interface ReplayResult {
  pool: PoolState;
  moves: CostedMove[];
  warnings: CostingWarning[];
  totals: ReplayTotals;
}

// ---------------------------------------------------------------------------
// Ядро: одна проводка
// ---------------------------------------------------------------------------

/**
 * Применяет одно событие к пулу. ЧИСТАЯ: входной pool не мутируется.
 *
 * Приход (q, v):
 *   Q += q; V += v — но если пул был отрицательным, часть v уходит на закрытие
 *   дефицита (deficitSettledKopecks) и в V не попадает. Иначе Q мог бы вернуться
 *   к нулю с ненулевым V, то есть «0 штук на N рублей».
 *
 * Расход q:
 *   Q > 0: value_out = (q >= Q) ? V : round(V * q / Q)   ← доля от ОСТАТКА
 *   Q <= 0: value_out = 0, штуки уходят в uncoveredQty, оценка для отчёта —
 *           «липкая» средняя (unitValueKopecks), но пул в минус по деньгам не уходит.
 */
export function applyEvent(pool: PoolState, event: CostingEvent): {
  pool: PoolState;
  move: CostedMove;
} {
  assertPositiveInt(event.qty, `event[seq=${event.seq}].qty`);
  const warnings: CostingWarning[] = [];
  const next = createPool(pool);
  const qty = event.qty;
  /**
   * «Применить дословно»: сторно и парная нога перемещения. Обе несут ГОТОВУЮ
   * сумму, которая обязана сойтись с другим движением до копейки, поэтому пул
   * не имеет права их пересматривать (ни дефицитом, ни базисом, ни lastCost).
   */
  const verbatim = event.isReversal === true || event.isPaired === true;

  let valueDelta = 0;
  let unitValue = 0;
  let uncoveredQty = 0;
  let deficitSettled = 0;

  if (event.direction === 'in') {
    const value = event.valueKopecks ?? 0;
    assertInt(value, `event[seq=${event.seq}].valueKopecks`);

    // 1. Закрытие отрицательного пула: штуки, которыми гасится долг, физически
    //    уже отгружены — их стоимость не остаток, а ретро-COGS.
    if (!verbatim && pool.qty < 0) {
      const deficitQty = Math.min(qty, -pool.qty);
      deficitSettled = mulDivRound(value, deficitQty, qty);
      warnings.push({
        code: 'deficit_settled',
        seq: event.seq,
        qty: deficitQty,
        valueKopecks: deficitSettled,
        message:
          `приход закрыл отрицательный остаток ${deficitQty} шт: ` +
          `${deficitSettled} коп. отнесены в потери/ретро-COGS, а не в остаток`,
      });
    }

    valueDelta = value - deficitSettled;
    unitValue = divRound(value, qty);

    next.qty = pool.qty + qty;
    next.valueKopecks = pool.valueKopecks + valueDelta;

    // 2. Базис (§12.2). Пустой пул принимает базис прихода; непустой с другим
    //    базисом становится 'mixed' — молча суммировать нельзя.
    if (!verbatim) {
      const basisIn = event.costBasis ?? pool.lastInBasis;
      next.lastInBasis = basisIn;
      const poolWasEmpty = pool.qty <= 0 && pool.valueKopecks === 0;
      if (poolWasEmpty) {
        next.basis = basisIn;
        next.basisMixed = false;
      } else if (pool.basis !== basisIn) {
        next.basis = 'mixed';
        next.basisMixed = true;
        warnings.push({
          code: 'mixed_cost_basis',
          seq: event.seq,
          valueKopecks: value,
          message:
            `в пул легли приходы разных базисов НДС (${pool.basis} + ${basisIn}) — ` +
            'отчёты обязаны пометить смешанную оценку',
        });
      }
      // 3. «Цена последней закупки» — только реальные поступления извне.
      if (event.kind === 'purchase' || event.kind === 'opening') {
        next.lastCostKopecks = divRound(value, qty);
      }
    }
  } else {
    // --- расход ---
    if (event.valueKopecks != null) {
      // Явная стоимость: сторно, возврат по конкретному движению,
      // расходная нога regrade/transfer. Применяется дословно.
      assertInt(event.valueKopecks, `event[seq=${event.seq}].valueKopecks`);
      const valueOut = event.valueKopecks;
      valueDelta = -valueOut;
      unitValue = divRound(valueOut, qty);
    } else {
      const available = Math.max(0, pool.qty);
      let valueOut = 0;
      if (pool.qty > 0) {
        valueOut =
          qty >= pool.qty
            ? pool.valueKopecks // забираем ОСТАТОК ЦЕЛИКОМ → нулевой дрейф
            : mulDivRound(pool.valueKopecks, qty, pool.qty);
      }
      uncoveredQty = Math.max(0, qty - available);
      valueDelta = -valueOut;
      // Для отчётности непокрытые штуки оцениваются «липкой» средней,
      // но в пул этот минус НЕ проваливается (иначе V ушло бы в минус).
      unitValue = divRound(valueOut + uncoveredQty * pool.avgCostKopecks, qty);
      if (uncoveredQty > 0) {
        warnings.push({
          code: 'uncovered_qty',
          seq: event.seq,
          qty: uncoveredQty,
          valueKopecks: uncoveredQty * pool.avgCostKopecks,
          message:
            `расход ${qty} шт при остатке ${pool.qty} шт: ${uncoveredQty} шт без ` +
            'себестоимости — позиция уходит в карантин, а не в «COGS = 0»',
        });
      }
    }

    next.qty = pool.qty - qty;
    next.valueKopecks = pool.valueKopecks + valueDelta;

    if (next.qty <= 0) {
      // Пул исчерпан: смешение базисов больше не актуально, базис
      // возвращается к базису последнего прихода.
      next.basisMixed = false;
      next.basis = next.lastInBasis;
    }
    if (next.qty < 0) {
      warnings.push({
        code: 'negative_pool',
        seq: event.seq,
        qty: next.qty,
        message: `остаток ушёл в минус (${next.qty} шт) — подсветить в блоке «Пробелы»`,
      });
    }
  }

  // Средняя: «липкая» при пустом пуле (§4.2).
  next.avgCostKopecks =
    next.qty > 0 ? divRound(next.valueKopecks, next.qty) : pool.avgCostKopecks;

  if (next.valueKopecks < 0) {
    warnings.push({
      code: 'negative_pool',
      seq: event.seq,
      valueKopecks: next.valueKopecks,
      message:
        `стоимость пула ушла в минус (${next.valueKopecks} коп.) — ` +
        'возможно сторнирован приход, уже растворившийся в продажах',
    });
  }

  if (event.isEstimated) {
    warnings.push({
      code: 'estimated_value',
      seq: event.seq,
      valueKopecks: event.valueKopecks ?? 0,
      message: 'стоимость введена как оценочная (is_estimated)',
    });
  }

  const move: CostedMove = {
    seq: event.seq,
    docDate: event.docDate,
    direction: event.direction,
    kind: event.kind,
    reason: event.reason ?? null,
    itemId: event.itemId ?? null,
    qtyDelta: event.direction === 'in' ? qty : -qty,
    valueDeltaKopecks: valueDelta,
    unitValueKopecks: unitValue,
    uncoveredQty,
    deficitSettledKopecks: deficitSettled,
    poolQtyAfter: next.qty,
    poolValueAfterKopecks: next.valueKopecks,
    avgCostAfterKopecks: next.avgCostKopecks,
    basisAfter: next.basis,
    warnings,
  };

  return { pool: next, move };
}

// ---------------------------------------------------------------------------
// Реплей ленты
// ---------------------------------------------------------------------------

/**
 * Детерминированный порядок проводки: (doc_date, seq). Именно он позволяет
 * вводить документы задним числом — recalcFrom() переигрывает ленту с той же
 * сортировкой и получает те же числа (§4.7, инвариант §4.8.7).
 */
export function sortEvents(events: readonly CostingEvent[]): CostingEvent[] {
  return [...events].sort((a, b) => {
    if (a.docDate !== b.docDate) return a.docDate < b.docDate ? -1 : 1;
    return a.seq - b.seq;
  });
}

export function replay(
  events: readonly CostingEvent[],
  initial?: PoolState,
): ReplayResult {
  let pool = createPool(initial ?? {});
  const moves: CostedMove[] = [];
  const warnings: CostingWarning[] = [];
  const totals: ReplayTotals = {
    inQty: 0,
    outQty: 0,
    inValueKopecks: 0,
    outValueKopecks: 0,
    lossValueKopecks: 0,
    cogsValueKopecks: 0,
    deficitSettledKopecks: 0,
    uncoveredQty: 0,
  };

  for (const event of sortEvents(events)) {
    const applied = applyEvent(pool, event);
    pool = applied.pool;
    moves.push(applied.move);
    warnings.push(...applied.move.warnings);

    if (applied.move.qtyDelta > 0) {
      totals.inQty += applied.move.qtyDelta;
      totals.inValueKopecks += applied.move.valueDeltaKopecks;
    } else {
      totals.outQty += -applied.move.qtyDelta;
      totals.outValueKopecks += -applied.move.valueDeltaKopecks;
      // §1.8: потери НЕ являются себестоимостью проданного — и наоборот.
      // Недостача приёмки (reason='mp_shortage') проводится ногой kind='writeoff'
      // внутри документа приёмки, поэтому попадает сюда же: «сколько товара
      // съел маркетплейс» видно суммой, отдельной статьёй.
      if (applied.move.kind === 'writeoff') {
        totals.lossValueKopecks += -applied.move.valueDeltaKopecks;
      } else if (applied.move.kind === 'sale') {
        totals.cogsValueKopecks += -applied.move.valueDeltaKopecks;
      }
    }
    totals.deficitSettledKopecks += applied.move.deficitSettledKopecks;
    totals.uncoveredQty += applied.move.uncoveredQty;
  }

  return { pool, moves, warnings, totals };
}

/**
 * Себестоимость единицы товара на дату (включительно) — вход для COGS продаж
 * маркетплейсов, которые движений не порождают (§5, «Продажа на Ozon»).
 * Возвращает null, если на дату по товару вообще не было приходов: это
 * «себестоимость неизвестна», а НЕ ноль (§1.10).
 */
export function costAtDate(
  events: readonly CostingEvent[],
  isoDate: string,
): { avgCostKopecks: number; qty: number; valueKopecks: number; basis: PoolBasis } | null {
  const upto = events.filter((e) => e.docDate <= isoDate);
  if (upto.length === 0) return null;
  const { pool } = replay(upto);
  if (pool.avgCostKopecks === 0 && pool.valueKopecks === 0 && pool.qty <= 0) return null;
  return {
    avgCostKopecks: pool.avgCostKopecks,
    qty: pool.qty,
    valueKopecks: pool.valueKopecks,
    basis: pool.basis,
  };
}

/**
 * Сторно-события для void документа: направление переворачивается, стоимость
 * берётся РОВНО обратной к оригинальной. Гарантирует §4.8.8
 * (Σ value_delta оригинала + сторно == 0) без пересчёта по средней.
 */
export function buildReversalEvents(
  moves: readonly CostedMove[],
  opts: { docDate: string; startSeq: number },
): CostingEvent[] {
  return moves.map((move, i) => {
    const direction: MoveDirection = move.direction === 'in' ? 'out' : 'in';
    // applyEvent даёт valueDelta = -X для расхода и +X для прихода, поэтому
    // X подбирается так, чтобы valueDelta сторно был ровно минус оригинальный.
    const valueKopecks =
      direction === 'out' ? move.valueDeltaKopecks : -move.valueDeltaKopecks;
    return {
      docDate: opts.docDate,
      seq: opts.startSeq + i,
      direction,
      qty: Math.abs(move.qtyDelta),
      kind: move.kind,
      reason: move.reason,
      valueKopecks,
      isReversal: true,
      itemId: move.itemId ?? undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Разнесение доп. расходов документа — метод наибольших остатков
// ---------------------------------------------------------------------------

export interface ExtraAllocLine {
  qty: number;
  /** База разнесения по стоимости (сумма строки до доп. расходов). */
  baseValueKopecks: number;
  direction?: MoveDirection;
}

/**
 * Разносит extra_cost_kopecks по строкам МЕТОДОМ НАИБОЛЬШИХ ОСТАТКОВ:
 * Σ alloc == extra РОВНО, остаток достаётся строке с наибольшей дробной частью
 * (при равенстве — меньшему индексу, чтобы результат был детерминированным).
 * Простой round() по каждой строке систематически теряет копейки и ломает
 * «Деньги в товаре» (§4.2).
 *
 * Разносится только на ПРИХОДНЫЕ строки, если такие есть: доп. расходы —
 * это стоимость доставки поступившего товара.
 */
export function allocateExtraCost(
  extraKopecks: number,
  lines: readonly ExtraAllocLine[],
  method: ExtraAllocMethod = 'by_value',
): number[] {
  const result = new Array<number>(lines.length).fill(0);
  if (method === 'none' || extraKopecks === 0 || lines.length === 0) return result;
  assertInt(extraKopecks, 'allocateExtraCost.extraKopecks');

  const hasInbound = lines.some((l) => (l.direction ?? 'in') === 'in');
  const eligible: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!hasInbound || (lines[i].direction ?? 'in') === 'in') eligible.push(i);
  }
  if (eligible.length === 0) return result;

  let weights = eligible.map((i) =>
    method === 'by_qty' ? Math.abs(lines[i].qty) : Math.abs(lines[i].baseValueKopecks),
  );
  let total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) {
    // Нулевая база (например поставка по нулевой цене) — делим поровну.
    weights = eligible.map(() => 1);
    total = eligible.length;
  }

  const sign = extraKopecks < 0 ? -1 : 1;
  const abs = Math.abs(extraKopecks);
  const bigTotal = BigInt(total);
  const bigAbs = BigInt(abs);

  const base: number[] = [];
  const remainder: bigint[] = [];
  let distributed = 0;
  for (let k = 0; k < eligible.length; k += 1) {
    const product = bigAbs * BigInt(weights[k]);
    const whole = product / bigTotal;
    base.push(Number(whole));
    remainder.push(product % bigTotal);
    distributed += Number(whole);
  }

  let left = abs - distributed;
  const order = eligible
    .map((_, k) => k)
    .sort((a, b) => {
      if (remainder[a] !== remainder[b]) return remainder[a] > remainder[b] ? -1 : 1;
      return a - b;
    });
  for (let n = 0; n < order.length && left > 0; n += 1) {
    base[order[n]] += 1;
    left -= 1;
  }

  for (let k = 0; k < eligible.length; k += 1) {
    result[eligible[k]] = sign * base[k];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Суммы строк документа: НДС и базис
// ---------------------------------------------------------------------------

export interface DocLineInput {
  lineNo: number;
  qty: number;
  /** Цена как в накладной (см. priceIncludesVat). */
  unitPriceKopecks: number;
  /** Базисные пункты: 500 = 5 %, 2000 = 20 %. */
  vatRateBp?: number;
  direction?: MoveDirection;
  isEstimated?: boolean;
}

export interface DocHeaderInput {
  /** Введённая цена уже содержит НДС. */
  priceIncludesVat: boolean;
  /** §12.2 — базис ЭТОГО документа, копируется в партии. */
  costBasis: CostBasis;
  extraCostKopecks?: number;
  extraAlloc?: ExtraAllocMethod;
}

export interface CostedDocLine {
  lineNo: number;
  direction: MoveDirection;
  qty: number;
  /** Сумма строки с НДС. */
  grossKopecks: number;
  /** Сумма строки без НДС. */
  netKopecks: number;
  vatKopecks: number;
  /** Сумма по базису документа ДО доп. расходов. */
  baseValueKopecks: number;
  extraAllocKopecks: number;
  /** Итоговая landed-сумма строки (stock_doc_lines.value_kopecks). */
  valueKopecks: number;
  isEstimated: boolean;
}

export interface CostedDoc {
  lines: CostedDocLine[];
  /**
   * stock_docs.total_kopecks — деньги ПРИХОДНОЙ части (что платим поставщику).
   * Расходные строки получают value_kopecks от движка себестоимости и в total
   * не входят: это не платёж.
   */
  totalKopecks: number;
  vatTotalKopecks: number;
}

/** НДС и базис одной строки. */
export function computeLineValues(
  line: DocLineInput,
  header: Pick<DocHeaderInput, 'priceIncludesVat' | 'costBasis'>,
): Pick<CostedDocLine, 'grossKopecks' | 'netKopecks' | 'vatKopecks' | 'baseValueKopecks'> {
  assertPositiveInt(line.qty, `line[${line.lineNo}].qty`);
  assertInt(line.unitPriceKopecks, `line[${line.lineNo}].unitPriceKopecks`);
  const rateBp = line.vatRateBp ?? 0;
  const amount = line.qty * line.unitPriceKopecks;

  let grossKopecks: number;
  let netKopecks: number;
  let vatKopecks: number;
  if (header.priceIncludesVat) {
    grossKopecks = amount;
    vatKopecks = rateBp === 0 ? 0 : mulDivRound(amount, rateBp, 10000 + rateBp);
    netKopecks = grossKopecks - vatKopecks;
  } else {
    netKopecks = amount;
    vatKopecks = rateBp === 0 ? 0 : mulDivRound(amount, rateBp, 10000);
    grossKopecks = netKopecks + vatKopecks;
  }

  return {
    grossKopecks,
    netKopecks,
    vatKopecks,
    baseValueKopecks: header.costBasis === 'gross' ? grossKopecks : netKopecks,
  };
}

/**
 * Полный расчёт документа: НДС по строкам → разнесение доп. расходов →
 * landed value_kopecks → итоги шапки. Инвариант §4.8.3:
 * Σ lines.valueKopecks (приходных) == totalKopecks и Σ extraAlloc == extraCost.
 */
export function computeDocTotals(
  header: DocHeaderInput,
  lines: readonly DocLineInput[],
): CostedDoc {
  const priced = lines.map((line) => ({
    line,
    values: computeLineValues(line, header),
  }));

  const allocInput: ExtraAllocLine[] = priced.map((p) => ({
    qty: p.line.qty,
    baseValueKopecks: p.values.baseValueKopecks,
    direction: p.line.direction ?? 'in',
  }));
  const alloc = allocateExtraCost(
    header.extraCostKopecks ?? 0,
    allocInput,
    header.extraAlloc ?? 'by_value',
  );

  const out: CostedDocLine[] = priced.map((p, i) => {
    const direction = p.line.direction ?? 'in';
    const extraAllocKopecks = alloc[i];
    return {
      lineNo: p.line.lineNo,
      direction,
      qty: p.line.qty,
      grossKopecks: p.values.grossKopecks,
      netKopecks: p.values.netKopecks,
      vatKopecks: p.values.vatKopecks,
      baseValueKopecks: p.values.baseValueKopecks,
      extraAllocKopecks,
      // У расходных строк сумму заполняет движок себестоимости при проводке.
      valueKopecks: direction === 'in' ? p.values.baseValueKopecks + extraAllocKopecks : 0,
      isEstimated: p.line.isEstimated ?? false,
    };
  });

  let totalKopecks = 0;
  let vatTotalKopecks = 0;
  for (const line of out) {
    if (line.direction !== 'in') continue;
    totalKopecks += line.valueKopecks;
    vatTotalKopecks += line.vatKopecks;
  }

  return { lines: out, totalKopecks, vatTotalKopecks };
}

// ---------------------------------------------------------------------------
// Идемпотентность внешних импортов (§4.8.9)
// ---------------------------------------------------------------------------

export interface ImportableDoc {
  /** stock_docs.source: 'import' | 'inbox' | 'site:shopb' | … */
  source: string;
  /** stock_docs.source_ref — естественный ключ строки во внешней системе. */
  sourceRef?: string | null;
}

/**
 * Ключ идемпотентности — ровно тот, что стоит в частичном уникальном индексе
 * stock_docs_source_idx (tenant_id, source, source_ref) WHERE source_ref IS NOT NULL.
 * Возвращает null для документов без source_ref: они уникальностью не защищены
 * и повторному импорту не подлежат.
 */
export function importKey(doc: ImportableDoc): string | null {
  const ref = (doc.sourceRef ?? '').trim();
  if (ref === '') return null;
  // Ключ собирается через JSON, а не конкатенацией с разделителем:
  // source вида 'site:shopb' и ref вида 'order:42' сами содержат
  // двоеточия, и наивная склейка давала бы коллизии между парами.
  return JSON.stringify([doc.source, ref]);
}

/**
 * Отсекает уже импортированные документы И дубли внутри самой пачки.
 * Повторный pull того же периода обязан не создать ни одного лишнего движения.
 */
export function filterNewDocs<T extends ImportableDoc>(
  existingKeys: Iterable<string>,
  docs: readonly T[],
): { fresh: T[]; skipped: T[] } {
  const seen = new Set<string>(existingKeys);
  const fresh: T[] = [];
  const skipped: T[] = [];
  for (const doc of docs) {
    const key = importKey(doc);
    if (key === null) {
      fresh.push(doc);
      continue;
    }
    if (seen.has(key)) {
      skipped.push(doc);
      continue;
    }
    seen.add(key);
    fresh.push(doc);
  }
  return { fresh, skipped };
}

// ---------------------------------------------------------------------------
// Партии: FEFO/FIFO-аллокация штук (оценка живёт на пуле, партии несут штуки)
// ---------------------------------------------------------------------------

export interface BatchRef {
  id: string;
  /** 'YYYY-MM-DD' */
  receivedAt: string;
  /** 'YYYY-MM-DD' | null */
  expiresAt?: string | null;
  qtyLeft: number;
}

export interface LotAllocEntry {
  batchId: string;
  qty: number;
}

export interface LotAllocResult {
  alloc: LotAllocEntry[];
  /** Сколько штук партии покрыть не смогли (должно совпадать с uncoveredQty). */
  shortfall: number;
}

/** Дата-заглушка для партий без срока годности: уходят в конец FEFO-очереди. */
const NO_EXPIRY = '9999-12-31';

/**
 * Порядок списания ШТУК из партий. FEFO по умолчанию — у БАДов это физика
 * склада, а не предпочтение. Инвариант §4.8.4: Σ batches.qty_left == qty_pool.
 */
export function allocateLots(
  batches: readonly BatchRef[],
  qty: number,
  policy: LotPolicy = 'fefo',
): LotAllocResult {
  assertPositiveInt(qty, 'allocateLots.qty');
  const queue = [...batches]
    .filter((b) => b.qtyLeft > 0)
    .sort((a, b) => {
      if (policy === 'fefo') {
        const ea = a.expiresAt ?? NO_EXPIRY;
        const eb = b.expiresAt ?? NO_EXPIRY;
        if (ea !== eb) return ea < eb ? -1 : 1;
      }
      if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const alloc: LotAllocEntry[] = [];
  let left = qty;
  for (const batch of queue) {
    if (left <= 0) break;
    const take = Math.min(left, batch.qtyLeft);
    alloc.push({ batchId: batch.id, qty: take });
    left -= take;
  }
  return { alloc, shortfall: left };
}
