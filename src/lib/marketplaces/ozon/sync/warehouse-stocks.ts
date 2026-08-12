// PURPOSE: Sync остатков FBO по конкретным складам через Seller API
// `/v2/analytics/stock_on_warehouses`. Маппит warehouse_name → кластер
// через справочник ozon_clusters (опционально — если sync clusters прошёл).
//
// Данные используются в блоке «Остатки по кластерам».
//
// v0.18.22: путь поднят с /v1 → /v2 (v1 снят с поддержки Ozon, отвечает 404).
//
// Этап 2b LK_V2_PLAN: строки помечаются `source='FBO'`, а «полная замена»
// сузилась до окна `(account, source='FBO')` — иначе снапшот FBO стирал бы
// строки соседнего стейджа `fbsWarehouseStocks` (тот же аккаунт, та же
// таблица, `source='FBS'`).
//
// Этап 2c: DELETE+INSERT под одной транзакцией и батч-вставка по 500 строк
// (раньше 40k строк вставлялись по одной, а между DELETE и концом вставки
// блок остатков видел пустую таблицу).

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  ozonWarehouseStocks,
  type OzonStockSource,
} from '@/lib/db/schema/marketplaces';
import { analyticsStockOnWarehouses } from '../endpoints';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { loadWarehouseClusterMap } from './clusters';
import { normalizeWarehouseName } from '../cluster-agg';

const PAGE_LIMIT = 1000;
const MAX_PAGES = 50; // 50_000 строк — с запасом

/** Строк в одном INSERT. 500 × ~10 колонок — заведомо ниже лимита параметров PG. */
export const WAREHOUSE_STOCKS_INSERT_BATCH = 500;

type WarehouseStockInsert = typeof ozonWarehouseStocks.$inferInsert;

/**
 * Полная замена окна `(tenant, account, source)` в `ozon_warehouse_stocks`.
 *
 * Общий helper для стейджей FBO и FBS: у обоих snapshot-семантика, но чистить
 * они обязаны ТОЛЬКО свой источник. Всё в одной транзакции — при падении
 * вставки старый снапшот остаётся на месте, а не превращается в пустую
 * таблицу (до Этапа 2c именно так и было).
 *
 * Дубли по ключу уникальности схлопываются заранее (last-wins): без этого
 * многострочный INSERT ... ON CONFLICT падает с «cannot affect row a second
 * time», если Ozon вернул один и тот же SKU на складе дважды.
 */
export async function replaceWarehouseStocksWindow(args: {
  tenantId: string;
  accountId: string;
  source: OzonStockSource;
  rows: WarehouseStockInsert[];
  onProgress?: (processed: number, total: number) => void;
}): Promise<{ inserted: number; duplicatesCollapsed: number }> {
  const deduped = new Map<string, WarehouseStockInsert>();
  for (const row of args.rows) {
    deduped.set(`${row.sku}\x00${row.warehouseName}`, row);
  }
  const rows = Array.from(deduped.values());
  const duplicatesCollapsed = args.rows.length - rows.length;

  await db.transaction(async (tx) => {
    await tx
      .delete(ozonWarehouseStocks)
      .where(
        and(
          eq(ozonWarehouseStocks.tenantId, args.tenantId),
          eq(ozonWarehouseStocks.accountId, args.accountId),
          eq(ozonWarehouseStocks.source, args.source),
        ),
      );

    for (let i = 0; i < rows.length; i += WAREHOUSE_STOCKS_INSERT_BATCH) {
      const chunk = rows.slice(i, i + WAREHOUSE_STOCKS_INSERT_BATCH);
      await tx
        .insert(ozonWarehouseStocks)
        .values(chunk)
        // Страховка от параллельного sync того же аккаунта: DELETE выше уже
        // очистил окно, поэтому конфликт возможен только с чужой транзакцией.
        .onConflictDoNothing({
          target: [
            ozonWarehouseStocks.accountId,
            ozonWarehouseStocks.sku,
            ozonWarehouseStocks.warehouseName,
            ozonWarehouseStocks.source,
          ],
        });
      args.onProgress?.(Math.min(i + chunk.length, rows.length), rows.length);
    }
  });

  return { inserted: rows.length, duplicatesCollapsed };
}

export async function syncWarehouseStocksStage(
  ctx: StageContext,
): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const clusterMap = await loadWarehouseClusterMap(ctx.tenantId, ctx.accountId);
    const warnings: string[] = [];
    if (clusterMap.size === 0) {
      warnings.push(
        'Справочник кластеров пуст — остатки сохранятся без cluster_name. ' +
          'Запустите sync stage `clusters` (Seller API POST /v1/cluster/list).',
      );
    }

    // Собираем все строки через offset-пагинацию.
    const all: WarehouseStockInsert[] = [];
    let hitPageLimit = false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await analyticsStockOnWarehouses(ctx.client, {
        limit: PAGE_LIMIT,
        offset: page * PAGE_LIMIT,
      });
      const rows = res.rows ?? [];
      for (const r of rows) {
        const sku = r.sku !== undefined ? String(r.sku) : '';
        const warehouseName = (r.warehouse_name ?? '').trim();
        if (!sku || !warehouseName) continue;
        // Нормализация только в JS: SQL `lower()` в C-локали БД кириллицу
        // не приводит к нижнему регистру (см. cluster-agg.ts).
        const cluster = clusterMap.get(normalizeWarehouseName(warehouseName)) ?? null;
        all.push({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          sku,
          offerId: r.item_code ?? null,
          warehouseName,
          source: 'FBO',
          warehouseId: null,
          warehouseType: null,
          clusterId: cluster?.clusterId ?? null,
          clusterName: cluster?.clusterName ?? null,
          clusterType: cluster?.clusterType ?? null,
          freeToSellAmount: r.free_to_sell_amount ?? 0,
          promisedAmount: r.promised_amount ?? 0,
          reservedAmount: r.reserved_amount ?? 0,
          raw: r as unknown as Record<string, unknown>,
        });
      }
      if (rows.length < PAGE_LIMIT) break;
      // Последняя итерация цикла отдала полную страницу — значит данные
      // обрезаны лимитом. Раньше это происходило молча.
      if (page === MAX_PAGES - 1) hitPageLimit = true;
    }

    if (hitPageLimit) {
      warnings.push(
        `Достигнут лимит пагинации: ${MAX_PAGES} страниц × ${PAGE_LIMIT} строк ` +
          `(${MAX_PAGES * PAGE_LIMIT}). Остатки FBO загружены не полностью — ` +
          'увеличьте MAX_PAGES в sync/warehouse-stocks.ts.',
      );
    }

    const { inserted, duplicatesCollapsed } = await replaceWarehouseStocksWindow({
      tenantId: ctx.tenantId,
      accountId: ctx.accountId,
      source: 'FBO',
      rows: all,
      onProgress: ctx.onProgress,
    });
    if (duplicatesCollapsed > 0) {
      warnings.push(
        `Ozon вернул ${duplicatesCollapsed} дублей (sku × склад) — схлопнуты в одну строку.`,
      );
    }

    return { itemsProcessed: inserted, itemsTotal: all.length, warnings };
  });
}
