// PURPOSE: ЗАПИСЬ модуля «Склад · Поставки · Себестоимость» — черновики, проводка,
// сторно и пересчёт себестоимости. Канон — docs/STOCK_MODULE_DESIGN.md §1 (инварианты),
// §4 (модель себестоимости), §4.7 (ввод задним числом и блокировка периода).
// Чтение — соседний queries.ts, чистая арифметика — costing.ts.
//
// ЖЁСТКИЕ ПРАВИЛА ЭТОГО ФАЙЛА:
//   1. postDoc / voidDoc / recalcFrom работают СТРОГО В ОДНОЙ ТРАНЗАКЦИИ.
//      Полупроведённый документ (движения есть, кэш не пересчитан) — это тихо
//      неверные «Деньги в товаре» на годы вперёд.
//   2. Физического удаления проведённого НЕТ (§1.4): только void → сторно.
//      DELETE разрешён лишь для draft — у него нет движений.
//   3. Арифметика НЕ дублируется в SQL. Любая копейка считается функциями
//      costing.ts (applyEvent / computeDocTotals / allocateLots), покрытыми
//      98 тестами scripts/test-stock-costing.ts. SQL здесь только двигает строки.
//   4. Кэш stock_items (qty_pool / value_pool / avg_cost / basis) ВСЕГДА пишется
//      из результата реплея (poolToCache), а не инкрементально «на лету».
//   5. tenantId только из сессии; каждый UPDATE/DELETE содержит tenant_id.
//
// ПОЧЕМУ ПОЛНЫЙ РЕПЛЕЙ, А НЕ ИНКРЕМЕНТ: «липкая» средняя при пустом пуле,
// цена последней закупки и базис НДС (§12.2) не восстанавливаются из SUM() —
// они зависят от ПОРЯДКА событий. Единственный способ получить те же числа при
// вводе задним числом (инвариант §4.8.7 «повторный реплей побайтово равен») —
// переиграть ленту товара с начала. Поэтому recalcFrom(fromDate) использует
// дату только для сообщения пользователю, а считает всегда с начала журнала.

import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db/client';
import { stockItems, stockPlaces } from '@/lib/db/schema/stock';
import {
  stockBatches,
  stockDocLines,
  stockDocs,
  stockMoves,
  type StockDocKind,
  type StockDocReason,
  type StockExtraAlloc,
  type StockLineDirection,
  type StockLotAllocEntry,
} from '@/lib/db/schema/stock-ledger';
import {
  allocateLots,
  computeDocTotals,
  createPool,
  divRound,
  poolToCache,
  type CostBasis,
  type CostingWarning,
  type DocLineInput,
  type PoolState,
} from './costing';
import { replayLedgerMulti, type LedgerMoveRow } from './replay-plan';
import {
  defaultDirectionFor,
  planDocLegs,
  type PlanLine,
  type PlanPlace,
  type PlannedLeg,
} from './doc-plan';
import { LOSS_PLACE_CODE, OWN_PLACE_CODE } from './places';
import { getStockSettings, type StockCtx, type StockDb } from './queries';
import { applyCostWriteback } from './writeback';
import { StockError } from './errors';

// Ошибка живёт в отдельном errors.ts (её бросают и чистые модули), но исторически
// импортируется отсюда — ре-экспорт держит старые импорты рабочими.
export { StockError } from './errors';
export type { StockErrorCode } from './errors';

// ---------------------------------------------------------------------------
// Что умеет проводить движок
// ---------------------------------------------------------------------------

/**
 * Все виды документов проводятся с Релиза 2: односторонние (Релиз 1) и
 * с ПАРНЫМИ ногами — transfer / accept / regrade, где приходная нога получает
 * РОВНО ту стоимость, что списана с расходной (§4.5). Раскладку документа на
 * ноги считает чистый planDocLegs() (doc-plan.ts), перенос стоимости —
 * правило 4 реплея (replay-plan.ts).
 */
const POSTABLE_KINDS: readonly StockDocKind[] = [
  'opening',
  'purchase',
  'return_in',
  'writeoff',
  'adjust',
  'sale',
  'transfer',
  'accept',
  'regrade',
];

function assertPostableKind(kind: StockDocKind): void {
  if (POSTABLE_KINDS.includes(kind)) return;
  throw new StockError('bad_request', `Неизвестный тип документа: ${kind}`);
}

// ---------------------------------------------------------------------------
// Ввод документа
// ---------------------------------------------------------------------------

export interface DocLinePayload {
  itemId: string;
  direction?: StockLineDirection;
  qty: number;
  /** Цена как в накладной, КОПЕЙКИ (UI умножает рубли на 100). */
  unitPriceKopecks?: number;
  /** Базисные пункты: 500 = 5 %. */
  vatRateBp?: number;
  batchNumber?: string | null;
  expiresAt?: string | null;
  /** «Цена по памяти» — тянется в партию и подсвечивается в отчётах (§8 шаг 4). */
  isEstimated?: boolean;
  /**
   * `adjust` — фактически пересчитанный остаток;
   * `accept` — сколько маркетплейс принял ФАКТИЧЕСКИ (при qty = сколько
   * отгружено). Разница уходит отдельной ногой потерь reason='mp_shortage'.
   */
  countedQty?: number | null;
  /** `regrade`: номер расходной строки, чью стоимость забирает эта приходная. */
  pairLineNo?: number | null;
  comment?: string | null;
}

export interface DocPayload {
  kind: StockDocKind;
  /** 'YYYY-MM-DD'. Единственное обязательное поле формы (§2.4). */
  docDate: string;
  supplier?: string;
  supplierInn?: string | null;
  docNumber?: string | null;
  /** Код места-источника (расход). По умолчанию — свой склад. */
  fromPlaceCode?: string | null;
  /** Код места-приёмника (приход). По умолчанию — свой склад. */
  toPlaceCode?: string | null;
  currency?: string;
  priceIncludesVat?: boolean;
  /** §12.2: базис ЭТОГО документа. Если не задан — дефолт из настроек. */
  costBasis?: CostBasis;
  extraCostKopecks?: number;
  extraAlloc?: StockExtraAlloc;
  reason?: StockDocReason | null;
  source?: string;
  sourceRef?: string | null;
  comment?: string | null;
  lines: DocLinePayload[];
}

/**
 * Направление строки по умолчанию для типа документа. Расход — у списания,
 * продажи, перемещения и приёмки: во всех четырёх пользователь вводит «что
 * ушло», а приходную ногу (если она есть) создаёт сервер.
 */
function defaultDirection(kind: StockDocKind): StockLineDirection {
  return defaultDirectionFor(kind);
}

function normalizeLines(
  kind: StockDocKind,
  lines: DocLinePayload[],
): Array<Required<Pick<DocLinePayload, 'itemId' | 'qty'>> & {
  direction: StockLineDirection;
  unitPriceKopecks: number;
  vatRateBp: number;
  batchNumber: string | null;
  expiresAt: string | null;
  isEstimated: boolean;
  countedQty: number | null;
  pairLineNo: number | null;
  comment: string | null;
}> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new StockError('bad_request', 'В документе нет ни одной строки');
  }
  return lines.map((line, i) => {
    const qty = Math.trunc(Number(line.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new StockError(
        'bad_request',
        `Строка ${i + 1}: количество должно быть целым больше нуля`,
      );
    }
    if (!line.itemId) {
      throw new StockError('bad_request', `Строка ${i + 1}: не выбран товар`);
    }
    const price = Math.trunc(Number(line.unitPriceKopecks ?? 0));
    if (!Number.isFinite(price) || price < 0) {
      throw new StockError('bad_request', `Строка ${i + 1}: некорректная цена`);
    }
    return {
      itemId: line.itemId,
      direction: line.direction ?? defaultDirection(kind),
      qty,
      unitPriceKopecks: price,
      vatRateBp: Math.max(0, Math.trunc(Number(line.vatRateBp ?? 0))),
      batchNumber: line.batchNumber?.trim() || null,
      expiresAt: line.expiresAt || null,
      isEstimated: Boolean(line.isEstimated),
      countedQty:
        line.countedQty === null || line.countedQty === undefined
          ? null
          : Math.trunc(Number(line.countedQty)),
      pairLineNo:
        line.pairLineNo === null || line.pairLineNo === undefined
          ? null
          : Math.trunc(Number(line.pairLineNo)),
      comment: line.comment?.trim() || null,
    };
  });
}

async function resolvePlaceIdByCode(
  ctx: StockCtx,
  client: StockDb,
  code: string,
): Promise<PlanPlace> {
  const [place] = await client
    .select({
      id: stockPlaces.id,
      code: stockPlaces.code,
      authority: stockPlaces.authority,
    })
    .from(stockPlaces)
    .where(and(eq(stockPlaces.tenantId, ctx.tenantId), eq(stockPlaces.code, code)))
    .limit(1);
  if (!place) {
    throw new StockError(
      'bad_request',
      `Место «${code}» не найдено. Откройте раздел «Склад» — встроенные места создаются автоматически.`,
    );
  }
  return place;
}

/**
 * То же по id (шапка документа хранит id, а не код). tenant_id обязателен:
 * без него чужое место подставилось бы в наш документ по угаданному uuid.
 */
async function resolvePlaceById(
  ctx: StockCtx,
  client: StockDb,
  placeId: string,
): Promise<PlanPlace> {
  const [place] = await client
    .select({
      id: stockPlaces.id,
      code: stockPlaces.code,
      authority: stockPlaces.authority,
    })
    .from(stockPlaces)
    .where(and(eq(stockPlaces.tenantId, ctx.tenantId), eq(stockPlaces.id, placeId)))
    .limit(1);
  if (!place) {
    throw new StockError('bad_request', 'Место документа не найдено или удалено');
  }
  return place;
}

/**
 * Создаёт ЧЕРНОВИК документа со строками и посчитанными суммами.
 * Движений не порождает: черновик можно править и удалять (§1.4).
 */
export async function createDraftDoc(
  ctx: StockCtx,
  payload: DocPayload,
): Promise<{ docId: string }> {
  const lines = normalizeLines(payload.kind, payload.lines);
  return db.transaction(async (tx) => {
    const settings = await getStockSettings(ctx, tx);
    const costBasis: CostBasis = payload.costBasis ?? settings.costBasis;

    await assertItemsBelongToTenant(ctx, tx, lines.map((l) => l.itemId));

    const fromPlace = payload.fromPlaceCode
      ? await resolvePlaceIdByCode(ctx, tx, payload.fromPlaceCode)
      : null;
    const toPlace = payload.toPlaceCode
      ? await resolvePlaceIdByCode(ctx, tx, payload.toPlaceCode)
      : null;

    const costed = computeDocTotals(
      {
        priceIncludesVat: payload.priceIncludesVat ?? true,
        costBasis,
        extraCostKopecks: payload.extraCostKopecks ?? 0,
        extraAlloc: payload.extraAlloc ?? 'by_value',
      },
      lines.map<DocLineInput>((l, i) => ({
        lineNo: i + 1,
        qty: l.qty,
        unitPriceKopecks: l.unitPriceKopecks,
        vatRateBp: l.vatRateBp,
        direction: l.direction,
        isEstimated: l.isEstimated,
      })),
    );

    const [doc] = await tx
      .insert(stockDocs)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        kind: payload.kind,
        status: 'draft',
        docDate: payload.docDate,
        fromPlaceId: fromPlace?.id ?? null,
        toPlaceId: toPlace?.id ?? null,
        supplier: payload.supplier?.trim() ?? '',
        supplierInn: payload.supplierInn?.trim() || null,
        docNumber: payload.docNumber?.trim() || null,
        currency: payload.currency ?? 'RUB',
        priceIncludesVat: payload.priceIncludesVat ?? true,
        costBasis,
        extraCostKopecks: payload.extraCostKopecks ?? 0,
        extraAlloc: payload.extraAlloc ?? 'by_value',
        totalKopecks: costed.totalKopecks,
        vatTotalKopecks: costed.vatTotalKopecks,
        reason: payload.reason ?? null,
        source: payload.source ?? 'manual',
        sourceRef: payload.sourceRef?.trim() || null,
        comment: payload.comment?.trim() || null,
      })
      .returning({ id: stockDocs.id });

    await tx.insert(stockDocLines).values(
      lines.map((l, i) => ({
        tenantId: ctx.tenantId,
        docId: doc.id,
        lineNo: i + 1,
        itemId: l.itemId,
        direction: l.direction,
        qty: l.qty,
        unitPriceKopecks: l.unitPriceKopecks,
        vatRateBp: l.vatRateBp,
        vatKopecks: costed.lines[i].vatKopecks,
        extraAllocKopecks: costed.lines[i].extraAllocKopecks,
        valueKopecks: costed.lines[i].valueKopecks,
        batchNumber: l.batchNumber,
        expiresAt: l.expiresAt,
        isEstimated: l.isEstimated,
        countedQty: l.countedQty,
        pairLineNo: l.pairLineNo,
        comment: l.comment,
      })),
    );

    return { docId: doc.id };
  });
}

/** Полная замена черновика (шапка + строки). Проведённый документ не трогает. */
export async function updateDraftDoc(
  ctx: StockCtx,
  docId: string,
  payload: DocPayload,
): Promise<{ docId: string }> {
  const lines = normalizeLines(payload.kind, payload.lines);
  return db.transaction(async (tx) => {
    const doc = await lockDoc(ctx, tx, docId);
    if (doc.status !== 'draft') {
      throw new StockError(
        'wrong_status',
        'Проведённый документ править нельзя — сторнируйте его и введите новый (§1.4)',
      );
    }
    const settings = await getStockSettings(ctx, tx);
    const costBasis: CostBasis = payload.costBasis ?? settings.costBasis;
    await assertItemsBelongToTenant(ctx, tx, lines.map((l) => l.itemId));

    const fromPlace = payload.fromPlaceCode
      ? await resolvePlaceIdByCode(ctx, tx, payload.fromPlaceCode)
      : null;
    const toPlace = payload.toPlaceCode
      ? await resolvePlaceIdByCode(ctx, tx, payload.toPlaceCode)
      : null;

    const costed = computeDocTotals(
      {
        priceIncludesVat: payload.priceIncludesVat ?? true,
        costBasis,
        extraCostKopecks: payload.extraCostKopecks ?? 0,
        extraAlloc: payload.extraAlloc ?? 'by_value',
      },
      lines.map<DocLineInput>((l, i) => ({
        lineNo: i + 1,
        qty: l.qty,
        unitPriceKopecks: l.unitPriceKopecks,
        vatRateBp: l.vatRateBp,
        direction: l.direction,
        isEstimated: l.isEstimated,
      })),
    );

    await tx
      .update(stockDocs)
      .set({
        kind: payload.kind,
        docDate: payload.docDate,
        fromPlaceId: fromPlace?.id ?? null,
        toPlaceId: toPlace?.id ?? null,
        supplier: payload.supplier?.trim() ?? '',
        supplierInn: payload.supplierInn?.trim() || null,
        docNumber: payload.docNumber?.trim() || null,
        priceIncludesVat: payload.priceIncludesVat ?? true,
        costBasis,
        extraCostKopecks: payload.extraCostKopecks ?? 0,
        extraAlloc: payload.extraAlloc ?? 'by_value',
        totalKopecks: costed.totalKopecks,
        vatTotalKopecks: costed.vatTotalKopecks,
        reason: payload.reason ?? null,
        comment: payload.comment?.trim() || null,
        updatedAt: new Date(),
      })
      .where(and(eq(stockDocs.tenantId, ctx.tenantId), eq(stockDocs.id, docId)));

    await tx
      .delete(stockDocLines)
      .where(
        and(eq(stockDocLines.tenantId, ctx.tenantId), eq(stockDocLines.docId, docId)),
      );
    await tx.insert(stockDocLines).values(
      lines.map((l, i) => ({
        tenantId: ctx.tenantId,
        docId,
        lineNo: i + 1,
        itemId: l.itemId,
        direction: l.direction,
        qty: l.qty,
        unitPriceKopecks: l.unitPriceKopecks,
        vatRateBp: l.vatRateBp,
        vatKopecks: costed.lines[i].vatKopecks,
        extraAllocKopecks: costed.lines[i].extraAllocKopecks,
        valueKopecks: costed.lines[i].valueKopecks,
        batchNumber: l.batchNumber,
        expiresAt: l.expiresAt,
        isEstimated: l.isEstimated,
        countedQty: l.countedQty,
        pairLineNo: l.pairLineNo,
        comment: l.comment,
      })),
    );

    return { docId };
  });
}

/** DELETE разрешён ТОЛЬКО для черновика (§1.4) — у проведённого есть движения. */
export async function deleteDraftDoc(ctx: StockCtx, docId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const doc = await lockDoc(ctx, tx, docId);
    if (doc.status !== 'draft') {
      throw new StockError(
        'wrong_status',
        'Удалить можно только черновик. Проведённый документ сторнируется (void), ' +
          'иначе исчезнут движения, на которых стоит вся себестоимость.',
      );
    }
    // stock_doc_lines удаляются каскадом (FK on delete cascade).
    await tx
      .delete(stockDocs)
      .where(and(eq(stockDocs.tenantId, ctx.tenantId), eq(stockDocs.id, docId)));
  });
}

// ---------------------------------------------------------------------------
// Проводка
// ---------------------------------------------------------------------------

export interface PostDocResult {
  docId: string;
  number: string | null;
  movesCount: number;
  itemIds: string[];
  warnings: CostingWarning[];
  /** Товары, у которых writeback обновил себестоимость в unit_products. */
  writebackUpdated: number;
}

/**
 * Проводка документа — ОДНА транзакция, порядок шагов важен:
 *
 *   1. блокируем документ (FOR UPDATE) и проверяем статус/период;
 *   2. пересчитываем деньги строк через computeDocTotals (НДС + разнесение
 *      доп. расходов методом наибольших остатков);
 *   3. создаём партии по приходным строкам (носители штук, срока, базиса);
 *   4. вставляем движения с НУЛЕВОЙ стоимостью — им нужен только seq;
 *   5. раскладываем расход по партиям (FEFO/FIFO) → lot_alloc, qty_left;
 *   6. помечаем документ проведённым и присваиваем номер;
 *   7. ПОЛНЫЙ РЕПЛЕЙ затронутых товаров → он и проставляет реальные
 *      value_delta / unit_value / uncovered / deficit и кэш stock_items;
 *   8. writeback себестоимости в unit_products (только cost_source='inventory').
 *
 * Почему стоимость движений проставляет шаг 7, а не шаг 4: документ мог быть
 * введён ЗАДНИМ ЧИСЛОМ. Тогда пересчитать нужно не только его движения, но и
 * все последующие — а это ровно тот же реплей. Один код вместо двух ветвей,
 * которые обязаны совпадать до копейки.
 */
export async function postDoc(
  ctx: StockCtx,
  docId: string,
  opts: { skipWriteback?: boolean } = {},
): Promise<PostDocResult> {
  return db.transaction(async (tx) => {
    const doc = await lockDoc(ctx, tx, docId);
    if (doc.status === 'posted') {
      throw new StockError('wrong_status', 'Документ уже проведён');
    }
    if (doc.status === 'void') {
      throw new StockError('wrong_status', 'Документ сторнирован — проводить нечего');
    }
    assertPostableKind(doc.kind);

    const settings = await getStockSettings(ctx, tx);
    assertPeriodOpen(doc.docDate, settings.lockedThrough);

    const lines = await tx
      .select()
      .from(stockDocLines)
      .where(and(eq(stockDocLines.tenantId, ctx.tenantId), eq(stockDocLines.docId, docId)))
      .orderBy(asc(stockDocLines.lineNo));
    if (lines.length === 0) {
      throw new StockError('bad_request', 'В документе нет строк — проводить нечего');
    }

    // --- места и раскладка документа на ноги (чистый planDocLegs, §3/§4.5) ---
    const ownPlace = await resolvePlaceIdByCode(ctx, tx, OWN_PLACE_CODE);
    const lossPlace = await resolvePlaceIdByCode(ctx, tx, LOSS_PLACE_CODE);
    const fromPlace = doc.fromPlaceId
      ? await resolvePlaceById(ctx, tx, doc.fromPlaceId)
      : null;
    const toPlace = doc.toPlaceId ? await resolvePlaceById(ctx, tx, doc.toPlaceId) : null;

    const legs = planDocLegs(
      {
        kind: doc.kind,
        reason: doc.reason,
        fromPlace,
        toPlace,
        ownPlace,
        lossPlace,
      },
      lines.map<PlanLine>((l) => ({
        lineNo: l.lineNo,
        lineId: l.id,
        itemId: l.itemId,
        direction: l.direction,
        qty: l.qty,
        countedQty: l.countedQty,
        pairLineNo: l.pairLineNo,
      })),
    );

    // --- 2. деньги строк ---
    const costed = computeDocTotals(
      {
        priceIncludesVat: doc.priceIncludesVat,
        costBasis: doc.costBasis,
        extraCostKopecks: doc.extraCostKopecks,
        extraAlloc: doc.extraAlloc,
      },
      lines.map<DocLineInput>((l) => ({
        lineNo: l.lineNo,
        qty: l.qty,
        unitPriceKopecks: l.unitPriceKopecks,
        vatRateBp: l.vatRateBp,
        direction: l.direction,
        isEstimated: l.isEstimated,
      })),
    );

    for (let i = 0; i < lines.length; i += 1) {
      const c = costed.lines[i];
      await tx
        .update(stockDocLines)
        .set({
          vatKopecks: c.vatKopecks,
          extraAllocKopecks: c.extraAllocKopecks,
          valueKopecks: c.valueKopecks,
        })
        .where(
          and(
            eq(stockDocLines.tenantId, ctx.tenantId),
            eq(stockDocLines.id, lines[i].id),
          ),
        );
    }

    // --- 3. партии по приходным строкам ---
    const lotSeqStart = await nextLotSequence(ctx, tx, doc.docDate.slice(0, 4));
    let lotOffset = 0;
    const batchIdByLineId = new Map<string, string>();
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.direction !== 'in') continue;
      const value = costed.lines[i].valueKopecks;
      const [batch] = await tx
        .insert(stockBatches)
        .values({
          tenantId: ctx.tenantId,
          itemId: line.itemId,
          docId: doc.id,
          lineId: line.id,
          lotNo: `LOT-${doc.docDate.slice(0, 4)}-${String(lotSeqStart + lotOffset).padStart(4, '0')}`,
          batchNumber: line.batchNumber,
          supplier: doc.supplier,
          receivedAt: doc.docDate,
          expiresAt: line.expiresAt,
          qtyIn: line.qty,
          qtyLeft: line.qty,
          unitCostKopecks: line.qty > 0 ? Math.round(value / line.qty) : 0,
          valueInKopecks: value,
          vatKopecks: costed.lines[i].vatKopecks,
          // §12.2: базис фиксируется в момент прихода и больше не меняется.
          costBasis: doc.costBasis,
          isEstimated: line.isEstimated,
        })
        .returning({ id: stockBatches.id });
      batchIdByLineId.set(line.id, batch.id);
      lotOffset += 1;
    }

    // --- 4. движения (стоимость проставит реплей на шаге 7) ---
    // Порядок вставки = порядок ног из планировщика, а он гарантирует, что
    // расходная нога пары идёт РАНЬШЕ приходной. seq (identity) наследует этот
    // порядок, и реплей находит донора уже посчитанным (правило 4).
    const movedIds: string[] = [];
    for (let i = 0; i < legs.length; i += 1) {
      const leg = legs[i];
      const pairMoveId =
        leg.pairLegIndex != null ? (movedIds[leg.pairLegIndex] ?? null) : null;
      if (leg.pairLegIndex != null && !pairMoveId) {
        // Планировщик обязан ссылаться только назад; если это не так —
        // ошибка кода, а не ввода: без пары приходная нога не знает стоимости.
        throw new StockError(
          'bad_request',
          `Строка ${leg.lineNo}: расходная нога пары не найдена — документ не проведён`,
        );
      }
      const [move] = await tx
        .insert(stockMoves)
        .values({
          tenantId: ctx.tenantId,
          docId: doc.id,
          lineId: leg.lineId ?? null,
          itemId: leg.itemId,
          placeId: leg.placeId,
          counterPlaceId:
            leg.counterPlaceId === leg.placeId ? null : (leg.counterPlaceId ?? null),
          qtyDelta: leg.direction === 'in' ? leg.qty : -leg.qty,
          valueDeltaKopecks: 0,
          unitValueKopecks: 0,
          kind: leg.kind,
          reason: leg.reason,
          docDate: doc.docDate,
          pairMoveId,
        })
        .returning({ id: stockMoves.id });
      movedIds.push(move.id);
    }

    // --- 5. FEFO/FIFO-раскладка расходных ног по партиям ---
    // Только ноги, реально уменьшающие ПУЛ товара (leg.touchesBatches).
    // Перемещение между ledger-местами пул не меняет, а партии к месту не
    // привязаны — тронуть их значило бы сломать «Σ qty_left == qty_pool» (§4.8.4).
    for (let i = 0; i < legs.length; i += 1) {
      const leg = legs[i];
      if (leg.direction !== 'out' || !leg.touchesBatches) continue;
      const open = await tx
        .select({
          id: stockBatches.id,
          receivedAt: stockBatches.receivedAt,
          expiresAt: stockBatches.expiresAt,
          qtyLeft: stockBatches.qtyLeft,
        })
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.tenantId, ctx.tenantId),
            eq(stockBatches.itemId, leg.itemId),
            sql`${stockBatches.qtyLeft} > 0`,
          ),
        );
      const { alloc } = allocateLots(open, leg.qty, settings.lotPolicy);
      for (const a of alloc) {
        await tx
          .update(stockBatches)
          .set({
            qtyLeft: sql`${stockBatches.qtyLeft} - ${a.qty}`,
            closedAt: sql`CASE WHEN ${stockBatches.qtyLeft} - ${a.qty} <= 0 THEN now() ELSE NULL END`,
            updatedAt: new Date(),
          })
          .where(
            and(eq(stockBatches.tenantId, ctx.tenantId), eq(stockBatches.id, a.batchId)),
          );
      }
      if (alloc.length > 0) {
        await tx
          .update(stockMoves)
          .set({ lotAlloc: alloc as StockLotAllocEntry[] })
          .where(and(eq(stockMoves.tenantId, ctx.tenantId), eq(stockMoves.id, movedIds[i])));
      }
    }

    // --- 6. статус и номер ---
    const number = doc.number ?? (await generateDocNumber(ctx, tx, doc.kind, doc.docDate));
    await tx
      .update(stockDocs)
      .set({
        status: 'posted',
        number,
        postedAt: new Date(),
        totalKopecks: costed.totalKopecks,
        vatTotalKopecks: costed.vatTotalKopecks,
        updatedAt: new Date(),
      })
      .where(and(eq(stockDocs.tenantId, ctx.tenantId), eq(stockDocs.id, docId)));

    // --- 7. реплей затронутых товаров ---
    const itemIds = Array.from(new Set(legs.map((l) => l.itemId)));
    const replay = await recalcItemsInTx(ctx, tx, itemIds);

    // --- 7b. партии приходной стороны пересортицы ---
    // Стоимость такой партии известна ТОЛЬКО после реплея (её приносит
    // расходная нога товара-донора), поэтому шаг 3 завёл её с нулевой суммой.
    // Без этой правки «история цен» товара B показывала бы 0 ₽ за партию,
    // хотя в пуле стоимость есть — расхождение витрины и журнала.
    const transferred = await syncPairedBatchValues(
      ctx,
      tx,
      doc.id,
      legs,
      movedIds,
      new Set(lines.filter((l) => l.direction === 'in').map((l) => l.id)),
    );
    if (transferred > 0) {
      // Σ строк == total документа (§4.8.3) обязана держаться и здесь: у
      // пересортицы «сумма документа» — это сколько стоимости переехало.
      await tx
        .update(stockDocs)
        .set({ totalKopecks: transferred, updatedAt: new Date() })
        .where(and(eq(stockDocs.tenantId, ctx.tenantId), eq(stockDocs.id, docId)));
    }

    // --- 8. writeback себестоимости в unit_products ---
    // Writeback по ЗАМЫКАНИЮ пересчёта, а не по строкам документа: цепочка
    // пересортиц могла втянуть соседний товар, и его цена в unit_products
    // осталась бы прежней.
    const writeback = opts.skipWriteback
      ? { updated: 0 }
      : await applyCostWriteback(ctx, tx, replay.itemIds);

    return {
      docId,
      number,
      movesCount: movedIds.length,
      itemIds,
      warnings: replay.warnings,
      writebackUpdated: writeback.updated,
    };
  });
}

/**
 * Проставляет партиям приходной стороны `regrade` фактически перенесённую
 * стоимость (после реплея). Партии в режиме avg — носитель штук, срока и
 * ИСТОРИИ ЦЕН; оценка живёт на пуле, поэтому эта правка ничего не пересчитывает,
 * а только выравнивает витрину с журналом.
 */
async function syncPairedBatchValues(
  ctx: StockCtx,
  tx: StockDb,
  docId: string,
  legs: readonly PlannedLeg[],
  moveIds: readonly string[],
  inLineIds: ReadonlySet<string>,
): Promise<number> {
  let transferred = 0;
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (leg.direction !== 'in' || leg.pairLegIndex == null || !leg.lineId) continue;
    // Только приходные СТРОКИ (пересортица). У перемещения/приёмки приходную
    // ногу порождает расходная строка — её value_kopecks трогать нельзя.
    if (!inLineIds.has(leg.lineId)) continue;
    const [move] = await tx
      .select({ value: stockMoves.valueDeltaKopecks })
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, ctx.tenantId), eq(stockMoves.id, moveIds[i])))
      .limit(1);
    if (!move) continue;
    const value = Number(move.value);
    transferred += value;
    await tx
      .update(stockBatches)
      .set({
        valueInKopecks: value,
        unitCostKopecks: leg.qty > 0 ? divRound(value, leg.qty) : 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stockBatches.tenantId, ctx.tenantId),
          eq(stockBatches.docId, docId),
          eq(stockBatches.lineId, leg.lineId),
        ),
      );
    // Строка документа тоже получает фактическую сумму: в карточке документа
    // пересортица обязана показывать, СКОЛЬКО денег переехало.
    await tx
      .update(stockDocLines)
      .set({ valueKopecks: value })
      .where(
        and(eq(stockDocLines.tenantId, ctx.tenantId), eq(stockDocLines.id, leg.lineId)),
      );
  }
  return transferred;
}

// ---------------------------------------------------------------------------
// Сторно
// ---------------------------------------------------------------------------

export interface VoidDocResult {
  docId: string;
  reversalDocId: string;
  movesCount: number;
  itemIds: string[];
  warnings: CostingWarning[];
  writebackUpdated: number;
}

/**
 * Сторно проведённого документа (§1.4): оригинал НЕ удаляется и не правится,
 * создаётся зеркальный документ со сторно-движениями. Инвариант §4.8.8:
 * Σ value_delta оригинала + сторно == 0 — он держится не «по договорённости»,
 * а потому что реплей выводит стоимость сторно-движения из ПЕРЕСЧИТАННОЙ
 * стоимости оригинала (см. replayItemsLedger), а не из снимка на диске.
 *
 * Сторно проводится ТОЙ ЖЕ ДАТОЙ, что оригинал: иначе «Закуплено за март»
 * осталось бы завышенным навсегда. Если период закрыт — 403 с текстом,
 * предлагающим корректирующий документ текущей датой (§4.7).
 */
export async function voidDoc(
  ctx: StockCtx,
  docId: string,
  opts: { skipWriteback?: boolean } = {},
): Promise<VoidDocResult> {
  return db.transaction(async (tx) => {
    const doc = await lockDoc(ctx, tx, docId);
    if (doc.status !== 'posted') {
      throw new StockError(
        'wrong_status',
        doc.status === 'draft'
          ? 'Черновик не сторнируют — его можно просто удалить'
          : 'Документ уже сторнирован',
      );
    }
    const settings = await getStockSettings(ctx, tx);
    assertPeriodOpen(doc.docDate, settings.lockedThrough);

    const moves = await tx
      .select()
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, ctx.tenantId), eq(stockMoves.docId, docId)))
      .orderBy(asc(stockMoves.seq));
    if (moves.length === 0) {
      throw new StockError(
        'bad_request',
        'У проведённого документа нет движений — сторнировать нечего (данные повреждены)',
      );
    }

    const [reversal] = await tx
      .insert(stockDocs)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        kind: doc.kind,
        status: 'posted',
        // Номер оригинала уникален, поэтому суффикс тоже уникален.
        number: doc.number ? `${doc.number}/СТОРНО` : null,
        docDate: doc.docDate,
        postedAt: new Date(),
        fromPlaceId: doc.toPlaceId,
        toPlaceId: doc.fromPlaceId,
        supplier: doc.supplier,
        docNumber: doc.docNumber,
        currency: doc.currency,
        priceIncludesVat: doc.priceIncludesVat,
        costBasis: doc.costBasis,
        totalKopecks: -doc.totalKopecks,
        vatTotalKopecks: -doc.vatTotalKopecks,
        reason: doc.reason,
        reversesDocId: doc.id,
        source: doc.source,
        // source_ref НЕ копируется: он ключ идемпотентности импорта (§4.8.9),
        // и дубль сломал бы частичный уникальный индекс stock_docs_source_idx.
        sourceRef: null,
        comment: `Сторно документа ${doc.number ?? doc.id}`,
      })
      .returning({ id: stockDocs.id });

    for (const m of moves) {
      await tx.insert(stockMoves).values({
        tenantId: ctx.tenantId,
        docId: reversal.id,
        lineId: null,
        itemId: m.itemId,
        placeId: m.placeId,
        counterPlaceId: m.counterPlaceId,
        qtyDelta: -m.qtyDelta,
        // Реплей перепишет: значение выводится из пересчитанного оригинала.
        valueDeltaKopecks: -m.valueDeltaKopecks,
        unitValueKopecks: m.unitValueKopecks,
        kind: m.kind,
        reason: m.reason,
        docDate: m.docDate,
        reversesMoveId: m.id,
      });
    }

    // --- партии: приходные закрываем, расходные возвращаем ---
    const docBatches = await tx
      .select({ id: stockBatches.id, qtyIn: stockBatches.qtyIn })
      .from(stockBatches)
      .where(and(eq(stockBatches.tenantId, ctx.tenantId), eq(stockBatches.docId, docId)));
    for (const b of docBatches) {
      // GREATEST(0, …): часть партии могла уже уйти в продажу. Деньги в этом
      // случае разрулит реплей (пул уйдёт в минус с warning), а штуки в партии
      // ниже нуля не опускаем — отрицательная партия не имеет физического смысла.
      await tx
        .update(stockBatches)
        .set({
          qtyLeft: sql`GREATEST(0, ${stockBatches.qtyLeft} - ${b.qtyIn})`,
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(stockBatches.tenantId, ctx.tenantId), eq(stockBatches.id, b.id)));
    }
    for (const m of moves) {
      for (const a of m.lotAlloc ?? []) {
        await tx
          .update(stockBatches)
          .set({
            qtyLeft: sql`${stockBatches.qtyLeft} + ${a.qty}`,
            closedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(eq(stockBatches.tenantId, ctx.tenantId), eq(stockBatches.id, a.batchId)),
          );
      }
    }

    await tx
      .update(stockDocs)
      .set({
        status: 'void',
        voidedAt: new Date(),
        // Сторно ОСВОБОЖДАЕТ ключ идемпотентности импорта (§4.8.9). Уникальный
        // индекс stock_docs_source_idx не смотрит на статус, поэтому пока
        // source_ref висит на сторнированном документе, повторно загрузить
        // исправленный файл за тот же день физически нельзя — вставка упадёт на
        // уникальности. Сам ключ при этом не теряется: он уходит в комментарий.
        sourceRef: null,
        comment: doc.sourceRef
          ? `${doc.comment ? `${doc.comment}\n` : ''}Сторнирован; ключ импорта ${doc.sourceRef} освобождён для повторной загрузки`
          : doc.comment,
        updatedAt: new Date(),
      })
      .where(and(eq(stockDocs.tenantId, ctx.tenantId), eq(stockDocs.id, docId)));

    const itemIds = Array.from(new Set(moves.map((m) => m.itemId)));
    const replay = await recalcItemsInTx(ctx, tx, itemIds);
    const writeback = opts.skipWriteback
      ? { updated: 0 }
      : await applyCostWriteback(ctx, tx, replay.itemIds);

    return {
      docId,
      reversalDocId: reversal.id,
      movesCount: moves.length,
      itemIds,
      warnings: replay.warnings,
      writebackUpdated: writeback.updated,
    };
  });
}

// ---------------------------------------------------------------------------
// Пересчёт (реплей)
// ---------------------------------------------------------------------------

export interface RecalcResult {
  itemsRecalced: number;
  movesUpdated: number;
  warnings: CostingWarning[];
  /**
   * Товары, которые реально были пересчитаны — это ЗАМЫКАНИЕ входного списка по
   * парным ногам, а не он сам. Writeback обязан идти по нему: цепочка
   * пересортиц могла втянуть товар, которого в документе не было, и его
   * себестоимость в unit_products осталась бы старой.
   */
  itemIds: string[];
}

/**
 * Публичная точка пересчёта. `fromDate` НЕ сужает реплей (см. шапку файла:
 * «липкая» средняя и базис не восстанавливаются из SUM), а используется только
 * для текста предупреждения в UI: «себестоимость и прибыль с DD.MM.YYYY будут
 * пересчитаны» (§4.7).
 */
export async function recalcFrom(
  ctx: StockCtx,
  args: { itemIds?: string[]; fromDate?: string },
): Promise<RecalcResult> {
  return db.transaction(async (tx) => {
    const itemIds =
      args.itemIds && args.itemIds.length > 0
        ? args.itemIds
        : (
            await tx
              .select({ id: stockItems.id })
              .from(stockItems)
              .where(eq(stockItems.tenantId, ctx.tenantId))
          ).map((r) => r.id);
    const result = await recalcItemsInTx(ctx, tx, itemIds);
    await applyCostWriteback(ctx, tx, result.itemIds);
    return result;
  });
}

/** Пересчёт ВНУТРИ уже открытой транзакции (используется postDoc/voidDoc). */
export async function recalcItemsInTx(
  ctx: StockCtx,
  tx: StockDb,
  itemIds: string[],
): Promise<RecalcResult> {
  const unique = Array.from(new Set(itemIds)).filter(Boolean);
  if (unique.length === 0) {
    return { itemsRecalced: 0, movesUpdated: 0, warnings: [], itemIds: [] };
  }

  // Пересортица связывает ленты РАЗНЫХ товаров: приходная нога товара B берёт
  // стоимость у расходной ноги товара A. Пересчитать B без A нельзя — донор
  // окажется вне выборки, реплей возьмёт снимок с диска и Σ по документу
  // перестанет быть нулём. Поэтому набор расширяется по связям пар до
  // неподвижной точки, и весь он переигрывается ОДНИМ хронологическим проходом.
  const closure = await expandPairedItems(ctx, tx, unique);
  return replayItemsLedger(ctx, tx, closure);
}

/**
 * Замыкание набора товаров по парным ногам (stock_moves.pair_move_id).
 * Обход в обе стороны: и «кто взял стоимость у моего товара», и «у кого взял
 * стоимость мой товар». Итераций мало (пересортица связывает две позиции), но
 * цикл идёт до неподвижной точки — цепочки A→B→C возможны.
 */
async function expandPairedItems(
  ctx: StockCtx,
  tx: StockDb,
  itemIds: readonly string[],
): Promise<string[]> {
  const known = new Set(itemIds);
  const partner = alias(stockMoves, 'pair_partner');
  // Потолок на случай патологических данных: лучше пересчитать неполно и
  // предупредить, чем крутиться в транзакции бесконечно.
  for (let round = 0; round < 8; round += 1) {
    const frontier = Array.from(known);
    const rows = await tx
      .selectDistinct({ itemId: partner.itemId })
      .from(stockMoves)
      .innerJoin(
        partner,
        and(
          eq(partner.tenantId, stockMoves.tenantId),
          or(
            eq(partner.pairMoveId, stockMoves.id),
            eq(partner.id, stockMoves.pairMoveId),
          ),
        ),
      )
      .where(
        and(
          eq(stockMoves.tenantId, ctx.tenantId),
          inArray(stockMoves.itemId, frontier),
        ),
      );
    let added = 0;
    for (const r of rows) {
      if (r.itemId && !known.has(r.itemId)) {
        known.add(r.itemId);
        added += 1;
      }
    }
    if (added === 0) break;
  }
  return Array.from(known);
}

/**
 * Детерминированный реплей лент НАБОРА товаров по (doc_date, seq) — один
 * хронологический проход, по пулу на товар.
 *
 * Источник значения для события:
 *   - сторно-движение (reverses_move_id) → стоимость, ОБРАТНАЯ уже
 *     пересчитанному оригиналу (не снимку на диске!). Так Σ == 0 держится
 *     даже после ввода документа задним числом перед оригиналом;
 *   - ПАРНАЯ НОГА (pair_move_id) → стоимость, равная пересчитанной стоимости
 *     своей расходной ноги: перемещение и пересортица ПЕРЕНОСЯТ стоимость,
 *     а не создают её (§4.5);
 *   - приход → landed-сумма СТРОКИ документа (stock_doc_lines.value_kopecks):
 *     она не зависит от пула, поэтому реплей воспроизводим;
 *   - расход → стоимость НЕ задаётся: её считает пул (доля от остаточной
 *     стоимости, §4.2 — единственно верный способ).
 *
 * Почему набор товаров, а не по одному: приходная нога пересортицы живёт в
 * ленте ДРУГОГО товара, чем её донор. Общий хронологический проход — то
 * единственное, что даёт ей увидеть донора уже пересчитанным.
 *
 * Пишет обратно только costing-поля движения (§2.7): value_delta_kopecks,
 * unit_value_kopecks, uncovered_qty, deficit_settled_kopecks. Количества,
 * места, даты и партии реплей не трогает — это физика, а не оценка.
 */
async function replayItemsLedger(
  ctx: StockCtx,
  tx: StockDb,
  itemIds: readonly string[],
): Promise<RecalcResult> {
  const unique = Array.from(new Set(itemIds)).filter(Boolean);
  if (unique.length === 0) {
    return { itemsRecalced: 0, movesUpdated: 0, warnings: [], itemIds: [] };
  }

  const rows = await tx
    .select({
      id: stockMoves.id,
      itemId: stockMoves.itemId,
      seq: stockMoves.seq,
      docDate: stockMoves.docDate,
      qtyDelta: stockMoves.qtyDelta,
      valueDeltaKopecks: stockMoves.valueDeltaKopecks,
      unitValueKopecks: stockMoves.unitValueKopecks,
      uncoveredQty: stockMoves.uncoveredQty,
      deficitSettledKopecks: stockMoves.deficitSettledKopecks,
      kind: stockMoves.kind,
      reason: stockMoves.reason,
      reversesMoveId: stockMoves.reversesMoveId,
      pairMoveId: stockMoves.pairMoveId,
      lineValueKopecks: stockDocLines.valueKopecks,
      lineIsEstimated: stockDocLines.isEstimated,
      docCostBasis: stockDocs.costBasis,
    })
    .from(stockMoves)
    .leftJoin(stockDocLines, eq(stockDocLines.id, stockMoves.lineId))
    .leftJoin(stockDocs, eq(stockDocs.id, stockMoves.docId))
    .where(and(eq(stockMoves.tenantId, ctx.tenantId), inArray(stockMoves.itemId, unique)))
    // Тот же порядок, что sortEvents() в costing.ts — иначе реплей не
    // воспроизводим и инвариант §4.8.7 ломается. replayLedgerMulti()
    // пересортирует ещё раз: он обязан быть корректен и на неотсортированном входе.
    .orderBy(asc(stockMoves.docDate), asc(stockMoves.seq));

  // Само правило «откуда берётся стоимость движения» живёт в чистом
  // replay-plan.ts и покрыто scripts/test-stock-replay.ts.
  const result = replayLedgerMulti(
    rows.map<LedgerMoveRow>((row) => ({
      id: row.id,
      itemId: row.itemId,
      seq: Number(row.seq),
      docDate: row.docDate,
      qtyDelta: row.qtyDelta,
      valueDeltaKopecks: row.valueDeltaKopecks,
      unitValueKopecks: row.unitValueKopecks,
      uncoveredQty: row.uncoveredQty,
      deficitSettledKopecks: row.deficitSettledKopecks,
      kind: row.kind,
      reason: row.reason,
      reversesMoveId: row.reversesMoveId,
      pairMoveId: row.pairMoveId,
      lineValueKopecks: row.lineValueKopecks,
      lineIsEstimated: row.lineIsEstimated,
      docCostBasis: row.docCostBasis,
    })),
  );

  let movesUpdated = 0;
  for (const move of result.moves) {
    if (!move.changed) continue;
    await tx
      .update(stockMoves)
      .set({
        valueDeltaKopecks: move.valueDeltaKopecks,
        unitValueKopecks: move.unitValueKopecks,
        uncoveredQty: move.uncoveredQty,
        deficitSettledKopecks: move.deficitSettledKopecks,
      })
      .where(and(eq(stockMoves.tenantId, ctx.tenantId), eq(stockMoves.id, move.id)));
    movesUpdated += 1;
  }

  // Кэш пишется ВСЕМ товарам набора, включая тех, у кого движений не осталось:
  // иначе сторнированная в ноль лента оставила бы старые «Деньги в товаре».
  for (const itemId of unique) {
    const pool: PoolState = result.pools.get(itemId) ?? createPool();
    const cache = poolToCache(pool);
    await tx
      .update(stockItems)
      .set({
        qtyPool: cache.qtyPool,
        valuePoolKopecks: cache.valuePoolKopecks,
        avgCostKopecks: cache.avgCostKopecks,
        lastCostKopecks: cache.lastCostKopecks,
        costBasis: cache.costBasis,
        costBasisMixed: cache.costBasisMixed,
        costUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(stockItems.tenantId, ctx.tenantId), eq(stockItems.id, itemId)));
  }

  return {
    itemsRecalced: unique.length,
    movesUpdated,
    warnings: result.warnings,
    itemIds: unique,
  };
}

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

async function lockDoc(ctx: StockCtx, tx: StockDb, docId: string) {
  const [doc] = await tx
    .select()
    .from(stockDocs)
    .where(and(eq(stockDocs.tenantId, ctx.tenantId), eq(stockDocs.id, docId)))
    .limit(1)
    // FOR UPDATE: два параллельных «Провести» по одному документу иначе создали
    // бы два комплекта движений — деньги в товаре удвоились бы молча.
    .for('update');
  if (!doc) throw new StockError('not_found', 'Документ не найден');
  return doc;
}

/** §4.7: проводка в закрытый период — 403 с готовым текстом для пользователя. */
function assertPeriodOpen(docDate: string, lockedThrough: string | null): void {
  if (!lockedThrough) return;
  if (docDate > lockedThrough) return;
  const [y, m, d] = lockedThrough.split('-');
  throw new StockError(
    'period_locked',
    `Период закрыт по ${d}.${m}.${y} — введите корректирующим документом текущей датой`,
  );
}

async function assertItemsBelongToTenant(
  ctx: StockCtx,
  tx: StockDb,
  itemIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(itemIds));
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: stockItems.id })
    .from(stockItems)
    .where(and(eq(stockItems.tenantId, ctx.tenantId), inArray(stockItems.id, unique)));
  if (rows.length !== unique.length) {
    throw new StockError('bad_request', 'В строках есть товар из другого аккаунта');
  }
}

// §3 («place_id всегда ledger») проверяет чистый planDocLegs → assertLedger:
// он один знает, какие места документ РЕАЛЬНО использует под движения, а какие
// стоят в шапке справочно (приёмник отгрузки на склад Ozon — external, и это
// нормально). Отдельной SQL-проверки больше нет, чтобы два условия не разъехались.

const DOC_NUMBER_PREFIX: Record<StockDocKind, string> = {
  opening: 'ОСТ',
  purchase: 'ПОСТ',
  transfer: 'ПЕР',
  accept: 'ПРМ',
  writeoff: 'СПИС',
  adjust: 'ИНВ',
  return_in: 'ВОЗВ',
  regrade: 'ПЕРЕС',
  sale: 'ПРОД',
};

/**
 * Человекочитаемый номер ПОСТ-2026-0001. Advisory-lock на (tenant, prefix, year)
 * держится до конца транзакции: без него два одновременных «Провести» взяли бы
 * один и тот же max+1 и второй упал бы на уникальном индексе.
 */
async function generateDocNumber(
  ctx: StockCtx,
  tx: StockDb,
  kind: StockDocKind,
  docDate: string,
): Promise<string> {
  const settings = await getStockSettings(ctx, tx);
  const prefix = settings.numberPrefixes?.[kind] ?? DOC_NUMBER_PREFIX[kind] ?? 'ДОК';
  const year = docDate.slice(0, 4);
  const lockKey = `stock-doc-number:${ctx.tenantId}:${prefix}:${year}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

  const like = `${prefix}-${year}-%`;
  // Берём ТОЛЬКО хвост из цифр и только у номеров, которые им заканчиваются:
  // сторно-документ называется «ПОСТ-2026-0001/СТОРНО», и наивное
  // regexp_replace('^.*-','') отдало бы «0001/СТОРНО» → ::int упал бы с
  // invalid input syntax ровно после первого сторно.
  // В шаблонной строке нужен ДВОЙНОЙ слеш: '\d' в JS схлопывается в 'd'.
  const rows = await tx.execute<{ max_seq: string | null }>(sql`
    SELECT MAX(substring(number from '(\\d+)$')::int) AS max_seq
    FROM stock_docs
    WHERE tenant_id = ${ctx.tenantId}
      AND number LIKE ${like}
      AND number ~ '\\d+$'
  `);
  const maxSeq = Number(Array.from(rows)[0]?.max_seq ?? 0) || 0;
  return `${prefix}-${year}-${String(maxSeq + 1).padStart(4, '0')}`;
}

/** Следующий свободный номер партии LOT-YYYY-NNNN в пределах tenant и года. */
async function nextLotSequence(
  ctx: StockCtx,
  tx: StockDb,
  year: string,
): Promise<number> {
  const lockKey = `stock-lot-number:${ctx.tenantId}:${year}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
  const like = `LOT-${year}-%`;
  // Тот же приём, что и в generateDocNumber: только цифровой хвост.
  const rows = await tx.execute<{ max_seq: string | null }>(sql`
    SELECT MAX(substring(lot_no from '(\\d+)$')::int) AS max_seq
    FROM stock_batches
    WHERE tenant_id = ${ctx.tenantId}
      AND lot_no LIKE ${like}
      AND lot_no ~ '\\d+$'
  `);
  return (Number(Array.from(rows)[0]?.max_seq ?? 0) || 0) + 1;
}

/** Утилита для роутов: собрать WHERE по списку id с обязательным tenant_id. */
export function tenantScoped(table: { tenantId: unknown }, tenantId: string): SQL {
  return eq(table.tenantId as never, tenantId);
}
