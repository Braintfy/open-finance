// PURPOSE: Маппинг Ozon-сущностей в наши БД-таблицы (unit_products,
// ozon_orders, ozon_realization, ozon_transactions). Все upsert'ы
// идемпотентные — по уникальным ключам.

import { and, eq, sql } from 'drizzle-orm';
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
  PricesItem,
  StocksItem,
  FbsPosting,
  FboPosting,
  RealizationRow,
  TransactionOperation,
  TurnoverRow,
} from './types';

export type UpsertContext = {
  tenantId: string;
  userId: string;
  accountId: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDimensions(info: ProductInfo): {
  weightG: number | null;
  dimsMm: { depth: number; width: number; height: number } | null;
  volumeLx100: number;
} {
  const weightUnit = info.weight_unit ?? 'g';
  const weight = info.weight ?? null;
  const weightG =
    weight === null
      ? null
      : weightUnit === 'kg'
        ? Math.round(weight * 1000)
        : weightUnit === 'lb'
          ? Math.round(weight * 453.592)
          : Math.round(weight);

  const dimsUnit = info.dimension_unit ?? 'mm';
  const toMm = (v: number | undefined) => {
    if (!v) return null;
    if (dimsUnit === 'cm') return v * 10;
    if (dimsUnit === 'm') return v * 1000;
    return v;
  };
  const d = toMm(info.depth);
  const w = toMm(info.width);
  const h = toMm(info.height);
  const dimsMm = d && w && h ? { depth: d, width: w, height: h } : null;
  const volumeLx100 = dimsMm
    ? Math.round(((dimsMm.depth * dimsMm.width * dimsMm.height) / 1_000_000) * 100)
    : 0;
  return { weightG, dimsMm, volumeLx100 };
}

function parseMoneyRu(value: string | undefined): number {
  if (!value) return 0;
  const num = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
}

// ---------------------------------------------------------------------------
// unit_products — товары
// ---------------------------------------------------------------------------

export type CombinedProduct = {
  info: ProductInfo;
  prices?: PricesItem;
  stocks?: StocksItem;
  turnover?: TurnoverRow;
};

/**
 * Нормализует primary_image: с 2026-05 Ozon отдаёт массив URL.
 * Старый формат — строка. Возвращаем массив без пустых строк.
 */
function normalizePrimaryImage(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((s) => typeof s === 'string' && s.length > 0);
  return [value];
}

/**
 * Upsert одного товара. Идентификатор: (tenant_id, marketplace, article).
 * article === offer_id. Все доп-данные складываем в metadata, чтобы не
 * раздувать схему unit_products.
 *
 * Возвращает true если запись upsert'нулась, false если skip (нет ключей).
 */
export async function upsertUnitProductFromOzon(
  ctx: UpsertContext,
  payload: CombinedProduct,
): Promise<boolean> {
  const { info, prices, stocks, turnover } = payload;
  // Skip без обязательных полей — у нас не на что мапить запись.
  if (!info.id || !info.offer_id) return false;

  const dims = parseDimensions(info);
  const priceRub = parseMoneyRu(prices?.price?.price);
  const priceWithSppRub = parseMoneyRu(prices?.price?.marketing_seller_price);
  const stockMarketplace = (stocks?.stocks ?? [])
    .filter((s) => s.type === 'fbo')
    .reduce((sum, s) => sum + (s.present ?? 0), 0);
  const stockOwn = (stocks?.stocks ?? [])
    .filter((s) => s.type === 'fbs' || s.type === 'crossborder')
    .reduce((sum, s) => sum + (s.present ?? 0), 0);

  const primaryImages = normalizePrimaryImage(info.primary_image);
  const images = info.images && info.images.length > 0 ? info.images : primaryImages;

  const metadata = {
    productId: info.id,
    images,
    primaryImage: primaryImages[0] ?? null,
    weightG: dims.weightG,
    dimensionsMm: dims.dimsMm,
    priceWithSpp: priceWithSppRub,
    commissions: {
      fboPct: prices?.commissions?.sales_percent_fbo ?? null,
      fbsPct: prices?.commissions?.sales_percent_fbs ?? null,
      fboFulfillmentRub: prices?.commissions?.fbo_fulfillment_amount ?? null,
    },
    turnoverIdc: turnover?.idc ?? null,
    turnoverDays: turnover?.turnover ?? null,
    stockByType: stocks?.stocks ?? [],
    syncedAt: new Date().toISOString(),
  };

  await db
    .insert(unitProducts)
    .values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      marketplace: 'ozon',
      article: info.offer_id,
      sku: String(info.id),
      barcode: info.barcode ?? info.barcodes?.[0] ?? null,
      name: info.name ?? info.offer_id,
      status: info.status?.state ?? null,
      visibility: info.visible === false ? 'hidden' : 'visible',
      stockMarketplace,
      stockOwn,
      priceKopecks: rublesToKopecks(priceRub),
      // costKopecks НЕ перезаписываем (себестоимость задаёт пользователь).
      // Если запись новая — будет 0; для существующей сохраним прежнее.
      volumeL: dims.volumeLx100,
      marketplaceAccountId: ctx.accountId,
      metadata,
    })
    .onConflictDoUpdate({
      target: [unitProducts.tenantId, unitProducts.marketplace, unitProducts.article],
      set: {
        sku: String(info.id),
        barcode: info.barcode ?? info.barcodes?.[0] ?? sql`unit_products.barcode`,
        name: info.name ?? sql`unit_products.name`,
        status: info.status?.state ?? sql`unit_products.status`,
        visibility: info.visible === false ? 'hidden' : 'visible',
        stockMarketplace,
        stockOwn,
        priceKopecks: rublesToKopecks(priceRub),
        volumeL: dims.volumeLx100,
        marketplaceAccountId: ctx.accountId,
        // metadata мерджим с существующим, чтобы не затирать кастомные поля
        metadata: sql`unit_products.metadata || ${JSON.stringify(metadata)}::jsonb`,
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

export async function insertRealizationBatch(
  ctx: UpsertContext,
  args: {
    periodFrom: Date;
    periodTo: Date;
    rows: RealizationRow[];
  },
): Promise<number> {
  if (args.rows.length === 0) return 0;
  // Очищаем предыдущие записи периода (по account+period_from+period_to),
  // потом массово вставляем. Это проще, чем upsert per-row.
  await db
    .delete(ozonRealization)
    .where(
      and(
        eq(ozonRealization.accountId, ctx.accountId),
        eq(ozonRealization.periodFrom, args.periodFrom),
        eq(ozonRealization.periodTo, args.periodTo),
      ),
    );

  const inserts: NewOzonRealizationRow[] = args.rows.map((r) => ({
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    periodFrom: args.periodFrom,
    periodTo: args.periodTo,
    sku: r.sku ? String(r.sku) : null,
    offerId: r.offer_id ?? null,
    qty: r.sale?.sale_qty ?? 0,
    grossKopecks: rublesToKopecks(r.sale?.sale_amount ?? 0),
    commissionKopecks: rublesToKopecks(r.sale?.sale_commission ?? 0),
    logisticsKopecks: 0,
    adsKopecks: 0,
    raw: r as unknown as Record<string, unknown>,
  }));
  await db.insert(ozonRealization).values(inserts);
  return inserts.length;
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
