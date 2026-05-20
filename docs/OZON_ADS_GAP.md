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
# 1. Live probe: API vs DB vs CPC+CPO
pnpm tsx scripts/debug-ozon-expense.ts <accountId> --from 2026-04-20 --to 2026-05-20

# 2. Per-SKU CSV format (если views/clicks = 0)
pnpm tsx scripts/debug-ozon-perf-csv.ts <accountId>

# 3. Re-sync (Settings → Синхронизация)
# perfExpenseDaily → perfCpoDaily → perfSkuStats

# 4. Сверка с кабинетом
# Ozon LK → Реклама → Аналитика → Расход → тот же период (MSC)
# KPI / Analytics / Chart должны показывать один adsRub при одном пресете «30d»
```

**Критерии успеха (v0.18.23):** KPI = Chart = Analytics footer `adsRub` (±0.1%); `adsSource=expense`; live expense ≈ Ozon LK (±2% с учётом lag −1 day).

## Сверка с конкурентами (Yoolip Analytics, май 2026)

Yoolip Analytics (`yoolip.ai/app/analytics`) — внешний сервис, который
работает с тем же Performance API и Ozon Seller API. На периоде
**20 апр 2026 — 19 мая 2026 (30 дней)** при сравнении одного и того же
магазина мы видим:

| Метрика       | Yoolip       | Open Finance (v0.18.25) | Ozon LK кабинет |
|---------------|--------------|-------------------------|-----------------|
| Выручка       | X ₽  | X ₽             | —               |
| Заказы (orders) | 3.5K       | 3.5K                    | —               |
| Расход на рекламу | **A ₽** | **B ₽**       | ~410 000 ₽      |
| ДРР            | 6.6%         | 6.0%                    | —               |

**Разрыв A−B ₽ (~9.4%) с Yoolip.** Гипотезы:

1. **Yoolip берёт период YYYY-MM-DD inclusive по локалу пользователя**,
   а Open Finance — MSC `[fromDate, toDateExclusive)`. На 30-дневном
   окне это даёт ±1 день в начале или конце. Если у Yoolip окно
   `20-04..19-05` интерпретируется как `[20-04, 20-05)` (31 день), а у
   нас как `[20-04, 19-05)` (29 дней) — это объясняет ~3% разницы.
2. **Yoolip может включать «сегодня»**, тогда как у нас sync —1 day лаг.
   В нашем случае «сегодня» обычно даёт +1–3% к total.
3. **Per-SKU CPO у Yoolip** — у них есть колонка «Расход» per-product
   (footer total A' ₽), что близко к общему A ₽. Это означает
   что они **распределяют CPO и SEARCH_PROMO** на SKU (мы тоже это
   делаем для CPO в `adsCpoAllocRub`, но SEARCH_PROMO остаётся в
   expense_daily total без per-SKU breakdown).
4. **Бонусы / абонентский счёт** — Open Finance включает их в
   expense parser (с v0.18.23, `prepaidMoneySpent`), но возможны
   корнер-кейсы JSON-формата, когда `prepaidMoneySpent` приходит
   отдельной payload-секцией.

### Где правда

**Эталон — Ozon LK (рекламный кабинет → Аналитика → Расход)**. На
текущий период LK показывает ~410K ₽. Yoolip ближе к LK, у нас
~9% недосчёт. Это не критично (отображается верно для трендов и
сортировки), но даёт повод к улучшению.

### План закрытия gap (v0.18.26+)

- [ ] Расширить sync до **+1 day overshoot** — забирать «сегодня»
      с пометкой `is_partial=true` (текущий день, может быть дозаписан).
- [ ] Проверить парсинг `prepaidMoneySpent` для всех типов JSON-ответа
      (single-store vs multi-store payload).
- [ ] Поверить интерпретацию `dateFrom..dateTo` Yoolip vs нашей MSC-логики
      на API уровне (Performance API endpoint signature).

## История

- **v0.18.25** — единая логика `resolveEffectiveDays` для «Остаток» и
  «Дней» (cycle bug). Yoolip-сверка зафиксирована (см. выше). Полный
  audit ad-spend в pipeline без изменений.
- **v0.18.20** — добавлен `perfExpenseDaily` sync, теперь эталон store-total.
  Routing для `perf-sku-stats`: только `advObjectType=SKU` (убрали
  `SEARCH_PROMO` — он шёл в неподходящий pipeline).
- **v0.18.18** — fix парсера CSV (метастроки Ozon в начале файла).
- **v0.18.15** — добавлен `perfCpoDaily` (CPO агрегат).
