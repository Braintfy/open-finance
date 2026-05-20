// PURPOSE: Sync остатков FBO по конкретным складам через Seller API
// `/v2/analytics/stock_on_warehouses`. Маппит warehouse_name → кластер
// через справочник ozon_clusters (опционально — если sync clusters прошёл).
//
// Данные используются в блоке «Остатки по кластерам».
//
// v0.18.22: путь поднят с /v1 → /v2 (v1 снят с поддержки Ozon, отвечает 404).

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonWarehouseStocks } from '@/lib/db/schema/marketplaces';
import { analyticsStockOnWarehouses } from '../endpoints';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { loadWarehouseClusterMap } from './clusters';

const PAGE_LIMIT = 1000;
const MAX_PAGES = 50; // 50_000 строк — с запасом

export async function syncWarehouseStocksStage(
  ctx: StageContext,
): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const clusterMap = await loadWarehouseClusterMap(ctx.tenantId, ctx.accountId);
    const warnings: string[] = [];
    if (clusterMap.size === 0) {
      warnings.push(
        'Справочник кластеров пуст — остатки сохранятся без cluster_name. ' +
          'Запустите sync stage `clusters` (Performance API).',
      );
    }

    // Собираем все строки через offset-пагинацию.
    const all: Array<{
      sku: string;
      offerId: string | null;
      warehouseName: string;
      promised: number;
      free: number;
      reserved: number;
      raw: Record<string, unknown>;
    }> = [];

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
        all.push({
          sku,
          offerId: r.item_code ?? null,
          warehouseName,
          promised: r.promised_amount ?? 0,
          free: r.free_to_sell_amount ?? 0,
          reserved: r.reserved_amount ?? 0,
          raw: r as unknown as Record<string, unknown>,
        });
      }
      if (rows.length < PAGE_LIMIT) break;
    }

    // Полная замена окна для аккаунта (snapshot-семантика).
    await db.execute(sql`
      DELETE FROM ${ozonWarehouseStocks}
      WHERE tenant_id = ${ctx.tenantId} AND account_id = ${ctx.accountId}
    `);

    let processed = 0;
    for (const r of all) {
      const cluster = clusterMap.get(r.warehouseName.toLowerCase()) ?? null;
      await db
        .insert(ozonWarehouseStocks)
        .values({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          sku: r.sku,
          offerId: r.offerId,
          warehouseName: r.warehouseName,
          clusterId: cluster?.clusterId ?? null,
          clusterName: cluster?.clusterName ?? null,
          clusterType: cluster?.clusterType ?? null,
          freeToSellAmount: r.free,
          promisedAmount: r.promised,
          reservedAmount: r.reserved,
          raw: r.raw,
        })
        .onConflictDoUpdate({
          target: [
            ozonWarehouseStocks.accountId,
            ozonWarehouseStocks.sku,
            ozonWarehouseStocks.warehouseName,
          ],
          set: {
            offerId: r.offerId,
            clusterId: cluster?.clusterId ?? null,
            clusterName: cluster?.clusterName ?? null,
            clusterType: cluster?.clusterType ?? null,
            freeToSellAmount: r.free,
            promisedAmount: r.promised,
            reservedAmount: r.reserved,
            raw: r.raw,
            fetchedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      processed += 1;
      ctx.onProgress?.(processed, all.length);
    }

    return { itemsProcessed: processed, itemsTotal: all.length, warnings };
  });
}
