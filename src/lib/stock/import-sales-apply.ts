// PURPOSE: Применение разобранной выгрузки продаж WB / Яндекс.Маркета к складу:
// сшивка позиций канала с нашей номенклатурой, документы по дням, проводка.
// Чистый разбор файла — в соседнем import-sales.ts (там же тесты).
//
// ЧТО ЗДЕСЬ ВАЖНО (docs/STOCK_MODULE_DESIGN.md §12.3, §4.3, §1.10, §4.8.9):
//   1. Продажа канала списывает товар СО СВОЕГО СКЛАДА (по умолчанию) — именно
//      её отсутствие завышала остаток. Место настраиваемое: если товар лежит
//      на складе маркетплейса, укажите его место (`wb` / `yandex`).
//   2. Вид документа — `sale`, а НЕ `writeoff`: §1.8 запрещает смешивать потери
//      и себестоимость проданного, иначе валовая маржа врёт в обе стороны.
//   3. Нетто-возврат дня приходуется документом `return_in` по ТЕКУЩЕЙ средней
//      с пометкой «оценочно» (§4.3: возврат без идентифицируемого источника).
//   4. Позиция без сшивки НЕ импортируется и НЕ считается нулём (§1.10):
//      она возвращается вызывающему со своей выручкой, чтобы человек увидел
//      цену бездействия и сшил товар.
//   5. Идемпотентность — по (source, source_ref) = (import:<канал>, <канал>:sales:<дата>).
//      Повторный или перекрывающийся файл не создаёт ни одного лишнего движения.

import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { stockItemLinks, stockItems } from '@/lib/db/schema/stock';
import { stockDocs } from '@/lib/db/schema/stock-ledger';
import { filterNewDocs, importKey } from './costing';
import {
  aggregateSales,
  buildSalesDocPlans,
  salesDocSource,
  type ParsedSaleRow,
  type SalesChannel,
  type SalesDocPlan,
} from './import-sales';
import { OWN_PLACE_CODE } from './places';
import { createDraftDoc, postDoc, type DocLinePayload } from './posting';
import type { StockCtx } from './queries';

/** Сшивка позиции канала с нашим товаром. */
interface LinkTarget {
  itemId: string;
  /** Карточка «3 банки» = 3 базовые единицы (§2.3) — без этого COGS едет кратно. */
  qtyPerUnit: number;
  avgCostKopecks: number;
}

export interface SalesImportUnmatched {
  externalId: string;
  qty: number;
  revenueKopecks: number;
  name: string | null;
}

export interface SalesImportDocResult {
  date: string;
  kind: 'sale' | 'return_in';
  docId: string | null;
  /** Строк документа (в базовых единицах уже приведено). */
  linesCount: number;
  qtyTotal: number;
  revenueKopecks: number;
  /** 'created' — проведён, 'skipped' — день уже импортирован (идемпотентность). */
  status: 'created' | 'skipped' | 'empty';
}

export interface SalesImportResult {
  channel: SalesChannel;
  fromPlaceCode: string;
  dryRun: boolean;
  docs: SalesImportDocResult[];
  unmatched: SalesImportUnmatched[];
  totals: {
    parsedRows: number;
    docsCreated: number;
    docsSkipped: number;
    qtySold: number;
    qtyReturned: number;
    revenueKopecks: number;
    /** Выручка позиций, которые не удалось сшить, — цена бездействия (§1.10). */
    unmatchedRevenueKopecks: number;
    unmatchedCount: number;
  };
}

/**
 * Сшивка позиций канала → наши товары. Приоритет: external_id (артикул
 * продавца), затем external_sku (номер маркетплейса), затем внутренний sku.
 * Всё в ОДНОМ запросе на канал: по 500 позиций по одному запросу — это минуты.
 */
async function resolveChannelLinks(
  ctx: StockCtx,
  channel: SalesChannel,
  keys: readonly string[],
): Promise<Map<string, LinkTarget>> {
  const map = new Map<string, LinkTarget>();
  const unique = Array.from(new Set(keys.filter((k) => k !== '')));
  if (unique.length === 0) return map;

  const links = await db
    .select({
      externalId: stockItemLinks.externalId,
      externalSku: stockItemLinks.externalSku,
      itemId: stockItemLinks.itemId,
      qtyPerUnit: stockItemLinks.qtyPerUnit,
      avgCostKopecks: stockItems.avgCostKopecks,
      overrideKopecks: stockItems.costOverrideKopecks,
    })
    .from(stockItemLinks)
    .innerJoin(stockItems, eq(stockItems.id, stockItemLinks.itemId))
    .where(
      and(
        eq(stockItemLinks.tenantId, ctx.tenantId),
        eq(stockItems.tenantId, ctx.tenantId),
        eq(stockItemLinks.channel, channel),
        // inArray, а не `= ANY($1)`: сериализация JS-массива в postgres-массив
        // зависит от драйвера, а в проекте такого приёма больше нигде нет —
        // не заводим единственный экземпляр непроверенного паттерна.
        or(
          inArray(stockItemLinks.externalId, unique),
          inArray(stockItemLinks.externalSku, unique),
        ),
      ),
    );

  for (const l of links) {
    const target: LinkTarget = {
      itemId: l.itemId,
      qtyPerUnit: Math.max(1, l.qtyPerUnit),
      avgCostKopecks: Number(l.overrideKopecks ?? l.avgCostKopecks) || 0,
    };
    // external_id приоритетнее: если позиция сшита и по артикулу, и по номеру
    // маркетплейса, побеждает артикул (тот же приоритет, что в queries.ts).
    map.set(l.externalId, target);
    if (l.externalSku && !map.has(l.externalSku)) map.set(l.externalSku, target);
  }

  // Fallback: наш внутренний sku совпал с артикулом канала. Частый случай для
  // WB, где «Артикул поставщика» — это и есть наш SKU.
  const missing = unique.filter((k) => !map.has(k));
  if (missing.length > 0) {
    const items = await db
      .select({
        sku: stockItems.sku,
        id: stockItems.id,
        avgCostKopecks: stockItems.avgCostKopecks,
        overrideKopecks: stockItems.costOverrideKopecks,
      })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, ctx.tenantId), inArray(stockItems.sku, missing)));
    for (const item of items) {
      map.set(item.sku, {
        itemId: item.id,
        // Сшивки нет — множитель неизвестен, берём 1 (карточку-набор обязан
        // завести человек через экран сопоставления, §8 шаг 3).
        qtyPerUnit: 1,
        avgCostKopecks: Number(item.overrideKopecks ?? item.avgCostKopecks) || 0,
      });
    }
  }

  return map;
}

/** Уже импортированные ключи (source, source_ref) этого канала. */
async function loadExistingKeys(
  ctx: StockCtx,
  channel: SalesChannel,
): Promise<string[]> {
  const source = salesDocSource(channel);
  const rows = await db
    .select({ source: stockDocs.source, sourceRef: stockDocs.sourceRef })
    .from(stockDocs)
    .where(
      and(
        eq(stockDocs.tenantId, ctx.tenantId),
        eq(stockDocs.source, source),
        sql`${stockDocs.sourceRef} is not null`,
        // Сторнированный документ дня ключ не занимает: voidDoc обнуляет ему
        // source_ref именно для того, чтобы исправленный файл можно было
        // загрузить заново. Условие оставлено явным — оно защищает от старых
        // данных, где source_ref у сторно ещё мог остаться.
        sql`${stockDocs.status} <> 'void'`,
      ),
    );
  return rows
    .map((r) => importKey({ source: r.source, sourceRef: r.sourceRef }))
    .filter((k): k is string => k !== null);
}

export interface ApplySalesOptions {
  channel: SalesChannel;
  /** Откуда списывать продажи. По умолчанию — свой склад (§12.3). */
  fromPlaceCode?: string;
  /** Только посчитать, ничего не писать. */
  dryRun?: boolean;
}

/**
 * Применяет разобранные строки продаж: свёртка по дням → сшивка → документы.
 * Каждый документ проводится сразу (продажа без проводки бессмысленна), но
 * КАЖДЫЙ в своей транзакции — упавший день не отменяет уже импортированные.
 */
export async function applySalesImport(
  ctx: StockCtx,
  rows: readonly ParsedSaleRow[],
  opts: ApplySalesOptions,
): Promise<SalesImportResult> {
  const fromPlaceCode = opts.fromPlaceCode?.trim() || OWN_PLACE_CODE;
  const dryRun = opts.dryRun === true;

  const aggregates = aggregateSales(rows);
  const plans = buildSalesDocPlans(aggregates, opts.channel);

  const keys = new Set<string>();
  for (const agg of aggregates) {
    keys.add(agg.externalId);
    if (agg.externalSku) keys.add(agg.externalSku);
  }
  const links = await resolveChannelLinks(ctx, opts.channel, Array.from(keys));

  // Идемпотентность (§4.8.9): отсекаем дни, уже лежащие в журнале.
  const existing = await loadExistingKeys(ctx, opts.channel);
  const { fresh, skipped } = filterNewDocs(existing, plans);
  const freshRefs = new Set(fresh.map((p) => p.sourceRef));

  const unmatchedByKey = new Map<string, SalesImportUnmatched>();
  const docs: SalesImportDocResult[] = [];
  let qtySold = 0;
  let qtyReturned = 0;
  let revenueKopecks = 0;

  for (const plan of plans) {
    if (!freshRefs.has(plan.sourceRef)) {
      docs.push({
        date: plan.date,
        kind: plan.kind,
        docId: null,
        linesCount: plan.lines.length,
        qtyTotal: plan.qtyTotal,
        revenueKopecks: plan.revenueKopecks,
        status: 'skipped',
      });
      continue;
    }

    const lines: DocLinePayload[] = [];
    let planQty = 0;
    let planRevenue = 0;
    for (const line of plan.lines) {
      const target =
        links.get(line.externalId) ??
        (line.externalSku ? links.get(line.externalSku) : undefined);
      if (!target) {
        // §1.10: не «ноль», а строка с ценой — её увидит человек.
        const acc = unmatchedByKey.get(line.externalId) ?? {
          externalId: line.externalId,
          qty: 0,
          revenueKopecks: 0,
          name: line.name,
        };
        acc.qty += line.qty;
        acc.revenueKopecks += line.revenueKopecks;
        unmatchedByKey.set(line.externalId, acc);
        continue;
      }
      const qtyBase = line.qty * target.qtyPerUnit;
      lines.push({
        itemId: target.itemId,
        direction: plan.kind === 'return_in' ? 'in' : 'out',
        qty: qtyBase,
        // Продажа: цена продажи за базовую единицу — справочно, себестоимость
        // считает пул. Возврат: ТЕКУЩАЯ средняя (§4.3) — именно она и станет
        // landed-стоимостью приходной строки.
        unitPriceKopecks:
          plan.kind === 'return_in'
            ? target.avgCostKopecks
            : qtyBase > 0
              ? Math.round(line.revenueKopecks / qtyBase)
              : 0,
        isEstimated: plan.kind === 'return_in',
      });
      planQty += qtyBase;
      planRevenue += line.revenueKopecks;
    }

    if (lines.length === 0) {
      docs.push({
        date: plan.date,
        kind: plan.kind,
        docId: null,
        linesCount: 0,
        qtyTotal: 0,
        revenueKopecks: 0,
        status: 'empty',
      });
      continue;
    }

    if (plan.kind === 'return_in') qtyReturned += planQty;
    else qtySold += planQty;
    revenueKopecks += planRevenue;

    if (dryRun) {
      docs.push({
        date: plan.date,
        kind: plan.kind,
        docId: null,
        linesCount: lines.length,
        qtyTotal: planQty,
        revenueKopecks: planRevenue,
        status: 'created',
      });
      continue;
    }

    const created = await createDraftDoc(ctx, {
      kind: plan.kind,
      docDate: plan.date,
      // Продажа списывает со СВОЕГО склада: именно этого движения не хватало,
      // чтобы остаток перестал быть завышенным (§12.3).
      fromPlaceCode: plan.kind === 'sale' ? fromPlaceCode : null,
      toPlaceCode: plan.kind === 'return_in' ? fromPlaceCode : null,
      // НДС продаж к себестоимости отношения не имеет: базис документа не
      // меняем, цена в строках — справочная.
      priceIncludesVat: true,
      source: plan.source,
      sourceRef: plan.sourceRef,
      comment:
        plan.kind === 'sale'
          ? `Импорт продаж ${plan.date}: ${plan.qtyTotal} шт, выручка ${(
              plan.revenueKopecks / 100
            ).toFixed(2)} ₽`
          : `Импорт возвратов ${plan.date}: ${plan.qtyTotal} шт (нетто), ` +
            'стоимость по текущей средней (оценочно, §4.3)',
      lines,
    });
    await postDoc(ctx, created.docId);

    docs.push({
      date: plan.date,
      kind: plan.kind,
      docId: created.docId,
      linesCount: lines.length,
      qtyTotal: planQty,
      revenueKopecks: planRevenue,
      status: 'created',
    });
  }

  const unmatched = Array.from(unmatchedByKey.values()).sort(
    (a, b) => b.revenueKopecks - a.revenueKopecks,
  );

  return {
    channel: opts.channel,
    fromPlaceCode,
    dryRun,
    docs,
    unmatched,
    totals: {
      parsedRows: rows.length,
      docsCreated: docs.filter((d) => d.status === 'created').length,
      docsSkipped: skipped.length,
      qtySold,
      qtyReturned,
      revenueKopecks,
      unmatchedRevenueKopecks: unmatched.reduce((s, u) => s + u.revenueKopecks, 0),
      unmatchedCount: unmatched.length,
    },
  };
}

/** Тип для роута: план без применения (превью диалога). */
export type SalesImportPreview = Pick<SalesImportResult, 'docs' | 'unmatched' | 'totals'> & {
  plans: SalesDocPlan[];
};
