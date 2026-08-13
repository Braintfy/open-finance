// PURPOSE: Встроенные места хранения модуля «Склад» — сиды stock_places.
// Канон — docs/STOCK_MODULE_DESIGN.md §3 (таблица «кто авторитет по остатку»)
// с уточнением §12.3 (WB и Яндекс.Маркет учитываются с первого дня).
//
// Чистый модуль конфигурации: никаких запросов, только данные и предикаты.
// Наливает справочник src/lib/stock/queries.ts при первом входе в раздел;
// склады Ozon добавляются поверх кнопкой из DISTINCT ozon_warehouse_stocks.
//
// ГЛАВНОЕ ПРАВИЛО (§3): stock_moves.place_id ВСЕГДА указывает на место с
// authority='ledger'. Перемещение own → ozon_fbo — это ОДНА расходная строка на
// own с counter_place_id=ozon_fbo; положительной строки на стороне Ozon не
// бывает никогда. Поэтому «Ozon двигает товар без нашего ведома» структурно
// не может создать расхождение — расходиться нечему.

import type {
  StockChannel,
  StockPlaceAuthority,
  StockPlaceKind,
} from '../db/schema/stock';

export interface StockPlaceSeed {
  code: string;
  name: string;
  kind: StockPlaceKind;
  authority: StockPlaceAuthority;
  /** 'FBO' | 'FBS' — совпадает с ozon_warehouse_stocks.source. */
  externalSource?: 'FBO' | 'FBS';
  /** Канал продаж, к которому относится место (для сшивки и отчётов). */
  channel?: StockChannel;
  sortOrder: number;
  /** Пояснение для UI-подсказки. */
  hint: string;
}

/**
 * Девять встроенных мест. Порядок = порядок колонок в блоке stock.balances.
 *
 * WB и Яндекс.Маркет заведены с authority='ledger', а НЕ 'external' (в отличие
 * от Ozon): API-коннекторов к ним нет, продажи приходят импортом файлов (§12.3),
 * то есть единственный источник остатка — наш журнал.
 */
export const BUILTIN_STOCK_PLACES: readonly StockPlaceSeed[] = [
  {
    code: 'own',
    name: 'Свой склад',
    kind: 'own',
    authority: 'ledger',
    sortOrder: 10,
    hint: 'Физический склад, с которого уходят поставки и заказы сайтов',
  },
  {
    code: 'transit_ozon',
    name: 'В пути на Ozon',
    kind: 'transit',
    authority: 'ledger',
    channel: 'ozon',
    sortOrder: 20,
    hint: 'Отгружено, но ещё не принято складом Ozon; разница закрывается приёмкой',
  },
  {
    code: 'ozon_fbo',
    name: 'Ozon FBO',
    kind: 'marketplace',
    authority: 'external',
    externalSource: 'FBO',
    channel: 'ozon',
    sortOrder: 30,
    hint: 'Остаток отдаёт Ozon (ozon_warehouse_stocks, source=FBO) — журнал его не ведёт',
  },
  {
    code: 'ozon_fbs',
    name: 'Ozon FBS',
    kind: 'marketplace',
    authority: 'external',
    externalSource: 'FBS',
    channel: 'ozon',
    sortOrder: 40,
    hint: 'Остаток отдаёт Ozon (ozon_warehouse_stocks, source=FBS) — журнал его не ведёт',
  },
  {
    code: 'wb',
    name: 'Wildberries',
    kind: 'marketplace',
    authority: 'ledger',
    channel: 'wb',
    sortOrder: 50,
    hint: 'Коннектора нет: продажи вводятся импортом файла, остаток считает журнал',
  },
  {
    code: 'yandex',
    name: 'Яндекс.Маркет',
    kind: 'marketplace',
    authority: 'ledger',
    channel: 'yandex',
    sortOrder: 60,
    hint: 'Коннектора нет: продажи вводятся импортом файла, остаток считает журнал',
  },
  {
    code: 'site_shopb',
    name: 'Сайт shopb.example',
    kind: 'site',
    authority: 'ledger',
    channel: 'site',
    sortOrder: 70,
    hint: 'Заказы сайта; до появления коннектора выравнивается инвентаризацией',
  },
  {
    code: 'site_shopa',
    name: 'Сайт shopa.example',
    kind: 'site',
    authority: 'ledger',
    channel: 'site',
    sortOrder: 80,
    hint: 'Заказы сайта; до появления коннектора выравнивается инвентаризацией',
  },
  {
    code: 'loss',
    name: 'Потери и списания',
    kind: 'virtual',
    authority: 'ledger',
    sortOrder: 90,
    hint: 'Приёмник списаний и недостач маркетплейса — отдельная статья, НЕ себестоимость',
  },
];

export const BUILTIN_PLACE_CODES: readonly string[] = BUILTIN_STOCK_PLACES.map(
  (p) => p.code,
);

/** Код собственного склада — сюда приходуются поставки по умолчанию. */
export const OWN_PLACE_CODE = 'own';
/** Код виртуального места потерь — приёмник writeoff/mp_shortage. */
export const LOSS_PLACE_CODE = 'loss';

export function getBuiltinPlace(code: string): StockPlaceSeed | undefined {
  return BUILTIN_STOCK_PLACES.find((p) => p.code === code);
}

export function isBuiltinPlaceCode(code: string): boolean {
  return BUILTIN_STOCK_PLACES.some((p) => p.code === code);
}

/** Места, по которым в журнале ЕСТЬ строки (place_id движения — только такие). */
export function ledgerPlaceCodes(): string[] {
  return BUILTIN_STOCK_PLACES.filter((p) => p.authority === 'ledger').map((p) => p.code);
}

/** Места, чей остаток отдаёт API маркетплейса; журнальных строк по ним не бывает. */
export function externalPlaceCodes(): string[] {
  return BUILTIN_STOCK_PLACES.filter((p) => p.authority === 'external').map((p) => p.code);
}

/**
 * Можно ли ставить это место в stock_moves.place_id. Проверяется в posting.ts:
 * попытка провести движение по external-месту — баг, а не пользовательский ввод.
 */
export function canHoldMoves(place: { authority: StockPlaceAuthority }): boolean {
  return place.authority === 'ledger';
}

/** Канал места (для сшивки stock_item_links и группировки в отчётах). */
export function placeChannel(code: string): StockChannel | null {
  return getBuiltinPlace(code)?.channel ?? null;
}
