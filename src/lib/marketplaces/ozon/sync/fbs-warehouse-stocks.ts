// PURPOSE: Sync остатков по СОБСТВЕННЫМ складам продавца (FBS/rFBS) через
// Seller API `/v1/warehouse/list` + `/v1/product/info/stocks-by-warehouse/fbs`.
// Пишет в ту же таблицу `ozon_warehouse_stocks`, что и FBO-стейдж, но в своё
// окно `source='FBS'` (Этап 2b LK_V2_PLAN).
//
// Зачем отдельный стейдж: `/v2/analytics/stock_on_warehouses` (стейдж
// `warehouseStocks`) отдаёт ТОЛЬКО фулфилмент Ozon. У продавцов, торгующих со
// своих складов, FBS-складов бывает больше, чем FBO, и до Этапа 2b их остатки
// не были видны в системе вообще.
//
// Особенности контракта:
//  - у `/v1/product/info/stocks-by-warehouse/fbs` НЕТ пагинации: «страница» —
//    это список SKU во входе, поэтому список режется по FBS_STOCKS_SKU_CHUNK;
//  - список SKU берём из `/v4/product/info/stocks` (тот же источник, что у
//    стейджа `stocks`) — стейдж самодостаточен и не зависит от того,
//    синкался ли каталог в `unit_products`;
//  - оттуда же берём подсказку «у SKU вообще есть FBS-остаток» и запрашиваем
//    склады только по таким SKU (иначе на каталоге в 10k SKU это 20 лишних
//    запросов на каждом синке чисто-FBO аккаунта);
//  - `promised_amount` у FBS нет — Ozon отдаёт только present/reserved.
//
// Кластеры FBS-складам НЕ проставляются: справочник `/v1/cluster/list` — это
// география фулфилмента Ozon, склады продавца в него не входят. Блок остатков
// собирает их в отдельную псевдо-строку «FBS (свои склады)», а не в общую
// «Без кластера» (см. cluster-agg.ts).

import {
  getFbsWarehouseList,
  getStocksByWarehouseFbs,
  productInfoStocks,
  FBS_STOCKS_SKU_CHUNK,
  type FbsWarehouseItem,
} from '../endpoints';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { replaceWarehouseStocksWindow } from './warehouse-stocks';
import type { ozonWarehouseStocks } from '@/lib/db/schema/marketplaces';

const CATALOG_PAGE_LIMIT = 1000;
const CATALOG_MAX_PAGES = 50; // 50_000 SKU — с запасом

type WarehouseStockInsert = typeof ozonWarehouseStocks.$inferInsert;

type CatalogScan = {
  /** Все SKU каталога (fallback, если Ozon не отдал ни одной FBS-записи). */
  allSkus: string[];
  /** SKU, у которых `/v4/product/info/stocks` показывает FBS-остаток > 0. */
  fbsSkus: string[];
  /** offer_id по SKU — колонка `offer_id` в снапшоте остатков. */
  offerBySku: Map<string, string>;
  /** Встречался ли вообще `type='fbs'` в ответе (иначе контракт «уехал»). */
  sawFbsType: boolean;
  hitPageLimit: boolean;
};

/** Собирает SKU каталога через cursor-пагинацию `/v4/product/info/stocks`. */
async function scanCatalog(ctx: StageContext): Promise<CatalogScan> {
  const allSkus: string[] = [];
  const fbsSkus: string[] = [];
  const offerBySku = new Map<string, string>();
  const seen = new Set<string>();
  let sawFbsType = false;
  let hitPageLimit = false;

  let cursor = '';
  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const res = await productInfoStocks(ctx.client, {
      cursor,
      limit: CATALOG_PAGE_LIMIT,
    });
    const items = res.items ?? [];
    for (const item of items) {
      const sku = item.sku ? String(item.sku) : '';
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      allSkus.push(sku);
      if (item.offer_id) offerBySku.set(sku, item.offer_id);
      for (const st of item.stocks ?? []) {
        if ((st.type ?? '').toLowerCase() !== 'fbs') continue;
        sawFbsType = true;
        if ((st.present ?? 0) + (st.reserved ?? 0) > 0) fbsSkus.push(sku);
      }
    }
    if (!res.cursor || items.length === 0) break;
    cursor = res.cursor;
    if (page === CATALOG_MAX_PAGES - 1) hitPageLimit = true;
  }

  return { allSkus, fbsSkus, offerBySku, sawFbsType, hitPageLimit };
}

export async function syncFbsWarehouseStocksStage(
  ctx: StageContext,
): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const warnings: string[] = [];

    // 1. Справочник своих складов: имя + тип (FBS/rFBS) + warehouse_id.
    let warehouses: FbsWarehouseItem[] = [];
    let warehouseListOk = true;
    try {
      warehouses = await getFbsWarehouseList(ctx.client);
    } catch (e) {
      // Не роняем стейдж: имя склада приходит и в самих остатках, справочник
      // нужен лишь для warehouse_type и «красивого» имени.
      warehouseListOk = false;
      warnings.push(
        `Справочник складов недоступен (POST /v1/warehouse/list): ${
          e instanceof Error ? e.message : String(e)
        }. Остатки сохранятся с типом FBS по умолчанию.`,
      );
    }
    const byWarehouseId = new Map(warehouses.map((w) => [w.warehouseId, w]));

    // Складов нет и справочник ответил успешно → продавец не торгует со своих
    // складов. Всё равно прогоняем замену окна: у аккаунта мог остаться
    // снапшот от прежних складов, его надо погасить.
    if (warehouseListOk && warehouses.length === 0) {
      await replaceWarehouseStocksWindow({
        tenantId: ctx.tenantId,
        accountId: ctx.accountId,
        source: 'FBS',
        rows: [],
      });
      return {
        itemsProcessed: 0,
        itemsTotal: 0,
        warnings: [
          ...warnings,
          'У аккаунта нет собственных складов (POST /v1/warehouse/list вернул пустой список) — FBS-остатков нет.',
        ],
      };
    }

    // 2. SKU каталога + подсказка «есть ли FBS-остаток».
    const catalog = await scanCatalog(ctx);
    if (catalog.hitPageLimit) {
      warnings.push(
        `Достигнут лимит пагинации каталога: ${CATALOG_MAX_PAGES} страниц × ` +
          `${CATALOG_PAGE_LIMIT} SKU. Часть SKU не проверена на FBS-остатки — ` +
          'увеличьте CATALOG_MAX_PAGES в sync/fbs-warehouse-stocks.ts.',
      );
    }
    const targetSkus = catalog.sawFbsType ? catalog.fbsSkus : catalog.allSkus;
    if (!catalog.sawFbsType && catalog.allSkus.length > 0) {
      warnings.push(
        '`/v4/product/info/stocks` не вернул ни одной записи type=fbs — ' +
          `остатки FBS запрошены по всему каталогу (${catalog.allSkus.length} SKU).`,
      );
    }

    // 3. Остатки по складам: чанки SKU (пагинации у метода нет).
    const rows: WarehouseStockInsert[] = [];
    let apiRows = 0;
    for (let i = 0; i < targetSkus.length; i += FBS_STOCKS_SKU_CHUNK) {
      const chunk = targetSkus.slice(i, i + FBS_STOCKS_SKU_CHUNK);
      const part = await getStocksByWarehouseFbs(ctx.client, { sku: chunk });
      apiRows += part.length;
      for (const r of part) {
        const meta = byWarehouseId.get(r.warehouseId) ?? null;
        const warehouseName =
          r.warehouseName || meta?.name || `Склад ${r.warehouseId}`;
        // int64 → number: id складов Ozon (~1e13) заведомо меньше 2^53,
        // но перестраховываемся, чтобы не записать искажённое значение.
        const numericId = Number(r.warehouseId);
        rows.push({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          sku: r.sku,
          offerId: catalog.offerBySku.get(r.sku) ?? null,
          warehouseName,
          source: 'FBS',
          warehouseId: Number.isSafeInteger(numericId) ? numericId : null,
          warehouseType: meta?.warehouseType ?? 'FBS',
          // Кластеры — только у фулфилмента Ozon (см. шапку файла).
          clusterId: null,
          clusterName: null,
          clusterType: null,
          freeToSellAmount: r.present,
          // У FBS нет «ожидается»: Ozon отдаёт только present/reserved.
          promisedAmount: 0,
          reservedAmount: r.reserved,
          raw: r.raw,
        });
      }
      ctx.onProgress?.(Math.min(i + chunk.length, targetSkus.length), targetSkus.length);
    }

    const { inserted, duplicatesCollapsed } = await replaceWarehouseStocksWindow({
      tenantId: ctx.tenantId,
      accountId: ctx.accountId,
      source: 'FBS',
      rows,
      onProgress: ctx.onProgress,
    });
    if (duplicatesCollapsed > 0) {
      warnings.push(
        `Ozon вернул ${duplicatesCollapsed} дублей (sku × склад) — схлопнуты в одну строку.`,
      );
    }
    if (warehouses.length > 0 && apiRows === 0) {
      warnings.push(
        `Складов у продавца ${warehouses.length}, но остатков FBS не найдено ` +
          `(проверено SKU: ${targetSkus.length}).`,
      );
    }

    return { itemsProcessed: inserted, itemsTotal: rows.length, warnings };
  });
}
