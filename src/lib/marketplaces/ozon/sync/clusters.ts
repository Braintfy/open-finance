// PURPOSE: Sync справочника географических кластеров Ozon через Seller
// API `POST /v1/cluster/list`. Используется для маппинга
// warehouse_name → cluster_name в блоке «Остатки по кластерам».
//
// История: раньше пытались дёргать `/api/client/cluster/list` через
// Performance API клиент — этот путь не существует и возвращает 404.
// С v0.18.22 справочник читается из Seller API.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonClusters } from '@/lib/db/schema/marketplaces';
import { getClusterListSeller } from '../endpoints';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

export async function syncClustersStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    // Performance API больше не нужен — справочник кластеров живёт в Seller API.
    const list = await getClusterListSeller(ctx.client);
    if (list.length === 0) {
      return {
        itemsProcessed: 0,
        ok: true,
        warnings: ['Seller API вернул пустой список кластеров (POST /v1/cluster/list).'],
      };
    }

    // Полная замена справочника для этого аккаунта.
    await db.execute(sql`
      DELETE FROM ${ozonClusters}
      WHERE tenant_id = ${ctx.tenantId} AND account_id = ${ctx.accountId}
    `);

    let processed = 0;
    for (const c of list) {
      await db
        .insert(ozonClusters)
        .values({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          clusterId: c.clusterId,
          clusterName: c.clusterName,
          clusterType: c.clusterType,
          warehouseNames: c.warehouseNames,
          raw: c as unknown as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [ozonClusters.accountId, ozonClusters.clusterId],
          set: {
            clusterName: c.clusterName,
            clusterType: c.clusterType,
            warehouseNames: c.warehouseNames,
            raw: c as unknown as Record<string, unknown>,
            syncedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      processed += 1;
      ctx.onProgress?.(processed, list.length);
    }

    return { itemsProcessed: processed, itemsTotal: list.length };
  });
}

/**
 * Helper: загружает справочник склад→кластер для аккаунта.
 * Используется в stage warehouse-stocks и в API endpoint cluster-stocks-v2.
 */
export async function loadWarehouseClusterMap(
  tenantId: string,
  accountId: string,
): Promise<Map<string, { clusterId: string; clusterName: string; clusterType: string | null }>> {
  const rows = await db
    .select({
      clusterId: ozonClusters.clusterId,
      clusterName: ozonClusters.clusterName,
      clusterType: ozonClusters.clusterType,
      warehouseNames: ozonClusters.warehouseNames,
    })
    .from(ozonClusters)
    .where(
      and(
        eq(ozonClusters.tenantId, tenantId),
        eq(ozonClusters.accountId, accountId),
      ),
    );
  const map = new Map<
    string,
    { clusterId: string; clusterName: string; clusterType: string | null }
  >();
  for (const c of rows) {
    for (const wname of c.warehouseNames ?? []) {
      const norm = wname.trim().toLowerCase();
      if (norm) {
        map.set(norm, {
          clusterId: c.clusterId,
          clusterName: c.clusterName,
          clusterType: c.clusterType,
        });
      }
    }
  }
  return map;
}
