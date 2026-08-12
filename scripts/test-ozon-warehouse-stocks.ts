// PURPOSE: Диагностика данных для блока «Ozon · Остатки по кластерам».
// Считает количество строк в `ozon_warehouse_stocks` и `ozon_clusters`
// per-account и печатает сводку. Используется когда блок показывает
// пустое состояние и нужно понять: данных нет (sync не запускался) или
// есть, но JOIN неправильный.
//
// Запуск:
//   pnpm tsx scripts/test-ozon-warehouse-stocks.ts
//   pnpm tsx scripts/test-ozon-warehouse-stocks.ts <accountId>
//   pnpm tsx scripts/test-ozon-warehouse-stocks.ts <accountId> --live
//     ↑ --live дополнительно дёргает Seller API напрямую:
//        POST /v1/cluster/list, POST /v2/analytics/stock_on_warehouses и
//        (Этап 2b) POST /v1/warehouse/list + /v1/product/info/stocks-by-warehouse/fbs,
//        чтобы воспроизвести 404/empty без полного sync-пайплайна.
//
// Скрипт read-only (write в БД не делает).

import { eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/db/client';
import {
  marketplaceAccounts,
  ozonWarehouseStocks,
  ozonClusters,
  ozonOrders,
} from '../src/lib/db/schema/marketplaces';
import { decryptAccountApiKey } from '../src/lib/marketplaces/queries';
import { OzonClient } from '../src/lib/marketplaces/ozon/client';
import {
  getClusterListSeller,
  analyticsStockOnWarehouses,
  getFbsWarehouseList,
  getStocksByWarehouseFbs,
  productInfoStocks,
} from '../src/lib/marketplaces/ozon/endpoints';

async function main() {
  const filterAccountId = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : null;
  const live = process.argv.includes('--live');

  console.log('=== Ozon warehouse stocks / clusters diagnostic ===');
  if (filterAccountId) {
    console.log(`Filter by accountId: ${filterAccountId}`);
  } else {
    console.log('No accountId filter — checking all active Ozon accounts.');
  }
  if (live) {
    console.log('Mode: --live (will hit Seller API: /v1/cluster/list + /v2/analytics/stock_on_warehouses)');
  }

  const accounts = await db
    .select({
      id: marketplaceAccounts.id,
      tenantId: marketplaceAccounts.tenantId,
      name: marketplaceAccounts.name,
      marketplace: marketplaceAccounts.marketplace,
      status: marketplaceAccounts.status,
      clientId: marketplaceAccounts.clientId,
      apiKeyEnc: marketplaceAccounts.apiKeyEnc,
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

    // Разбивка по источнику (Этап 2b). Отдельным запросом с try/catch:
    // на БД без миграции 0012 колонки `source` ещё нет, и остальная
    // диагностика не должна из-за этого падать.
    let fbsRows: number | null = null;
    try {
      type SourceRow = { source: string; cnt: number; warehouses: number };
      const srcResult = await db.execute<SourceRow>(sql`
        SELECT source, COUNT(*)::int AS cnt,
               COUNT(DISTINCT warehouse_name)::int AS warehouses
        FROM ${ozonWarehouseStocks}
        WHERE tenant_id = ${acc.tenantId} AND account_id = ${acc.id}
        GROUP BY source
        ORDER BY source
      `);
      const srcRows: SourceRow[] = Array.isArray(srcResult)
        ? (srcResult as SourceRow[])
        : ((srcResult as unknown as { rows: SourceRow[] }).rows ?? []);
      fbsRows = srcRows.find((r) => r.source === 'FBS')?.cnt ?? 0;
      console.log(
        `  по источникам:                        ${
          srcRows.length === 0
            ? '(нет строк)'
            : srcRows
                .map((r) => `${r.source}: ${r.cnt} строк / ${r.warehouses} складов`)
                .join(', ')
        }`,
      );
    } catch (e) {
      console.log(
        '  по источникам:                        (колонки source нет — примените миграцию 0012_ozon_fbs_stocks)',
        e instanceof Error ? `[${e.message}]` : '',
      );
    }

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

    // 3. orders (для резолва склад→кластер).
    // ВАЖНО: имя склада лежит в `raw->'analytics_data'->>'warehouse_name'`.
    // Легаси-путь `raw->>'warehouseName'` НЕ существует ни в одном постинге —
    // именно из-за него вся выручка периода когда-то оседала в «Без кластера».
    type OrdersDiag = { cnt: number; with_wh_name: number; legacy_wh_name: number };
    const ordersResult = await db.execute<OrdersDiag>(sql`
      SELECT
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (
          WHERE COALESCE(raw->'analytics_data'->>'warehouse_name', '') <> ''
        )::int AS with_wh_name,
        COUNT(*) FILTER (WHERE raw->>'warehouseName' IS NOT NULL)::int AS legacy_wh_name
      FROM ${ozonOrders}
      WHERE tenant_id = ${acc.tenantId} AND account_id = ${acc.id}
        AND order_created_at >= NOW() - INTERVAL '30 days'
    `);
    const ordersRows: OrdersDiag[] = Array.isArray(ordersResult)
      ? (ordersResult as OrdersDiag[])
      : ((ordersResult as unknown as { rows: OrdersDiag[] }).rows ?? []);
    const ordersAgg = ordersRows[0] ?? { cnt: 0, with_wh_name: 0, legacy_wh_name: 0 };
    console.log(
      `  ozon_orders (30d) rows:               ${ordersAgg.cnt}`,
      `(with analytics_data.warehouse_name=${ordersAgg.with_wh_name},`,
      `legacy raw.warehouseName=${ordersAgg.legacy_wh_name})`,
    );

    // 4. Live Seller API sanity-call (по --live флагу)
    if (live && acc.clientId && acc.apiKeyEnc) {
      try {
        const apiKey = decryptAccountApiKey({
          apiKeyEnc: acc.apiKeyEnc,
        } as unknown as Parameters<typeof decryptAccountApiKey>[0]);
        const client = new OzonClient({ clientId: acc.clientId, apiKey });

        console.log('  --- Live Seller API check ---');
        // Стейдж clusters тянет ОБА типа: без CLUSTER_TYPE_CIS склады
        // Казахстана/Беларуси (АСТАНА_РФЦ, МИНСК_МПСЦ) не резолвятся.
        for (const clusterType of ['CLUSTER_TYPE_OZON', 'CLUSTER_TYPE_CIS'] as const) {
          try {
            const clusters = await getClusterListSeller(client, { clusterType });
            console.log(
              `  POST /v1/cluster/list ${clusterType.replace('CLUSTER_TYPE_', '').padEnd(4)}: ✓ clusters=${clusters.length}`,
              clusters
                .slice(0, 3)
                .map((c) => `${c.clusterId}:${c.clusterName} (${c.warehouseNames.length} wh)`)
                .join(', '),
            );
          } catch (e) {
            console.error(
              `  POST /v1/cluster/list ${clusterType.replace('CLUSTER_TYPE_', '').padEnd(4)}: ✗`,
              e instanceof Error ? e.message : e,
            );
          }
        }
        try {
          const stocks = await analyticsStockOnWarehouses(client, { limit: 50 });
          console.log(
            `  POST /v2/analytics/stock_on_warehouses: ✓ rows=${stocks.rows.length}`,
            stocks.rows.slice(0, 2).map((r) => `${r.sku ?? '?'}@${r.warehouse_name ?? '?'}=${r.free_to_sell_amount ?? 0}`).join(', '),
          );
        } catch (e) {
          console.error('  POST /v2/analytics/stock_on_warehouses: ✗', e instanceof Error ? e.message : e);
        }
        // Этап 2b: собственные склады продавца. Проверяем ту же пару вызовов,
        // что делает стейдж fbsWarehouseStocks.
        try {
          const own = await getFbsWarehouseList(client);
          console.log(
            `  POST /v1/warehouse/list:                ✓ складов=${own.length}`,
            own
              .slice(0, 3)
              .map((w) => `${w.warehouseId}:${w.name} (${w.warehouseType})`)
              .join(', '),
          );
          // Пробный запрос остатков по первым SKU каталога: у метода нет
          // пагинации, «страница» — это список SKU во входе.
          const catalog = await productInfoStocks(client, { limit: 100 });
          const skus = (catalog.items ?? [])
            .map((i) => (i.sku ? String(i.sku) : ''))
            .filter(Boolean)
            .slice(0, 50);
          if (skus.length === 0) {
            console.log('  POST /v1/product/info/stocks-by-warehouse/fbs: пропуск (нет SKU в каталоге)');
          } else {
            const fbsStocks = await getStocksByWarehouseFbs(client, { sku: skus });
            console.log(
              `  POST /v1/product/info/stocks-by-warehouse/fbs: ✓ строк=${fbsStocks.length} (по ${skus.length} SKU)`,
              fbsStocks
                .slice(0, 2)
                .map((r) => `${r.sku}@${r.warehouseName}=${r.present}`)
                .join(', '),
            );
          }
        } catch (e) {
          console.error(
            '  FBS-склады (warehouse/list + stocks-by-warehouse/fbs): ✗',
            e instanceof Error ? e.message : e,
          );
        }
      } catch (e) {
        console.error('  Live API check skipped: cannot decrypt api_key:', e instanceof Error ? e.message : e);
      }
    }

    // Diagnosis suggestion
    const diags: string[] = [];
    if (stocksAgg.cnt === 0) {
      diags.push('▶ Запустите sync-стейдж «Остатки по кластерам» (warehouse_stocks)');
    }
    if (clustersCount === 0) {
      diags.push('▶ Запустите sync-стейдж «Кластеры» (cluster_list)');
    }
    if (fbsRows === 0) {
      diags.push(
        '▶ FBS-остатков нет: запустите стейдж «Остатки по своим складам (FBS)» ' +
          '(или у продавца просто нет своих складов)',
      );
    }
    if (stocksAgg.cnt > 0 && stocksAgg.with_cluster === 0) {
      diags.push('⚠ warehouse_stocks есть, но все cluster_id=NULL → проверьте маппинг warehouse_name → cluster в sync/clusters.ts');
    }
    if (ordersAgg.cnt > 0 && ordersAgg.with_wh_name === 0) {
      diags.push('⚠ ни у одного заказа нет analytics_data.warehouse_name → выручка уйдёт в «Склад не указан» (FBS-постинги — ожидаемо)');
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
