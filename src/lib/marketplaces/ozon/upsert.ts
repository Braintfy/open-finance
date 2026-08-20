// PURPOSE: Маппинг Ozon-сущностей в наши БД-таблицы (unit_products,
// ozon_orders, ozon_realization, ozon_transactions). Все upsert'ы
// идемпотентные — по уникальным ключам.

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import {
  ozonOrders,
  ozonRealization,
  ozonTransactions,
  type NewOzonOrder,
  type NewOzonRealizationRow,
  type NewOzonTransaction,
} from '@/lib/db/schema/marketplaces';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import type {
  ProductInfo,
  FbsPosting,
  FboPosting,
  RealizationHeader,
  RealizationRow,
  TransactionOperation,
  TurnoverRow,
} from './types';
import { MISMATCH_TOLERANCE_RUB, mapRealizationRow } from './realization-map';
import {
  planUnitProductUpsertFromOzon,
  type CombinedProduct,
} from './upsert-plan';

// Re-export для совместимости со старыми импортами
export type { CombinedProduct } from './upsert-plan';
export {
  planUnitProductUpsertFromOzon,
  type UnitProductUpsertPlan,
} from './upsert-plan';

export type UpsertContext = {
  tenantId: string;
  userId: string;
  accountId: string;
};

// ---------------------------------------------------------------------------
// unit_products — товары
// ---------------------------------------------------------------------------

/**
 * Upsert одного товара. Идентификатор: (tenant_id, marketplace, article).
 * article === offer_id. Все доп-данные складываем в metadata, чтобы не
 * раздувать схему unit_products.
 *
 * Возвращает true если запись upsert'нулась, false если skip (нет ключей).
 *
 * КРИТИЧЕСКОЕ ПРАВИЛО ИДЕМПОТЕНТНОСТИ:
 * Стейджи sync вызывают эту функцию с **частичным** payload — `products` без
 * prices/stocks, `prices` без dimensions, `stocks` без prices/dimensions.
 * Если бы мы всегда писали все поля, поздние стейджи затирали бы данные
 * ранних (например stocks-стейдж обнулял бы priceKopecks и volumeL).
 * Поэтому в `onConflictDoUpdate.set` каждое поле обновляется только тогда,
 * когда соответствующий payload фактически передан — иначе fallback на
 * текущее значение в БД через `sql\`unit_products.x\``.
 */
export async function upsertUnitProductFromOzon(
  ctx: UpsertContext,
  payload: CombinedProduct,
): Promise<boolean> {
  const plan = planUnitProductUpsertFromOzon(payload);
  if (!plan) return false;
  const { info } = payload;

  await db
    .insert(unitProducts)
    .values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      marketplace: 'ozon',
      article: plan.insert.article,
      sku: plan.insert.sku,
      barcode: info.barcode ?? info.barcodes?.[0] ?? null,
      name: plan.insert.name,
      status: info.status?.state ?? null,
      visibility: plan.insert.visibility,
      stockMarketplace: plan.insert.stockMarketplace,
      stockOwn: plan.insert.stockOwn,
      priceKopecks: plan.insert.priceKopecks,
      // costKopecks НЕ перезаписываем (себестоимость задаёт пользователь).
      // Если запись новая — будет 0; для существующей сохраним прежнее.
      volumeL: plan.insert.volumeL,
      marketplaceAccountId: ctx.accountId,
      metadata: plan.metadataDelta,
    })
    .onConflictDoUpdate({
      target: [unitProducts.tenantId, unitProducts.marketplace, unitProducts.article],
      set: {
        sku: plan.updates.sku === 'fresh' ? plan.insert.sku : sql`unit_products.sku`,
        barcode: info.barcode ?? info.barcodes?.[0] ?? sql`unit_products.barcode`,
        name: info.name ?? sql`unit_products.name`,
        status: info.status?.state ?? sql`unit_products.status`,
        visibility:
          plan.updates.visibility === 'fresh'
            ? plan.insert.visibility
            : sql`unit_products.visibility`,
        stockMarketplace:
          plan.updates.stockMarketplace === 'fresh'
            ? plan.insert.stockMarketplace
            : sql`unit_products.stock_marketplace`,
        stockOwn:
          plan.updates.stockOwn === 'fresh'
            ? plan.insert.stockOwn
            : sql`unit_products.stock_own`,
        priceKopecks:
          plan.updates.priceKopecks === 'fresh'
            ? plan.insert.priceKopecks
            : sql`unit_products.price_kopecks`,
        volumeL:
          plan.updates.volumeL === 'fresh'
            ? plan.insert.volumeL
            : sql`unit_products.volume_l_x100`,
        marketplaceAccountId: ctx.accountId,
        // metadata мерджим с существующим — JSONB `||` обновит только ключи
        // верхнего уровня которые присутствуют в delta.
        metadata: sql`unit_products.metadata || ${JSON.stringify(plan.metadataDelta)}::jsonb`,
        updatedAt: new Date(),
      },
    });
  return true;
}

// ---------------------------------------------------------------------------
// ozon_orders
// ---------------------------------------------------------------------------

function pickFbsTimings(p: FbsPosting): {
  createdAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
} {
  const createdAt = p.created_at ? new Date(p.created_at) : p.in_process_at ? new Date(p.in_process_at) : null;
  const cancelledAt = p.cancellation?.cancelled_at ? new Date(p.cancellation.cancelled_at) : null;
  return { createdAt, deliveredAt: null, cancelledAt };
}

export async function upsertFbsPosting(
  ctx: UpsertContext,
  p: FbsPosting,
): Promise<void> {
  const t = pickFbsTimings(p);
  const payload: NewOzonOrder = {
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    postingNumber: p.posting_number,
    scheme: 'fbs',
    status: p.status,
    orderCreatedAt: t.createdAt,
    deliveredAt: p.status === 'delivered' ? new Date() : null,
    cancelledAt: t.cancelledAt,
    returnedAt: null,
    items: (p.products ?? []).map((it) => ({
      sku: it.sku,
      offerId: it.offer_id,
      name: it.name,
      quantity: it.quantity,
      price: it.price,
    })),
    raw: p as unknown as Record<string, unknown>,
  };
  await db
    .insert(ozonOrders)
    .values(payload)
    .onConflictDoUpdate({
      target: [ozonOrders.accountId, ozonOrders.postingNumber],
      set: {
        status: p.status,
        orderCreatedAt: t.createdAt ?? sql`ozon_orders.order_created_at`,
        deliveredAt: p.status === 'delivered' ? new Date() : sql`ozon_orders.delivered_at`,
        cancelledAt: t.cancelledAt ?? sql`ozon_orders.cancelled_at`,
        items: payload.items as unknown as Array<Record<string, unknown>>,
        raw: payload.raw,
        updatedAt: new Date(),
      },
    });
}

export async function upsertFboPosting(
  ctx: UpsertContext,
  p: FboPosting,
): Promise<void> {
  const createdAt = p.created_at ? new Date(p.created_at) : null;
  const payload: NewOzonOrder = {
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    postingNumber: p.posting_number,
    scheme: 'fbo',
    status: p.status,
    orderCreatedAt: createdAt,
    deliveredAt: p.status === 'delivered' ? new Date() : null,
    cancelledAt: null,
    returnedAt: null,
    items: (p.products ?? []).map((it) => ({
      sku: it.sku,
      offerId: it.offer_id,
      name: it.name,
      quantity: it.quantity,
      price: it.price,
    })),
    raw: p as unknown as Record<string, unknown>,
  };
  await db
    .insert(ozonOrders)
    .values(payload)
    .onConflictDoUpdate({
      target: [ozonOrders.accountId, ozonOrders.postingNumber],
      set: {
        status: p.status,
        orderCreatedAt: createdAt ?? sql`ozon_orders.order_created_at`,
        deliveredAt: p.status === 'delivered' ? new Date() : sql`ozon_orders.delivered_at`,
        items: payload.items as unknown as Array<Record<string, unknown>>,
        raw: payload.raw,
        updatedAt: new Date(),
      },
    });
}

// ---------------------------------------------------------------------------
// ozon_realization
// ---------------------------------------------------------------------------

/** Сколько строк отчёта уходит в БД одним INSERT (у строки жирный `raw`). */
const REALIZATION_INSERT_CHUNK = 500;

/** День в миллисекундах — для запаса при чистке окна периода (см. ниже). */
const DAY_MS = 24 * 60 * 60 * 1000;

export type RealizationBatchResult = {
  /** Сколько строк записано. */
  inserted: number;
  /**
   * Сколько строк не сошлось: «итого к начислению + вознаграждение» разошлось
   * с суммой компонентов выплат больше чем на `MISMATCH_TOLERANCE_RUB`.
   * Стейдж выносит это в `warnings` — признак, что Ozon снова поменял форму.
   */
  mismatched: number;
};

/**
 * Записывает месячный отчёт о реализации. Идемпотентно: перед вставкой сносит
 * ВСЁ окно периода по (tenant, account) — повторный синк того же месяца строки
 * не задваивает. Тот же приём, что в стейдже аналитики (`analytics-data.ts`),
 * где DELETE идёт строго по окну дат.
 *
 * Окно чистки сдвинуто на сутки назад намеренно: `period_from` — `timestamp`
 * без таймзоны, и строка, записанная процессом с локальной полуночью МСК, лежит
 * как `<пред. месяц> 21:00`, а не как `1-е 00:00`. Сравнение на равенство (как
 * было раньше) такую строку не нашло бы и она бы задвоилась. Сдвиг ровно на
 * сутки не может зацепить соседний месяц: его строки стоят на своей границе,
 * а до неё в любом кодировании больше суток.
 */
export async function insertRealizationBatch(
  ctx: UpsertContext,
  args: {
    periodFrom: Date;
    periodTo: Date;
    rows: RealizationRow[];
    /** Шапка документа — кладётся в `raw` каждой строки (контекст для пересчёта). */
    header?: RealizationHeader | null;
  },
): Promise<RealizationBatchResult> {
  await db
    .delete(ozonRealization)
    .where(
      and(
        eq(ozonRealization.tenantId, ctx.tenantId),
        eq(ozonRealization.accountId, ctx.accountId),
        gte(ozonRealization.periodFrom, new Date(args.periodFrom.getTime() - DAY_MS)),
        lt(ozonRealization.periodFrom, new Date(args.periodTo.getTime() - DAY_MS)),
      ),
    );

  if (args.rows.length === 0) return { inserted: 0, mismatched: 0 };

  let mismatched = 0;
  const inserts: NewOzonRealizationRow[] = args.rows.map((r) => {
    const plan = mapRealizationRow(r);
    if (plan.residualRub > MISMATCH_TOLERANCE_RUB) mismatched += 1;
    return {
      tenantId: ctx.tenantId,
      accountId: ctx.accountId,
      periodFrom: args.periodFrom,
      periodTo: args.periodTo,
      sku: plan.sku,
      offerId: plan.offerId,
      qty: plan.qty,
      grossKopecks: plan.grossKopecks,
      commissionKopecks: plan.commissionKopecks,
      // Логистику и рекламу отчёт о реализации не содержит вовсе: это приложение
      // к УПД по товарам, а услуги (доставка, обработка, продвижение) приходят
      // отдельными операциями в `/v3/finance/transaction/list`. Пишем 0, чтобы
      // не выдумывать числа; источник рекламы — `ozon_perf_*` / `getOzonAdsTotals`.
      logisticsKopecks: 0,
      adsKopecks: 0,
      // Строка целиком + шапка документа: единственный способ пересчитать
      // выручку/вознаграждение задним числом, если трактовка полей окажется
      // неверной, — без повторного похода в API (Ozon отдаёт только закрытые месяцы).
      raw: { ...(r as unknown as Record<string, unknown>), header: args.header ?? null },
    };
  });

  for (let i = 0; i < inserts.length; i += REALIZATION_INSERT_CHUNK) {
    await db.insert(ozonRealization).values(inserts.slice(i, i + REALIZATION_INSERT_CHUNK));
  }
  return { inserted: inserts.length, mismatched };
}

// ---------------------------------------------------------------------------
// ozon_transactions
// ---------------------------------------------------------------------------

export async function upsertTransaction(
  ctx: UpsertContext,
  op: TransactionOperation,
): Promise<void> {
  const payload: NewOzonTransaction = {
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    transactionId: op.operation_id,
    operationType: op.operation_type ?? op.operation_type_name ?? null,
    operationDate: op.operation_date ? new Date(op.operation_date) : null,
    amountKopecks: rublesToKopecks(op.amount ?? 0),
    postingNumber: op.posting?.posting_number ?? null,
    sku: op.items?.[0]?.sku ? String(op.items[0].sku) : null,
    raw: op as unknown as Record<string, unknown>,
  };
  await db
    .insert(ozonTransactions)
    .values(payload)
    .onConflictDoUpdate({
      target: [ozonTransactions.accountId, ozonTransactions.transactionId],
      set: {
        operationType: payload.operationType,
        operationDate: payload.operationDate,
        amountKopecks: payload.amountKopecks,
        postingNumber: payload.postingNumber,
        sku: payload.sku,
        raw: payload.raw,
      },
    });
}

// ---------------------------------------------------------------------------
// Turnover update — merge in metadata of unit_products
// ---------------------------------------------------------------------------

export async function updateTurnoverForProduct(
  ctx: UpsertContext,
  row: TurnoverRow,
): Promise<void> {
  if (!row.item_code) return;
  await db
    .update(unitProducts)
    .set({
      metadata: sql`unit_products.metadata || ${JSON.stringify({
        turnoverDays: row.turnover ?? null,
        turnoverIdc: row.idc ?? null,
        turnoverCurrentStock: row.current_stock ?? null,
        turnoverSyncedAt: new Date().toISOString(),
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(unitProducts.tenantId, ctx.tenantId),
        eq(unitProducts.marketplace, 'ozon'),
        eq(unitProducts.article, row.item_code),
      ),
    );
}
