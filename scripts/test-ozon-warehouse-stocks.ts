// PURPOSE: Диагностика данных для блока «Ozon · Остатки по кластерам».
// Считает количество строк в `ozon_warehouse_stocks` и `ozon_clusters`
// per-account и печатает сводку. Используется когда блок показывает
// пустое состояние и нужно понять: данных нет (sync не запускался) или
// есть, но JOIN неправильный.
//
// Запуск:
//   pnpm tsx scripts/test-ozon-warehouse-stocks.ts
//   pnpm tsx scripts/test-ozon-warehouse-stocks.ts <accountId>
//
// Скрипт read-only.

import { eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/db/client';
import {
  marketplaceAccounts,
  ozonWarehouseStocks,
  ozonClusters,
  ozonOrders,
} from '../src/lib/db/schema/marketplaces';

async function main() {
  const filterAccountId = process.argv[2] ?? null;

  console.log('=== Ozon warehouse stocks / clusters diagnostic ===');
  if (filterAccountId) {
    console.log(`Filter by accountId: ${filterAccountId}`);
  } else {
    console.log('No accountId filter — checking all active Ozon accounts.');
  }

  const accounts = await db
    .select({
      id: marketplaceAccounts.id,
      tenantId: marketplaceAccounts.tenantId,
      name: marketplaceAccounts.name,
      marketplace: marketplaceAccounts.marketplace,
      status: marketplaceAccounts.status,
    })
    .from(marketplaceAccounts)
    .where(
      filterAccountId
        ? eq(marketplaceAccounts.id, filterAccountId)
        : eq(marketplaceAccounts.marketplace, 'ozon'),
    );

  if (accounts.length === 0) {
    console.error('No accounts found.');
    process.exit(2);
  }

  for (const acc of accounts) {
    console.log(`\n--- Account ${acc.id} (${acc.name ?? 'no name'}) ---`);
    console.log(`  tenant=${acc.tenantId}, marketplace=${acc.marketplace}, status=${acc.status}`);

    // 1. warehouse_stocks
    const stocksAggResult = await db.execute<{
      cnt: number;
      with_cluster: number;
      without_cluster: number;
      last_fetch: string | null;
    }>(sql`
      SELECT
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (WHERE cluster_id IS NOT NULL)::int AS with_cluster,
        COUNT(*) FILTER (WHERE cluster_id IS NULL)::int AS without_cluster,
        MAX(fetched_at)::text AS last_fetch
      FROM ${ozonWarehouseStocks}
      WHERE tenant_id = ${acc.tenantId}
        AND account_id = ${acc.id}
    `);
    const stocksRows: Array<{
      cnt: number;
      with_cluster: number;
      without_cluster: number;
      last_fetch: string | null;
    }> = Array.isArray(stocksAggResult)
      ? (stocksAggResult as Array<{
          cnt: number;
          with_cluster: number;
          without_cluster: number;
          last_fetch: string | null;
        }>)
      : ((stocksAggResult as unknown as {
          rows: Array<{
            cnt: number;
            with_cluster: number;
            without_cluster: number;
            last_fetch: string | null;
          }>;
        }).rows ?? []);
    const stocksAgg = stocksRows[0] ?? {
      cnt: 0,
      with_cluster: 0,
      without_cluster: 0,
      last_fetch: null,
    };
    console.log(
      `  ozon_warehouse_stocks rows:           ${stocksAgg.cnt}`,
      `(with cluster_id=${stocksAgg.with_cluster}, without=${stocksAgg.without_cluster})`,
    );
    console.log(`  warehouse_stocks last fetch:          ${stocksAgg.last_fetch ?? '(never)'}`);

    // 2. clusters
    const clustersResult = await db.execute<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM ${ozonClusters}
      WHERE tenant_id = ${acc.tenantId} AND account_id = ${acc.id}
    `);
    const clustersRows: Array<{ cnt: number }> = Array.isArray(clustersResult)
      ? (clustersResult as Array<{ cnt: number }>)
      : ((clustersResult as unknown as { rows: Array<{ cnt: number }> }).rows ?? []);
    const clustersCount = clustersRows[0]?.cnt ?? 0;
    console.log(`  ozon_clusters rows:                   ${clustersCount}`);

    // 3. orders (для JOIN-ability на warehouse_name)
    const ordersResult = await db.execute<{
      cnt: number;
      with_wh_name: number;
    }>(sql`
      SELECT
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (WHERE raw->>'warehouseName' IS NOT NULL)::int AS with_wh_name
      FROM ${ozonOrders}
      WHERE tenant_id = ${acc.tenantId} AND account_id = ${acc.id}
        AND order_created_at >= NOW() - INTERVAL '30 days'
    `);
    const ordersRows: Array<{ cnt: number; with_wh_name: number }> = Array.isArray(ordersResult)
      ? (ordersResult as Array<{ cnt: number; with_wh_name: number }>)
      : ((ordersResult as unknown as { rows: Array<{ cnt: number; with_wh_name: number }> }).rows ?? []);
    const ordersAgg = ordersRows[0] ?? { cnt: 0, with_wh_name: 0 };
    console.log(
      `  ozon_orders (30d) rows:               ${ordersAgg.cnt}`,
      `(with raw.warehouseName=${ordersAgg.with_wh_name})`,
    );

    // Diagnosis suggestion
    const diags: string[] = [];
    if (stocksAgg.cnt === 0) {
      diags.push('▶ Запустите sync-стейдж «Остатки по кластерам» (warehouse_stocks)');
    }
    if (clustersCount === 0) {
      diags.push('▶ Запустите sync-стейдж «Кластеры» (cluster_list)');
    }
    if (stocksAgg.cnt > 0 && stocksAgg.with_cluster === 0) {
      diags.push('⚠ warehouse_stocks есть, но все cluster_id=NULL → проверьте маппинг warehouse_name → cluster в sync/clusters.ts');
    }
    if (diags.length === 0) {
      console.log('  ✓ Данные есть, блок должен показывать ряды.');
    } else {
      console.log('  Diagnosis:');
      for (const d of diags) console.log(`    ${d}`);
    }
  }

  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
