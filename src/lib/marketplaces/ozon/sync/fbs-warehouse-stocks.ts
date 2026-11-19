// PURPOSE: Sync остатков по СОБСТВЕННЫМ складам продавца (FBS/rFBS) через
// Seller API `/v2/warehouse/list` + `/v2/product/info/stocks-by-warehouse/fbs`
// (v1 обоих методов отключаются Ozon 07.04.2026).
// Пишет в ту же таблицу `ozon_warehouse_stocks`, что и FBO-стейдж, но в своё
// окно `source='FBS'` (Этап 2b LK_V2_PLAN).
//
// Зачем отдельный стейдж: `/v2/analytics/stock_on_warehouses` (стейдж
// `warehouseStocks`) отдаёт ТОЛЬКО фулфилмент Ozon. У продавцов, торгующих со
// своих складов, FBS-складов бывает больше, чем FBO, и до Этапа 2b их остатки
// не были видны в системе вообще.
//
// Особенности контракта:
//  - у `/v2/product/info/stocks-by-warehouse/fbs` вход — список SKU (<=1000), поэтому
//    список режется по FBS_STOCKS_SKU_CHUNK, а строки ответа добираются курсором
//    (`cursor`/`has_next`, внутри endpoints.ts);
//  - список SKU берём из `/v4/product/info/stocks` (тот же источник, что у
//    стейджа `stocks`) — стейдж самодостаточен и не зависит от того,
//    синкался ли каталог в `unit_products`;
//  - оттуда же берём подсказку «у SKU вообще есть FBS-остаток» и запрашиваем
//    склады только по таким SKU (иначе на каталоге в 10k SKU это 20 лишних
//    запросов на каждом синке чисто-FBO аккаунта);
//  - `promised_amount` у FBS нет — Ozon отдаёт present/reserved/free_stock;
//    «доступно к продаже» = free_stock (fallback — present).
//
// Кластеры FBS-складам НЕ проставляются: справочник `/v1/cluster/list` — это
// география фулфилмента Ozon, склады продавца в него не входят. Блок остатков
// собирает их в отдельную псевдо-строку «FBS (свои склады)», а не в общую
// «Без кластера» (см. cluster-agg.ts).

import {
  getFbsWarehouseListDetailed,
  getStocksByWarehouseFbsDetailed,
  productInfoStocks,
  FBS_STOCKS_SKU_CHUNK,
} from '../endpoints';
import {
  buildFbsStockInsertRows,
  type FbsWarehouseItem,
  type WarehouseStockInsert,
} from '../fbs-stocks-map';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { replaceWarehouseStocksWindow } from './warehouse-stocks';

const CATALOG_PAGE_LIMIT = 1000;
const CATALOG_MAX_PAGES = 50; // 50_000 SKU — с запасом

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
  /** Сколько товаров (items) вернул каталог — для проверки «форма не та». */
  itemsSeen: number;
  /** Был ли в первой странице ответа ключ `items` вообще. */
  hadItemsKey: boolean;
};

/** Собирает SKU каталога через cursor-пагинацию `/v4/product/info/stocks`. */
async function scanCatalog(ctx: StageContext): Promise<CatalogScan> {
  const allSkus: string[] = [];
  const fbsSkus: string[] = [];
  const offerBySku = new Map<string, string>();
  const seen = new Set<string>();
  const fbsSeen = new Set<string>();
  let sawFbsType = false;
  let hitPageLimit = false;
  let itemsSeen = 0;
  let hadItemsKey = false;

  let cursor = '';
  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const res = await productInfoStocks(ctx.client, {
      cursor,
      limit: CATALOG_PAGE_LIMIT,
    });
    if (page === 0) hadItemsKey = Array.isArray(res.items);
    const items = res.items ?? [];
    itemsSeen += items.length;
    for (const item of items) {
      // SKU берём из каждой записи `stocks[]` (живой ответ: у товара верхнего
      // уровня `sku` нет; у одного товара может быть несколько SKU). `item.sku`
      // остаётся запасным вариантом на случай старой формы ответа.
      const fallbackSku = item.sku ? String(item.sku) : '';
      const stocks = item.stocks ?? [];
      const register = (sku: string) => {
        if (!sku || seen.has(sku)) return;
        seen.add(sku);
        allSkus.push(sku);
        if (item.offer_id) offerBySku.set(sku, item.offer_id);
      };
      register(fallbackSku);
      for (const st of stocks) {
        const sku = st.sku !== undefined && st.sku !== null && String(st.sku) !== '' ? String(st.sku) : fallbackSku;
        register(sku);
        if ((st.type ?? '').toLowerCase() !== 'fbs') continue;
        sawFbsType = true;
        if (sku && (st.present ?? 0) + (st.reserved ?? 0) > 0 && !fbsSeen.has(sku)) {
          fbsSeen.add(sku);
          fbsSkus.push(sku);
        }
      }
    }
    if (!res.cursor || items.length === 0) break;
    cursor = res.cursor;
    if (page === CATALOG_MAX_PAGES - 1) hitPageLimit = true;
  }

  return { allSkus, fbsSkus, offerBySku, sawFbsType, hitPageLimit, itemsSeen, hadItemsKey };
}

export async function syncFbsWarehouseStocksStage(
  ctx: StageContext,
): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const warnings: string[] = [];

    // 1. Справочник своих складов: имя + тип (FBS/rFBS) + warehouse_id.
    // Любой сбой (HTTP или дрейф формы) уходит в warnings, а не в console.
    let warehouses: FbsWarehouseItem[] = [];
    let warehouseListOk = true;
    try {
      const wl = await getFbsWarehouseListDetailed(ctx.client);
      warehouses = wl.items;
      warehouseListOk = wl.shapeOk && wl.complete;
      warnings.push(...wl.warnings);
      if (!wl.shapeOk || !wl.complete) {
        warnings.push(
          'Справочник складов (POST /v2/warehouse/list) вернул неожиданную форму ответа или неполный список — ' +
            'остатки сохранятся с типом FBS по умолчанию, пустой список не считается «складов нет».',
        );
      }
    } catch (e) {
      // Не роняем стейдж: имя склада приходит и в самих остатках, справочник
      // нужен лишь для warehouse_type и «красивого» имени.
      warehouseListOk = false;
      warnings.push(
        `Справочник складов недоступен (POST /v2/warehouse/list): ${
          e instanceof Error ? e.message : String(e)
        }. Остатки сохранятся с типом FBS по умолчанию.`,
      );
    }
    const byWarehouseId = new Map(warehouses.map((w) => [w.warehouseId, w]));

    // Складов нет и справочник ответил корректно → продавец не торгует со
    // своих складов. Всё равно прогоняем замену окна: у аккаунта мог остаться
    // снапшот от прежних складов, его надо погасить. При сбое/дрейфе
    // справочника (warehouseListOk=false) окно НЕ чистим.
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
          'У аккаунта нет собственных складов (POST /v2/warehouse/list вернул пустой список) — FBS-остатков нет.',
        ],
      };
    }

    // 2. SKU каталога + подсказка «есть ли FBS-остаток».
    const catalog = await scanCatalog(ctx);
    // Неполный или «не той формы» каталог не должен заменять снапшот: иначе
    // окно FBS молча очищается (так и было до фикса 2026-11-19, когда SKU
    // искали не в том поле). Пустое окно допустимо только если каталог
    // действительно пуст или у всех SKU FBS-остаток 0.
    if (catalog.hitPageLimit) {
      throw new Error(
        `Достигнут лимит пагинации каталога: ${CATALOG_MAX_PAGES} страниц × ${CATALOG_PAGE_LIMIT} SKU — ` +
          'выборка неполная, снапшот FBS не заменён. Увеличьте CATALOG_MAX_PAGES в sync/fbs-warehouse-stocks.ts.',
      );
    }
    if (!catalog.hadItemsKey) {
      throw new Error(
        'POST /v4/product/info/stocks: в ответе нет `items` — форма ответа изменилась, снапшот FBS не заменён.',
      );
    }
    if (catalog.itemsSeen > 0 && catalog.allSkus.length === 0) {
      throw new Error(
        `POST /v4/product/info/stocks: ${catalog.itemsSeen} товаров, но ни одного SKU — ` +
          'поле sku переехало, снапшот FBS не заменён.',
      );
    }
    const targetSkus = catalog.sawFbsType ? catalog.fbsSkus : catalog.allSkus;
    if (!catalog.sawFbsType && catalog.allSkus.length > 0) {
      warnings.push(
        '`/v4/product/info/stocks` не вернул ни одной записи type=fbs — ' +
          `остатки FBS запрошены по всему каталогу (${catalog.allSkus.length} SKU).`,
      );
    }

    // 3. Остатки по складам: чанки SKU, строки ответа — курсором (в endpoints).
    const rows: WarehouseStockInsert[] = [];
    let apiRows = 0;
    for (let i = 0; i < targetSkus.length; i += FBS_STOCKS_SKU_CHUNK) {
      const chunk = targetSkus.slice(i, i + FBS_STOCKS_SKU_CHUNK);
      const part = await getStocksByWarehouseFbsDetailed(ctx.client, { sku: chunk });
      apiRows += part.rows.length;
      for (const w of part.warnings) if (!warnings.includes(w)) warnings.push(w);
      if (!part.complete) {
        // Обрыв пагинации: заменять окно частью строк нельзя — старый снапшот остаётся.
        throw new Error(
          'POST /v2/product/info/stocks-by-warehouse/fbs: выборка остатков неполная: ' +
            part.warnings.join('; '),
        );
      }
      if (!part.shapeOk) {
        // Не заменяем окно пустым/неполным снапшотом: старые данные остаются.
        throw new Error(
          'POST /v2/product/info/stocks-by-warehouse/fbs вернул неожиданную форму ответа (нет products или массовый пропуск строк): ' +
            part.warnings.join('; '),
        );
      }
      rows.push(
        ...buildFbsStockInsertRows({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          stocks: part.rows,
          warehousesById: byWarehouseId,
          offerBySku: catalog.offerBySku,
        }),
      );
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
