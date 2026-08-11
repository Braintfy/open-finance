// PURPOSE: Sync справочника географических кластеров Ozon через Seller
// API `POST /v1/cluster/list`. Используется для маппинга
// warehouse_name → cluster_name.
//
// История: раньше пытались дёргать `/api/client/cluster/list` через
// Performance API клиент — этот путь не существует и возвращает 404.
// С v0.18.22 справочник читается из Seller API.
//
// Этап 1 LK_V2_PLAN: тянем ОБА типа кластеров — `CLUSTER_TYPE_OZON` и
// `CLUSTER_TYPE_CIS`. Раньше запрашивали только Ozon, из-за чего склады
// СНГ (АСТАНА_РФЦ, МИНСК_МПСЦ) не резолвились и их заказы падали
// в строку «Без кластера».
//
// Важно: этот справочник — ЕДИНСТВЕННЫЙ источник правды для резолва
// склад→кластер. Снапшот `ozon_warehouse_stocks.cluster_id` проставляется
// на insert стейджа `warehouseStocks` и потому отражает состояние
// справочника на момент того синка И покрывает только склады, где сейчас
// лежит товар. Поэтому потребители (API `cluster-stocks-v2`) обязаны
// резолвить кластер заказа через `loadWarehouseClusterMap()`, а снапшот
// использовать лишь как fallback.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonClusters } from '@/lib/db/schema/marketplaces';
import { getClusterListSeller, type ClusterListItem } from '../endpoints';
import { normalizeWarehouseName, type ClusterRef } from '../cluster-agg';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

const CLUSTER_TYPES = ['CLUSTER_TYPE_OZON', 'CLUSTER_TYPE_CIS'] as const;

export async function syncClustersStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    // Performance API больше не нужен — справочник кластеров живёт в Seller API.
    // Оба типа мержим по clusterId: аккаунт может торговать и в РФ, и в СНГ.
    const warnings: string[] = [];
    const merged = new Map<string, ClusterListItem>();
    for (const clusterType of CLUSTER_TYPES) {
      let part: ClusterListItem[];
      try {
        part = await getClusterListSeller(ctx.client, { clusterType });
      } catch (e) {
        // CIS доступен не всем аккаунтам — 4xx здесь не должен ронять стейдж.
        warnings.push(
          `cluster/list (${clusterType}) недоступен: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        continue;
      }
      for (const c of part) {
        const prev = merged.get(c.clusterId);
        if (!prev) {
          merged.set(c.clusterId, c);
          continue;
        }
        prev.warehouseNames = Array.from(
          new Set([...prev.warehouseNames, ...c.warehouseNames]),
        );
      }
    }

    const list = Array.from(merged.values());
    if (list.length === 0) {
      return {
        itemsProcessed: 0,
        ok: true,
        warnings: [
          'Seller API вернул пустой список кластеров (POST /v1/cluster/list).',
          ...warnings,
        ],
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

    return { itemsProcessed: processed, itemsTotal: list.length, warnings };
  });
}

/**
 * Helper: загружает справочник склад→кластер.
 * Используется в stage warehouse-stocks и в API endpoint cluster-stocks-v2.
 *
 * `accountId = null` → все Ozon-аккаунты тенанта (режим блока без фильтра
 * по магазину).
 *
 * Ключ нормализуется через `normalizeWarehouseName` (JS `toLowerCase`), а не
 * через SQL `lower()`: БД создана с `--locale=C`, где `lower()` кириллицу
 * не трогает. См. комментарий в `cluster-agg.ts`.
 */
export async function loadWarehouseClusterMap(
  tenantId: string,
  accountId: string | null,
): Promise<Map<string, ClusterRef>> {
  const rows = await db
    .select({
      clusterId: ozonClusters.clusterId,
      clusterName: ozonClusters.clusterName,
      clusterType: ozonClusters.clusterType,
      warehouseNames: ozonClusters.warehouseNames,
    })
    .from(ozonClusters)
    .where(
      accountId
        ? and(
            eq(ozonClusters.tenantId, tenantId),
            eq(ozonClusters.accountId, accountId),
          )
        : eq(ozonClusters.tenantId, tenantId),
    );
  const map = new Map<string, ClusterRef>();
  for (const c of rows) {
    for (const wname of c.warehouseNames ?? []) {
      const norm = normalizeWarehouseName(wname);
      if (norm) {
        map.set(norm, {
          clusterId: c.clusterId,
          clusterName: c.clusterName,
          clusterType: c.clusterType,
          // Каноническое имя склада — для показа в режиме groupBy='warehouse'
          // (в постингах то же имя приходит капсом).
          warehouseName: wname,
        });
      }
    }
  }
  return map;
}
