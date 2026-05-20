# Реклама Ozon — что покрываем и почему возможны расхождения

С версии **v0.18.20** total расхода на рекламу (`adsRub` в Аналитике и KPI)
берётся из **эталонного отчёта Performance API**
`GET /api/client/statistics/expense` — той же цифры, что селлер видит в
рекламном кабинете Ozon в разделе «Расход».

## Источники в порядке приоритета

| Приоритет | Источник | Таблица | Что покрывает |
|-----------|----------|---------|---------------|
| 1 | `GET /api/client/statistics/expense` | `ozon_perf_expense_daily` | **ВСЕ** типы кампаний (SKU/SEARCH_PROMO/ALL_SKU_PROMO/BANNER/VIDEO_BANNER) + расход бонусов |
| 2 | `POST /api/client/statistics` per-SKU CSV | `ozon_perf_sku_stats` | CPC кампании (только `advObjectType=SKU`) per-day per-SKU |
| 2 | `GET /api/client/statistics/all_sku_promo/products/generate` | `ozon_perf_cpo_daily` | CPO `ALL_SKU_PROMO` per-day по магазину |
| 3 | `POST /v3/finance/transaction/list` heuristic | `ozon_transactions` | Транзакции с `operation_type LIKE '%promot%/advertis%/marketing%'` |

`adsSource` в ответе API подсказывает какой именно источник выбран:
`'expense' | 'performance' | 'transactions-heuristic' | 'none'`.

## Per-SKU расход

Per-SKU `adsRub` в таблице Аналитики строится так:

1. `adsCpcRub` — `SUM(ozon_perf_sku_stats.expense_kopecks)` JOIN с
   `unit_products` по 5 ключам (sku, article, offer_id, item_code, raw).
2. `adsCpoAllocRub` — CPO total пропорционально выручке SKU
   (CPO в Performance API **не имеет per-SKU детализации**, поэтому
   распределение приближённое).
3. `adsRub = adsCpcRub + adsCpoAllocRub`.

Total `adsRub` блока (totals row) — это **эталонный store-aggregate** из
expense_daily (если есть данные). Это значит, что **сумма per-SKU `adsRub`
может быть меньше total `adsRub`**: в total включены баннеры/видео/
бренд-полка, у которых нет атрибуции на конкретные SKU.

## Почему могут быть расхождения с рекламным кабинетом Ozon

1. **Лаг −1 день**: sync берёт окно `today(MSC) - 1` — сегодняшний день в
   кабинете уже есть, у нас нет (Ozon не отдаёт незавершённый день в
   async-отчёт).
2. **Окно `perfWindowDays`**: по умолчанию 30 (max 62). При просмотре
   90 дней в Аналитике первые 60 дней могут быть пустыми. Увеличьте окно
   в Settings → Синхронизация → Performance API.
3. **Бонусы**: expense отчёт включает потраченные бонусы и абонент-плату.
   В UI Ozon они могут показываться отдельной колонкой — сравнивать надо
   с итогом «Расход всего», а не «Деньги».
4. **`SEARCH_PROMO` кампании**: с v0.18.20 они НЕ обрабатываются
   per-SKU pipeline (это «Оплата за заказ» / CPO, не CPC). Если их
   расход важен per-SKU — он остаётся в expense_daily totals, но
   в колонке `adsRub` per-SKU не появляется.
5. **`BANNER` / `VIDEO_BANNER`**: расход есть в expense_daily total, но
   per-SKU detail отсутствует.

## Диагностика

Если расход в Open Finance ≠ кабинету Ozon:

```bash
# 1. Просмотреть последний sync summary
# Settings → Синхронизация → expand «Performance API expense (эталон)»
# — там видны warnings и itemsProcessed/itemsTotal.

# 2. Прямая проверка `/statistics/expense` за тот же период
pnpm tsx scripts/debug-ozon-perf-csv.ts <accountId>

# 3. Сверка с кабинетом
# Кабинет → Реклама → Аналитика → Расход → выбрать тот же период
# и сравнить с totals.adsRub из API /api/marketplaces/analytics/ozon.
```

## История

- **v0.18.20** — добавлен `perfExpenseDaily` sync, теперь эталон store-total.
  Routing для `perf-sku-stats`: только `advObjectType=SKU` (убрали
  `SEARCH_PROMO` — он шёл в неподходящий pipeline).
- **v0.18.18** — fix парсера CSV (метастроки Ozon в начале файла).
- **v0.18.15** — добавлен `perfCpoDaily` (CPO агрегат).
