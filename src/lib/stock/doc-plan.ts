// PURPOSE: ЧИСТЫЙ планировщик движений документа — «какие ноги породит эта
// шапка и эти строки». Ни db, ни Next: только правила §3 (авторитет мест) и
// §4.5 (парные ноги). Тесты — scripts/test-stock-doc-plan.ts.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Релиз 1 строил движения прямо внутри postDoc: одна
// строка = одно движение. Релиз 2 добавляет документы, где строка порождает
// ДВЕ ноги (перемещение own → transit) или ноги РАЗНОГО СМЫСЛА (приёмка с
// недостачей: часть ушла маркетплейсу, часть — в потери). Ошибка в этой
// раскладке не падает — она молча создаёт или съедает стоимость. Поэтому
// решение «сколько ног, куда, с каким counter_place и кто чья пара» вынесено в
// функцию без побочных эффектов и покрыто тестами до всякого SQL.
//
// ГЛАВНОЕ ПРАВИЛО (§3): stock_moves.place_id ВСЕГДА указывает на место с
// authority='ledger'. Отгрузка на склад Ozon (external) — это ОДНА расходная
// нога на своём месте с counter_place_id = ozon_fbo; положительной строки на
// стороне Ozon не бывает никогда, поэтому расходиться нечему.
//
// ВТОРОЕ ПРАВИЛО (§4.5): если приёмник — тоже ledger-место (own → transit_ozon),
// нога приходуется, и её стоимость ОБЯЗАНА равняться списанной. Планировщик
// лишь помечает пару (pairLegIndex → stock_moves.pair_move_id); саму сумму
// переносит реплей (replay-plan.ts, правило 4), потому что она известна только
// после пересчёта ленты.

import { StockError } from './errors';
import type { CostingDocKind, CostingReason, MoveDirection } from './costing';

/** Место в терминах планировщика (id + кто авторитет по остатку). */
export interface PlanPlace {
  id: string;
  code: string;
  authority: 'ledger' | 'external';
}

/** Строка документа — то, что ввёл человек. */
export interface PlanLine {
  lineNo: number;
  /** id строки в БД; планировщику не нужен, но удобно тащить сквозь. */
  lineId?: string;
  itemId: string;
  direction: MoveDirection;
  /** Всегда > 0. */
  qty: number;
  /**
   * `accept` — принято фактически (NULL = принято всё);
   * `adjust` — посчитанный факт (планировщик его не трогает).
   */
  countedQty?: number | null;
  /** `regrade`: line_no расходной строки, чью стоимость забирает эта приходная. */
  pairLineNo?: number | null;
}

/** Шапка документа с уже разрезолвленными местами. */
export interface PlanDoc {
  kind: CostingDocKind;
  reason?: CostingReason | null;
  /** stock_docs.from_place_id (null — не задано). */
  fromPlace: PlanPlace | null;
  /** stock_docs.to_place_id (null — не задано). */
  toPlace: PlanPlace | null;
  /** Место по умолчанию — свой склад. */
  ownPlace: PlanPlace;
  /** Приёмник потерь (виртуальное место `loss`). */
  lossPlace: PlanPlace;
}

export interface PlannedLeg {
  lineNo: number;
  lineId?: string;
  itemId: string;
  direction: MoveDirection;
  /** Всегда > 0; знак движения задаёт direction. */
  qty: number;
  /** stock_moves.place_id — ВСЕГДА ledger-место. */
  placeId: string;
  /** stock_moves.counter_place_id — вторая сторона (может быть external). */
  counterPlaceId: string | null;
  /**
   * stock_moves.kind. Обычно равен kind документа, НО у ноги недостачи приёмки
   * это 'writeoff' + reason='mp_shortage': иначе «сколько съел маркетплейс»
   * растворилось бы в себестоимости, а §1.8 требует отдельной статьи.
   */
  kind: CostingDocKind;
  reason: CostingReason | null;
  /**
   * Индекс расходной ноги-донора В ЭТОМ ЖЕ массиве (только у приходной ноги
   * пары). Всегда меньше собственного индекса: расходная нога обязана быть
   * проведена раньше, иначе реплей не найдёт её пересчитанную стоимость.
   */
  pairLegIndex: number | null;
  /**
   * Списывать ли штуки из партий (FEFO/FIFO). false у пары «расход+приход по
   * ОДНОМУ товару» (перемещение между ledger-местами): пул товара не меняется,
   * а партии не привязаны к месту — тронуть их значило бы сломать инвариант
   * §4.8.4 «Σ batches.qty_left == qty_pool».
   */
  touchesBatches: boolean;
}

/** Виды, у которых все строки — расход (UI может прислать direction явно). */
const OUTBOUND_KINDS: readonly CostingDocKind[] = [
  'writeoff',
  'transfer',
  'accept',
  'sale',
];

/** Направление строки по умолчанию для типа документа. */
export function defaultDirectionFor(kind: CostingDocKind): MoveDirection {
  return OUTBOUND_KINDS.includes(kind) ? 'out' : 'in';
}

function assertLedger(place: PlanPlace, what: string): PlanPlace {
  if (place.authority !== 'ledger') {
    throw new StockError(
      'bad_request',
      `${what}: место «${place.code}» ведёт остаток маркетплейс — журнальных строк ` +
        'по нему не бывает (§3). Такое место можно указать только как приёмник ' +
        'отгрузки, а не как источник.',
    );
  }
  return place;
}

/**
 * Раскладка документа на движения. Бросает StockError с текстом для человека:
 * тип документа, у которого нет мест или сходятся источник с приёмником, —
 * это ошибка ввода, а не «пустой результат».
 */
export function planDocLegs(doc: PlanDoc, lines: readonly PlanLine[]): PlannedLeg[] {
  if (lines.length === 0) {
    throw new StockError('bad_request', 'В документе нет строк — проводить нечего');
  }
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new StockError(
        'bad_request',
        `Строка ${line.lineNo}: количество должно быть целым больше нуля`,
      );
    }
  }

  switch (doc.kind) {
    case 'transfer':
      return planTransfer(doc, lines);
    case 'accept':
      return planAccept(doc, lines);
    case 'regrade':
      return planRegrade(doc, lines);
    default:
      return planOneSided(doc, lines);
  }
}

// ---------------------------------------------------------------------------
// Односторонние документы (Релиз 1) — поведение сохранено 1:1
// ---------------------------------------------------------------------------

/**
 * opening / purchase / return_in / writeoff / adjust / sale.
 * Каждая строка = одна нога. Приход ложится на to_place (по умолчанию свой
 * склад), расход снимается с from_place. Стоимость приходной ноги — landed-сумма
 * строки, расходной — доля от остаточной стоимости пула (её считает реплей).
 */
function planOneSided(doc: PlanDoc, lines: readonly PlanLine[]): PlannedLeg[] {
  const inPlace = assertLedger(doc.toPlace ?? doc.ownPlace, 'Приёмник документа');
  const outPlace = assertLedger(doc.fromPlace ?? doc.ownPlace, 'Источник документа');

  return lines.map((line) => {
    const isIn = line.direction === 'in';
    const placeId = isIn ? inPlace.id : outPlace.id;
    // Потери всегда уходят в виртуальное место `loss` — по нему потом видно
    // суммой, сколько денег утекло списаниями (§1.8). Для остальных видов
    // вторая сторона — то, что указал пользователь (может быть external).
    const counterRaw = isIn
      ? (doc.fromPlace?.id ?? null)
      : doc.kind === 'writeoff'
        ? doc.lossPlace.id
        : (doc.toPlace?.id ?? null);
    return {
      lineNo: line.lineNo,
      lineId: line.lineId,
      itemId: line.itemId,
      direction: line.direction,
      qty: line.qty,
      placeId,
      counterPlaceId: counterRaw === placeId ? null : counterRaw,
      kind: doc.kind,
      reason: doc.reason ?? null,
      pairLegIndex: null,
      touchesBatches: true,
    };
  });
}

// ---------------------------------------------------------------------------
// transfer — перемещение (Релиз 2)
// ---------------------------------------------------------------------------

/**
 * Перемещение между местами. Две ситуации, и разница между ними —
 * содержательная, а не техническая:
 *
 *   own → transit_ozon (ledger → ledger): ДВЕ ноги. Стоимость переезжает
 *     внутри пула, Σ value_delta документа == 0 — товар сменил место, а не
 *     подешевел (инвариант §1, тест test-stock-doc-plan).
 *
 *   own → ozon_fbo (ledger → external): ОДНА расходная нога с
 *     counter_place_id = ozon_fbo. Остатки складов Ozon мы не ведём (§1.2),
 *     поэтому стоимость выходит из журнала — ровно как при продаже.
 */
function planTransfer(doc: PlanDoc, lines: readonly PlanLine[]): PlannedLeg[] {
  const from = assertLedger(doc.fromPlace ?? doc.ownPlace, 'Откуда перемещаем');
  const to = doc.toPlace;
  if (!to) {
    throw new StockError(
      'bad_request',
      'Перемещение без приёмника: укажите, куда уходит товар (например «В пути на Ozon»)',
    );
  }
  if (to.id === from.id) {
    throw new StockError(
      'bad_request',
      `Перемещение из «${from.code}» в «${to.code}»: источник и приёмник совпадают`,
    );
  }

  const legs: PlannedLeg[] = [];
  for (const line of lines) {
    if (line.direction !== 'out') {
      throw new StockError(
        'bad_request',
        `Строка ${line.lineNo}: в перемещении все строки расходные — приходную ногу ` +
          'создаёт сервер, чтобы она получила РОВНО списанную стоимость',
      );
    }
    const paired = to.authority === 'ledger';
    const outIndex = legs.length;
    legs.push({
      lineNo: line.lineNo,
      lineId: line.lineId,
      itemId: line.itemId,
      direction: 'out',
      qty: line.qty,
      placeId: from.id,
      counterPlaceId: to.id,
      kind: 'transfer',
      reason: doc.reason ?? null,
      pairLegIndex: null,
      // Пул товара при ledger → ledger не меняется, значит и партии не трогаем:
      // они не привязаны к месту, и списание сломало бы Σ qty_left == qty_pool.
      touchesBatches: !paired,
    });
    if (paired) {
      legs.push({
        lineNo: line.lineNo,
        lineId: line.lineId,
        itemId: line.itemId,
        direction: 'in',
        qty: line.qty,
        placeId: to.id,
        counterPlaceId: from.id,
        kind: 'transfer',
        reason: doc.reason ?? null,
        pairLegIndex: outIndex,
        touchesBatches: false,
      });
    }
  }
  return legs;
}

// ---------------------------------------------------------------------------
// accept — приёмка на складе маркетплейса (Релиз 2)
// ---------------------------------------------------------------------------

/**
 * Приёмка: `qty` — сколько отгружено (лежит в пути), `counted_qty` — сколько
 * маркетплейс принял фактически. Разница НЕ растворяется в средней, а уходит
 * ногой потерь reason='mp_shortage' в место `loss` — через год видно суммой,
 * сколько товара съел маркетплейс (§5, §1.8).
 *
 * Если приёмник — ledger-место (например приёмка обратно на свой склад),
 * принятая часть получает парную приходную ногу; если external (ozon_fbo) —
 * только расход, как при любой отгрузке на склад Ozon.
 */
function planAccept(doc: PlanDoc, lines: readonly PlanLine[]): PlannedLeg[] {
  const from = assertLedger(
    doc.fromPlace ?? doc.ownPlace,
    'Откуда принимаем (место «в пути»)',
  );
  const to = doc.toPlace;
  if (!to) {
    throw new StockError(
      'bad_request',
      'Приёмка без приёмника: укажите склад маркетплейса, который принял товар',
    );
  }
  if (to.id === from.id) {
    throw new StockError(
      'bad_request',
      `Приёмка из «${from.code}» в «${to.code}»: источник и приёмник совпадают`,
    );
  }

  const legs: PlannedLeg[] = [];
  for (const line of lines) {
    if (line.direction !== 'out') {
      throw new StockError(
        'bad_request',
        `Строка ${line.lineNo}: в приёмке все строки расходные (списываются с «в пути»)`,
      );
    }
    const accepted = line.countedQty == null ? line.qty : Math.trunc(line.countedQty);
    if (accepted < 0) {
      throw new StockError(
        'bad_request',
        `Строка ${line.lineNo}: принято не может быть отрицательным`,
      );
    }
    if (accepted > line.qty) {
      throw new StockError(
        'bad_request',
        `Строка ${line.lineNo}: принято ${accepted} шт при отгруженных ${line.qty} шт. ` +
          'Излишек приёмкой не оформляют — проведите отдельное перемещение или ' +
          'инвентаризацию, иначе в журнале появятся штуки из ниоткуда.',
      );
    }
    const shortage = line.qty - accepted;
    const paired = to.authority === 'ledger';

    if (accepted > 0) {
      const outIndex = legs.length;
      legs.push({
        lineNo: line.lineNo,
        lineId: line.lineId,
        itemId: line.itemId,
        direction: 'out',
        qty: accepted,
        placeId: from.id,
        counterPlaceId: to.id,
        kind: 'accept',
        reason: doc.reason ?? null,
        pairLegIndex: null,
        touchesBatches: !paired,
      });
      if (paired) {
        legs.push({
          lineNo: line.lineNo,
          lineId: line.lineId,
          itemId: line.itemId,
          direction: 'in',
          qty: accepted,
          placeId: to.id,
          counterPlaceId: from.id,
          kind: 'accept',
          reason: doc.reason ?? null,
          pairLegIndex: outIndex,
          touchesBatches: false,
        });
      }
    }

    if (shortage > 0) {
      legs.push({
        lineNo: line.lineNo,
        lineId: line.lineId,
        itemId: line.itemId,
        direction: 'out',
        qty: shortage,
        placeId: from.id,
        counterPlaceId: doc.lossPlace.id,
        // Именно 'writeoff', а не 'accept': нога недостачи обязана попасть в
        // статью потерь, а не в себестоимость проданного (§1.8).
        kind: 'writeoff',
        reason: 'mp_shortage',
        pairLegIndex: null,
        touchesBatches: true,
      });
    }
  }
  return legs;
}

// ---------------------------------------------------------------------------
// regrade — пересортица (Релиз 2)
// ---------------------------------------------------------------------------

/**
 * Пересортица: один документ, расходная строка по товару A и приходная по
 * товару B. Приходная получает РОВНО ту стоимость, что списана с A, поэтому
 * пересорт не создаёт и не съедает прибыль (§4.5, Σ value_delta == 0).
 *
 * Сопоставление строк — строго 1:1 (`pair_line_no`, а при его отсутствии —
 * по порядку). Долевого распределения одной расходной строки на несколько
 * приходных здесь СОЗНАТЕЛЬНО нет: любое распределение — это округления, а
 * округления в пересортице означают копейки, взявшиеся из воздуха. Разные
 * количества по сторонам — это уже переупаковка (документ `assembly`,
 * не входит в Релиз 2), а не пересорт.
 */
function planRegrade(doc: PlanDoc, lines: readonly PlanLine[]): PlannedLeg[] {
  if (doc.fromPlace && doc.toPlace && doc.fromPlace.id !== doc.toPlace.id) {
    throw new StockError(
      'bad_request',
      'Пересортица происходит в одном месте: источник и приёмник должны совпадать. ' +
        'Если товар одновременно переезжает — оформите отдельное перемещение.',
    );
  }
  const place = assertLedger(
    doc.fromPlace ?? doc.toPlace ?? doc.ownPlace,
    'Место пересортицы',
  );

  const outs = lines.filter((l) => l.direction === 'out');
  const ins = lines.filter((l) => l.direction === 'in');
  if (outs.length === 0 || ins.length === 0) {
    throw new StockError(
      'bad_request',
      'Пересортица — это две стороны: строка списания (что было) и строка ' +
        'оприходования (что оказалось на самом деле)',
    );
  }
  if (outs.length !== ins.length) {
    throw new StockError(
      'bad_request',
      `Пересортица: ${outs.length} строк списания и ${ins.length} строк оприходования. ` +
        'Стороны сопоставляются 1:1 — стоимость переносится целиком, без дробления.',
    );
  }

  const outByLineNo = new Map(outs.map((l) => [l.lineNo, l]));
  const usedOut = new Set<number>();
  const pairs: Array<{ out: PlanLine; in: PlanLine }> = [];

  const explicit = ins.some((l) => l.pairLineNo != null);
  ins.forEach((inLine, i) => {
    let outLine: PlanLine | undefined;
    if (explicit) {
      if (inLine.pairLineNo == null) {
        throw new StockError(
          'bad_request',
          `Строка ${inLine.lineNo}: не указано, какую строку списания она замещает`,
        );
      }
      outLine = outByLineNo.get(inLine.pairLineNo);
      if (!outLine) {
        throw new StockError(
          'bad_request',
          `Строка ${inLine.lineNo}: строка списания №${inLine.pairLineNo} не найдена`,
        );
      }
    } else {
      // Неявное сопоставление по порядку: 1-я приходная ↔ 1-я расходная.
      outLine = outs[i];
    }
    if (usedOut.has(outLine.lineNo)) {
      throw new StockError(
        'bad_request',
        `Строка списания №${outLine.lineNo} указана как пара дважды: сопоставление ` +
          'строго 1:1, иначе стоимость пришлось бы делить с округлением',
      );
    }
    if (outLine.qty !== inLine.qty) {
      throw new StockError(
        'bad_request',
        `Пересортица строк ${outLine.lineNo} → ${inLine.lineNo}: ${outLine.qty} шт ` +
          `превращаются в ${inLine.qty} шт. Количество обязано совпадать — иначе это ` +
          'переупаковка (документ «сборка», не входит в Релиз 2), а не пересорт.',
      );
    }
    if (outLine.itemId === inLine.itemId) {
      throw new StockError(
        'bad_request',
        `Пересортица строк ${outLine.lineNo} → ${inLine.lineNo}: это один и тот же ` +
          'товар — пересортица бы ничего не изменила',
      );
    }
    usedOut.add(outLine.lineNo);
    pairs.push({ out: outLine, in: inLine });
  });

  // Сначала ВСЕ расходные ноги, потом приходные: приходная обязана получить
  // seq больше своей пары, иначе реплей (порядок doc_date, seq) дойдёт до неё
  // раньше, чем узнает стоимость донора.
  const legs: PlannedLeg[] = [];
  const outIndexByLineNo = new Map<number, number>();
  for (const pair of pairs) {
    outIndexByLineNo.set(pair.out.lineNo, legs.length);
    legs.push({
      lineNo: pair.out.lineNo,
      lineId: pair.out.lineId,
      itemId: pair.out.itemId,
      direction: 'out',
      qty: pair.out.qty,
      placeId: place.id,
      counterPlaceId: null,
      kind: 'regrade',
      reason: doc.reason ?? null,
      pairLegIndex: null,
      // Пул товара A уменьшается по-настоящему → партии A списываются.
      touchesBatches: true,
    });
  }
  for (const pair of pairs) {
    legs.push({
      lineNo: pair.in.lineNo,
      lineId: pair.in.lineId,
      itemId: pair.in.itemId,
      direction: 'in',
      qty: pair.in.qty,
      placeId: place.id,
      counterPlaceId: null,
      kind: 'regrade',
      reason: doc.reason ?? null,
      pairLegIndex: outIndexByLineNo.get(pair.out.lineNo) ?? null,
      // Партию товару B заводит postDoc по приходной СТРОКЕ (её стоимость
      // проставляется после реплея), поэтому нога партии не трогает.
      touchesBatches: false,
    });
  }
  return legs;
}
