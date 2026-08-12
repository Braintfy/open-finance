// PURPOSE: Остатки по географическим кластерам Ozon. Источник —
// ozon_warehouse_stocks (Seller `POST /v2/analytics/stock_on_warehouses`) +
// ozon_clusters (Seller `POST /v1/cluster/list`, маппинг
// warehouse_name → cluster). Опционально — продажи и выручка за период
// из ozon_orders по `raw->'analytics_data'->>'warehouse_name'`.
//
// Роут тонкий: auth + разбор query. Вся агрегация — в
// `src/lib/marketplaces/ozon/cluster-stocks-query.ts` (её же гоняет
// smoke-тест `scripts/test-ozon-cluster-agg.ts`).
//
// v0.18.22: оба источника переведены на Seller API. Раньше `cluster/list`
// ошибочно дёргали через Performance API (→ 404) и `stock_on_warehouses`
// бил по deprecated `/v1` (→ 404).
//
// Этап 1 LK_V2_PLAN: три бага, из-за которых ВСЯ выручка периода оседала
// в строке «Без кластера»:
//   1. склад заказа читался из `raw->>'warehouseName'` — такого поля в
//      постингах нет, реальный путь `raw->'analytics_data'->>'warehouse_name'`;
//   2. JOIN склада шёл по сырому имени, а регистры расходятся между
//      Seller-эндпоинтами («Новосибирск_РФЦ_НОВЫЙ» vs «НОВОСИБИРСК_РФЦ_НОВЫЙ»);
//   3. кластер резолвился ЧЕРЕЗ снапшот остатков, поэтому склад с продажами,
//      но без текущего остатка, кластера не получал.
//
// Этап 2a LK_V2_PLAN: `?groupBy=warehouse` — иерархия кластер→склады.
// Схема БД не менялась: разрез по складам берётся из уже существующей колонки
// `ozon_warehouse_stocks.warehouse_name` и имени склада заказа.
//
// Этап 2b LK_V2_PLAN: `?source=all|FBO|FBS`. Собственные склады продавца
// синкает стейдж `fbsWarehouseStocks` (`source='FBS'` в той же таблице);
// в географические кластеры Ozon они не входят и группируются отдельной
// псевдо-строкой «FBS (свои склады)».

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  loadOzonClusterStocks,
  type OzonClusterStocksGroupBy,
  type OzonClusterStocksMeta,
  type OzonClusterStocksTotals,
} from '@/lib/marketplaces/ozon/cluster-stocks-query';
import {
  isWarehouseSortKey,
  isStockSourceFilter,
  DEFAULT_WAREHOUSE_LIMIT,
  MAX_WAREHOUSE_LIMIT,
  type ClusterAggRow,
  type StockSourceFilter,
  type WarehouseAggRow,
} from '@/lib/marketplaces/ozon/cluster-agg';

export const runtime = 'nodejs';

export type OzonClusterStocksRow = ClusterAggRow;
export type OzonWarehouseRow = WarehouseAggRow;

export type OzonClusterStocksResponse = {
  ok: true;
  /**
   * `groupBy='warehouse'` → у каждой строки заполнены `warehouses` (топ-N),
   * `warehousesTotal` и `hiddenWarehouses`. Сами цифры кластеров одинаковы
   * в обоих режимах.
   */
  groupBy: OzonClusterStocksGroupBy;
  /** Применённый фильтр источника остатков (Этап 2b). Дублируется в `meta`. */
  source: StockSourceFilter;
  rows: OzonClusterStocksRow[];
  totals: OzonClusterStocksTotals;
  period: { from: string; to: string } | null;
  /**
   * Диагностика для empty-state UI. Когда `rows.length === 0`, фронт
   * показывает actionable card («Запустите sync-стейджи: clusters +
   * warehouseStocks») вместо пустого графика.
   */
  meta: OzonClusterStocksMeta;
};

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId');
    const fromIso = url.searchParams.get('from');
    const toIso = url.searchParams.get('to');
    // Дефолт 'cluster' — обратная совместимость со старыми вызовами.
    const groupBy: OzonClusterStocksGroupBy =
      url.searchParams.get('groupBy') === 'warehouse' ? 'warehouse' : 'cluster';

    // Именно `Number(строка || null)`: без явной проверки на пустоту
    // `Number(null) === 0` прошёл бы isFinite и схлопнул лимит до 1.
    const rawLimit = url.searchParams.get('warehouseLimit');
    const parsedLimit = rawLimit ? Number(rawLimit) : NaN;
    const warehouseLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(MAX_WAREHOUSE_LIMIT, Math.trunc(parsedLimit)))
      : DEFAULT_WAREHOUSE_LIMIT;

    const rawSort = url.searchParams.get('warehouseSort') ?? '';
    const warehouseSort = isWarehouseSortKey(rawSort) ? rawSort : undefined;
    const warehouseSortDir =
      url.searchParams.get('warehouseSortDir') === 'asc' ? 'asc' : 'desc';

    // Дефолт 'all' — обратная совместимость: до Этапа 2b параметра не было,
    // а в таблице лежали только FBO-строки.
    const rawSource = url.searchParams.get('source') ?? '';
    const source: StockSourceFilter = isStockSourceFilter(rawSource) ? rawSource : 'all';

    const { rows, totals, meta } = await loadOzonClusterStocks({
      tenantId: session.tenantId,
      accountId,
      fromIso,
      toIso,
      groupBy,
      warehouseLimit,
      warehouseSort,
      warehouseSortDir,
      source,
    });

    return NextResponse.json({
      ok: true,
      groupBy,
      source,
      rows,
      totals,
      period: fromIso && toIso ? { from: fromIso, to: toIso } : null,
      meta,
    } satisfies OzonClusterStocksResponse);
  } catch (e) {
    console.error('[marketplaces] GET /ozon/cluster-stocks-v2 failed:', e);
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
