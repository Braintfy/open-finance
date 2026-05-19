# Changelog

## [0.18.11] - 2026-05-19

Ozon Аналитика: root-cause фикс SKU, рекламы и отмен.

### Fixed

- **SKU в аналитике больше не равен `product_id`** — `unit_products.sku` теперь обновляется только реальным Ozon SKU из `ProductInfo.sources[]`, `/v5/product/info/prices.sku` или `/v4/product/info/stocks.sku`; `product_id` сохранён отдельно в `metadata.productId`.
- **Реклама из `ozon_perf_sku_stats` не теряется из-за старого SKU-маппинга** — `/api/marketplaces/analytics/ozon` матчится по реальному SKU, legacy `metadata.productId`, `offer_id` и raw `Артикул`, без задвоения строк.
- **Отмены/возвраты в аналитике считаются по статусам** — помимо `cancelled_at`/`returned_at`, API учитывает `status LIKE cancel/return`.
- **Нули в колонках отмен/возвратов/показов/кликов/корзины отображаются как `0`**, а не как `—`.
- **Performance sync устойчивее к 400 «Некорректный период»** — `perfSkuStats` пробует окна с лагом завершённого дня 1/2/3/4/7 и очищает старые агрегаты окна перед записью, чтобы не копить дубли при `campaign_id IS NULL`.

### Changed

- **Smoke-тесты Ozon upsert расширены** — добавлена проверка, что `product_id` и реальный Ozon SKU не смешиваются.

## [0.18.10] - 2025-05-19

Ozon Аналитика: исправление синхронизации Performance API + 12 новых колонок.

### Исправлено

- **`buildPerfPeriod()` — dateTo = вчера** (`src/lib/marketplaces/ozon/sync/perf-period.ts`). Root cause: Ozon Performance API отклоняет незавершённые дни (400 «Некорректный период»). Теперь `dateTo = shiftIsoDate(today, -1)`.

### Добавлено

- **12 новых колонок** в блоке `unit.ozon-analytics`:
  - **Идентификаторы:** `SKU` — кликабельная ссылка на ozon.ru/product/{sku}
  - **Продажи:** `Отмены`, `Возвраты`, `% возвратов`, `Прод/день` (среднее за период), `Доля %` (от общей выручки)
  - **Реклама:** `Показы`, `Клики`, `CTR`, `В корзину` (из рекламы), `CPC` (₽/клик), `CPM` (₽/1000 показов)
- **Данные `views`, `clicks`, `cartAdds`** теперь подтягиваются из `ozon_perf_sku_stats` в API route (perf source) или возвращаются как 0 (tx fallback).
- **Группировка колонок в настройках** обновлена: Реклама включает показы/клики/CTR/CPC/CPM, Продажи — отмены/возвраты/долю.
- **XLSX-экспорт** поддерживает все новые колонки.
- **Props `totalRevenue` / `periodDays`** в `OzonAnalyticsTable` для расчётных колонок (salesPerDay, salesShare).

## [0.18.9] - 2025-05-19

Ozon Performance: исправления отображения данных и авто-retry sync.

### Исправлено

- **Блоки Top Ads / Campaigns / Search Phrases показывали perf-error даже при наличии данных** — логика `emptyKind` теперь приоритетно показывает загруженные данные из локальных таблиц; `perf-error` отображается только когда данных реально нет.
- **Колонки РЕКЛАМА и ДРР в Ozon Аналитике показывали «—»** (`/api/marketplaces/analytics/ozon`). Теперь primary source для per-SKU рекламы — `ozon_perf_sku_stats` (Performance API), fallback на `ozon_transactions` (эвристика). Добавлен `adsSource` в response.

### Добавлено

- **Auto-retry sync при 400 от Ozon Performance API** (`perf-sku-stats.ts`). Если запрошенный период отклоняется (30d), sync автоматически пробует 14d → 7d. При успехе — warning в результат, данные сохраняются для меньшего окна.

## [0.18.8] - 2025-05-19

Кнопка обновления данных в блоках Ozon Performance.

### Добавлено

- **Кнопка ↻ в тулбаре** блоков `unit-ozon-kpi`, `unit-ozon-top-ads`, `unit-ozon-campaigns`, `unit-ozon-search-phrases`. Позволяет перезагрузить данные после смены периода без перезагрузки страницы. Анимируется при загрузке.
- **Кнопка «Попробовать снова» / «Обновить» в error-состояниях** (perf-error, error). Пользователь может сменить период на более короткий и нажать обновить, не перезагружая страницу.

## [0.18.7] - 2025-05-19

Модалка связей: реальные значения из Ozon-аналитики вместо "—" (null).

### Исправлено

- **Значения "—" в модалке связей для Ozon-аналитики** (`src/app/api/blocks/sources/route.ts`). Endpoint `/api/blocks/sources` теперь выполняет реальный SQL-запрос для `unit.ozon-analytics` блоков — возвращает агрегаты (выручка, реклама, ДРР, заказы, остатки и др.) вместо `null`. Данные видны при привязке с любой страницы.
- **Формат ₽ для live-блоков в модалке привязок** (`src/components/unit-economics/unit-cell-binding-dialog.tsx`). Для live-блоков (текущая страница) теперь корректно определяется `format: 'money'` через `__money` convention — денежные поля отображаются как рубли.

### Добавлено

- **`getOzonAnalyticsTotals()`** (`src/lib/blocks/catalog/unit-ozon-analytics-queries.ts`). Переиспользуемая серверная функция расчёта агрегатов Ozon-аналитики — упрощённый SQL (только SUM/COUNT, без per-product breakdown, ~100ms).
- **`moneyFields` в `useAvailableBlockSources()`** (`src/lib/blocks/values.tsx`). Хук теперь возвращает Set<string> с именами денежных полей (парсится из `__money` convention блока-источника).

## [0.18.6] - 2025-05-19

Блок «Ozon · Аналитика»: расширенная публикация данных для модалки связей (cross-block bindings).

### Добавлено

- **Расширенные поля в useBlockValuePublisher** (`src/lib/blocks/catalog/unit-ozon-analytics.tsx`). Помимо выручки/рекламы/ДРР теперь публикуются: себестоимость проданного, прибыль (выручка−себест), заказы отменено/возврат, штук доставлено, всего товаров, остатки (шт), средний выкуп %. Все поля доступны в модалке привязок для cross-block формул.
- **Синхронизация remote sources** (`src/app/api/blocks/sources/route.ts`). `fieldsForBlock` для `unit.ozon-analytics` расширен до 14 полей (было 6), полностью соответствует клиентскому publisher — данные аналитики доступны и для привязок с других страниц.

## [0.18.5] - 2026-05-18

Блок «Юнит-экономика Ozon»: актуальные цены, сортировка, заполнение из API (скидка, ДРР, комиссия, выкуп, продажи/мес), улучшенный BulkFill.

### Исправлено

- **Цена в юнит-таблице показывала raw цену без скидок** (`src/components/unit-economics/ozon-sync-diff.ts`). Sync теперь берёт `metadata.priceWithSpp` (marketing_seller_price — актуальная цена покупателя с SPP/промо), с fallback на `priceKopecks` если нет маркетинговой цены.

### Добавлено

- **Скидка % и ДРР % в колонки синхронизации** (`ozon-sync-diff.ts`, `ozon-sync-settings-form.tsx`). `discountPct` рассчитывается из разницы базовой и маркетинговой цены. `drrPct` рассчитывается на основе рекламных расходов и выручки за 30 дней per-article.
- **Расширенный products API с ДРР** (`src/app/api/unit-economics/products/route.ts`). При `include=aggregates` теперь дополнительно JOIN-ит `ozon_transactions` для расчёта ads/revenue per-article и возвращает `drrPct`.
- **Сортировка колонок в юнит-таблице** (`unit-ozon-multi-table.tsx`). Клик по заголовку input/result колонки переключает сортировку desc → asc → off. Стрелки-индикаторы на hover и при активной сортировке.
- **Sync columns по умолчанию включены**: комиссия, выкуп, ДРР, скидка, продажи/мес теперь включены в columnMap по умолчанию (ранее были выключены).

### Изменено

- **Улучшенный дизайн всплывающего окна «Заполнить колонку»** (`BulkFillMenu`). Ширина 288px, заголовок с названием колонки, описание, поле ввода с суффиксом единиц внутри, цветной feedback (зелёный/красный).
- **Секция «Расширенные» в настройках sync** переименована в «Расширенные (из аналитики)» с пояснениями источников данных.

## [0.18.4] - 2026-05-18

Блок «Ozon · Аналитика»: ручной ресайз колонок, публикация данных для связей, актуальная цена.

### Исправлено

- **Цена в аналитике показывала raw стоимость без скидок** (`src/app/api/marketplaces/analytics/ozon/route.ts`). Теперь API читает `metadata.priceWithSpp` (marketing_seller_price — актуальная цена для покупателя с учётом SPP/промо), с fallback на `priceKopecks` если маркетинговая цена отсутствует.
- **Модалка связей не показывала данные из Ozon-аналитики** (`src/lib/blocks/catalog/unit-ozon-analytics.tsx`). Блок не вызывал `useBlockValuePublisher`. Добавлен publish totals: выручка, реклама, ДРР, заказы, товары с продажами. Поля доступны для cross-block формул.

### Изменено

- **Таблица Ozon-аналитики: drag-to-resize колонок + nowrap** (`src/components/unit-economics/ozon-analytics-table.tsx`). Заменён autoColumnWidth на фиксированные ширины с ручным ресайзом (как в `unit.ozon-multi-table`). Все ячейки `whitespace-nowrap` + `overflow-hidden` + `truncate` для текста. `table-layout: fixed`, горизонтальный scroll при переполнении.

## [0.18.3] - 2026-05-18

Стабилизация Ozon sync: numeric payload цен/комиссий не падает, Performance API больше не получает «Некорректный период», XLSX-импорт цен переехал в настройки блока с инструкционной модалкой, таблицы Ozon аналитики получили автоматические ширины колонок, четыре проблемных аналитических блока публикуют значения и показывают честные статусы.

### Исправлено

- **`prices: value.replace is not a function` при sync цен Ozon** ([`src/lib/marketplaces/ozon/upsert-plan.ts`](src/lib/marketplaces/ozon/upsert-plan.ts), [`src/lib/marketplaces/ozon/types.ts`](src/lib/marketplaces/ozon/types.ts)). Lenient-клиент возвращал `price.price` / `marketing_seller_price` числом (Ozon отдаёт смешанные типы), а `parseMoneyRu` ожидал строго `string | undefined` и падал на `.replace`. `parseMoneyRu` теперь принимает `unknown` и обрабатывает `string`/`number`/`null`/`undefined`/мусор. Zod-схема `PriceMoneySchema` ослаблена через `z.union([z.string(), z.number()])` для всех денежных полей. Покрыто 12 новыми тестами в [`scripts/test-ozon-upsert.ts`](scripts/test-ozon-upsert.ts) (`92 PASS`).
- **`Ozon Perf 400 «Некорректный период»`** ([`src/lib/marketplaces/ozon/sync/perf-sku-stats.ts`](src/lib/marketplaces/ozon/sync/perf-sku-stats.ts)). UTC-дата уезжала в завтра по Москве около полуночи + окно могло превышать лимит async-отчёта. Новый pure-helper [`buildPerfPeriod`](src/lib/marketplaces/ozon/sync/perf-period.ts) считает диапазон по MSC-календарю, ограничивает `[1, 62]` дня (документированный лимит), не уходит в будущее. Ошибки от Perf API теперь логируются с фактическим диапазоном — пользователю видно «период `YYYY-MM-DD…YYYY-MM-DD (Nd, MSC)`», а не голое 400. Smoke-тест [`scripts/test-ozon-perf-period.ts`](scripts/test-ozon-perf-period.ts) — 20 PASS.
- **«Ozon · Кампании» показывал 0 расхода для всех кампаний** ([`src/app/api/marketplaces/ozon/campaigns/route.ts`](src/app/api/marketplaces/ozon/campaigns/route.ts)). `perf-sku-stats` сейчас не разбивает отчёт по `campaign_id`, а API фильтровал `campaign_id IS NOT NULL`. Добавлен fallback `summary`: возвращаем total expense/orders/drr по аккаунту + флаг `statsAreAccountWide`, чтобы блок честно показал «расход — суммарный по аккаунту» вместо пустых строк.
- **XLSX импорт цен Ozon путал «Цена до скидки» с действующей** ([`src/lib/unit-economics/import/ozon-price-template.ts`](src/lib/unit-economics/import/ozon-price-template.ts)). Старый matcher `Цена` ловил первую же подходящую колонку, включая зачёркнутую. Парсер переписан на двухступенчатый exact-match → substring fallback с приоритетом `Текущая цена (со скидкой)` → `Новая цена (со скидкой)`. Добавлены отдельные поля `oldPrice`, `minPrice`, `vatPct`, `fboCommissionPct`, `fbsCommissionPct`, `acquiringPct` в `OzonImportRow` и в metadata `unit_products` (см. [`route`](src/app/api/unit-economics/import/ozon-prices/route.ts)). Строки-подсказки Ozon без артикула пропускаются. Тест на реальном шаблоне `Шаблон для обновления цен_18.05.26.xlsx` — 38 PASS.

### Добавлено

- **Секция «Импорт XLSX» в настройках блока `unit.ozon-multi-table`** ([`src/components/unit-economics/ozon-import-section.tsx`](src/components/unit-economics/ozon-import-section.tsx)). Две кнопки `Импорт цен` / `Импорт товаров`, инструкционный `Dialog` (как заполнить шаблон, какие колонки читаются, что мы НЕ отправляем цены обратно в Ozon), баннер результата с количеством распознанных строк и колонок. Старая toolbar-кнопка `Импорт XLSX` и сопутствующие баннеры из блока убраны.
- **Pure-helper `buildPerfPeriod`** ([`src/lib/marketplaces/ozon/sync/perf-period.ts`](src/lib/marketplaces/ozon/sync/perf-period.ts)) — расчёт MSC-окна для Performance API с защитой от будущей даты и clamp до 62 дней. Документированный лимит async-отчёта Ozon.
- **Адаптивные ширины колонок таблиц** ([`src/lib/blocks/auto-column-width.ts`](src/lib/blocks/auto-column-width.ts)). Общий SSR-safe helper через `canvas.measureText`: измеряет заголовок (uppercase/bold) и самые длинные форматированные значения, клипает к min/max каждой колонки. Применён в [`ozon-analytics-table`](src/components/unit-economics/ozon-analytics-table.tsx), [`unit-ozon-top-ads`](src/lib/blocks/catalog/unit-ozon-top-ads.tsx), [`unit-ozon-campaigns`](src/lib/blocks/catalog/unit-ozon-campaigns.tsx), [`unit-ozon-search-phrases`](src/lib/blocks/catalog/unit-ozon-search-phrases.tsx).
- **`useBlockValuePublisher` в четырёх аналитических блоках** (Top Ads, Campaigns, Search Phrases, Data Health). Теперь можно привязываться к `totalExpenseRub` / `totalOrders` / `avgDrrPct` / `perfConnected` / `sellerErrorMessage` etc. — поля синхронизированы с [`/api/blocks/sources`](src/app/api/blocks/sources/route.ts).

### Изменено

- **Четыре «сломанных» аналитических блока получили честные empty/error states.**
  - `unit.ozon-top-ads` / `unit.ozon-campaigns` / `unit.ozon-search-phrases` — разные UI для `no-account`, `no-perf`, `perf-error`, `error`, `no-data`, `limited`. Больше не показывают «Нет данных. Подключите Performance API» когда Performance уже подключён, но просто нет данных за период.
  - `unit.ozon-search-phrases` теперь сообщает, что Ozon Performance API не отдаёт стабильный отчёт «поисковые фразы» — это не баг подключения, а ограничение API (sync-stage помечен `TODO real implementation` в [`perf-phrases.ts`](src/lib/marketplaces/ozon/sync/perf-phrases.ts)).
  - `unit.ozon-data-health` показывает `useMarketplaceAccounts().error` отдельной красной карточкой с кнопкой «Повторить», отличает «нет ни одного аккаунта» от «не выбран в этом блоке».
- **«Ozon · Кампании» отображает badge «Расход — суммарный по аккаунту»**, если Performance API не разбил отчёт по `campaign_id`, и помечает курсивом ячейки `Расход = 0` с tooltip «Нет данных perf-sync для этой кампании».

### Audit

- `pnpm typecheck` ✓
- `pnpm build` ✓ (60+ routes, нет регрессий, единственный error был `useBlockValuePublisher` после early return в Data Health — поправлен).
- **150 smoke-тестов PASS:** `test-ozon-upsert.ts` (92), `test-ozon-perf-period.ts` (20, новый), `test-unit-economics.ts` (38, включая реальный XLSX-шаблон).
- Финальный осмотр: каждый из четырёх «проблемных» блоков теперь имеет 5+ различимых состояний (loading / no-account / no-perf / perf-error / api-error / limited / data), таблицы Ozon аналитики не уходят за viewport, привязки в Settings → Bindings не падают на новые поля.

## [0.18.2] - 2026-05-18

Фиксы багов Ozon-аналитики (React-warning, краш perf-sync, отключённая granularity, UX KPI) + редизайн модалки привязок: two-level рендер полей, понятный label страницы «Аналитика Ozon», унифицированная категория и стабильная сортировка блоков.

### Исправлено

- **React key-in-spread warning в `ChartShell`** ([`src/components/blocks/chart-shell.tsx`](src/components/blocks/chart-shell.tsx)). `key` лежал внутри `props` объекта, который spread'ился в `<Line {...props} />`. React 18.3+ требует передавать `key` напрямую. Теперь `key` извлекается отдельно и передаётся как `<Bar key={key} {...props} />` / `<Area key={key} ...>` / `<Line key={key} ...>`. Warning исчез из консоли при рендере всех блоков-графиков (Ozon · Динамика, Cashflow chart и т.д.).
- **Performance API sync крашился на `insert into "ozon_perf_campaigns"`** ([`src/lib/marketplaces/ozon/sync/perf-campaigns.ts`](src/lib/marketplaces/ozon/sync/perf-campaigns.ts)). Ozon отдаёт `"toDate": ""` для бессрочных кампаний; пустая строка отправлялась как значение в `date`-колонку PostgreSQL → `invalid input syntax for type date: ""` → **вся синхронизация рекламы падала на первой же кампании**. Симптомы каскадно: KPI/Топ рекламы/Кампании/Поисковые фразы показывают «нет данных», ДРР=0%, Состояние данных = ошибка. Фикс — pure-функция [`toDateOrNull`](src/lib/marketplaces/ozon/sync/date-utils.ts) нормализует `""`/`"   "`/не-строки в `null`, ISO datetime обрезается до `YYYY-MM-DD`. Тесты: 14 PASS в `scripts/test-ozon-perf-campaigns.ts`.

### Добавлено

- **Блок «Ozon · Динамика» — переключение granularity прямо в шапке блока** ([`src/lib/blocks/catalog/unit-ozon-chart.tsx`](src/lib/blocks/catalog/unit-ozon-chart.tsx)). Раньше дропдаун «по дням / неделям / месяцам» был задизаблен и менялся только в settings. Теперь — локальный `useState<Granularity>` (session-only, не пишет в config; перенастроить дефолт можно в settings блока). `useEffect` синхронизирует state при изменении `config.granularity` извне (например, после settings save).
- **`showPerfStatus` добавлен в `OzonAccountSelector`** для блоков, использующих Performance API:
  - `unit.ozon-chart` ([`unit-ozon-chart.tsx`](src/lib/blocks/catalog/unit-ozon-chart.tsx)) — реклама в overlay.
  - `unit.ozon-ai-insights` ([`unit-ozon-ai-insights.tsx`](src/lib/blocks/catalog/unit-ozon-ai-insights.tsx)) — анализ ДРР/CPO требует perf-данных.

### Изменено

- **KPI SettingsForm — группы карточек** ([`src/lib/blocks/catalog/unit-ozon-kpi.tsx`](src/lib/blocks/catalog/unit-ozon-kpi.tsx)): тогглы разделены на «Основные» (Выручка, Заказы, Расход, ДРР — `grid-cols-2 sm:grid-cols-4`, solid border) и «Дополнительные» (Средний чек, Средний CPO — `grid-cols-2`, dashed border). Пользователь видит, что aov/cpo — опциональные карточки.
- **Модалка привязок ячейки: two-level рендер полей** ([`src/components/unit-economics/unit-cell-binding-dialog.tsx`](src/components/unit-economics/unit-cell-binding-dialog.tsx)). Раньше все поля блока показывались плоским рядом одинаковых chips → для блоков с 7+ полями выглядело как большой массив. Теперь:
  - **Главное поле `value`** — крупная кнопка во всю ширину блока с label слева (с иконкой `Link2`) и preview-значением справа (`font-mono`, выровнено `tabular-nums`). Primary CTA для одно-кликового связывания «общего» значения блока (например, `Выручка / период` для Ozon · KPI).
  - **Остальные поля** — компактные мини-чипы под главным полем (`text-[10px]`, тонкий ring), для точечной привязки к конкретной метрике (orders, ads, drr, aov, cpo).
- **Понятные label страниц в sidebar модалки** ([`src/app/api/blocks/sources/route.ts`](src/app/api/blocks/sources/route.ts)). Добавлен `'marketplaces-ozon-dashboard': 'Аналитика Ozon'` в `PAGE_LABELS` + сама страница в `DEFAULT_PAGE_KEYS` (чтобы появлялась в picker даже если у пользователя ещё нет save'нутого layout'а). Раньше отображалось как raw `marketplaces-ozon-das...`.
- **Категория «Аналитика Ozon» для всех `unit.ozon-*` блоков** ([`sources/route.ts`](src/app/api/blocks/sources/route.ts)). Раньше: разнобой (`unit.ozon-analytics` → «Юнит-экономика», `unit.ozon-kpi` → «Маркетплейсы», `unit.ozon-ai-insights` → «AI»). Теперь все 10 блоков (KPI, Динамика, Топ рекламы, Остатки, Поисковые фразы, Кампании, Состояние данных, ABC, AI инсайты, Аналитика) под одной категорией → группируются вместе в picker'е.
- **Стабильная сортировка блоков в модалке** ([`sources/route.ts`](src/app/api/blocks/sources/route.ts)). На сервере, перед отправкой JSON: `CATEGORY_ORDER` (аналитика → юнит-эконом → финансы → KPI → графики → таблицы → данные → вычисления → кэшфлоу → входящие → навигация → AI), потом — `label.localeCompare(b.label, 'ru')`. Локальные live-блоки текущей страницы в `unit-cell-binding-dialog.tsx` — аналогично, по label. До этого был случайный порядок появления в layout.

### Audit

- `pnpm typecheck` ✓
- `pnpm build` ✓ (все 60+ routes собрались, нет регрессий)
- **229 smoke-тестов PASS:** `test-ozon-perf-campaigns.ts` 14 (новый), `test-ozon-perf-client.ts` 42, `test-ozon-sync-diff.ts` 37, `test-ozon-upsert.ts` 71, `test-ozon-analytics.ts` 29, `test-unit-economics.ts` 36.

## [0.18.1] - 2026-05-18

Hotfix Ozon-аналитики: SQL-запросы возвращали 500 из-за того, что `postgres.js` не сериализует `Date` в raw `sql\`...\``-template'ах.

### Исправлено

- **`TypeError: The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`** — все routes Ozon-аналитики, принимающие `from`/`to`, теперь конвертируют `Date → ISO-строку` перед интерполяцией в `db.execute(sql\`...\`)` и кастят явно `::timestamp` / `::date` в SQL:
  - `src/app/api/marketplaces/ozon/kpi/route.ts`
  - `src/app/api/marketplaces/ozon/timeseries/route.ts`
  - `src/app/api/marketplaces/ozon/top-ads/route.ts`
  - `src/app/api/marketplaces/ozon/abc/route.ts`
  - `src/app/api/marketplaces/ozon/campaigns/route.ts`
  - `src/app/api/marketplaces/ozon/search-phrases/route.ts`
  - `src/app/api/marketplaces/analytics/ozon/route.ts`
  - `src/app/api/unit-economics/products/route.ts` (превентивно — там был тот же паттерн с 30/90-дневным окном).
- Все эндпоинты теперь возвращают `400 Invalid date` вместо падения, если `from`/`to` не парсится.

### Изменено

- Раздел в sidebar и заголовок страницы `/marketplaces/ozon`: **«Ozon · Аналитика» → «Аналитика»** (`src/app/(app)/layout.tsx`, `src/app/(app)/marketplaces/ozon/marketplaces-ozon-client.tsx`). Блоки в каталоге сохраняют свои имена (`Ozon · KPI`, `Ozon · Аналитика` и т.д.) — это namespace в маркете блоков.

### Audit

- `pnpm typecheck`, `pnpm build`, `pnpm lint` — чисто.
- `scripts/test-ozon-upsert.ts` 71 PASS, `test-ozon-sync-diff.ts` 37 PASS, `test-ozon-analytics.ts` 29 PASS, `test-ozon-perf-client.ts` 42 PASS, `test-period-picker.ts` 19 PASS — **198 PASS · 0 FAIL**.
- Проверка против live-БД: `WHERE order_created_at >= 'YYYY-MM-DDTHH:MM:SS.000Z'::timestamp` — корректно возвращает 2405 строк за 30 дней (account `a37bfc90-…`).

## [0.18.0] - 2026-05-17

Полный rebuild Ozon-аналитики: 9 новых блоков + интеграция Performance API + критический фикс sync-обнуления.

### Критический фикс (Phase 0)

- **`upsertUnitProductFromOzon` больше не записывает 0 как «свежее»**:
  - `hasPrices` теперь требует `priceRub > 0` (не просто наличие объекта `prices`). Пустой/нулевой prices payload — `updates.priceKopecks = 'keep'`.
  - `commissions` в metadata пишутся только если есть хотя бы один НЕнулевой процент. Иначе JSONB `||` сохраняет существующие значения.
  - 71 unit-тест в [`scripts/test-ozon-upsert.ts`](scripts/test-ozon-upsert.ts) (было 47).
- **`getProductValue` в `ozon-sync-diff.ts`** возвращает `null` для `priceKopecks <= 0` / `volumeL <= 0` / `costKopecks <= 0`. Diff больше не предлагает «5990 → 0».
- 37 unit-тестов в [`scripts/test-ozon-sync-diff.ts`](scripts/test-ozon-sync-diff.ts) (было 32, +5 на zero-as-no-data).
- Скрипт [`scripts/prune-zero-ozon-fields.ts`](scripts/prune-zero-ozon-fields.ts) для diagnostics/cleanup после фикса (dry-run по умолчанию).

### Performance API интеграция

- **Схема БД расширена**: `marketplace_accounts` + `perf_client_id`, `perf_client_secret_enc`, `perf_status`, `perf_last_sync_at`, `perf_last_sync_error`. 3 новые таблицы: `ozon_perf_campaigns`, `ozon_perf_sku_stats`, `ozon_perf_phrases`.
- **OzonPerformanceClient** ([`performance/client.ts`](src/lib/marketplaces/ozon/performance/client.ts)): OAuth `client_credentials` на `api-performance.ozon.ru`, токены кэшируются в Redis-like абстракции с TTL `expires_in - 60s`.
- **Endpoints**: `listCampaigns`, `generateSkuStatsReport`, `waitForReport`, `downloadReport`, `parseCsv`, `parseSkuStatsRow`.
- **3 sync-стейджа**: `perfCampaigns`, `perfSkuStats`, `perfPhrases`. Полная интеграция в `runFullSync` — пропускаются с `skipped` если у аккаунта нет perf-кредов.
- **UI настроек**: Performance API секция в CreateAccountDialog (тогглер «У меня есть Performance API»), отдельный EditPerfApiDialog, в карточке аккаунта — статус + «Тест Performance» + «Изменить» / «Отключить».
- **API**: `POST /api/marketplaces/accounts/[id]/test-perf` — пробный OAuth-запрос.
- **On-demand слой** ([`performance/on-demand.ts`](src/lib/marketplaces/ozon/performance/on-demand.ts)): `mergeHistoricalAndOnDemand`, `periodIncludesToday`, `todayInMoscow`. Кэш 10 мин.
- 42 unit-теста в [`scripts/test-ozon-perf-client.ts`](scripts/test-ozon-perf-client.ts).

### Переиспользуемая инфраструктура

- **`PeriodPicker`** ([`components/blocks/period-picker.tsx`](src/components/blocks/period-picker.tsx)): пресеты `today/yesterday/7d/14d/30d/mtd/custom`, pure-функции `resolvePeriod`, `getPreviousPeriod`, `describePeriod`. 19 unit-тестов в [`scripts/test-period-picker.ts`](scripts/test-period-picker.ts).
- **`StatCard`** ([`components/blocks/stat-card.tsx`](src/components/blocks/stat-card.tsx)): KPI-карточка с delta, sparkline, цветовыми бейджами по `goodDirection`, форматами `rub`/`pct`/`int`/`days`. Использует `useBlockDensity`.
- **`ChartShell`** ([`components/blocks/chart-shell.tsx`](src/components/blocks/chart-shell.tsx)): универсальная обёртка над Recharts — line/area/bar + compare-overlay прошлым периодом (пунктир).
- **`OzonAccountSelector`** ([`components/marketplaces/ozon-account-selector.tsx`](src/components/marketplaces/ozon-account-selector.tsx)): селектор Ozon-аккаунта для SettingsForm с CTA-fallback и статусом Perf API.
- **`@/lib/redis`** ([`src/lib/redis.ts`](src/lib/redis.ts)): `RedisLike` интерфейс + in-memory shim. Для Phase 2 (горизонтальный масштаб) — подключить ioredis.

### Новые блоки (9 штук)

1. **`unit.ozon-kpi`** — 6 KPI-карточек (Выручка / Заказы / Расход / ДРР / AOV / CPO) с delta и sparkline. API `/api/marketplaces/ozon/kpi`.
2. **`unit.ozon-chart`** — time-series график (line / area / bar) с compare-overlay. API `/api/marketplaces/ozon/timeseries`.
3. **`unit.ozon-top-ads`** — таблица топ-N товаров по рекламному расходу: CTR / CPC / CPO / ДРР. API `/api/marketplaces/ozon/top-ads`.
4. **`unit.ozon-stock-clusters`** — распределение остатков по типу склада (FBO/FBS/CrossBorder). API `/api/marketplaces/ozon/stock-clusters`.
5. **`unit.ozon-search-phrases`** — топ поисковых фраз с CTR / CPO. API `/api/marketplaces/ozon/search-phrases`.
6. **`unit.ozon-campaigns`** — таблица рекламных кампаний с расходом / заказами / ДРР. API `/api/marketplaces/ozon/campaigns`.
7. **`unit.ozon-data-health`** — статус Seller API + Performance API + последний sync + CTA. Без backend-API (использует `useMarketplaceAccounts`).
8. **`unit.ozon-abc`** — ABC-анализ выручки (80/15/5%). API `/api/marketplaces/ozon/abc`.
9. **`unit.ozon-ai-insights`** — rule-based инсайты по KPI + аналитике (тренд, ДРР, OOS-риски, реклама без продаж, топ-3). Без внешнего AI-вызова на MVP, но контракт совместим с переходом на `ai.micro-agent`. Pure-функция `generateInsights`.

### Новая страница

- **`/marketplaces/ozon`** — отдельная страница с дефолтным layout: KPI наверху, Chart посередине, Analytics-таблица, Top-Ads + Data-Health, Campaigns + Phrases, Stock-Clusters + ABC, AI Insights. Ссылка в боковой навигации.

### Обновления существующих файлов

- **`unit.ozon-analytics` SettingsForm**: добавлена секция «Синхронизация» с тогглерами 8 стейджей + кнопкой «Запустить синхронизацию». Performance стейджи disabled если нет perf-кредов.
- **`/api/blocks/sources/route.ts`**: добавлены output-поля для всех 9 новых блоков (для cross-block формул).
- **`registry.ts`**: 9 новых `BlockDef` + `BLOCK_META` + дефолтный layout для `marketplaces-ozon-dashboard`.
- **Yoolip-упоминания** убраны из 4 .ts/.tsx файлов и MEMORY/START. Остались только историчные упоминания в CHANGELOG и PLAN.md (имя конкурента).

### Документация

- Новый файл [`docs/MARKETPLACES_OZON_PERFORMANCE.md`](docs/MARKETPLACES_OZON_PERFORMANCE.md): инструкция по получению Performance API ключа, описание endpoints, sync-окна, кэш-стратегия, troubleshooting.

### Audit / Reliability

- ✅ `pnpm typecheck` — 0 errors.
- ✅ ~170 unit-тестов pass (71 upsert + 37 sync-diff + 29 analytics + 42 perf-client + 19 period-picker).
- ✅ `tenant_id` во всех новых SQL-запросах.
- ✅ `mountedRef` во всех новых `useEffect` с async-функциями.
- ✅ Никогда не логируем `client_secret` / `perfClientSecret`.
- ✅ Все Zod-схемы с `.default()` для backward-compat.
- ✅ Performance API: rate-limit (10 RPS) + retry на 429/5xx + backoff с jitter.
- ✅ Период в UTC ISO (PeriodPicker), Performance API даты в Europe/Moscow (`todayInMoscow`).
- ✅ Старые аккаунты без `perfClientId` работают штатно — perf-стейджи пропускаются.

## [0.17.2] - 2026-05-17

Полный аудит Ozon-sync и новый Yoolip-style блок аналитики.

**Что починили в существующем блоке `unit.ozon-multi-table`:**
1. Sync больше не обнуляет «свои» значения. Раньше при поэтапной синхронизации
   (стейджи `products` → `prices` → `stocks`) каждый поздний стейдж писал
   `priceKopecks=0`, `volumeL=0` и т.п. для полей, которые он не приносит —
   потому что в `onConflictDoUpdate.set` всегда стояли значения из текущего
   payload'а. Теперь они условные: если payload не принёс это поле — fallback
   на текущее значение в БД через `sql\`unit_products.x\``.
2. Настройки sync теперь живут в **дефолтной табе «Параметры» Settings-диалога
   блока** (через `BlockDef.SettingsForm`), а не в отдельной toolbar-кнопке.
3. Добавлен **`stockSource`** в настройки sync — гибкий выбор источника
   остатка: `mode-aware` (FBO→stockMarketplace, FBS→stockOwn — default),
   `fbo` (всегда склады Ozon), `fbs` (всегда ваши склады), `sum` (legacy).

**Новый блок `unit.ozon-analytics` (Yoolip-style):**
Read-only таблица аналитики per-product за выбранный период: выручка, заказы,
реклама, ДРР, остатки, дней остатков. SQL-агрегаты из `ozon_orders` (через
LATERAL `jsonb_array_elements(items)`) и `ozon_transactions` (фильтр по
operation_type ~ promot/advertis/marketing). Smart-фильтры: «с рекламой /
ДРР>20% / мало остатков / нет остатков / без заказов / без рекламы /
убыточные». Period picker (сегодня / вчера / 7д / 14д / 30д / MTD / custom),
XLSX-экспорт, цветные баджи для ДРР и stock.

### Added

- **`planUnitProductUpsertFromOzon()`** — pure function ([upsert-plan.ts](src/lib/marketplaces/ozon/upsert-plan.ts)). Возвращает план upsert'а: `{insert, updates: {field: 'fresh'|'keep'}, metadataDeltaKeys, metadataDelta}`. Выделено из `upsert.ts` чтобы тестировать без env/db.
- **Conditional set + sql-fallback в upsert** ([upsert.ts](src/lib/marketplaces/ozon/upsert.ts)) — для каждого поля (`priceKopecks`, `volumeL`, `stockMarketplace`, `stockOwn`, `visibility`) обновляется только если payload его принёс; иначе `sql\`unit_products.price_kopecks\`` и т.д. Metadata-merge тоже использует delta-объект, в который попадают только присутствующие части (commissions/dimensions/stockByType/turnover).
- **47 smoke-тестов upsert** ([scripts/test-ozon-upsert.ts](scripts/test-ozon-upsert.ts)) — частичные payload'ы (products / prices / stocks / комбинации), skip без ключей, visibility, primary_image (string vs array), crossborder в FBS бакет.
- **`OzonSyncSettingsForm`** ([ozon-sync-settings-form.tsx](src/components/unit-economics/ozon-sync-settings-form.tsx)) — извлечённый UI настроек sync (без Dialog-обёртки). Используется и в `BlockDef.SettingsForm` блока, и в legacy `OzonSyncSettingsDialog` (для «Edit settings» в preview).
- **`stockSource`** в `SyncSettingsSchema` ([unit-ozon-multi-table.tsx](src/lib/blocks/catalog/unit-ozon-multi-table.tsx)) — 4 опции (`mode-aware`/`fbo`/`fbs`/`sum`), default `mode-aware`. UI в SettingsForm — radio с inline-подсказкой какой буфер реально подставится в текущем mode.
- **`resolveStock()`** ([ozon-sync-diff.ts](src/components/unit-economics/ozon-sync-diff.ts)) — pure-helper, разветвляет логику остатка по stockSource × mode. `getProductValue` теперь принимает stockSource четвёртым параметром.
- **+7 stockSource-тестов** ([scripts/test-ozon-sync-diff.ts](scripts/test-ozon-sync-diff.ts)) → итого 32 PASS.
- **Блок `unit.ozon-analytics`** ([unit-ozon-analytics.tsx](src/lib/blocks/catalog/unit-ozon-analytics.tsx) + [unit-ozon-analytics-types.ts](src/lib/blocks/catalog/unit-ozon-analytics-types.ts)) — Yoolip-style read-only таблица per-product за период. BlockDef + `SettingsForm` + Render. Регистрация в [registry.ts](src/lib/blocks/registry.ts), теги `marketplace/analytics/ozon/yoolip`, иконка `BarChart3`.
- **API `/api/marketplaces/analytics/ozon`** ([route.ts](src/app/api/marketplaces/analytics/ozon/route.ts)) — tenant-scoped, joins `ozon_orders` (LATERAL items) + `ozon_transactions` (фильтр promot/advertis/marketing) ← spine `unit_products`. Возвращает `rows` + `totals` (revenue/ads/drr/delivered/cancelled/returned/productsWithSales) + period. Cancelled+returned+delivered = total для buyout, drr=null если revenue=0.
- **`ozon-analytics-table.tsx`** — таблица с сортировкой по любой колонке, баджами для ДРР (green<10 / ok<20 / warning<50 / danger≥50) и stock (danger=0 / danger<7d / warning<14d / ok<30d / good≥30d). 13 колонок (article/name/price/cost/margin/orders/qty/revenue/ads/drr/stock/days/buyout).
- **`ozon-analytics-filters.ts`** — 8 smart-фильтров (`all`, `with-ads`, `high-drr`, `no-ads`, `low-stock`, `no-stock`, `no-orders`, `unprofitable`). Pure functions + counts.
- **`ozon-analytics-settings-form.tsx`** — UI для нового блока (магазин / дефолтный период / дефолтный фильтр / видимые колонки по группам).
- **Period picker в блоке** — сегодня / вчера / 7д / 14д / 30д / MTD / custom (с input[type=date] для произвольного диапазона). `resolvePeriod()` помощник в [unit-ozon-analytics-types.ts](src/lib/blocks/catalog/unit-ozon-analytics-types.ts).
- **Totals header** — 5 карточек: выручка / реклама / ДРР / заказы / товары с продажами.
- **XLSX-экспорт** через `xlsx` (уже в стеке) с именем `ozon-analytics_YYYY-MM-DD_YYYY-MM-DD.xlsx`.
- **29 smoke-тестов analytics** ([scripts/test-ozon-analytics.ts](scripts/test-ozon-analytics.ts)) — все 8 фильтров, config schema, resolvePeriod все пресеты.
- **Поля блока в `/api/blocks/sources`** ([route.ts](src/app/api/blocks/sources/route.ts)) — `revenue/ads/drr/orders/productsWithSales` для cross-block биндингов (live-значения грузятся клиентом, в sources только labels).

### Fixed

- **Sync clobbering bug** — поэтапная синхронизация перезаписывала уже загруженные данные нулями. Проявлялось как «preview показывает все нули» в `unit.ozon-multi-table` после обновления через диалог-настроек (см. PR-комментарий пользователя со скриншотом). Корневая причина: безусловный set всех полей в onConflictDoUpdate; теперь — conditional set с sql-fallback. Покрыто 47 тестами.
- **Отсутствие Settings-tab в блоке Ozon юнит-таблицы** — раньше настройки sync открывались только через toolbar-кнопку («Настройки Ozon»). Теперь — стандартный механизм через `BlockDef.SettingsForm` → таб «Параметры» Settings-диалога. Тоlbar-кнопка убрана. Диалог `OzonSyncSettingsDialog` сохранён в виде back-compat обёртки (используется из preview «Edit settings»).
- **Неправильная FBO/FBS семантика остатка** — `buildSyncDiff` суммировал stockMarketplace+stockOwn независимо от mode блока. Теперь — `resolveStock()` с 4 политиками (default `mode-aware` — FBO→stockMarketplace, FBS→stockOwn).

### Audit / Reliability

- `pnpm typecheck` ✓ · `pnpm build` ✓
- `pnpm tsx scripts/test-ozon-upsert.ts` → **47/47 PASS**
- `pnpm tsx scripts/test-ozon-sync-diff.ts` → **32/32 PASS** (25 предыдущих + 7 stockSource)
- `pnpm tsx scripts/test-ozon-analytics.ts` → **29/29 PASS** (8 фильтров + config schema + resolvePeriod)
- **Итого 108 smoke-тестов** проходят.
- `mountedRef` в новом блоке `unit.ozon-analytics` защищает setState после unmount.
- Deleted-account fallback в обоих SettingsForm (sync для multi-table, analytics для нового блока) — если сохранённый accountId не существует, автоматически переключается на первый доступный.
- Backward-compat: старые конфиги блока `unit.ozon-multi-table` без `sync.stockSource` корректно получают default `mode-aware` через Zod `.default()`. Покрыто в [scripts/test-ozon-analytics.ts](scripts/test-ozon-analytics.ts) #12.
- tenant_id фильтрация явно присутствует в новом analytics-API (`unitProducts.tenantId`, `ozonOrders.tenant_id`, `ozonTransactions.tenant_id`).
- JSONB injection safety — все динамические данные (offer_id, price, qty, sku) идут как `it->>'offerId'` и параметризованные значения, без конкатенации SQL.

## [0.17.1] - 2026-05-17

Робастность Ozon-синхронизации и продвинутая интеграция Ozon с блоком
`unit.ozon-multi-table`. Исправлены валидационные ошибки `/v1/seller/info`
и `primary_image`, добавлена мини-инструкция «Где взять Client-Id/Api-Key»,
блок получил dedicated диалог настроек синхронизации (магазин, политика
конфликтов, какие колонки заполнять) и **детальный preview-модал** с
артикулом/полем/было/станет перед применением изменений.

### Added

- **[src/components/integrations/ozon-key-help.tsx](src/components/integrations/ozon-key-help.tsx)** — складная инструкция «Где взять Client-Id и Api-Key Ozon»: 7 шагов, ссылка на `seller.ozon.ru/app/settings/api-keys`, акцент на роли **Admin read only** (238 методов), срок действия 180 дней, AES-256-GCM в БД. Два варианта: `full` (страница интеграций) и `compact` (диалог создания аккаунта).
- **Диалог настроек синхронизации блока** [`ozon-sync-settings-dialog.tsx`](src/components/unit-economics/ozon-sync-settings-dialog.tsx) — выбор магазина, политика конфликтов (`overwrite`/`fill-empty`/`skip`), `matchBy` (article|sku), `treatZeroAsEmpty`, гранулярный columnMap по группам: «Идентификаторы / Базовые / Расширенные», с описанием источника данных под каждым полем и предупреждениями для полей, требующих включённый стейдж (`salesPerMonth` ← заказы, `commissionPct` ← FBO/FBS из global.mode блока).
- **Pure-function diff builder** [`ozon-sync-diff.ts`](src/components/unit-economics/ozon-sync-diff.ts) — собирает детальный diff между текущими строками блока и данными Ozon: индексация по `matchBy` (case-insensitive, trim для article), применение `conflictPolicy`, маппинг полей блока ↔ unit_products, поддержка `commissionPct.{fbo,fbs}` по mode блока. Возвращает `totals` + `changes[]` (rowKey, field, before, after, action, reason) + `resultRows`.
- **Smoke-тесты diff** [`scripts/test-ozon-sync-diff.ts`](scripts/test-ozon-sync-diff.ts) — 25 кейсов: все политики, `treatZeroAsEmpty`, mode fbo/fbs, empty inputs, case-insensitive matching, matchBy=sku fallback. Все PASS.
- **Detailed Preview-модал** [`ozon-sync-preview-dialog.tsx`](src/components/unit-economics/ozon-sync-preview-dialog.tsx) — summary-карточки (новые / обновлено / пропущено / без изменений), фильтр-pills по типу действия, scrollable таблица 7 колонок: «Артикул · Название · Колонка · Было · → · Станет · badge», пагинация по 200 строк, action-badges (new/изменено/пропущено с reason-tooltip).
- **Кнопка «Настройки Ozon»** в toolbar `unit.ozon-multi-table` ([unit-ozon-multi-table.tsx](src/lib/blocks/catalog/unit-ozon-multi-table.tsx)) — открывает `OzonSyncSettingsDialog`. Кнопка «Синхронизировать» переименована/обновлена: использует `accountId` из конфига блока (если задан), после завершения job собирает diff и открывает превью.
- **`/api/unit-economics/products?include=aggregates&accountId=…`** ([products/route.ts](src/app/api/unit-economics/products/route.ts)) — query param `include=aggregates` агрегирует `ozon_orders` (LATERAL `jsonb_array_elements(items)`) для расчёта `salesPerMonth` (delivered за 30 дней) и `buyoutPct` (delivered / total за 90 дней, минимум 5 заказов в окне). `accountId` ограничивает выборку конкретным магазином. Поддержка обоих драйверов drizzle (`{rows}` vs прямой массив).
- **Sync config в схеме блока** [unit-ozon-multi-table.tsx](src/lib/blocks/catalog/unit-ozon-multi-table.tsx) — секция `sync` в Zod-схеме: `accountId`, `conflictPolicy`, `matchBy`, `treatZeroAsEmpty`, и `columnMap` (article/name/price/cost/stock/volumeL/commissionPct/salesPerMonth/buyoutPct). Все поля с `.default()` — backward-compat для старых конфигов.
- **`JobErrorsBlock`** в `/settings/integrations` — раскрываемый список ошибок job'а с stage-badge, info-tooltip для «schema mismatch» сообщений (после lenient-mode такие ошибки = warnings).

### Fixed

- **Ошибка валидации `/v1/seller/info`: `result: Required`** ([types.ts](src/lib/marketplaces/ozon/types.ts), [test/route.ts](src/app/api/marketplaces/accounts/[id]/test/route.ts)) — `SellerInfoSchema` теперь принимает обе формы ответа Ozon: с обёрткой `result` и плоскую. Test-route извлекает companyInfo как `info.result ?? { name, company_id, is_enabled }`.
- **Ошибка `items.N.primary_image: Expected string, received array`** ([types.ts](src/lib/marketplaces/ozon/types.ts), [upsert.ts](src/lib/marketplaces/ozon/upsert.ts)) — `ProductInfoSchema.primary_image: z.union([z.string(), z.array(z.string())]).optional()`. `upsertUnitProductFromOzon()` нормализует через `normalizePrimaryImage()`: массив или строка → массив без пустых строк. В metadata сохраняется отдельно `primaryImage` (первый URL) и `images` (полный массив; приоритет `info.images`, fallback на primary).
- **`upsertUnitProductFromOzon()` возвращает `boolean`** — пропускает запись и возвращает `false`, если у Ozon-карточки нет `info.id` или `info.offer_id` (раньше падало бы на NOT NULL / уникальном индексе). Стейдж `products` считает skipped, добавляет `warnings: ["N товаров пропущено: у них нет id или offer_id"]`. Прежняя сигнатура `Promise<void>` совместима с другими стейджами (prices/stocks) — они игнорируют возврат.

### Changed

- **`OzonClient.post()` — lenient mode по умолчанию** ([client.ts](src/lib/marketplaces/ozon/client.ts)) — при несовпадении Zod-схемы (после `safeParse`) пишет `console.warn('[ozon] schema mismatch on ...')` и возвращает raw JSON, **не бросает ошибку**. Sync продолжается. Опция `{ strict: true }` сохраняет старое поведение (бросает `OzonApiError`). 4xx/5xx по-прежнему throw — lenient НЕ глотает HTTP-ошибки.
- **`RATE_LIMITERS` cleanup** ([client.ts](src/lib/marketplaces/ozon/client.ts)) — добавлен `lastUsedAt` на `RateLimiter`, опortunistic cleanup лимитеров старше 1ч при создании нового (`size % 8 === 0`). Без `setInterval` (плохо для serverless).
- **`OzonSyncButton`** ([ozon-sync-button.tsx](src/components/unit-economics/ozon-sync-button.tsx)) — props `accountId?: string | null` (pinned account для блоков), `mountedRef` для защиты от setState после unmount. Если `accountId` задан и существует — dropdown прячется, кнопка работает только с этим магазином. Если pinned аккаунт удалён — fallback к первому активному + warning «Сохранённый магазин удалён».
- **`OzonSyncSettingsDialog`** автоматически переключает draft на первый доступный магазин, если сохранённый `accountId` больше не существует (с предупреждением «Сохранённый аккаунт удалён»).
- **`/settings/integrations`** — `OzonKeyHelp` (full) в начале секции Ozon Seller, `OzonKeyHelp` (compact) в `CreateAccountDialog`. Стейджи job'a теперь рендерят свои ошибки inline (через `truncate()`), плюс детальный `JobErrorsBlock` под списком стейджей.
- **Импорт XLSX в `unit.ozon-multi-table`** — после успешного импорта тоже открывает preview-модал согласно `config.sync` (не сразу применяет, как раньше).

### Audit / Reliability

- Все новые `setState` в `OzonSyncButton` и `RenderOzonMultiTable` защищены `mountedRef`.
- `tenant_id` явно присутствует в WHERE нового SQL (`/api/unit-economics/products?include=aggregates`).
- `OzonClient.post({ strict: false })` НЕ глотает 4xx/5xx — они по-прежнему throw `OzonApiError`. Lenient режим срабатывает только на Zod-парсинг.
- Backward-compat: блок `unit.ozon-multi-table` со старым конфигом (без `sync`) корректно подхватывает `.default()` значения.
- `pnpm typecheck` ✓ · `pnpm build` ✓ · `pnpm tsx scripts/test-ozon-sync-diff.ts` → 25/25 PASS.

## [0.17.0] - 2026-05-17

Интеграция Ozon Seller API: подключение магазинов в новом разделе
`/settings/integrations`, типизированный клиент с rate-limit, оркестратор
7 стейджей синхронизации (товары / цены / комиссии / остатки / заказы /
реализация / транзакции / оборачиваемость), кнопка «Загрузить из Ozon»
в Ozon юнит-блоках, plan-gate на multi-store (Pro+), задел под cron-расписание.
api_key хранится зашифрованным AES-256-GCM, никогда не возвращается raw на клиент.

### Added

- **Раздел Настройки → Интеграции** ([src/app/(app)/settings/integrations/page.tsx](src/app/(app)/settings/integrations/page.tsx) + [integrations-client.tsx](src/app/(app)/settings/integrations/integrations-client.tsx)) — подключение Ozon Seller API:
  - Создание/редактирование/удаление аккаунтов (Client-Id + Api-Key из ЛК Ozon → Настройки → Seller API).
  - Тогглы «Что синхронизировать»: каталог товаров, цены и комиссии, остатки, заказы (с настройкой окна в днях), реализация, транзакции (с окном), оборачиваемость.
  - Кнопки «Тест подключения» (вызов `/v1/seller/info`), «Синхронизировать сейчас» (запуск runFullSync), inline-прогресс с per-stage статусами.
  - История последних синхронизаций с раскрытием деталей по стейджам.
  - Plan-gate: free/trial — 1 магазин на маркетплейс; Pro/Business/Enterprise — unlimited. Кнопка «Добавить магазин» disabled с tooltip для не-premium.
- **`src/lib/marketplaces/`** новый модуль:
  - [`types.ts`](src/lib/marketplaces/types.ts) — `OzonSyncSettings`, `OZON_FULL_STAGES`, `DEFAULT_OZON_SYNC_SETTINGS`, `CreateAccountSchema`/`UpdateAccountSchema` (Zod), `isPremiumPlan()`, `AccountPublic` (DTO без расшифрованного api_key).
  - [`crypto.ts`](src/lib/marketplaces/crypto.ts) — реэкспорт `encryptSecret/decryptSecret/maskSecret` из `lib/inbox/crypto.ts` (общий `INBOX_SECRET_KEY`, AES-256-GCM).
  - [`queries.ts`](src/lib/marketplaces/queries.ts) — tenant-scoped CRUD `marketplace_accounts`/`ozon_sync_jobs`, `canAddAccount()` (plan-gate), `updateAccountLastSync()`, `updateSyncJobStage()` (atomic per-stage merge через `jsonb_set`).
  - [`use-accounts.ts`](src/lib/marketplaces/use-accounts.ts) — React-хук для списка аккаунтов в блоках.
- **`src/lib/marketplaces/ozon/`** клиент Ozon Seller API:
  - [`client.ts`](src/lib/marketplaces/ozon/client.ts) — `OzonClient` с native fetch, headers `Client-Id`/`Api-Key`, timeout 30s, **token-bucket rate-limit 40 RPS per Client-Id** (Ozon допускает 50, держим запас), exponential backoff на 429/5xx (3 retry, base 500/1500/4000ms + jitter), не ретраит 4xx кроме 429.
  - [`types.ts`](src/lib/marketplaces/ozon/types.ts) — Zod-схемы ответов API (`.passthrough()` для гибкости).
  - [`endpoints.ts`](src/lib/marketplaces/ozon/endpoints.ts) — типизированные обёртки 10 endpoints + `OZON_API_VERSION_MAP` (единая точка при изменении версии: `sellerInfo`, `productList /v3`, `productInfoList /v3`, `productInfoPrices /v5`, `productInfoStocks /v4`, `postingFbsList /v3`, `postingFboList /v2`, `financeRealization /v2`, `financeTransactionList /v3`, `analyticsTurnoverStocks /v1`).
- **`src/lib/marketplaces/ozon/sync/`** оркестратор синхронизации:
  - [`full.ts`](src/lib/marketplaces/ozon/sync/full.ts) — последовательное прогон 7 стейджей с записью per-stage прогресса в `ozon_sync_jobs.stages`, финализация `marketplace_accounts.last_sync_*`.
  - [`products.ts`](src/lib/marketplaces/ozon/sync/products.ts), [`prices.ts`](src/lib/marketplaces/ozon/sync/prices.ts), [`stocks.ts`](src/lib/marketplaces/ozon/sync/stocks.ts), [`orders.ts`](src/lib/marketplaces/ozon/sync/orders.ts), [`realization.ts`](src/lib/marketplaces/ozon/sync/realization.ts), [`transactions.ts`](src/lib/marketplaces/ozon/sync/transactions.ts), [`turnover.ts`](src/lib/marketplaces/ozon/sync/turnover.ts) — отдельные файлы на каждый стейдж с единым контрактом `runStage(ctx) → StageResult`.
  - [`upsert.ts`](src/lib/marketplaces/ozon/upsert.ts) — маппинг Ozon-сущностей в БД: `upsertUnitProductFromOzon()` (идемпотентен по `(tenant_id, marketplace, article=offer_id)`, мерджит metadata через `||` JSONB, **не перезаписывает costKopecks** — себестоимость пользователя), `upsertFbsPosting`/`upsertFboPosting`/`insertRealizationBatch`/`upsertTransaction`/`updateTurnoverForProduct`. Расчёт `volume_l_x100` из `weight/depth/width/height` с конвертацией единиц.
- **API-роуты** (все `runtime='nodejs'`, `auth()`, tenant_id filtering, top-level try/catch):
  - [`/api/marketplaces/accounts`](src/app/api/marketplaces/accounts/route.ts) — `GET` (список), `POST` (создать с `canAddAccount` plan-gate).
  - [`/api/marketplaces/accounts/[id]`](src/app/api/marketplaces/accounts/[id]/route.ts) — `GET`/`PATCH`/`DELETE`. apiKey шифруется в `updateAccount`; никогда не возвращает raw.
  - [`/api/marketplaces/accounts/[id]/test`](src/app/api/marketplaces/accounts/[id]/test/route.ts) — `POST` проверка через `/v1/seller/info`.
  - [`/api/marketplaces/accounts/[id]/sync`](src/app/api/marketplaces/accounts/[id]/sync/route.ts) — `POST` создаёт job, запускает `runFullSync` асинхронно через `Promise.resolve().then(...)`, возвращает `jobId` сразу. `maxDuration=300` для serverless.
  - [`/api/marketplaces/accounts/[id]/jobs`](src/app/api/marketplaces/accounts/[id]/jobs/route.ts) — `GET` история (последние 20).
  - [`/api/marketplaces/accounts/[id]/jobs/[jobId]`](src/app/api/marketplaces/accounts/[id]/jobs/[jobId]/route.ts) — `GET` polling-эндпоинт для конкретного job.
- **DB schema** [`marketplaces.ts`](src/lib/db/schema/marketplaces.ts) + [`drizzle/init/07-marketplaces.sql`](drizzle/init/07-marketplaces.sql):
  - `marketplace_accounts` — `tenant_id, user_id, marketplace ('ozon'|'yandex'|'wb'), name, client_id, api_key_enc (AES-256-GCM), status, sync_settings JSONB (тогглы + cron-поля), company_info JSONB, last_sync_{at,status,error,summary}`. Уникальный индекс `(tenant_id, marketplace, client_id)`.
  - `ozon_sync_jobs` — `tenant_id, account_id, kind, status, started_at, finished_at, items_processed/total, stages JSONB (per-stage SyncStageState), errors JSONB`.
  - `ozon_orders` — `posting_number UNIQUE per account, scheme ('fbo'|'fbs'), status, order_created_at, delivered_at, cancelled_at, returned_at, items JSONB, raw JSONB`. Для расчёта реального `salesPerMonth`/`returnsPct`/`cancelPct`.
  - `ozon_realization` — `account_id, period_from, period_to, sku, offer_id, qty, gross_kopecks, commission_kopecks, logistics_kopecks, ads_kopecks, raw JSONB`. Индекс `(account_id, period_from, sku)`.
  - `ozon_transactions` — `account_id, transaction_id UNIQUE per account, operation_type, operation_date, amount_kopecks, posting_number, sku, raw JSONB`.
  - `unit_products.marketplace_account_id uuid NULL` (FK `marketplaces.accounts.id` `ON DELETE SET NULL`) — связь синхронизированного товара с источником, XLSX-импорт оставляет NULL.
- **Кнопка «Загрузить из Ozon»** в Ozon юнит-блоках:
  - [src/components/unit-economics/ozon-sync-button.tsx](src/components/unit-economics/ozon-sync-button.tsx) — shared компонент с polling `/jobs/[jobId]` каждые 1.5s, DropdownMenu для multi-store (Pro+), inline-прогресс, fallback-ссылка на `/settings/integrations` если аккаунтов нет.
  - В [unit-ozon-multi-table.tsx](src/lib/blocks/catalog/unit-ozon-multi-table.tsx) — рядом с «Импорт XLSX»; после sync вызывается `loadProductsAndPopulate()`.
  - В [unit-ozon-calculator.tsx](src/lib/blocks/catalog/unit-ozon-calculator.tsx) — в верхней панели; после sync открывается `OzonProductPickerDialog` для выбора одного товара (автозаполнение price/cost/volumeL/commissionPct и заголовка блока именем товара).
  - [src/components/unit-economics/ozon-product-picker-dialog.tsx](src/components/unit-economics/ozon-product-picker-dialog.tsx) — диалог с поиском по article/name, читает `/api/unit-economics/products?marketplace=ozon`.
- **Навигатор в `/settings`** ([src/app/(app)/settings/settings-client.tsx](src/app/(app)/settings/settings-client.tsx)) — карточка «Маркетплейсы (Ozon, …)» с переходом на `/settings/integrations`.

### Changed

- [src/lib/db/schema/unit-economics.ts](src/lib/db/schema/unit-economics.ts) — добавлено nullable-поле `marketplaceAccountId` (uuid, FK на `marketplace_accounts.id`, `on delete set null`) + индекс `unit_products_marketplace_account_idx`. Существующие записи (XLSX-импорт) сохраняют `NULL`.
- [src/lib/db/schema/index.ts](src/lib/db/schema/index.ts) — добавлен экспорт `./marketplaces`.
- [START.md](START.md) — добавлена строка маршрутизации «Интеграции маркетплейсов» с указанием ключевых файлов.
- [MEMORY.md](MEMORY.md) — новый раздел «Marketplace Integrations / Ozon Seller API» с инвариантами, ключевыми файлами, граблями rate-limit/fire-and-forget/realization-window и manual SQL для `07-marketplaces.sql`.
- [PLAN.md](PLAN.md) — добавлен TODO «BullMQ cron для Ozon sync» и зафиксирован mini-plan для дальнейших аналитических блоков и документации.

### Security / Invariants

- **api_key хранится только в `marketplace_accounts.api_key_enc` (AES-256-GCM с `INBOX_SECRET_KEY`).** Никогда не возвращается raw на клиент — только `maskSecret(api_key_enc)`. В логах sync — тоже нет ключа.
- **Все API-роуты под `auth()` + tenant_id filtering.** Невозможно прочитать чужой аккаунт даже зная `id`.
- **Top-level try/catch с `NextResponse.json({ ok: false, error })`** во всех роутах — никогда не возвращаем HTML error page. Specific case: распознавание `relation "marketplace_accounts" does not exist` → 503 с прямой инструкцией применить SQL.
- **Rate-limit per Client-Id 40 RPS** (Ozon allow 50) + exponential backoff — не блокируем чужие магазины при горячем sync одного, не упираемся в 429 от Ozon.

### Deferred (TODO в PLAN.md)

- BullMQ-воркер для авто-синхронизации по расписанию (поля `auto_sync_enabled/cron` в `OzonSyncSettings` уже есть, UI рисует disclaimer).
- Yandex Market / Wildberries (схема `marketplace_accounts` уже мультимаркетная).
- Ozon Push API (вебхуки) как замена polling'а.
- Incremental sync через `updated_at` фильтры.
- AI-tool `sync_ozon` для голосового запуска через Cmd+K.
- Аналитические блоки `ozon.*` (sales-by-sku, commissions-vs-tariff, returns-heatmap, actual-vs-plan).
- Документация `docs/MARKETPLACES_OZON.md` для AI-агентов (как менять endpoint версии, типичные пагинационные паттерны, известные quirks).

### Команды на применение

```bash
pnpm install # на всякий случай
pnpm db:generate # сгенерировать миграции из новой Drizzle-схемы (необязательно для dev — applied через manual SQL)
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/07-marketplaces.sql
pnpm build
```

После применения SQL открыть `/settings/integrations`, добавить Ozon-аккаунт
(Client-Id + Api-Key из ЛК Ozon → Настройки → Seller API), нажать
«Тест подключения», потом «Синхронизировать сейчас». В блоках
«Юнит-экономика Ozon» появится кнопка «Загрузить из Ozon».

## [0.16.0] - 2026-05-16

Новый блок «Курсы валют» (`currency.rates`) с публикацией курсов в реальном
времени для использования в формулах и привязках, плюс фикс пустого селекта
«основная колонка» в блоке Данные (`custom.data`), когда у всех колонок снят
флаг публикации. После первоначальной реализации проведён аудит — закрыты
race-condition в hook'е, защита от не-JSON ответов сервера, понятные сообщения
при ненастроенной БД.

### Hardened (audit pass)

- **Frontend: защита от не-JSON ответов** ([src/lib/blocks/catalog/currency-rates.tsx](src/lib/blocks/catalog/currency-rates.tsx)) — если route handler упадёт с unhandled exception (например, не применена SQL-миграция и Drizzle бросает `relation "currency_rates" does not exist`), Next.js возвращает HTML error page, и `await response.json()` падает с непонятным `Unexpected end of JSON input`. Введён хелпер `parseJsonResponse(response)`: сначала `response.text()`, потом `JSON.parse()` с extract'ом `<title>` HTML-страницы как hint'а. Пользователь видит человеческое: `"Сервер вернул не-JSON ответ: 500 Internal Server Error. Проверьте логи и применение SQL-миграции drizzle/init/06-currency.sql"`.
- **Frontend: race-condition после unmount** — `useCurrencyRates()` теперь хранит `mountedRef` и обёртку `safeSetState`, чтобы async fetch'и не дёргали `setState` после unmount компонента (классический React-warning + потенциальный source of stale state). Также `triedAutoRefreshRef` гарантирует ровно ОДИН авто-refresh за жизнь компонента — без guard'а пустой ответ от refresh'а триггерил бы рекурсивный цикл.
- **Frontend: error message переносится** — добавлены `whitespace-pre-wrap break-words` к контейнеру ошибки в Render. Раньше длинные сообщения (полный HTTP-стек или multi-line error) обрезались.
- **Frontend: useMemo для `parseConfig`** — без обёртки в `useMemo` каждый рендер создавал новый массив `config.codes` → пересчёт `visible`/`publishOutput` на пустом месте + лишние ре-публикации в `BlockValuesContext`.
- **Backend: try/catch + распознавание missing-table** ([src/app/api/currency/rates/route.ts](src/app/api/currency/rates/route.ts), [src/app/api/currency/rates/refresh/route.ts](src/app/api/currency/rates/refresh/route.ts)) — оба роута полностью обёрнуты, при ошибке всегда возвращается JSON. Если ошибка содержит `relation .*currency_rates.* does not exist` (regex), отдаём `503` с прямой инструкцией: `"Применить SQL: docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/06-currency.sql"`. Это покрывает самый частый failure mode setup'а.
- **CBR loader: защита от невалидной даты** ([src/lib/currency/sources/cbr.ts](src/lib/currency/sources/cbr.ts)) — `new Date(data.Date).toISOString()` мог бросить `RangeError` на нестандартном формате. Теперь fallback на текущую дату, если `getTime()` возвращает `NaN`.

### Added

- **Блок `currency.rates`** ([src/lib/blocks/catalog/currency-rates.tsx](src/lib/blocks/catalog/currency-rates.tsx)) — свежие курсы валют ЦБ РФ для использования в `@связать`. Config: `codes` (массив выбранных валют, дефолт `['USD','EUR','CNY','AED']`), `primaryCode` (для шапки блока и публикации как `value`), `showDelta`/`showPercent` (стрелка ↑↓ + Δ% от вчерашнего курса). Density-aware Render: `xs` → курс primaryCode + `CODE/RUB`, `sm` → код + курс, `md/lg` → список валют со стрелками тренда и Δ%. Кнопка `RefreshCw` в шапке блока — принудительный refresh (rate-limit 1/min на tenant). Settings-форма: 9 «популярных» валют (USD/EUR/CNY/AED/TRY/GBP/JPY/KZT/BYN) с описаниями + кнопка «Остальные валюты ЦБ» открывает диалог со всеми ~30 валютами и search'ем. Publisher (`useBlockValuePublisher`): `value: rates[primaryCode]`, `usd/eur/cny/...` (по выбранным), `usd_change/eur_change/...` (Δ% от вчера), `__labels: 'usd=USD (₽),...'`. **`__money` НЕ публикуется** — курс это число (RUB за 1 единицу), а не money-формат; формулы вида `=A1*@currency.usd` работают корректно когда A1 — money, а курс — обычное число.
- **`/api/currency/rates`** ([src/app/api/currency/rates/route.ts](src/app/api/currency/rates/route.ts)) — `GET`: список snapshot'ов из БД, опциональный фильтр `?codes=USD,EUR,CNY`, lazy-refresh при возрасте >23h (асинхронный, не блокирует ответ). Защита от параллельных refresh'ей через `inflightRefresh` глобальный promise.
- **`/api/currency/rates/refresh`** ([src/app/api/currency/rates/refresh/route.ts](src/app/api/currency/rates/refresh/route.ts)) — `POST`: принудительный refresh, требует auth, rate-limit 1/min per tenant через in-memory `Map<tenantId, lastRefreshAt>`. При ошибке fetch у ЦБ возвращает `502` с понятным сообщением.
- **`src/lib/currency/`** модуль:
  - [`types.ts`](src/lib/currency/types.ts) — `CurrencyRate`, `CurrencyStaleness`, `CURRENCY_STALENESS_WINDOW_MS = 23h`.
  - [`sources/cbr.ts`](src/lib/currency/sources/cbr.ts) — `fetchCbrDaily()`: тянет `https://www.cbr-xml-daily.ru/daily_json.js` (community JSON-mirror официального XML ЦБ, бесплатно/без ключей/без лимитов). Нормализует `Nominal>1` (10 KRW = 110₽ → 11₽/KRW) к курсу за 1 единицу. Таймаут 8s + 1 retry с задержкой 800ms.
  - [`queries.ts`](src/lib/currency/queries.ts) — `getCurrencyRates(codes?)`, `getStaleness()`, `refreshCurrencyRates()` с bulk upsert через `onConflictDoUpdate({ target: code, set: { ...sql\`excluded.field\` } })`.
- **DB schema** [`currency_rates`](src/lib/db/schema/currency.ts) + [`drizzle/init/06-currency.sql`](drizzle/init/06-currency.sql) — общая таблица (НЕ tenant-scoped, это публичные данные): `code` (PK, varchar(8)), `nominal`, `name`, `rate_rub` (numeric 18,6 — за 1 единицу), `previous_rub` (для Δ%), `source` (default `cbr`), `source_date`, `updated_at`. Индекс по `updated_at desc`.
- **Регистрация** ([src/lib/blocks/registry.ts](src/lib/blocks/registry.ts)) — `BLOCK_META['currency.rates'] = { tags: ['finance', 'currency', 'universal', 'data'], recommendedFor: ['dashboard'], iconName: 'Banknote' }`. В `/api/blocks/sources` добавлены `TYPE_LABELS['currency.rates'] = { label: 'Курсы валют', category: 'Финансы' }` и ветка в `fieldsForBlock`, читающая из `getCurrencyRates()` (один SQL на весь GET, кэшируется в `currencyRatesByCode: Map<string, CurrencyRate>`).

### Fixed

- **`custom.data` Settings: пустой селект «основной колонки»** ([src/lib/blocks/catalog/custom-data.tsx](src/lib/blocks/catalog/custom-data.tsx)) — раньше селект `publishColumnId` фильтровал колонки через `.filter((c) => c.publish !== false)`, и если пользователь снимал флаг публикации со всех колонок (`<X/>` в кнопке-toggle), список становился пустым и поле выглядело «отключённым». «Активировался» только при добавлении третьей колонки с дефолтным `publish: true`. Это путало UX, потому что `publishColumnId` (какую колонку показывать в шапке как агрегат) и `publish` колонки (экспорт через `@блок.id_колонки`) — это две **разные оси**, а не зависимые. Фикс: убран фильтр, селект показывает **все** колонки. Колонки с `publish: false` помечены текстом `· не публикуется`. При выборе такой колонки она автоматически переключается в `publish: true` (защита: основная колонка обязана экспортироваться, иначе `value`/`__money='value'` не сработают через `@блок`-ссылки).

### Notes

- **Источники курсов — анализ.** Для MVP выбран ЦБ РФ через `cbr-xml-daily.ru` — единственный из доступных вариантов **без API-ключей и без лимитов**. Альтернативы (ExchangeRate-API: 1500/мес, OpenExchangeRates: 1000/мес, Fixer: 100/мес) требуют ключ и для самообновления раз в сутки явно избыточны. Frankfurter (на основе ECB) — резерв на Phase 2 для нерублёвых пар. Свой парсер Yandex Финансы / MOEX / Banki.ru рассматривался, но: верстка ломается, юридическая серая зона, а ЦБ покрывает 99% сценариев финансового пользователя в РФ. История курсов (sparkline-график), кросс-курсы (USD→EUR через RUB), криптовалюты — отдельные итерации, в этой не делается.
- **Команды для применения:**
  ```bash
  pnpm typecheck
  pnpm build
  docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/06-currency.sql
  # первичный seed (после первого пользовательского запроса GET /api/currency/rates
  # делает background-refresh автоматически; этот curl только если хочется сразу):
  curl -X POST http://localhost:3000/api/currency/rates/refresh
  ```

## [0.15.2] - 2026-05-16

Security-патч Next.js (CVE-2026-44578, SSRF через WebSocket upgrade-запросы) + три
UI-фикса по обратной связи: рамка блока теперь применяется визуально (раньше
inset boxShadow на wrapper'е перекрывался `bg-card` детьми), цветовая палитра
перестала «слипаться» в узком столбце, треугольник cross-page сидит ровно под
кружочком на той же вертикальной оси.

### Security

- **Next.js 15.5.4 → 15.5.18** (CVE-2026-44578, severity high, CVSS 3.1 = 8.6) — self-hosted Node.js server позволял SSRF через специально сформированные WebSocket upgrade-запросы (атакующий мог проксировать запросы на внутренние сервисы или cloud metadata endpoints). Фикс в 15.5.16+, мы взяли latest 15.5.x (`15.5.18`). Vercel-hosted деплои не затронуты, но мы планируем self-hosted и AWS — патчим обязательно. Bump в пределах 15.5.x — breaking changes отсутствуют, typecheck + build прошли. [GHSA-c4j6-fc7j-m34r](https://github.com/vercel/next.js/security/advisories/GHSA-c4j6-fc7j-m34r), [NVD CVE-2026-44578](https://nvd.nist.gov/vuln/detail/CVE-2026-44578).

### Fixed

- **`BlockChrome` теперь честно рисует `appearance.borderColor`** ([src/components/blocks/block-chrome.tsx](src/components/blocks/block-chrome.tsx)) — раньше border применялся как `boxShadow: inset 0 0 0 2px {color}` на wrapper'е `<div className="group relative h-full w-full">`. Большинство блоков рендерят внутренний контейнер с `bg-card` и собственным `border` на всю площадь — inset-shadow родителя физически прячется под бэкграундом ребёнка. Поэтому пользователь выбирал «Цвет рамки» в настройках, а визуально ничего не менялось. Фикс: отдельный absolute-overlay `<div className="pointer-events-none absolute inset-0 z-20 rounded-lg">` с тем же `boxShadow: inset` — сидит на z-20 ПОВЕРХ детей блока (которые z-0/z-10), но НИЖЕ chrome-контролов (z-30). `pointer-events-none` гарантирует, что клики проходят насквозь в блок.
- **ColorPalette не «слипается» в узком столбце** ([src/components/blocks/block-settings-dialog.tsx](src/components/blocks/block-settings-dialog.tsx)) — `grid grid-cols-12` сжимал 24px-swatches до ~22px и они теряли отступы (при `max-w-2xl` модалке и двух колонках под цвета каждая получала ~310px при нужных 332px на 12 ячеек × 24px + gap-1). Переход на `flex flex-wrap gap-1.5` с фиксированным размером `h-5 w-5` (20px): swatches не деформируются, естественно переносятся на следующую строку. Активная ячейка вместо `ring-2 ring-primary` теперь рисует **двойное кольцо** через `boxShadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px {colorValue}` — 2px gap до фона + 2px кольца ЦВЕТА самой палитры. Это даёт честный визуальный акцент даже для тёмных цветов (например `#0f172a`), которые раньше сливались с background в dark-теме. Иконка `Check` отрисована с `strokeWidth=3` для лучшей читаемости поверх цветной заливки. `IconPalette` тоже переехала на `flex flex-wrap` — кнопки 28×28 не деформируются.
- **Cross-page треугольник теперь ровно под кружочком** ([src/components/blocks/block-relations-overlay.tsx](src/components/blocks/block-relations-overlay.tsx)) — в v0.15.1 треугольник был ниже центра по Y (правильно), но смещён ВНУТРЬ блока по X на `TRI_INSET = 4`. Из-за этого визуально он не воспринимался как продолжение того же anchor-ряда, что и кружочек — кружочек на ребре блока, треугольник в 4px глубже внутри. По эскизу пользователя треугольник должен сидеть на той же вертикальной оси, что и кружочек (= край блока). Новая формула: `left = edgeX - TRI_SIZE/2` (центр треугольника на ребре блока), `top = anchorCenterY + ANCHOR_R + ANCHOR_TRI_GAP`. Константа `TRI_INSET` удалена (больше не нужна).

## [0.15.1] - 2026-05-15

UI-полировка модалки настроек блока (плотный layout, расширенные палитры
цветов и иконок) и фикс перекрытия cross-page треугольников с anchor-кружочками
в mindmap-overlay'е.

### Changed

- **`BlockSettingsDialog` redesign** ([src/components/blocks/block-settings-dialog.tsx](src/components/blocks/block-settings-dialog.tsx)) — модалка перешла с `max-w-3xl` + `gap-y-4` на `max-w-2xl` + `gap-0 p-0` со sticky header'ом (px-5 py-3) и footer'ом (border-t bg-muted/20). Tabs теперь рендерятся в `bg-muted/20` бэйра с тонким primary-индикатором (`absolute -bottom-px`), вместо border-b-2. В `StyleAndSizeForm` верхняя часть превратилась в двухколоночный grid `200px + 1fr` (preview-чип слева с цветным backplate под иконкой, заголовок справа) — убрано большое пустое поле "ПРЕВЬЮ". Размер-блок получил пресеты в плоской ряд + два слайдера в `sm:grid-cols-2`. AI-промпт-форма уплотнена (textarea rows 8→9, заголовки uppercase tracking, padding 3→2.5). Все uppercase-лейблы используют `text-[10px] font-medium tracking-wide text-muted-foreground` — единый стиль с другими секциями проекта (cashflow, sheet headers).
- **Расширенная палитра цветов** ([src/lib/blocks/types.ts](src/lib/blocks/types.ts)) — `ACCENT_COLORS` вырос с 8 до 25 (default + 13 насыщенных + 8 light + 3 dark). Добавлены: голубой/тиловый/лайм/оранжевый/фуксия/индиго в основном ряду; light-варианты (3b82f6→93c5fd, etc.) для мягких рамок; deep-варианты (1d4ed8, 047857, 0f172a) для контраста. UI: `ColorPalette` перешла на `grid grid-cols-12 gap-1` (4×24px = одна строка из 25 ячеек), default-кнопка стала dashed border с символом `×`, активная кнопка получила `ring-2 ring-primary ring-offset-1 ring-offset-background` — лучше виден focus в обоих темах.
- **Расширенная палитра иконок** ([src/lib/blocks/types.ts](src/lib/blocks/types.ts)) — `ICON_NAMES` вырос с 24 до 70 иконок: финансы (Wallet, PiggyBank, Landmark, RussianRuble, BadgePercent), графики (LineChart, Sigma, Calculator, Gauge), время (Clock, Hourglass, Timer), бизнес (Factory, Store, Package, Truck, Boxes), люди/действия (UserCheck, Repeat, Plus, Minus), данные (Server, HardDrive, FileText, Folder, Inbox, Mail, Bell, Tag), спец (Flame, Bookmark, Bot, Cpu, Globe, Lock, Key, Settings). UI: `IconPalette` перешла на `grid grid-cols-12 gap-1`, кнопки 7×7 с `bg-muted/40` фоном (вместо плоского border'а), активная — `border-primary bg-primary/10 text-primary shadow-sm`, под палитрой строка-метаданные `{N} в палитре · Каталог 1500+`.
- **`AppearanceForm` (legacy для AddBlockDialog)** — синхронизирован с новым `StyleAndSizeForm`: использует `ColorSection` (uppercase-лейбл + опц. hint справа) и тот же стиль для иконки.

### Fixed

- **Треугольнички cross-page больше не перекрывают anchor-кружочки** ([src/components/blocks/block-relations-overlay.tsx](src/components/blocks/block-relations-overlay.tsx)) — раньше треугольник позиционировался по `(top+bottom)/2 - TRI_SIZE/2`, что попадало ровно в центр edge-anchor'а (`<circle r={4} cx={left} cy={midY}/>`) и они визуально слипались (см. скрин юзера). Теперь `triTop = anchorCenterY + ANCHOR_R + ANCHOR_TRI_GAP` (4 + 6 = 10px ниже центра кружочка). Добавлены константы `ANCHOR_R = 4` (синк с `<circle r={4}/>`) и `ANCHOR_TRI_GAP = 6`. Защита от вылета за нижнюю границу блока: `triTop = min(triTop, box.bottom - TRI_SIZE - 4)`.

## [0.15.0] - 2026-05-15

Адаптивные колонки в `custom.data` (auto-fit + drag-resize + кнопка «А»),
точная геометрия фон-сетки `BlockGrid` (совпадает с RGL-cells),
cross-page треугольнички в mindmap-overlay'е (incoming/outgoing с popover'ом).

### Added

- **`custom.data` — адаптивные ширины колонок** ([src/lib/blocks/catalog/custom-data.tsx](src/lib/blocks/catalog/custom-data.tsx)) — label-колонка и value-колонки теперь автоматически подгоняются под самое длинное значение через `canvas.measureText` (один общий контекст на весь модуль, SSR-safe). `computeLabelColumnWidth(rows)` и `computeValueColumnWidth(col, rows, liveValues, showKopecks)` учитывают header label + все ячейки в форматированном виде, ограничены диапазоном (label: 80–240px, value: 72–220px). Manual override через `column.width` / новое `config.labelColumnWidth` имеет приоритет. Drag-handle между header'ами колонок (включая label) — pointer-капчер на header-ячейке, локальный `dragState` обновляется на каждое движение без записи в config (только на pointerUp), кнопка-курсор `col-resize` появляется при hover. Кнопка **«A»** (Maximize2-иконка) в шапке блока сбрасывает все ручные widths (`labelColumnWidth=undefined` + удаление `column.width` у всех колонок) → возврат к авто-режиму. Кнопка скрыта когда блок уже в auto-mode.
- **`/api/blocks/relations` lightweight-эндпоинт** ([src/app/api/blocks/relations/route.ts](src/app/api/blocks/relations/route.ts)) — возвращает все страницы юзера (defaults + saved) с базовой инфой блоков (`blockId`, `type`, `typeLabel`, `label`) и их исходящими связями (`outgoing: [{pageKey, blockId, field}]`), собранными из `block.dependencies.sources` + `@`-refs внутри `config` (через рекурсивный scan + `blockRefs` объекты excel.cell). Без агрегаций — в отличие от `/api/blocks/sources`, который дополнительно резолвит фактические значения для UI-пикеров. Новый эндпоинт быстрее, потому что не дёргает getCashflowSummary/listInboxChannels/evaluateSheetFormula.
- **`useCrossPageRelations(currentPageKey, enabled)` хук** ([src/lib/blocks/use-cross-page-relations.ts](src/lib/blocks/use-cross-page-relations.ts)) — при `enabled=true` (overlay открыт) делает один fetch и возвращает `Record<blockId, { incoming: CrossPageLink[], outgoing: CrossPageLink[] }>`. **Incoming** = блоки на ДРУГИХ страницах, на которые этот блок ссылается (данные приходят сюда). **Outgoing** = блоки на ДРУГИХ страницах, которые ссылаются на ЭТОТ блок (данные уходят туда). Кэш per-`pageKey` для stale-while-revalidate: при повторном маунте overlay сразу видит прошлый snapshot, обновление в фоне.
- **Cross-page треугольнички в mindmap** ([src/components/blocks/block-relations-overlay.tsx](src/components/blocks/block-relations-overlay.tsx)) — поверх SVG-edge-overlay добавлен HTML-слой с маркерами cross-page связей. **▶ зелёный** на левом ребре блока (apex смотрит ВНУТРЬ) = incoming, **▶ индиго** на правом ребре блока (apex смотрит НАРУЖУ) = outgoing. Размещаются по вертикальному центру боковых рёбер (top/bottom заняты chrome'ом — drag handle, AI/settings/X, CrossPagePin, Network-иконка, resize hot-zone). Треугольники кликабельны (`pointerEvents: auto`), при клике открывается popover в стиле сайта (`bg-popover`, `border-border`, `shadow-lg`) со списком блоков-целей: каждая строка — `<Link href={pageHref(pageKey)}>` с заголовком блока, лейблом страницы и ExternalLink-иконкой. Закрывается кликом вне (`mousedown` listener на document, скипает клики на trigger/popover через `data-cross-rel-*` атрибуты). Бейдж с `count` показывается если cross-page связей > 1.

### Changed

- **`.block-grid-surface` точная геометрия** ([src/components/blocks/block-grid.tsx](src/components/blocks/block-grid.tsx), [src/components/blocks/block-grid.css](src/components/blocks/block-grid.css)) — фон-сетка теперь рассчитывается под реальные cell'ы RGL: `colW = (containerWidth - margin[0] * (cols - 1)) / cols`, `stepX = colW + margin[0]`, `stepY = rowHeight + margin[1]`, breakpoints/cols 1:1 как у RGL. ResizeObserver на surface пересчитывает inline-style `backgroundSize` + `backgroundPosition` при ресайзе окна. Радиальный градиент сместился с `circle at 1px 1px` на `circle at 5px 5px`, в сочетании с offset (colW, rowH) даёт дот ровно в центре gap'а между ячейками — точки попадают в углы grid-cell'ов (туда, куда «прилипает» блок). Усилены уровни видимости: default 0.18, edit 0.30, active 0.50.
- **`useCrossPageRelations` использует `cache: 'no-store'`** в fetch — иначе stale данные из CDN/SW могли бы скрывать только что добавленные cross-page refs.

### Notes

- Авто-ширина колонок `custom.data` пересчитывается через `useMemo([config.columns, config.rows, liveValues, showKopecks])` — изменение содержимого ячеек (включая live-обновления привязок) перерасчёт width'ов триггерит автоматически. Хуки вынесены ВЫШЕ early-returns для `density==='xs'/'sm'` (rules-of-hooks).
- Cross-page outgoing detection пока работает только если ссылающийся блок имеет `block.dependencies.sources` ИЛИ `@page:blockId.field` ref внутри config. Sheet-формулы с локальными ссылками типа `=A1+B2` не считаются cross-page (это локальные cell-refs).
- Popover треугольничка — обычный absolute div со `z-30`, привязан к triangle-кнопке; при множестве открытых блоков на странице одновременно показывается максимум один (state `openPopover: blockId|direction`).

## [0.14.0] - 2026-05-15

Доработка блока «Данные» (multi-column с привязками per cell), глобальная
координатная сетка-фон под BlockGrid и переработка модалки настроек блока
с master-промптом.

### Added

- **`custom.data` multi-column** ([src/lib/blocks/catalog/custom-data.tsx](src/lib/blocks/catalog/custom-data.tsx)) — блок «Данные» теперь поддерживает произвольное число колонок с per-column форматом (₽/число/%/текст), per-column шириной и флагом `publish`. Каждая ячейка может быть либо ручным значением, либо привязкой к другому блоку (`@blockId.field`) — ровно как в `excel.cell`. Новая схема `Config = { columns, rows: [{id, label, cells: Record<colId, {v, ref?, isMoney?}>}], publishMode, publishColumnId, showKopecks }`. На hover ячейки появляется `@`-кнопка для открытия picker'а блоков-источников; готовый picker — `CellRefPickerDialog` использует `/api/blocks/sources` + live `BlockValuesContext`. Сохраняет money-флаг через `cell.isMoney` (мигрировано из `excel.cell.moneyRefs`).
- **Per-column publish** — каждая `publish:true` колонка публикуется в `BlockValuesContext` отдельным агрегатом `{column.id} = aggregateByMode(values, publishMode)`. В `__money` попадают все рублёвые publish-колонки, в `__labels` — пары `colId=Label` для красивого отображения в picker'ах. Legacy `value` = агрегат «основной» колонки (`publishColumnId`, по умолчанию первая publish:true).
- **`SettingsForm` для `custom.data`** — управление колонками (add/remove, inline-edit label, format-pills с иконками `₽/#/%/T`, toggle `publish`), выбор `publishMode` + `publishColumnId`, переопределение `showKopecks`.
- **Координатная сетка-фон** ([src/components/blocks/block-grid.css](src/components/blocks/block-grid.css), [src/components/blocks/block-grid.tsx](src/components/blocks/block-grid.tsx)) — `.block-grid-surface` рендерит точки с шагом 24px (`radial-gradient` + `hsl(var(--foreground)/0.07)`), почти незаметно в обычном режиме. В `data-edit="true"` (режим «Настроить») точки ярче (`primary/0.18`), в `data-active="true"` (активный drag/resize через `onDragStart`/`onResizeStart` props RGL) — ещё ярче (`primary/0.32`). Применяется автоматически на всех страницах с `BlockGrid` (Dashboard, Cashflow, Inbox, Boards, Unit Economics).
- **`BlockInstance.aiPrompt: string`** ([src/lib/blocks/types.ts](src/lib/blocks/types.ts)) — универсальное поле для master-промпта блока. Передаётся в `/api/ai/chat` через `MicroAgentDialog.blockContext.aiPrompt`. Имеет приоритет над legacy `config.blockPrompt` в `ai.micro-agent`. Persistence: добавлено `aiPrompt: z.string().max(8000).optional()` в `BlockInstanceSchema` API роута `/api/blocks/layout/[pageKey]`.
- **Вкладка «AI / Промпт»** в модалке настроек блока ([src/components/blocks/block-settings-dialog.tsx](src/components/blocks/block-settings-dialog.tsx)) — universal для всех блоков, текстовая область для master-промпта с подсказкой, счётчиком символов/токенов и заделом под `BlockDef.defaultAiPrompt` (показывается «Шаблон по типу блока: ещё не задан»).

### Changed

- **Модалка настроек блока** — табы «Внешний вид» и «Размер» объединены в одну вкладку **«Стиль и размер»** с live-preview-карточкой блока (показывает выбранные цвета/иконку/заголовок), цветовыми палитрами в две колонки на десктопе, иконкой и блоком размера со слайдерами + numeric inputs + quick-presets (Маленький / Средний / Большой / Широкий). Финальный набор табов: **Параметры | Связи | Стиль и размер | AI / Промпт**.
- **`MicroAgentSettingsForm`** (`ai.micro-agent`) — убрано поле «Инструкция для AI (блок-промпт)», теперь оно живёт в общей вкладке «AI / Промпт». Поле «Модель» осталось в «Параметры». `instance.aiPrompt > config.blockPrompt` приоритет в `RenderMicroAgent.handleSubmit` и в `block-grid.tsx → MicroAgentDialog blockContext`.
- **`MicroAgentDialog`** ([src/components/micro-agent/micro-agent-dialog.tsx](src/components/micro-agent/micro-agent-dialog.tsx)) — при отправке в `/api/ai/chat` master-промпт из `blockContext.aiPrompt` имеет приоритет над inline-инструкцией ввода в раскрывашке.
- **AI-нормалайзер `normalizeCustomDataConfig`** в `block-grid.tsx` обновлён для multi-column shape: принимает `raw.columns`, миграция legacy `row.value` → `row.cells[primary].v`, поддержка нового `row.cells: Record<colId, {v, ref?, isMoney?}>`.

### Notes

- `parseConfig` в `custom.data` мигрирует все старые конфиги при чтении (legacy `rows[i].value` + top-level `format`), запись всегда в новом формате.
- `AppearanceForm` и `SizeForm` остались экспортами `block-settings-dialog.tsx` ради `AddBlockDialog`, который использует их при создании нового блока.
- `minContentSize` у `custom.data` снят — таблица сама скроллится внутри блока любого размера.

## [0.13.0] - 2026-05-15

Крупный апгрейд Ozon юнит-блоков до соответствия с референсом
[синий-рассвет.рф/ozon.html](https://xn----8sbgmlah4a4aehap.xn--p1ai/) +
два критических blocker-фикса (Маркет блоков, выбор города FBS).

### Fixed

- **`/marketplace` крах #2** (`Cannot read properties of undefined (reading 'map')` на `b.pages.map(pageLabel)`) — RSC-граница превращала `BlockDef` объекты из `'use client'`-каталогов в opaque client-reference proxy, у которых `pages`/`description`/`category`/`defaultSize` undefined. Точечный фикс `iconName` в 0.12.2 не покрывал остальные поля. Решение: `marketplace/page.tsx` оставлен только для auth-проверки, `MarketplaceClient` сам вызывает `listAllBlocks()` на клиенте — все поля `BlockDef` доступны нативно. `PAGE_LABELS` и `MarketplaceBlock` тип переехали в `marketplace-client.tsx`.
- **«Не работает выбор города FBS»** — closure-trap: `handleWarehouseChange` делал два последовательных `onChange`/`setInput` с замкнутым `config.global`/`config.inputs` из одного рендера, второй вызов перезатирал смену склада из первого. Решение: новые helper'ы `updateGlobalMany(patch)` / `setInputs(patch)` собирают апдейты в один `persist`. Зафиксировано в `MEMORY.md` как универсальный паттерн.

### Added

- **Multi-cluster FBS** — выбор нескольких кластеров с долями (sum = 100%) вместо одного склада. Новый компонент `<ClusterSelector>` (`src/components/unit-economics/cluster-selector.tsx`) с popover-чекбоксами, % инпутами, индикатором суммы (зелёный/оранжевый), кнопкой «Нормализовать», quick-пресетами «Все РФ / Топ-5 / Топ-10 / География / Снять все». Triggern показывает компактный chip «Москва 60% · СПб 40% · +N».
- **28 кластеров FBS** (`tariffs-2026-04-07.ts → FBS_CLUSTERS`) вместо 9: Алматы, Армения, Астана, Беларусь, Воронеж, Дальний Восток, Екатеринбург, Казань, Калининград, Краснодар, Красноярск, Кыргызстан, Махачкала, Москва+МО, Невинномысск, Новосибирск, Омск, Оренбург, Пермь, Ростов, Самара, СПб+СЗО, Саратов, Тверь, Тюмень, Узбекистан, Уфа, Ярославль. Каждый помечен `local: boolean` (для multiplier ×1.0 / ×1.25) и `region` (для пресетов).
- **Расширенные объёмные диапазоны** — `VOLUME_BRACKETS` LUT с 43 бинами (0.2/0.4/.../1/1.25/.../15/17/20/25/.../200/400/600/800/∞ л) для FBO и FBS. Step-функции `fboLogisticsCost`/`fbsLogisticsCost` стали точнее на крупногабаритах.
- **Новые поля Ozon-расчёта** (`OzonInputs`):
  - `fbsClusters: Array<{ key, sharePct }>` — multi-cluster выбор.
  - `returnsPct` (% возвратов после выкупа) и `cancelPct` (% отмен) вместо одного `buyoutPct`. `effectiveBuyoutPct` derived: `100 - returnsPct - cancelPct`. Legacy `buyoutPct` сохранён для обратной совместимости (если оба новых = 0).
  - `coInvestPct` — соинвест баллами Ozon, % компенсации расходов. P&L строка «Соинвест» (положительная) и метрика `coInvestSavings`.
  - `freeAcceptance` — бесплатная приёмка (toggle). Если выключена и `mode='fbs'` — фикс `+10₽/ед` к логистике.
  - `supplyLeadWeeks` — лог. плечо (нед., для будущего расчёта оборачиваемости).
  - `documentedExpensesMonth` — документально подтверждённые расходы ₽/мес (для УСН Д-Р вычета: `tax = rate × max(0, buyerPrice - documentedExpensesMonth/salesPerMonth)`). Заменяет boolean `taxDeductExpenses`.
  - `indirectExpensesMonth` — косвенные расходы ₽/мес (распределяются на единицу).
- **Метрика «Цена с СПП»** (`priceWithSpp` = `buyerPrice`, явно дублируется в результатах) и привязываемое поле в picker'е (label `Цена с СПП`).
- **Multi-cluster логистика** в `calculateOzon` — weighted-sum по выбранным кластерам: `Σ (baseLogistics × clusterMultiplier(c) × share/totalShare)`. Если `fbsClusters` пуст — fallback к single через `isLocalCluster`. 3 новых смоук-теста подтверждают: Дальний Восток дороже Москвы, 50/50 split = среднее.

### Changed

- **Точки сдачи FBS — 2 опции** (вместо 3): «СЦ» (`sorting_center`), «ПВЗ/ППЗ» (`pickup_point`). Опция `'ozon_warehouse'` удалена — мигрируется в `'sorting_center'`.
- **`OzonResults`** расширены: `priceWithSpp`, `effectiveBuyoutPct`, `coInvestSavings`. `returns` теперь учитывает обе доли потерь (`returnsPct + cancelPct`), а не один `buyoutPct`.
- **Header-чип FBS** в обоих Ozon-блоках теперь показывает `Точка сдачи · Скорость · Кластеры (top1 X% · top2 Y% · +N)` вместо одиночного склада.
- **Ozon одиночный калькулятор** реструктурирован: 7 секций (Товар и цена / Комиссия / Логистика FBO / Возвраты и отмены / Реклама и соинвест / Налоги / Оборачиваемость). Inline toggle'ы «Бесплатная приёмка», «>50 заказов», «Локальный» и условный input `Док. расходы` при `usn_income_minus`.
- **Ozon multi-table GlobalParamsBar** дополнен полями: `% возвратов`, `% отмен`, `Соинвест`, `Косвенные ₽/мес`, `Бесплатная приёмка` toggle, conditional `Док. расходы`.

### Removed

- **Налоговый режим `'nds'` (Только НДС)** удалён из `TaxMode` enum. Старые конфиги мигрируются в `'osno'` (где НДС считается отдельной строкой через `vatPct`). UI-метка `'osno'` теперь «ОСНО (НДС)».
- **`OzonInputs.taxDeductExpenses` (boolean)** заменён на `documentedExpensesMonth: number` (₽/мес).
- **Старый single-warehouse выбор FBS** в обоих Ozon-блоках. Поле `fbsWarehouse` оставлено только в типе как `@deprecated` для миграции.

### Migration

`migrateOzonRaw()` (`src/lib/unit-economics/ozon/migrate.ts`) выполняет idempotent-миграцию любых сырых конфигов:
- `fbsWarehouse: string` → `fbsClusters: [{ key, sharePct: 100 }]` (single → multi).
- `taxMode: 'nds'` → `'osno'`.
- `taxDeductExpenses: boolean` → удаляется, `documentedExpensesMonth = 0` (пользователь введёт).
- `fbsDropoffPoint: 'ozon_warehouse'` → `'sorting_center'`.

Вызывается в `parseConfig` обоих Ozon-блоков (single — на `inputs`, multi — на `global`). Старые сохранённые layout'ы открываются без потери данных.

### Tests

`scripts/test-unit-economics.ts`: **36 PASS / 0 FAIL** (было 32). Добавлены:
- УСН Д-Р: `tax = 15% × max(0, 1000 - documentedPerUnit) = 135` (5000₽/мес × 50 продаж = 100₽/ед).
- Соинвест баллами: `coInvestSavings > 0`, profit с соинвестом > без.
- Multi-cluster: ДВ дороже Москвы, 50/50 split = среднее.

## [0.12.2] - 2026-05-15

### Fixed
- **`/marketplace` крах** — Server Component обращался к `b.icon.displayName` объектов `BlockDef`, которые приходят из `'use client'`-каталогов как client-references (без полей). Решение: добавлено поле `iconName?: string` в `BlockDef`, расширена карта `BLOCK_META` в `registry.ts` (одно строковое имя на каждый из 18 блоков), `withMeta()` подставляет `iconName` автоматически. `marketplace/page.tsx` теперь использует `b.iconName ?? 'Square'`. `add-block-dialog.tsx` приведён к симметрии (`def.iconName ?? def.icon?.displayName ?? 'Square'`).
- **Пустые select-ы FBS / Налог** в Ozon-юнитке (multi и single) — нативный `<select>` на macOS/iOS периодически рендерил пустую метку в закрытом состоянии. Заменён на `DropdownSelect` (Radix `DropdownMenu` + кнопка-trigger с явной меткой и `ChevronDown`). Гарантированный рендер выбранного значения во всех браузерах. Заодно унифицированы select-ы в `unit.yandex-calculator` (Спецтариф / Налог).
- **Нечитаемые ключи в picker «Итого по товарам»** — раньше picker привязки показывал технические имена (`totalProfitMonth`, `totalMoneyInGoods`). Теперь блоки публикуют `__labels` строкой `"key=Label,..."` через `useBlockValuePublisher`, `useAvailableBlockSources` парсит её в `Record<string, string>`, `unit-cell-binding-dialog` использует `labels[field] ?? sourceFieldLabel(field)`. Cross-page picker (`/api/blocks/sources`) расширен — `unit.ozon-multi-table` и `unit.my-store-table` отдают все publishable поля с человекочитаемыми label/format.

### Changed
- **Resize handle UX** — было: появляется при hover на блок с задержкой 3 сек («удержание указателя»). Стало: невидимый hot-zone 40×40 в правом нижнем углу `BlockChrome` (`data-resize-hotzone`), CSS-правила в `block-grid.css` показывают handle через `:has([data-resize-hotzone]:hover)` или `:has(> .react-resizable-handle:hover)` без задержек. Edit mode по-прежнему показывает handle всегда.
- **«Маркетплейс» → «Маркет блоков»** — sidebar label, H1 на `/marketplace`, ссылка из `AddBlockDialog`. URL `/marketplace` сохранён, ссылки и история не ломаются.

### Added
- **Массовое заполнение колонки** в `unit.ozon-multi-table` (кнопка `MoreVertical` в `SortableHeaderCell` для input-колонок открывает `DropdownMenu` с input + Apply) и в `unit.my-store-table` (секция «Массовое заполнение» в `ColumnEditDialog`, disabled для type=`formula`). Привязанные ячейки (`row.bindings[field]`) пропускаются — биндинги не ломаются. Inline-фидбэк «Применено к N · пропущено K (привязки сохранены)».
- **`DropdownSelect`** (`src/components/unit-economics/dropdown-select.tsx`) — переиспользуемый wrapper над Radix `DropdownMenu`: явная кнопка-trigger c label/ChevronDown, `min-w-[10rem] max-w-[14rem]`, truncate, отметка выбранного `Check`. Используется в трёх unit-блоках.
- **`__labels` convention** — соглашение для блоков с богатым output: строка `"key=Human Label,..."` в `useBlockValuePublisher`. Парсится `parseLabelsString` в `values.tsx`. Опубликовано для `unit.ozon-multi-table`, `unit.my-store-table`, `unit.ozon-calculator`, `unit.yandex-calculator`.

## [0.12.1] - 2026-05-15

### Fixed
- **Unit Ozon UI** — закреплена геометрия таблицы `unit.ozon-multi-table`: фиксированные ширины/minWidth/maxWidth для sticky/header/body/totals ячеек, единые высоты `HEADER_H/ROW_H`, непрозрачные sticky-колонки без полупрозрачного hover-слоя. Это убирает просвечивание и налезание скроллящихся колонок под `# / Артикул / Название`.
- **Unit My Store UI** — тот же sticky/table fix применён к `unit.my-store-table`, включая непрозрачные sticky-ячейки, фиксированную геометрию и стабильный z-index итоговой строки.
- **Ozon DnD hydration** — у двух `DndContext` в `unit.ozon-multi-table` добавлены стабильные `id` на основе `instance.id`, чтобы `@dnd-kit` не генерировал разные `aria-describedby` на SSR/client.
- **FBS/tax display** — в Ozon multi-table и одиночном Ozon-калькуляторе теперь явно видны выбранные FBS-настройки (точка сдачи, скорость, склад) и налоговый режим со ставкой; native select'ы получили закреплённые ширины, `text-foreground` и `color-scheme`, чтобы выбранные значения не выглядели пустыми.

## [0.12.0] - 2026-05-15

### Added
- **DnD-перетаскивание колонок** в блоке `unit.ozon-multi-table`: hover на header показывает drag-handle (`GripVertical`) — input-колонки и result-колонки имеют отдельные `DndContext`/`SortableContext` (нельзя смешивать input и result между собой). Sticky `#`/Артикул/Название/Действия не двигаются. Порядок сохраняется в `config.global.columnOrder = { inputs: string[]; results: string[] }` через `safeParse`-совместимое расширение схемы; новые колонки автоматически добавляются в конец, удалённые — выкидываются (`resolveColumnOrder`).
- **Раздел `/marketplace`** — каталог всех блоков (browse-only). Поиск по названию/описанию/тегам, фильтр по категории и тегам, карточки с иконкой/описанием/тегами/доступными страницами, диалог детальной информации (defaultSize, supportsDependencies, теги). Кнопки «Создать блок» и «Купить блок» — disabled-заглушки на будущее. Sidebar-пункт «Маркетплейс» (иконка `Store`).
- **Метаданные блоков** в `BlockDef`: опциональные `recommendedFor: string[]` (страницы, для которых блок «рекомендован»), `tags: string[]` (метки для фильтра в маркетплейсе), `source: 'builtin' | 'user' | 'paid'` (default `'builtin'`). Заполнено для всех 18 встроенных блоков через карту `BLOCK_META` в `registry.ts` + `withMeta()`-обёртку (без правки каждого файла-блока).
- **`listRecommendedForPage(pageKey)`** в `registry.ts` — сборка рекомендованных: `recommendedFor.includes(pageKey)` ИЛИ `pages.includes(pageKey)` (без `'*'`-универсалов).
- **Редизайн `AddBlockDialog`**: зона «Рекомендуемые» с иконкой `Sparkles` сверху + кнопка «Показать все»/«Свернуть». В режиме «все» показываются остальные блоки сгруппированные по категории (рекомендованные не дублируются). Поиск по названию/описанию/тегам — расширяет каталог автоматически. Footer диалога — ссылка «Открыть Маркетплейс блоков →».
- **Полный апгрейд FBS** на блоке `unit.ozon-multi-table` и одиночном Ozon-калькуляторе: 3 глобальных селекта (видны только при `mode === 'fbs'`) — Точка сдачи (`sorting_center / pickup_point / ozon_warehouse`), Скорость отгрузки (`fast 12–24ч (+2% ком.) / standard 24–48ч / slow 48–72ч`), Склад FBS (`almaty / moscow / spb / ekaterinburg / kazan / novosibirsk / rostov / krasnodar / other`). При смене склада автосинхронизируется toggle «Локальный кластер» (`FBS_WAREHOUSE_LOCAL_BY_DEFAULT`). Чип режима в заголовке расширен: `FBS · 12–24 ч (+2% ком.) · Алматы`.
- **Тарифы FBS** (`tariffs-2026-04-07.ts`): константа `FBS_FAST_SHIPMENT_COMMISSION_BUMP_PCT = 2`, карты `FBS_WAREHOUSE_LOCAL_BY_DEFAULT`, `FBS_WAREHOUSE_LABELS`, `FBS_DROPOFF_LABELS`, `FBS_SHIPMENT_SPEED_LABELS`. `calculateOzon` добавляет +2% к комиссии при `mode='fbs' && fbsShipmentSpeed='fast'` (для FBO надбавка не применяется).
- **4 новых смоук-теста** (`scripts/test-unit-economics.ts`): FBS standard/fast/slow комиссия, FBO + fast не получает надбавку. Итого **32 PASS, 0 FAIL**.

### Fixed
- **Окончательное «просвечивание» sticky-колонок** в `unit.ozon-multi-table` и `unit.my-store-table`. Корни проблемы: `bg-card/95 backdrop-blur` (полупрозрачный header), отсутствие `overflow:hidden` на `BodyCell` (текст из `<input>` соседних ячеек выезжал в sticky-зону), мягкий z-index. Решение: header-row `→ bg-card` (solid, без `backdrop-blur`); sticky cells получили `overflow:hidden isolate` (новый stacking-context); z-index: header sticky `35→45`, totals `25→35`, body sticky `20→30`; hover остаётся непрозрачным `hover:bg-accent/5` без слоя поверх sticky; inputs Артикул/Название теперь `truncate` чтобы текст не выезжал. Те же правки в обоих табличных блоках.

### Changed
- **`OzonInputs`** дополнен опциональными FBS-полями `fbsDropoffPoint?`, `fbsShipmentSpeed?`, `fbsWarehouse?`. `OZON_DEFAULT_INPUTS` имеет default'ы `'sorting_center' / 'standard' / 'almaty'`. Старые сохранённые расчёты не ломаются.
- **`GlobalParamsSchema`** в `unit.ozon-multi-table.tsx` — добавлены `fbsDropoffPoint / fbsShipmentSpeed / fbsWarehouse`; добавлено опциональное поле `columnOrder`. `safeParse` сохраняет совместимость с предыдущими блоками без этих полей.
- **`AddBlockDialog`** теперь использует `listAllBlocks()` + `listRecommendedForPage()` вместо `listBlocksForPage()`, чтобы пользователь мог через «Показать все» добавить нетипичный для текущей страницы блок.
- **Sidebar** (`(app)/layout.tsx`) — между «Мои доски» и «Дедлайны» вставлен пункт «Маркетплейс» (`Store` icon, key `marketplace`).
- **Зависимости**: добавлены `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, `@dnd-kit/utilities ^3.2.2` (упоминались в `PLAN.md` как планируемые — теперь установлены).

### Notes
- БД-схема не менялась, миграции не нужны.
- Маркетплейс — browse-only: установка/создание/покупка блоков остаётся заглушкой (видны disabled-кнопки) под отдельную итерацию.
- DnD добавлен только в `unit.ozon-multi-table` (там колонки фиксированные); у `unit.my-store-table` уже есть полноценный column editor — DnD добавим следующей итерацией при необходимости.

## [0.11.1] - 2026-05-14

### Added
- **Юнит-экономика — глобальный НДС (`vatPct`)** в Ozon (multi-table + single) и Yandex (single). Считается отдельной строкой расхода `vat = buyerPrice * vatPct/100` (в Yandex от `customerPrice`); налог УСН/ОСНО (`tax`) остался отдельной строкой. По умолчанию `vatPct=0` — обратная совместимость со старыми расчётами.
- **Чип режима** в заголовке Ozon multi-table и обоих single-калькуляторов: `FBO`/`FBS` (синий/зелёный) для Ozon, `FBY/FBS/DBS/Express` (фиолетовый) для Yandex; рядом — чип `НДС N%` если задан.
- **Result-колонка «НДС»** в Ozon мульти-таблице и P&L-строка «НДС» в обоих single-калькуляторах.
- **Вкладка «Мой магазин» (`unit-economics-my-store`)** в `/unit-economics` после Яндекс Маркет, со своим `pageKey` и BlockGrid layout. Иконка `Store` (Lucide).
- **Блок `unit.my-store-table`** — кастомизируемая таблица товаров: sticky `#`/Артикул/Название и итоги (как в Ozon мульти), но колонки полностью CRUD-редактируемые. Колонка имеет `id`, `label`, `type` (`number | percent | money | text | formula`), `unit`, `width`, `formula`, `positive`, `hidden`. UI: триггер `Settings2` на header (появляется при hover), модалка редактирования (Dialog), кнопка «+ Колонка», скрыть/удалить. В числовых ячейках — `LinkableNumberCell` (привязки + manual). Дефолтный seed колонок: `cost / packaging / delivery / priceRetail / priceWholesale / marginRetail (formula) / marginWholesale (formula) / salesPerMonth / stock / revenueMonth (formula) / profitMonth (formula)`.
- **`src/lib/unit-economics/store-formula.ts`** — лёгкий evaluator для блока «Мой магазин». `evalSingleFormula(formula, scope)` и `evalRowFormulas(manualValues, formulas)` — fast-formula-parser + защита от циклов (visiting-set, цикл → `'#CYCLE'`). Идентификаторы заменяются по убыванию длины ключа (`priceRetail` не путается с `price`). Доступны id колонок и глобальные переменные `vatPct`, `taxRatePct`.
- **3 новых смоук-теста** в `scripts/test-unit-economics.ts`: VAT в Ozon, VAT в Yandex, формулы и циклы в Store. Итого 28 PASS.

### Fixed
- **Sticky-колонки Ozon мульти-таблицы** не сливаются со скроллящимся содержимым: z-index sticky body cells `10 → 20`, sticky header cells `30 → 35`, контейнер totals row `→ z-[25]`. Inline `background: var(--background)` заменён на класс `bg-card` (плотный токен). На последней sticky-колонке («Название товара») добавлена тень-разделитель `boxShadow: '1px 0 0 0 var(--border)'`. Hover-фон строки распространяется на sticky-cells через `[&:hover_[data-sticky]]:bg-accent/10`. Тот же набор фиксов в новом блоке «Мой магазин».
- **`LinkableNumberCell` без сдвига** между manual ↔ linked: убрано различие `<input>` vs `<button>`, теперь всегда `<input>`. В linked состоянии — `readOnly`, `tabIndex=-1`, `onClick` → picker, `cursor-pointer`. Меняются только цвет фона (amber-50/60), цвет иконки и пометка `text-muted` при недоступном источнике. Размер ячейки больше не «прыгает».

### Changed
- **`OzonInputs/OzonResults`** — добавлены поля `vatPct` (input) и `vat` (output). `OZON_DEFAULT_INPUTS.vatPct = 0`.
- **`YandexInputs/YandexResults`** — то же.
- **`/api/blocks/sources`** — page label `unit-economics-my-store: 'Юнит-экономика · Мой магазин'`, type label `unit.my-store-table`, `fieldsForBlock` отдаёт `rowsCount` и `stockTotal`.

### Notes
- БД-схема не менялась, миграции не нужны.
- Парсер `СЕБЕС озон.xlsx` не реализован — оставлен на отдельный заход (по запросу пользователя).

## [0.11.0] - 2026-05-14

### Added
- **Раздел «Юнит-экономика»** `/unit-economics` — три вкладки (Ozon, Ozon мульти-артикул, Яндекс Маркет) на BlockGrid; каждая вкладка имеет свой `pageKey` и сохраняет layout отдельно. Новый sidebar-пункт, видимость в `/settings`, Cmd+K action.
- **Pure-TS calculation engines** — `src/lib/unit-economics/{ozon,yandex}/calculate.ts` без зависимостей от React/DB; версионированные тарифные пакеты (`ozon_2026_04_07`, `yandex_2026_04_01`). Ozon: автокомиссия по цене (≤100→14%, 101–300→20%), FBO/FBS логистика по объёму, нелокальный кластер +25%, скидка >50 заказов FBO −15%, доставка ПВЗ с лимитом и учётом выкупа, возвраты, реклама/выкуп, налоги (УСН Доходы/Доходы−Расходы/ОСНО/НДС/Без), оборачиваемость, P&L. Yandex: customerPrice от соинвеста, объём ceil(LWH/1000), модели FBY/FBS/DBS/Express, спецтарифы (витрина 5%, подписка 9%/16%), Fixed tariff при price≤300 и volume≤5, last/middle mile, fulfillment, хранение, налоги, P&L.
- **Drizzle schemas** — `unit_products` (товары с tenant_id, marketplace, цена/себестоимость в копейках, метаданные импорта), `unit_calculations` (сохранённые inputs/bindings/results + `tariff_version`), `unit_imports` (история XLSX-импортов с warnings). Manual SQL: `drizzle/init/05-unit-economics.sql`.
- **Tenant-scoped queries и API** — `/api/unit-economics/products` (GET/POST с upsert по `(tenant_id, marketplace, article)`), `/api/unit-economics/calculations` (GET/POST), `/api/unit-economics/import/ozon-prices` (POST multipart с `commit=false|true`).
- **XLSX-импорт Ozon** — `src/lib/unit-economics/import/ozon-price-template.ts`. Стратегия: основной парсер `xlsx` (SheetJS) с `cellStyles:false` чтобы обходить «битые» border-стили в шаблоне Ozon; fallback — низкоуровневый ZIP+XML парсер (sharedStrings + sheet xml). Маппинг колонок по заголовкам, не по индексам. Фильтр служебных строк-меток («Нередактируемое», «Обязательное» и пр.).
- **Linkable cells (UnitCellBindingDialog)** — `src/components/unit-economics/unit-cell-binding-dialog.tsx` + `linkable-number-cell.tsx`. Клик по chain-icon открывает модалку источников из текущей страницы (live `BlockValuesContext`) и других страниц через `/api/blocks/sources`. Режимы `manual` ↔ `block_ref` с money-флагом и fallback. Активная ссылка визуально показывает источник, пропадание источника → жёлтый warning state.
- **Блоки**: `unit.ozon-calculator` (single, FBO/FBS, метрики и P&L), `unit.ozon-multi-table` (sticky глобальные параметры, sticky колонки `#`/`Артикул`/`Название`, ввод параметров и результаты, итоги, дублирование/удаление/сброс привязок строки, импорт XLSX), `unit.yandex-calculator` (FBY/FBS/DBS/Express, спецтарифы, налоги, P&L). Все блоки публикуют aggregate outputs через `useBlockValuePublisher` (с `__money` для денежных полей), чтобы быть доступны как источники в других блоках.
- **Расширение `/api/blocks/sources`** — добавлены page labels (`unit-economics-*`), type labels (`unit.*`) и `fieldsForBlock` для unit-блоков (`price`, `stock`, `rowsCount`, `stockTotal`).
- **Smoke-тесты** — `scripts/test-unit-economics.ts` (запуск `pnpm tsx scripts/test-unit-economics.ts [path-to-xlsx]`): 19 проверок калькуляционных движков (автокомиссия, маржа/ROI, налоги УСН, спецтариф Яндекс, Fixed tariff) и XLSX-парсера на реальном файле.

### Changed
- **`src/lib/blocks/registry.ts`** — добавлены три unit-блока в `ALL_BLOCKS` и три новых `DEFAULT_LAYOUTS` (`unit-economics-ozon`, `unit-economics-ozon-multi`, `unit-economics-yandex`).
- **Sidebar / Settings / Cmd+K** — иконка `Calculator`, пункт «Юнит-экономика» во всех трёх местах.

## [0.10.4] - 2026-05-13

### Fixed
- **Sheet money formatting через @связать** — Sheet (Excel-блок) при связывании ячейки с источником через `@связать` теперь сохраняет money-флаг в `config.moneyRefs` (как `excel.cell`), а не полагается только на эвристику по имени поля. Решает баг, где значение из KPI-блока (рубли в копейках) выводилось как обычное число `2 613 726 900` вместо `26 137 269 ₽`. То же исправление применено в server-side `/api/blocks/sources` для evaluateSheetCells.
- **Публикация money-метаданных в KPI-блоках** — `stat.income`, `stat.expense`, `stat.balance`, `stat.custom` (для всех metric кроме `count`), `custom.data` (когда format=`rubles`), `computed.sum` (когда хотя бы один источник money) и `excel.cell` (когда формула содержит money refs) теперь публикуют поле `__money` в reactive store. Это даёт live-preview в `@связать` picker правильное money-форматирование для current-page блоков.

### Changed
- **Sheet — свобода размера** — убран `minContentSize` и `minSize` уменьшен до `{1, 1}`. Раньше блок при размере меньше 360×220px показывал overlay «Мало места» и становился полупрозрачным/неинтерактивным. Теперь пользователь может ужать блок до любого размера, таблица скроллится по обеим осям внутри блока. Для очень крошечных размеров (≤130×70) остаётся xs-fallback с иконкой+названием.
- **Sheet header / formula bar** — добавлен `shrink-0` и `overflow-x-auto` для строки заголовков и formula bar, чтобы они не растягивали блок и не блокировали уменьшение. CardContent с таблицей получил `min-h-0 min-w-0` для корректного flex-shrink.

## [0.10.3] - 2026-05-13

### Added
- **`START.md`** — компактный bootstrap-файл (~1.5K токенов): идентичность, жёсткие правила, стек, структура `src/`, маршрутизация «по типу задачи → какие файлы читать», команды, ключевые грабли. Единственный файл, который AI читает первым в новой сессии по триггеру «загрузи контекст Open Finance».

### Changed
- **Bootstrap-процесс** — `CLAUDE.md`, `MEMORY.md` и `AGENTS.md` переведены с тяжёлой обязательной загрузки `MEMORY.md` + `CHANGELOG.md` (1199 строк) + `PLAN.md` (1420 строк) на ленивую загрузку: `START.md` + `MEMORY.md` + `git log -20`. Стартовый контекст ужат с ~70K до ~6–8K токенов без потери качества.
- **`CHANGELOG.md` / `PLAN.md` по запросу** — оба файла больше не грузятся целиком по умолчанию; читаются только при вопросах про историю/стратегию, и только нужный кусок через `Read offset+limit`.
- **MemPalace** — `mempalace wake-up --wing open-finance` исключён из bootstrap (индекс содержит и устаревшие версии проекта: Tauri-only, Prisma, Python sidecar — даёт misleading контекст). `mempalace search "..."` теперь используется только точечно для исторических вопросов.
- **`~/.mempalace/identity.txt`** — обновлён под новый bootstrap-процесс с явным «не делать `wake-up` для open-finance на старте».
- **`~/.mempalace/sources/open-finance/current-context-v0.10.3.md`** — обновлён внешний AI-handoff (для ChatGPT/Gemini без доступа к репо), включает встроенную bootstrap-инструкцию и таблицу маршрутизации задач. Старая `v0.10.2`, дубль `current-context.md` и копия в корне `~/.mempalace/` удалены.
- **MemPalace индекс** — починен после застрявшей миграции ChromaDB; `mempalace status` снова работает (5288 drawers всего, 696 в `open-finance`). Wing переиндексирован поверх свежих `START.md`/`MEMORY.md`/`CHANGELOG.md`.

### Removed
- **`/Users/firay/open-finance/CLAUDE.md`** — устаревший дубликат правил от старого Prisma/SQLite/Python-проекта, который грузился во все сессии через `always_applied_workspace_rules` и противоречил актуальному project-level `CLAUDE.md`.

## [0.10.2] - 2026-05-13

### Changed
- **Project memory** — `MEMORY.md` переписан как актуальный AI handoff-контекст по BlockGrid, Boards, Inbox, AI Micro-Agent и MemPalace.
- **MemPalace context** — обновлён `~/.mempalace/identity.txt` и добавлен актуальный источник `current-context.md` для wing `open-finance`.

## [0.10.1] - 2026-05-13

### Added
- **Входящие** — новая страница `/inbox` на BlockGrid с дефолтным блоком `inbox.channel-feed`.
- **Inbox Channel Feed block** — read-only блок каналов коммуникаций: счетчики почты/Telegram, список сообщений и просмотр тела письма.
- **Inbox DB schema** — `inbox_channels` и `inbox_messages` с tenant scoping, `created_by`, дедупликацией сообщений и SQL init-файлом.
- **Email IMAP MVP** — настройки email-канала, проверка подключения, синхронизация последних 25 писем, базовый MIME parse без новых npm-зависимостей.
- **Inbox settings** — секция «Каналы входящих» в `/settings`: почта через IMAP и placeholder Telegram.
- **AI tool** — read-only `query_inbox_messages` для tenant-scoped доступа AI-агентов к сообщениям.

### Changed
- **Навигация** — пользовательский раздел `Inbox` переименован в «Входящие» в sidebar, Cmd+K, settings, dashboard-карточке и cross-page labels.
- **Secrets** — пароль почтового канала шифруется AES-256-GCM через `INBOX_SECRET_KEY` с dev-only fallback.
- **Inbox block settings** — подключение каналов перенесено из `/settings` в модалку настроек конкретного блока; каналы теперь scoped per block через `config.blockId`.
- **Inbox layout** — дефолтная страница `/inbox` теперь стартует с двумя средними блоками `6×12`, расположенными в две колонки.
- **Inbox tabs** — chips «Почта» и «Telegram» показываются только если соответствующий канал подключён в текущем блоке.
- **Inbox email help** — в настройках блока добавлена модалка «Инструкция» с параметрами Beget, Gmail, Яндекс, Mail.ru/VK WorkMail и VPS/self-hosted mail.
- **Inbox IMAP STARTTLS** — выключенный SSL/TLS теперь использует STARTTLS перед логином; это покрывает Beget `imap.beget.com:143`, если `993` зависает на TLS greeting.
- **Inbox Beget fallback** — при timeout на `imap.beget.com:993` тест/синхронизация автоматически повторяют подключение через `143 + STARTTLS`.
- **Inbox title editing** — блок `inbox.channel-feed` теперь уважает универсальное название из вкладки «Внешний вид».
- **Inbox MIME decode** — исправлено отображение кириллических тем писем (`=?UTF-8?Q?...?=`, quoted-printable, windows-1251/koi8-r fallback) и переносы длинных текстов.
- **Inbox sync reliability** — IMAP FETCH теперь забирает письма по одному, чтобы байтовые literal-length с кириллицей не сбивали парсинг следующих сообщений; повторная синхронизация обновляет уже сохранённые письма и исправляет старые битые заголовки.

## [0.10.0] - 2026-05-12

### Added
- **Мои доски** — новый раздел в sidebar: персональные рабочие пространства с BlockGrid (`/boards`, `/boards/[boardId]`)
- **DB schema `boards`** — таблица для метаданных досок (`src/lib/db/schema/boards.ts`, SQL: `drizzle/init/03-boards.sql`)
- **API** — `GET/POST /api/boards`, `GET/PUT/DELETE /api/boards/[boardId]` с Zod-валидацией и tenant/user фильтрацией
- **Tab-bar UI** — переключение между досками, inline rename (двойной клик), context menu (переименовать/закрепить/удалить)
- **Pin to sidebar** — запиненные доски отображаются как вложенные ссылки под «Мои доски»
- **Command Palette** — навигация к доскам через Cmd+K
- **Settings** — «Мои доски» добавлена в управление видимостью разделов
- **Cross-page связи** — доски автоматически видны в `@связать` picker через `/api/blocks/sources`
- **DropdownMenu** — новый shadcn/ui компонент (`src/components/ui/dropdown-menu.tsx`)
- **AlertDialog** — подтверждение удаления доски с описанием

## [0.9.23] - 2026-05-12

### Changed
- **Block resize UX** — hover resize-corner delay reduced from 5s to 3s and moved to grid-item CSS hover to prevent flicker when pointing at the handle.
- **Excel Cell adaptation** — `excel.cell` now uses a compact `sm` render with smaller padding/text and a softer `150×70` min-content threshold.

### Fixed
- **Resize corner flicker** — resize handle no longer disappears when the pointer moves from block content onto the bottom-right resize corner.
- **Excel Cell false TooSmallOverlay** — normal compact cell sizes no longer show “Мало места” while preserving protection for truly tiny blocks.

## [0.9.22] - 2026-05-12

### Changed
- **Block defaults: Excel Cell** — `excel.cell` keeps compact `3×2` default size with readable `220×80` min-content threshold.
- **Block defaults: Sheet** — new Excel table blocks now start as compact `3 cols × 5 rows` with `5×5` grid size and `=SUM(A1:A5)` header total.
- **Block resize UX** — resize handle is hidden by default and appears after 5 seconds of hover, while edit mode still shows resize immediately.

### Fixed
- **Relations icon coverage** — relation indicators and overlay now use shared relation detection for `dependencies`, `config.blockRefs`, and `@...` formulas, so linked Sheet/Excel Cell blocks show the icon consistently.

## [0.9.21] - 2026-05-12

### Changed
- **Sources modal: categories** — category pages now merge live `BlockValuesContext` fields into saved `/api/blocks/sources` data, so the `Кэшфлоу` tab shows the same current Sheet cells as `Текущая страница`.
- **Naming: @связать** — visible `@Блок` labels were renamed to `@связать` across Sheet and Excel Cell linking UI.
- **Sources modal UI** — source rows now stack title and field pills vertically to prevent category/title overlap with values.

### Fixed
- **Sheet sources API: formulas** — `/api/blocks/sources` now evaluates Sheet formula cells and includes computed linked values like `C4 = 894 777,77` in page categories, not only in live current-page data.
- **Sheet money cells metadata** — Sheet publishes `__money` metadata and source fields carry `format: money`, so linked monetary cells keep kopeck display semantics when selected in `excel.cell`.
- **Sheet formulas: decimal comma** — simple formula evaluation in sources API normalizes comma decimals before math evaluation.

## [0.9.20] - 2026-05-12

### Fixed
- **Excel Cell: Sheet cell refs** — ссылки на обычные ячейки таблицы (`@...B3`) больше не форматируются как копейки: `45600` отображается как `45 600`, а не `456`.
- **Sheet formulas: plain refs** — формулы Sheet больше не считают любую `@`-ссылку денежной; `A1/B3/count/raw/label` остаются обычными числовыми/текстовыми значениями.
- **Computed sources: cell refs** — агрегатор не применяет рублёвое форматирование к источникам-ячейкам (`A1`, `B3`, `count`), предотвращая срезание двух последних цифр.

### Changed
- **Excel Cell refs metadata** — при выборе источника `@связать` сохраняется `moneyRefs`, чтобы display-layer отличал денежные KPI/Data источники от произвольных ячеек.

## [0.9.19] - 2026-05-12

### Changed
- **Block settings: Связи** — раздел связей переработан в компактный список: отображает связи из формул (`ячейка → блок/поле`) и зависимости блока (`блок → источник.field`) в едином стиле.
- **Block settings: добавить связь** — кнопка `Добавить источник` заменена на более понятную `Добавить связь`; picker теперь позволяет выбрать конкретное поле источника (`value`, `count`, `A1` и т.д.).

### Added
- **Excel Cell settings** — рядом с `Значение / формула` добавлена кнопка `@связать`, открывающая модалку выбора блоков, полей и ячеек с автоматической вставкой `@...` в формулу.

## [0.9.18] - 2026-05-12

### Added
- **Excel Cell block** — добавлен новый минимальный блок `excel.cell`: редактируемое название, одна Excel-like ячейка с текстом/числами/формулами, `@связать` picker и публикация `value/raw/label`.
- **Sheet cell references** — `Sheet` теперь публикует отдельные числовые ячейки (`A1`, `B2`, ...) в `BlockValuesContext` и `/api/blocks/sources`, чтобы другие блоки могли ссылаться на конкретную ячейку.

### Changed
- **Sheet: kopecks display** — формулы с денежными `@`-ссылками отображают суммы как в блоке `Данные`: значения в копейках форматируются через запятую (`788 000` / `788 000,00`), а не показываются как сырые `78800000`.
- **Sheet settings** — добавлена настройка отображения копеек на уровне блока (`showKopecks`: global / on / off).

### Fixed
- **Sheet: money format propagation** — формулы, которые ссылаются на ячейки с денежными `@`-значениями (`A4+B4`, `SUM(A4:B4)`), наследуют денежный формат отображения.

## [0.9.17] - 2026-05-12

### Changed
- **Sheet: @связать picker** — модалка компактнее (640px), sidebar показывает только страницы с блоками (без пустых категорий), блоки в плоском списке с кнопками полей inline, поле `label` скрыто для краткости.
- **Sheet: header editing UX** — Escape сбрасывает editingHeaderId и caretPos.

### Added
- **Sheet: accept/cancel buttons** — плавающие кнопки `✓` / `✕` в правом нижнем углу блока при редактировании ячейки/header, стиль аналогичен `block-chrome.tsx` (rounded-full, ghost, shadow+ring).

## [0.9.16] - 2026-05-12

### Changed
- **Sheet: @связать picker UI** — модалка расширена до двухпанельного интерфейса: слева фильтры по страницам и категориям, справа список блоков с полями и превью значений.

### Fixed
- **Sheet: @связать field insertion** — выбор поля теперь атомарно записывает формулу в активную ячейку/header и сохраняет `blockRefs` одним config patch, устраняя гонку `editValue`/`saveConfig`.
- **Sheet: inline cell blur race** — inline-инпут ячейки теперь учитывает `openingBlockPickerRef/blockPickerOpen`, поэтому клик по полю в Dialog не вызывает преждевременный `commitEdit()`.

## [0.9.15] - 2026-05-11

### Fixed
- **Sheet: operator buttons focus** — `onMouseDown={preventDefault}` на кнопках `+ - * /` и функциях `SUM/AVG/...` предотвращает потерю фокуса из поля ввода формулы
- **Sheet: header #ERR** — формулы в header-ячейках теперь используют общий `evaluated` cache из основной таблицы; добавлен `simpleMathEval` fallback для простых выражений (`=77`, `=21+22`)
- **Sheet: header formula editing** — клик по value header-ячейки активирует formula bar для редактирования; в formula mode клик по ячейкам таблицы вставляет ссылку (как в Excel)
- **Sheet: onBlur premature commit** — `onBlur` проверяет весь `sheetRef` контейнер (не только `<table>`), предотвращая ложный commit при клике на helper-кнопки
- **Sheet: MAX_ROW/MAX_COLUMN** — добавлен robust fallback (`?? 1048576` / `?? 16384`) если named exports недоступны; сравнение через `>=` вместо `===`

### Added
- **Sheet: @block live references** — кнопка `@связать` открывает модалку (Dialog) со списком блоков текущей и сохранённых страниц через `/api/blocks/sources`; каждый блок показывает поля `value`, `count`, `label` и превью значений. При клике по полю вставляется `@page:blockId.field` в формулу и значение кэшируется в `config.blockRefs`.
- **Sheet: reactive block values hook** — `useAllBlockValues()` подписывается на `BlockValuesContext` и возвращает все живые значения (`blockId` → `output.value`, `blockId.field` → `output.field`).
- **Blocks sources API** — добавлен `GET /api/blocks/sources` с tenant/user scoping, каталогизацией блоков по страницам/типам и серверным расчётом `value/count` для cashflow KPI и custom KPI.

### Changed
- **Sheet: formula engine** — `evaluateFormula` результат обрабатывает `boolean`, `null`, `undefined`, `FormulaError` объекты; добавлен `simpleMathEval` как last-resort fallback в catch
- **Cashflow KPI outputs** — `stat.income`, `stat.expense`, `stat.balance`, `stat.custom` публикуют не только `value`, но и `count`, чтобы Sheet мог привязывать сумму или количество операций.
- **Sheet: formula references** — parser поддерживает ссылки с дефисами, точками и страницами (`@cashflow:block-id.count`), а не только `@word`.

## [0.9.14] - 2026-05-11

### Added
- **Основная локальная модель** — в `/admin/ai/local-models` можно выбрать установленную chat-модель как `tenant.settings.aiModel`; `/api/ai/chat` использует её перед fallback на `OLLAMA_DEFAULT_MODEL`.

### Changed
- **AI Models tabs** — `Внешние API + VPN` перенесён из отдельного пункта сайдбара во вкладку внутри раздела `AI модели`, а карточки providers-формы выровнены по отступам с родительской страницей.

### Fixed
- **Ollama broken blob error** — ошибка `unable to load model ... blobs/sha256-*` теперь форматируется как понятная рекомендация удалить повреждённую модель и скачать GGUF заново/другую квантизацию.

## [0.9.13] - 2026-05-11

### Fixed
- **HuggingFace model pull UX** — `parseHuggingFaceUrl()` теперь блокирует обычные safetensors-репозитории без `GGUF` и показывает понятную причину вместо неработающей кнопки скачивания.
- **Ollama pull errors** — `/api/admin/ai/local-models/pull` отправляет `model` в `/api/pull`, прокидывает тело ошибки Ollama, а UI показывает streaming `error` события красным статусом.
- **AI Providers navigation** — пункт `Внешние API + VPN` добавлен в левое админ-меню, настройки видимости `/settings` и как быстрый переход на странице локальных моделей.

## [0.9.12] - 2026-05-11

### Fixed
- **AI Micro-Agent apply flow** — `parseAction()` теперь извлекает action из fenced/unfenced JSON, поддерживает `payload`/`config` и инферит `update_block`/`create_block` по структуре ответа.
- **Block-Grid persistence** — `BlockGrid` применяет `update_block` через нормализацию config и обрабатывает `create_block` с сохранением в `/api/blocks/layout/[pageKey]`.
- **Sheet AI config** — prompt capabilities обновлён под реальный формат `sheet`: `rows`, `cols`, `cells: string[][]`, чтобы AI-результат сразу отрисовывался.
- **Proxy build warning** — `undici` импортируется только runtime-способом, чтобы сборка не предупреждала при выключенном proxy.

## [0.9.11] - 2026-05-11

### Fixed (CRITICAL)
- **`Ollama error 400: nomic-embed-text does not support chat`** — Root cause: `resolveModel()` брал первую установленную модель как fallback, не проверяя что она chat-capable. Если установлен только `nomic-embed-text` — он попадал в fallback и /api/chat возвращал 400.
- **Решение:** `isChatCapableModel()` (`src/lib/ai/providers/ollama.ts`) — фильтр по family (bert/nomic-bert/mxbai/clip) и regexp по имени (embed/embedding/bge-/gte-/e5-/all-minilm/rerank/clip/sentence-transformer). Применяется и к точному совпадению, и к base-name match, и к fallback.
- Понятная ошибка когда установлены только embedding-модели: «Установлены только embedding-модели (X). Установите chat-модель: ollama pull qwen2.5:1.5b»

### Added
- **Расширенный каталог моделей (RECOMMENDED_MODELS)** — было 6 моделей, стало 19 в 7 категориях:
  - **Ультра-лёгкие** (1-2 GB RAM): `qwen2.5:0.5b`, `qwen2.5:1.5b`, `llama3.2:1b`
  - **Лёгкие** (3-4 GB): `qwen2.5:3b` ★, `llama3.2:3b`, `phi3.5:3.8b`, `gemma2:2b`
  - **Средние** (6-8 GB): `qwen2.5:7b` ★, `llama3.1:8b`, `mistral:7b`, `gemma2:9b`
  - **Тяжёлые** (16+ GB): `qwen2.5:14b`, `qwen2.5:32b`
  - **Vision**: `llama3.2-vision:11b`, `qwen2.5vl:7b` ★
  - **Code**: `qwen2.5-coder:1.5b`, `qwen2.5-coder:7b`
  - **Embedding**: `nomic-embed-text` ★, `mxbai-embed-large`
- **Бейджи в UI:** ★ рекомендуется / vision / tools (function calling)
- **Загрузка моделей с HuggingFace** — `parseHuggingFaceUrl()` (`src/lib/ai/providers/ollama-catalog.ts`):
  - Поддержка форматов: `https://huggingface.co/user/repo`, `huggingface.co/user/repo:Q4_K_M`, `hf.co/user/repo`, `user/repo:Q4_K_M`
  - Конвертирует в Ollama tag: `hf.co/user/repo:Q4_K_M`
  - API endpoint `/api/admin/ai/local-models/hf-parse` для preview
  - UI поле в `/admin/ai/local-models`: вставка ссылки → preview → кнопка Скачать (использует существующий streaming pull)
- **Внешние AI провайдеры** (OpenAI / Claude / OpenRouter / VseGPT / Custom):
  - Tenant settings extension: `aiExternal: { enabled, provider, baseUrl, apiKey, defaultModel, useProxy }`
  - `streamOpenAICompat()` (`src/lib/ai/providers/openai-compat.ts`) — streaming через OpenAI-совместимый endpoint, поддержка vision (multimodal messages), proxy через undici dispatcher
  - `testExternalConnection()` — проверка `/v1/models`, возвращает count + sample
  - `/api/ai/chat` теперь автоматически роутит на external API когда `aiExternal.enabled`, иначе на Ollama
- **VPN / Прокси** для обхода блокировок зарубежных AI:
  - Tenant settings extension: `aiProxy: { enabled, url, type: http|https|socks5, username, password }`
  - `createProxyDispatcher()` (`src/lib/ai/providers/proxy.ts`) — undici ProxyAgent через dynamic import (опциональная зависимость)
  - SOCKS5 пока заглушен (нужен `Socks5ProxyAgent` или socks-proxy-agent), HTTP/HTTPS работает
  - `getExternalIp()` через ipinfo.io для проверки что прокси работает
- **Диагностика подключений** (`/api/admin/ai/diagnostics`):
  - Ollama: статус + список chat/embedding моделей
  - External API: ping + список доступных моделей
  - Proxy: внешний IP + страна/город + via direct/proxy
- **Страница `/admin/ai/providers`** — единый UI:
  - Блок диагностики (CheckCircle/XCircle с деталями)
  - Настройка внешнего провайдера: выбор preset (OpenAI/Claude/OpenRouter/VseGPT/Custom) + Base URL + API key (показ/скрыть) + Default model + ссылки на signup
  - Настройка прокси: тип (HTTP/HTTPS/SOCKS5 disabled) + URL + auth
  - Test connection кнопки для каждой секции (без сохранения)
  - Маскировка секретов: API key/password в БД хранятся как есть, на клиент идут как `abcd••••wxyz`. При PUT — если приходит маска, оставляем старое значение.

### Changed
- `RECOMMENDED_MODELS`: добавлено поле `category` (chat-tiny/chat-light/chat-medium/chat-heavy/code/vision/embedding) + `vision` + `toolCalling`
- `/admin/ai/local-models`: каталог сгруппирован по категориям (CATEGORY_ORDER), новая секция HuggingFace
- `OllamaModel` type: добавлены `details.families[]` и `details.format`
- `TenantSettings`: расширен полями `aiExternal` и `aiProxy`
- `/admin` навигация: добавлен линк «Внешние API + VPN + диагностика», убран dead-link `/admin/vpn`

### Security Notes
- API ключи и пароли прокси хранятся в `tenants.settings` JSONB **в открытом виде** (для MVP). Доступ только для admin/super_admin через RLS. В UI секреты маскируются. **TODO в production:** AES-256-GCM шифрование с master key из env, или Vault/Doppler.

## [0.9.10] - 2026-05-11

### Added
- **Streaming AI responses** — AI пишет в реальном времени, видно процесс генерации (`/api/ai/chat` теперь NDJSON streaming с событиями `start`/`token`/`done`/`error`/`aborted`)
- **Live preview во время генерации** — пользователь видит что AI пишет токен за токеном с мигающим курсором
- **Кнопка «Остановить»** — abort streaming в любой момент (через AbortController на клиенте + req.signal на сервере)
- **Счётчик токенов** — в footer модалки: `N токенов · X.X т/с · Ys` во время генерации
- **Финальная статистика** — `N токенов · X.X т/с` после `done` (из `eval_count` и `eval_duration` Ollama)
- **Model auto-fallback** — если запрошенная модель не установлена, автоматически используется первая доступная (`listInstalledModels()` → `/api/tags`). Badge «fallback» в UI.
- **Понятная ошибка «нет моделей»** — «Нет установленных моделей Ollama. Установите: ollama pull qwen2.5:0.5b»

### Fixed
- **Ollama error 404: model 'qwen2.5:7b' not found** — Root cause: hardcoded дефолтная модель не проверялась на наличие. Теперь `resolveModel()` смотрит установленные модели и fallback'ится на первую.
- **«AI обрабатывает запрос...» без feedback** — заменено на полноценный stream с token preview + stats

### Changed
- `MicroAgentDialog`: переработан flow с `loading` boolean → `streaming` + богатое состояние (streamingContent, tokenCount, elapsedSec, finalStats, currentModel, usedFallback)
- `ai.micro-agent` block: обновлён под NDJSON streaming (ждёт `done` событие)
- `parseAction` экспортируется из `route.ts` для использования в streaming pipeline

## [0.9.9] - 2026-05-11

### Added
- **Block Capabilities** (`src/lib/ai/micro-agent/block-capabilities.ts`) — AI теперь получает полный контекст возможностей блока: что он умеет, какой формат config ожидается, какие ограничения. Не будет пытаться сделать таблицу из KPI-блока.

### Fixed
- **fetch failed при вызове AI** — Root cause: использовался `process.env.OLLAMA_HOST` (не существует) вместо типизированного `env.OLLAMA_BASE_URL`. Ollama всегда fallback'ился на `localhost:11434` что не работает на prod.
- **Улучшенные ошибки Ollama** — вместо "fetch failed" показывает «Не удалось подключиться к Ollama (url). Убедитесь что Ollama запущена: ollama serve»
- **Timeout 120s** — добавлен AbortController с 120s timeout для Ollama (qwen2.5:7b может думать долго)
- **maxDuration: 120** — увеличен лимит Next.js route handler
- **Модель из env** — используется `env.OLLAMA_DEFAULT_MODEL` вместо hardcoded `qwen2.5:7b`

## [0.9.8] - 2026-05-11

### Added
- **AI Micro-Agent модуль** — универсальный AI-помощник для быстрого создания и заполнения блоков из разнородных данных(vision), вызывает Ollama `/api/chat`
  - **MicroAgentDialog** (`src/components/micro-agent/micro-agent-dialog.tsx`) — модалка с полем ввода, quick action табы (Суммировать, По ячейкам, Рассчитать, Извлечь, Категоризировать), загрузка изображений, голосовой ввод (Web Speech API), превью результата с Apply/Retry
  - **Блок `ai.micro-agent`** (`src/lib/blocks/catalog/ai-micro-agent.tsx`) — standalone блок-тип в каталоге, добавляется на любую страницу; внутри — input + quick actions + результат AI
  - **Кнопка ✨ в block-chrome** — вызывает MicroAgentDialog в контексте любого блока (тип, данные, страница)
  - **Prompt builder** (`src/lib/ai/micro-agent/prompt.ts`) — собирает system prompt: глобальный + микроагент-инструкция + block context + quick action
  - **Типы** (`src/lib/ai/micro-agent/types.ts`) — BlockContext, QuickAction, MicroAgentRequest/Response, SuggestedAction (update_block/create_block/text_only)
  - **Web Speech API** — встроенный микрофон для голосового ввода (🎙️), транскрипция в реальном времени
  - **Vision support** — загрузка изображений (base64), передаётся в Ollama для vision-моделей (qwen3-vl, gemma3, llava)
  - **Preview & Apply** — AI предлагает structured JSON → пользователь просматривает → Применить (мутация config блока) или Переделать

## [0.9.7] - 2026-05-11

### Added
- **Click-to-insert формулы** — при вводе `=` кликать по ячейкам для вставки ссылок (A1, B3...) в позицию курсора, как в Excel. Работает в formula bar и inline-edit
- **Touch/mobile formula helpers** — кнопка 📍 для активации pick-cell mode на тачскринах; панель быстрых операторов (`+ - * / ( ) , :`) и функций (`SUM AVG MAX MIN COUNT`) с вставкой в позицию курсора
- **Formula mode индикатор** — `fx` badge в formula bar при активном режиме формулы
- **Visual cursor** — `cursor-cell` на ячейках в formula mode + tooltip с адресом для вставки

### Fixed
- **setState-in-setState баг** — `block-grid.tsx:291 updateBlock` → `setBlocks` вызывался из `setCells` updater в sheet-блоке. Root cause: `saveConfig()` внутри `setCells(() => { saveConfig(); })`. Исправлено через `queueMicrotask()` для всех save-вызовов (`updateCell`, `startColResize`, `startRowResize`)
- **onBlur при formula pick** — formula bar и inline-input не теряют фокус при клике по ячейке таблицы в режиме формулы

## [0.9.6] - 2026-05-11

### Added
- **Sheet block полный Excel-функционал** — `src/lib/blocks/catalog/sheet.tsx` переписан с нуля:
  - **Формулы** — полная поддержка Excel-формул через `fast-formula-parser`: `=SUM(A1:A10)`, `=AVERAGE(B:B)`, `=A1+B2*3`, `=MAX(A:A)`, `=IF(...)` и все стандартные функции
  - **Header-строка** — ряд кастомных ячеек сверху (название блока, итоги, формулы). Каждая ячейка может содержать формулу. Inline-edit label + value, кнопка удаления при hover, кнопка «+» для добавления
  - **Настраиваемые размеры ячеек** — drag-resize колонок (перетащить правую границу заголовка) и строк (перетащить нижнюю границу номера строки). Персист в config
  - **Formula bar** — строка формул сверху показывает адрес активной ячейки (A1, B3...) + raw формулу. Inline-edit с автосохранением
  - **Active cell selection** — клик на ячейку выделяет её (ring-2), Enter/Tab навигация, Escape отмена
  - **Block references** — синтаксис `=@income` в формулах подставляет значение из связанного блока через `blockRefs` config
  - **Circular reference protection** — рекурсивный evaluator с visiting set предотвращает бесконечные циклы
  - **Публикация значений** — блок публикует sum/count всех числовых ячеек через `useBlockValuePublisher` для связей с другими блоками
  - **Adaptive density** — xs (иконка+название), sm (название+размер), md/lg (полная таблица)
- **`fast-formula-parser`** — новая зависимость (v1.0.19) для вычисления Excel-формул
- **Type declarations** — `src/lib/blocks/fast-formula-parser.d.ts` для типизации библиотеки

### Changed
- **Sheet block** — `minSize` увеличен до 3×3 (было 2×2), `minContentSize` до 240×160px (было 200×120)
- **Sheet block** — `supportsDependencies: true` — теперь поддерживает таб «Связи» в Settings dialog
- **SheetSettings** — расширена: toggle header-строки, toggle formula bar, инструкция по формулам

## [0.9.5] - 2026-05-11

### Added
- **Анимированные иконки** — новая категория «Анимированные» в `icon-library.ts` с ~65 уникальных иконок (Loaders, Pulse, Motion, Sparkle, Waves, Progress и т.д.)
- **Hover-анимация иконок на блоках** — при наведении на блок анимированная иконка проигрывает одиночную CSS-анимацию (spin, pulse, shake, flash, bounce, scale). 7 типов анимации подбираются по имени иконки через `getIconAnimationClass()`. Keyframes в `globals.css`
- **`resolveIconWithAnimation()`** — новый экспорт из `icon-resolver.ts`, возвращает `{ Icon, animClass }` для удобного применения
- **showKopecks во ВСЕХ блоках** — настройка копеек добавлена в: `stat.income`, `stat.expense`, `stat.balance`, `cashflow.top-categories`, `cashflow.transactions`, `computed.sum`. Каждый блок имеет toggle в настройках
- **KpiSettingsForm** — новая форма настроек для KPI-блоков (income/expense/balance) с toggle копеек
- **ComputedSettingsForm** — форма настроек для computed.sum с toggle копеек

### Changed
- **CurrencyInput переделан на ATM-style** — запятая появляется автоматически при вводе цифр. Последние 2 цифры всегда копейки. Пользователь просто вводит цифры, форматирование (пробелы-разделители + запятая) происходит мгновенно
- **cashflow.tsx** — все денежные блоки (StatCard, TopCategories, TransactionsList) переведены с `useFormatRubles()` на per-block `showKopecks` через `useFormatSettings() + formatRublesWithSettings()`
- **computed.tsx** — переведён с `useFormatRubles()` на per-block настройку
- **block-chrome.tsx** — добавлен класс `group` для триггера CSS анимаций на hover
- **icon-picker-modal.tsx** — исправлена ошибка дублирующихся ключей, добавлен `modal={false}` для вложенного Dialog, анимированные иконки показывают preview при hover в модалке

## [0.9.4] - 2026-05-11

### Added
- **CurrencyInput** — `src/components/ui/currency-input.tsx` — специализированный input для денежных сумм с автоподставкой запятой (копейки). Хранит значение в копейках (integer), отображает форматированную строку с разделителями
- **Per-block showKopecks** — настройка «Показывать копейки» теперь индивидуальная для каждого блока (`custom.data`, `stat.custom`). `null` = глобальная настройка, `true/false` = override. Кнопка «Сбросить» для возврата к глобальной
- **Полная библиотека иконок** — `src/lib/blocks/icon-library.ts` — 1500+ иконок Lucide с категоризацией (16 категорий: Финансы, Графики, Бизнес, Время, Транспорт, и т.д.)
- **Icon Picker Modal** — `src/components/blocks/icon-picker-modal.tsx` — модальное окно с поиском и категориями для выбора иконки. Lazy-loaded, грузится только при открытии
- **Кнопка «Выбрать из каталога»** в настройках внешнего вида блока — открывает полную библиотеку иконок с sidebar категорий и поиском по названию

### Changed
- **custom-data block** — `type="number"` input заменён на `CurrencyInput` с форматированием (автозапятая, пробелы-разделители тысяч). Исправлена проблема с вводом «020000» вместо форматированного числа
- **icon-resolver** — расширен dynamic fallback через `icons` export из `lucide-react`. Любая иконка из каталога теперь резолвится без необходимости добавлять в статический map
- **ICON_NAMES** — расширен с 20 до 24 иконок в быстром пикере (добавлены Heart, Star, Zap, Users, Database, Sparkles)
- **Глобальная настройка копеек** остаётся в `/settings` как default, но блоки могут переопределять индивидуально

## [0.9.3] - 2026-05-11

### Changed
- **Mindmap overlay полностью скрыт** — если toggle «Связи» выключен, SVG не рендерится вообще (было: полупрозрачные линии видны всегда). Ресурсы recalc не тратятся когда overlay скрыт
- **Smart edge detection** — линии связей идут от ближайших сторон блоков (top/right/bottom/left), а не только bottom→top. Алгоритм на основе угла между центрами блоков. Bezier control points расходятся в направлении стороны привязки
- **Dot-узлы на якорях** — кружки рисуются на каждом конце связи (source + target) вместо общих per-block dots

### Added
- **Micro-icon связей** — полупрозрачная иконка Network (opacity 0.2, 12px) в левом нижнем углу блоков, участвующих в связях (source или target). При hover на блок opacity растёт до 0.35. Не мешает содержимому

### Removed
- **ExternalLinkIndicator** — треугольники внешних связей убраны из overlay (cross-page индикация уже реализована через `CrossPagePin` в `block-chrome.tsx`)

## [0.9.2] - 2026-05-11

### Fixed
- **Mindmap overlay не отображается** — root cause: компонент `null` на первом рендере (пустой `edges` state) → SVG не монтируется → `recalc()` вызывается на `null` svg. Исправлено: guard по `rawEdges.length`, удален `svgRef` из `recalc`, добавлен `setTimeout(200ms)` для RGL layout
- **Графики показывают копейки вместо рублей** — `groupTransactions()` теперь делит на 100 (`income/100`, `expense/100`, `balance/100`). Y-axis и tooltip показывают корректные рубли

### Added
- **Опция копейки** — `src/lib/format-settings.tsx` — `FormatSettingsProvider` + `useFormatRubles()` хук. Настройка `showKopecks` в localStorage. При включении: `1 234,56 ₽`, при выключении: `1 235 ₽`
- **Toggle в /settings** — секция «Формат отображения» с переключателем «Показывать копейки». Работает мгновенно без перезагрузки страницы

### Changed
- **Все блоки переведены на `useFormatRubles()`** — `cashflow.tsx` (StatCard, TopCategories, TransactionsList), `computed.tsx`, `stat-custom.tsx`, `custom-data.tsx`, `chart-cashflow.tsx` (tooltip). Все суммы учитывают глобальную настройку копеек

## [0.9.1] - 2026-05-11

### Fixed
- **Mindmap overlay видимость** — линии связей теперь видны по умолчанию (opacity 0.5 → было 0.35), цвет `#6366f1` (indigo), stroke 2px вместо 1.8. Bezier-кривые идут от bottom-center → top-center блоков (было center→center) для лучшей читаемости
- **Node dots** — на краях блоков появляются кружки-узлы (4-5px) где подключаются связи
- **Треугольник внешних связей** — рядом с кружком узла, если блок имеет cross-page зависимости, рисуется треугольник-индикатор с числом; при hover — popup со списком связей (страница, блок)

### Changed
- **Шрифты KPI блоков уменьшены** — md: `text-2xl`→`text-xl`, lg: `text-3xl`→`text-2xl`; sm: `text-lg`→`text-base` с `text-xs`→`text-[11px]` для labels — содержимое лучше умещается без обрезания
- **Card padding уменьшен** — `CardHeader`/`CardContent`/`CardFooter` теперь `p-3` вместо `p-4`; header `pb-2`→`pb-1.5`
- **Density thresholds подняты** — `smMaxW: 160→180`, `smMaxH: 80→90`, `smMaxArea: 22k→25k` — блоки раньше переключаются на компактный вариант при уменьшении
- Затронуты: `cashflow.tsx`, `computed.tsx`, `stat-custom.tsx`, `block-size.tsx`, `card.tsx`, `block-relations-overlay.tsx`

## [0.9.0] - 2026-05-11

### Added
- **Cycle Detection** — `src/lib/blocks/graph.ts` граф-утилиты: `buildDependencyGraph`, `wouldCreateCycle`, `findCyclicBlocks`, `topologicalSort`, `findDependents`. Интегрировано в `BlockReferencePicker` — при добавлении зависимости, создающей цикл, кандидат отображается как disabled с ⚠️ иконкой и подписью «цикл»
- **Cmd+K Command Palette** — `src/components/command-palette.tsx` глобальный поиск + быстрые действия (навигация, тема, добавление транзакции). Открывается по `Cmd+K` / `Ctrl+K`, встроен в header layout
- **Chart Block (Recharts)** — `src/lib/blocks/catalog/chart-cashflow.tsx` блок `chart.cashflow` с типами Bar/Line/Area, группировкой по дням/неделям/месяцам, настройками серий данных (доход/расход/баланс). Adaptive density, responsive, tooltip с форматированием ₽

### Changed
- **BlockReferencePicker** — принимает `allBlocks` prop для cycle detection; показывает warning icon на блоках, уже участвующих в циклах
- **BlockSettingsDialog** — прокидывает `allBlocks` в BlockReferencePicker
- **BlockGrid** — передаёт `blocks` в settings dialog для cycle detection
- **App Layout** — добавлен CommandPalette в header, версия обновлена на v0.9.0

### Dependencies
- `recharts@3.8.1` — библиотека графиков

## [0.8.9] - 2026-05-11

### Fixed — CRITICAL: блоки не сохранялись в БД (save всегда писал [])
- **Root cause**: `sanitizeBlocks()` в `saveLayout`/`loadLayout` (`src/lib/blocks/queries.ts`) фильтровала блоки по серверному REGISTRY. Но REGISTRY **пуст на сервере** — все файлы каталога блоков (`src/lib/blocks/catalog/*.tsx`) имеют `'use client'`, и Next.js не резолвит их экспорты в server-side бандле API routes
- **Симптомы**: при любом сохранении (PUT `/api/blocks/layout/[pageKey]`) в БД писался `blocks: []`; на перезагрузке страницы все блоки сбрасывались на дефолтные (если row удалён) или на пустые (если row с `[]` уже есть)
- **Fix**: убран вызов `sanitizeBlocks` из `saveLayout` и `loadLayout`. Валидация уже выполняется:
  - На **save**: Zod-схема в API route проверяет структуру `BlockInstance[]`
  - На **render**: клиентский `BlockGrid` пропускает неизвестные типы через `getBlockDef(b.type)` → `null` → не рендерится
- **Файл**: `src/lib/blocks/queries.ts` — минимальный 3-строчный diff

## [0.8.8] - 2026-05-11

### Fixed — CRITICAL: блоки исчезали после настройки
- **Root cause анализ**:
  - Reactive store `useBlockDependencyResult` не пересчитывался на изменения store — `useMemo` deps не включали `tick` от subscription, поэтому computed-блоки могли использовать stale значения и вызывать каскадные re-renders
  - `onLayoutChange` от RGL мог приходить с пустым `layout` во время mount/unmount (race condition в react-grid-layout)
- **Защитные меры (defense in depth)**:
  - **`hadBlocksRef` + `explicitClearRef`**: BlockGrid теперь отслеживает был ли у user'а валидный layout. Если `doSave([])` вызывается БЕЗ явного намерения user'а (Reset / поочерёдное удаление через X) — save отклоняется с warning'ом в console
  - **`onLayoutChange` skip empty**: если RGL прислал пустой layout, а в state блоки есть — игнорируем (вероятно баг RGL)
  - **`onLayoutChange` skip unchanged**: если позиции реально не изменились — не вызываем `scheduleSave` (избегаем бесконечных ре-рендеров)
  - **`flushSave` тоже защищён** на unload
- **Reactive store fix**: `useBlockValue`/`useBlockDependencyResult` теперь корректно пересчитываются на изменения store (добавлен `tick` в deps useMemo)
- **Error handling**: HTTP 4xx/5xx от save endpoint теперь логируется в console (раньше fetch не throw'ил, ошибки были невидимы)

### Fixed — Drag handle не работал при hover (вне edit mode)
- `BlockChrome`: drag-handle теперь имеет `pointer-events-auto` + `cursor-move` когда показан (hover или edit mode)
- `BlockGrid`: `isDraggable={true}` всегда (раньше только в edit mode); `isResizable` остаётся только в edit mode
- `onLayoutChange` теперь работает без edit mode (drag сохраняет layout сразу)

### Fixed — Mindmap overlay не виден
- **Root cause**: CSS-переменные `hsl(var(--primary))` НЕ работают в SVG-атрибутах `stroke=""`/`fill=""` (только в style). Линии рендерились невидимым цветом
- **Fix**: явные hex-цвета (#3b82f6 / #4f46e5 — Tailwind blue/indigo). Также увеличена opacity (dim 0.18 → 0.35), толщина (1.5 → 1.8), и pattern (4 3 → 5 4) для лучшей видимости в dim-режиме

### Added — Cross-page connection mini-pin
- Новый компонент **`CrossPagePin`** (`src/components/blocks/cross-page-pin.tsx`):
  - Маленький круглый бейдж в правом верхнем углу блока (z-20, размер 5×5)
  - Показывается ТОЛЬКО если блок имеет хотя бы одну зависимость с `pageKey !== currentPageKey`
  - При hover — popover со списком cross-page связей: блок-источник, → название страницы, иконка ExternalLink
  - Клик ведёт на нужную страницу
- Интегрирован в `BlockChrome` через props `block` + `currentPageKey`
- `BlockGrid` пробрасывает `pageKey` в каждый `BlockChrome`

### Added — Универсальный data-блок (`custom.data`)
- **`CustomDataBlock`** в `src/lib/blocks/catalog/custom-data.tsx`:
  - Excel-style ячейка с произвольными строками `label + value (number)`
  - Inline-редактирование прямо в блоке (клик на label/value)
  - Кнопки «+ Строка» (добавить) и «AI» (заглушка для будущего автозаполнения из истории операций)
  - **Публикует output**: `value` (по выбранной агрегации: sum/avg/count/last), `sum`, `count`, `label`. Доступен другим computed-блокам как источник
  - **Settings**: 4 режима publishMode (Сумма/Среднее/Количество/Последнее), 3 формата значений (Рубли/Число/Процент)
  - Адаптивный density xs/sm/md/lg
  - Доступен на любой странице (`pages: ['*']`)

### Verified
- ✅ `pnpm build` — Exit 0, /cashflow 190kB (+2kB)
- ✅ Drag handle работает при hover в обычном режиме
- ✅ Mindmap линии видны (полупрозрачно по умолчанию, акцент при toggle)
- ✅ Защита от случайного стирания блоков

---

## [0.8.7] - 2026-05-11

### Added — Block Relationships (Excel-style ссылки между блоками)
- **Тип `BlockDependencies`** в `src/lib/blocks/types.ts` — `sources: BlockRef[]` + `aggregation: 'sum'|'avg'|'min'|'max'|'count'|'formula'|'ai'`
- **Reactive value store** `src/lib/blocks/values.tsx`:
  - `BlockValuesProvider` — на уровне страницы (внутри BlockGrid)
  - `useBlockValuePublisher(blockId, output)` — блок-источник публикует свои значения
  - `useBlockValue(ref)` — подписка на одно значение по ссылке
  - `useBlockDependencyResult(deps)` — агрегированный результат для computed-блока
- **Блок `computed.sum`** (`src/lib/blocks/catalog/computed.tsx`):
  - Поддерживает sum/avg/min/max/count (formula/ai — заглушки до Этапа 4)
  - Сам публикует свой результат → цепочки computed → computed работают
  - Адаптивный рендер xs/sm/md/lg
- **`BlockReferencePicker`** (`src/components/blocks/block-reference-picker.tsx`):
  - Notion-style выбор блоков-источников + тип агрегации
  - Поиск по названиям, исключает self из источников
- **Таб «Связи»** в `BlockSettingsDialog` (показывается если `def.supportsDependencies === true`)
- **Zod-валидация** `dependencies` в API route — поддержка POST/PUT
- **KPI блоки** (`stat.income/expense/balance`) теперь публикуют свои значения

### Added — Mindmap overlay (визуализация связей)
- **`BlockRelationsOverlay`** (`src/components/blocks/block-relations-overlay.tsx`):
  - SVG bezier-кривые между связанными блоками
  - Стрелки направления (markers)
  - Полупрозрачно по умолчанию (opacity 0.18, dashed) — не мешает виду
  - Toggle-кнопка «Связи» в шапке BlockGrid → акцент (opacity 0.85, solid, лейблы агрегации)
- Кнопка показывается ТОЛЬКО если есть хотя бы одна связь между блоками
- ResizeObserver + 300ms re-poll для обновления координат при drag/resize

### Changed — Notion-style hover controls
- **`BlockChrome`**: drag-handle и action toolbar появляются при hover с задержкой 250ms
- В edit mode — все контролы видны всегда (как было)
- Кнопка «Удалить» (X) — только в edit mode (защита от случайных удалений)
- Кнопка «Настройки» — на hover, можно открыть быстро без edit mode

### Changed — Полный формат сумм (formatRubles вместо compact)
- **Density thresholds** ужесточены — реально маленькие блоки попадают в xs/sm:
  - xs: ≤130×70 ИЛИ area ≤ 9_000
  - sm: ≤160×80 ИЛИ area ≤ 22_000
  - md: area ≤ 200_000 (тут полный формат)
- **`StatCard` SM density** теперь использует `formatRubles` (полный) с truncate fallback и tooltip
- **`StatCustomBlock` SM density** аналогично — full format с truncate

### Verified
- ✅ `pnpm build` — 30 страниц, /cashflow вырос с 183kB → 188kB (+5kB новые модули)
- ✅ Layout с dependencies сохраняется и загружается корректно (Zod schema валидирует)
- ✅ Mindmap overlay рендерится поверх grid'а без блокировки кликов

### Memory
- 📝 Notion UX-паттерны сохранены в memory (15 паттернов из Notion для применения в проекте)
- 📝 Block Relationships архитектура — отдельная memory с примерами кода
- 📝 PLAN.md → раздел «Этап 9» обновлён с MVP-чеклистом и Phase-2 списком

---

## [0.8.6] - 2026-05-10

### Fixed — Layout persistence (final fix, race condition)
- **Root cause v2**: даже после фикса 0.8.5 layout мог сбрасываться — `fetch` с `keepalive: true` не гарантирует, что сервер успеет обработать запрос ДО следующей перезагрузки страницы (request улетает, но новая страница может прочитать БД раньше)
- **Решение**:
  - **`navigator.sendBeacon`** — гарантированная доставка через OS-level network stack, browser ждёт завершения перед закрытием вкладки
  - sendBeacon использует **только POST** → добавлен `POST` handler в `/api/blocks/layout/[pageKey]` (семантически идентичен PUT)
  - **Debounce 800ms → 300ms** — резко уменьшает окно race condition
  - **Race в `doSave`**: pending обнулялся даже если за время fetch'а пришли новые изменения. Теперь `pendingBlocks.current = null` только если он === сохранённым данным
  - **`performReset`** отменяет pending save перед DELETE (иначе stale данные могли перезаписать дефолты)

### Changed — UI: подтверждение сброса раскладки
- **Системный `confirm()` заменён на `AlertDialog`** в `block-grid.tsx`
- Linear/Notion-style модалка с заголовком, описанием, и destructive-стилем для кнопки «Сбросить»
- Используется существующий компонент `src/components/ui/alert-dialog.tsx` (Radix UI)

### Verified
- ✅ `pnpm build` — 30 страниц, без регрессий
- ✅ `/api/blocks/layout/[pageKey]` поддерживает GET/PUT/POST/DELETE
- ✅ sendBeacon работает в Chrome/Firefox/Safari (стандарт W3C)

---

## [0.8.5] - 2026-05-10

### Fixed — Layout persistence bug (critical)
- **Блоки сбрасывались к дефолтным после перезагрузки страницы** — root cause: debounced save (800ms) очищался на unmount, pending данные терялись
- **Решение**:
  - `flushSave()` вызывается на `beforeunload` (закрытие/перезагрузка страницы)
  - `flushSave()` вызывается на unmount компонента (cleanup useEffect)
  - `flushSave()` вызывается при выходе из edit mode (клик «Готово»)
  - Используется `fetch(..., { keepalive: true })` — запрос завершается даже после unload страницы
  - `pendingBlocks` ref хранит последнее состояние для гарантированного flush

### Changed — Density threshold algorithm (font size fix)
- **Алгоритм density изменён с OR на площадь (area-based)** в `src/components/blocks/block-size.tsx`:
  - Раньше: `width ≤ 240 || height ≤ 140` → `sm` — блок 400×90px (KPI 4x2) попадал в `sm` из-за малой высоты
  - Теперь: площадь `width × height` определяет density — широкий но низкий блок получает правильный `md`
  - xs: `width ≤ 150 && height ≤ 80` ИЛИ area ≤ 12,000
  - sm: `width ≤ 180 && height ≤ 90` ИЛИ area ≤ 33,600
  - md: area ≤ 134,400
  - lg: всё больше
- **Результат**: KPI-блоки 4×2 (≈400×90px, area=36,000) теперь `md` вместо `sm`

### Changed — Font sizes increased (Notion-style: fill available space)
- **StatCard (KPI income/expense/balance)**:
  - md: `text-xl` → **`text-2xl`** (значение)
  - lg: `text-2xl` → **`text-3xl`** (значение)
  - sm: `text-base` → **`text-lg`** (значение), label `text-[10px]` → `text-xs`
  - Header label: `text-xs` → **`text-sm`** для md/lg
- **StatCustom (KPI с фильтрами)**:
  - md: `text-xl` → **`text-2xl`** (значение)
  - lg: **`text-3xl`** (значение)
  - sm: `text-base` → **`text-lg`**
  - Count: `text-[11px]` → **`text-xs`**
- **TopCategories (Топ доходов/расходов)**:
  - Title: `text-sm` → **`text-base font-semibold`** для md/lg
  - Category items: `text-[11px]` → **`text-sm`** для md/lg
  - Progress bar: `h-1` → **`h-1.5`**
  - Spacing: `space-y-2` → **`space-y-3`** для md/lg

### Verified
- ✅ `pnpm build` — 30 страниц, `/cashflow` 2.46 kB / 183 kB, без регрессий
- ✅ Density для блока 400×90px: было `sm` (мелкий текст), теперь `md` (нормальный)
- ✅ Layout сохраняется при перезагрузке страницы (keepalive flush)

---

## [0.8.4] - 2026-05-10

### Added — Block-Grid: Universal Adaptive (Lego-конструктор)

**Фундаментальное изменение архитектуры.** Все блоки теперь поддерживают размер от **1x1** с автоматической адаптацией контента и защитой от нечитаемости.

- **`useBlockSize` / `useBlockDensity` / `BlockSizeProvider`** (`src/components/blocks/block-size.tsx`):
  - Реактивный `ResizeObserver` — измеряет фактический размер блока в пикселях
  - 4 уровня плотности: `xs` (≤150×80), `sm` (≤240×140), `md` (≤480×280), `lg` (больше)
  - Хелпер `byDensity()` для выбора варианта рендера
- **`minContentSize: { w, h }` (px)** в `BlockDef` — порог читаемости:
  - Если фактический размер меньше → BlockGrid рисует **`TooSmallOverlay`** («Мало места, нужно ≥ XxYpx»)
  - Контент приглушается `opacity-30` чтобы пользователь сразу видел: «надо растянуть»
- **`BlockTabs`** (`src/components/blocks/block-tabs.tsx`) — мини-табы:
  - Variant `underline` (Linear-style тонкое подчёркивание) или `pills`
  - При `density === 'xs'` коллапсирует «лишние» табы в `<select>` (показывает только 2 первых как кнопки)
  - Универсальный — любой блок может иметь multi-view (Сводка / Список / График...)

### Changed — Adaptive рендер всех блоков
- **`StatCard`** (cashflow KPI) — `xs`: только число `compactRubles` (`643к₽`); `sm`: иконка+число+маленький label; `md+`: полный header
- **`stat.custom`** — три варианта рендера, `formatCompact()` для xs/sm
- **`navigate.card`** — `xs`: только иконка в центре; `sm`: иконка + title; `md+`: полная карточка с description
- **`top-categories`** — `xs`: 1 строка; `sm`: 3 строки; `md+`: все категории. Везде `formatCompactRubles` в xs/sm
- Все блоки имеют `truncate` + `title=...` (tooltip с полным значением) при xs/sm

### Changed — BlockGrid base parameters
- `rowHeight: 60 → 40` (более тонкая сетка)
- `margin: [16, 16] → [10, 10]` (плотнее)
- `react-grid-layout` minW/minH из `def.minSize ?? 1` (вместо `2` дефолта)

### Changed — minSize всех существующих блоков
| Блок | Было | Стало | minContentSize |
|---|---|---|---|
| `stat.income/expense/balance` | 3×2 | **1×1** | 80×40 |
| `stat.custom` | 3×2 | **1×1** | 80×40 |
| `navigate.card` | 2×2 | **1×1** | 60×40 |
| `top-categories` | 4×3 | **2×2** | 180×120 |
| `sheet` | 4×3 | **2×2** | 200×120 |
| `cashflow.transactions` | 6×3 | **3×3** | 280×180 |

### Added — `/settings` UI для видимости разделов
- **`src/app/(app)/settings/page.tsx`** + **`settings-client.tsx`**:
  - Список основных и админ-разделов с переключателями «виден / скрыт» (Linear-style status pills)
  - Защищённые разделы (`dashboard`, `settings`) нельзя скрыть
  - Сохранение через `PUT /api/blocks/layout/nav` (page-key `nav` для `hiddenSections`)
- **Layout sidebar** (`src/app/(app)/layout.tsx`) теперь читает `hiddenSections` из `block_layouts` (pageKey=`nav`) и фильтрует nav-items
- NavItem расширен полем `protected` (всегда виден независимо от настроек)

### Added — Memory правило
Зафиксировано фундаментальное правило **«Block-Grid: Lego-конструктор»** — обязательные требования для всех новых блоков и страниц:
- Каждая новая страница ДОЛЖНА строиться через BlockGrid (никаких статических layout'ов)
- Каждый новый блок ДОЛЖЕН использовать `useBlockDensity()` и указать `minContentSize`
- minSize стремится к 1x1 везде где возможно
- Конвенция `page-key`: `dashboard`, `cashflow`, `nav` (специальный), `inbox`/`deadlines`/... — будущие

### Updated — PLAN.md
Добавлен статус реализации Block-Grid (✅ что готово, 🔜 что отложено) в раздел «Configurable Block-Grid Architecture».

### Verified
- ✅ `pnpm build` — 31 страница, `/settings` 3.44 kB / 156 kB, без регрессий
- ✅ Layout fallback: если `loadLayout` не удался (нет tenant), sidebar показывает все пункты

### Не вошло (отложено)
- **AI-flow «Импорт через AI»** — требует Этапа 4 (полная реализация orchestrator). Текущий импорт CSV/XLSX с Тинькофф парсером работает корректно.
- **BlockTabs в конкретных блоках** — компонент создан, но пока не интегрирован в существующие блоки. Будет использоваться в Inbox / AI Chat / Reports.

---

## [0.8.3] - 2026-05-10

### Added — /dashboard на Block-Grid
- **`DEFAULT_LAYOUTS.dashboard`** в `src/lib/blocks/registry.ts` — 3 KPI (income/expense/balance) + 3 navigation-карточки (cashflow/inbox/deadlines)
- **Новый блок `navigate.card`** — `src/lib/blocks/catalog/navigate-card.tsx`:
  - Кликабельная карточка-ссылка на раздел с иконкой, заголовком, описанием
  - SettingsForm: title / description / href / comingSoon (checkbox)
  - Применяет `appearance.icon` и `accentColor` (цветной фон иконки 15% opacity)
  - Coming-soon pill (Linear-style) + disabled стиль (opacity-60)
- **`/dashboard/page.tsx`** полностью переписан: server-side load layout + cashflow-data → передаёт в `DashboardClient`
- **`DashboardClient`** (`dashboard-client.tsx`) — обёртка с Notion-like header + BlockGrid + CashflowDataProvider. Foundation-phase Alert сохранён (text-xs)

### Added — Sidebar/Header переделаны под Design System
- **Sidebar** (`src/app/(app)/layout.tsx`):
  - Ширина w-56 (было w-60), px-2 py-3 (было p-4)
  - Nav-items: h-auto px-2 py-1.5 text-[13px], иконка 14px, hover:bg-accent
  - Admin section: text-[10px] uppercase tracking-wider (Linear-style)
  - Version badge text-[10px]
  - Иконки для всех пунктов (lucide): LayoutDashboard, Inbox, Wallet, Calendar, Settings, Shield, Cpu, Sparkles, Users, Wrench
- **Header** h-10 (было h-14), border-border/60, px-4 (было px-6), email в text-xs

### Added — Ollama: полное управление моделями
- **Новые функции** в `src/lib/ai/providers/ollama.ts`:
  - `listRunningModels()` — `GET /api/ps`
  - `showModel(name)` — `POST /api/show` (modelfile, parameters, template, system, license)
  - `unloadModel(name)` — `POST /api/generate` с `keep_alive: 0`
- **Новые API**:
  - `GET /api/admin/ai/local-models/ps` — запущенные модели с RAM/VRAM/expires
  - `GET /api/admin/ai/local-models/[name]/show` — детали модели
  - `POST /api/admin/ai/local-models/[name]/unload` — выгрузка из памяти
- **UI `/admin/ai/local-models`** расширен:
  - Секция **«В памяти»** (автообновление каждые 5 сек) — показывает name, RAM, VRAM, TTL + кнопка «Выгрузить»
  - Бейдж `loaded` (зелёный) на installed-карточках для моделей в памяти
  - Кнопка `Info` — открывает Dialog с modelfile / parameters / template / system / license
  - Весь UI переделан под новый Design System: рамки rounded-lg, p-3, text-xs, pill-badges h-4 rounded-full, иконки 14px

### Added — AI System Prompt (дефолтный + UI-редактор)
- **`src/lib/ai/system-prompt.ts`**:
  - `DEFAULT_SYSTEM_PROMPT` — оптимизирован под qwen2.5:7b (~450 слов): роль AI-секретаря, контекст РФ, принципы работы с Tools Layer, формат ответов, запреты (юрконсультации, курсы валют)
  - `getSystemPrompt(settings)` — возвращает `tenantSettings.aiSystemPrompt` override или дефолт
- **API `GET/PUT /api/admin/ai/system-prompt`**:
  - GET возвращает `{default, custom, usingDefault}`
  - PUT сохраняет в `tenants.settings.aiSystemPrompt` (если тот же как default — сохраняет пустую строку → используется дефолт)
- **UI `/admin/ai/system-prompt`**:
  - Textarea 24 строки с `font-mono text-xs`
  - Счётчик «строк · символов» в шапке редактора
  - Alert с текущим статусом (использует дефолтный / кастомный)
  - Кнопки «К дефолту» (confirm) и «Сохранить»
  - Disabled «Сохранить» когда нет изменений
  - Details-секция с подсказками по написанию prompt
  - Ссылка в sidebar: «AI prompt» (иконка Sparkles)

### Changed
- **Dashboard** убран оригинальный `dashboard/page.tsx` code — теперь файл всего 80 строк (server-side load + pass в client)
- **Bundle sizes** после очистки .next: `/dashboard` 1.02 kB / 180 kB, `/cashflow` 2.45 kB / 182 kB (shared chunks пересчитались, фактический payload уменьшился за счёт общих модулей)

### Verified
- ✅ `pnpm build` — 30 страниц + 6 AI API endpoints. Все блоки доступны на dashboard через конструктор (Settings → Добавить)

### Использование
**Dashboard-конструктор:**
1. `/dashboard` → «Настроить»
2. Можно добавлять любые блоки из всех категорий: KPI, stat.custom с фильтрами, таблицы, sheet, navigate.card
3. Перетаскивать, ресайзить, удалять, сбрасывать к дефолту

**Ollama управление:**
1. `/admin/ai/local-models` → если модель загружена в память, видно в «В памяти» с кнопкой «Выгрузить»
2. На каждой installed-карточке — иконка `i` показывает modelfile/parameters/system prompt/license

**AI prompt:**
1. `/admin/ai/system-prompt` → редактируйте дефолтный, сохраните
2. Все AI-вызовы этого tenant'а будут использовать ваш prompt
3. «К дефолту» → возвращает стандартную версию

---

## [0.8.2] - 2026-05-10

### Added — Фундаментальный Design System (Linear/Notion-inspired)
- **Memory-правило** «Design System: Linear/Notion-inspired Compact UI» — обязательные правила для всех новых модулей (Inbox, Deadlines, Dashboard, Settings, ...). Зафиксировано как global rule.
- **Базовые tokens** (`src/app/globals.css`):
  - `html { font-size: 14px }` (было 16px) → вся типографика на 12.5% плотнее
  - `letter-spacing: -0.01em` + `font-feature-settings: 'ss01' 1` (Linear-like)
  - Тонкие scrollbars 10px через `::-webkit-scrollbar`
  - Auto-применяемые `h1/h2/h3` с `tracking-tight`
  - Design tokens `--font-size-*`, `--space-*` как CSS variables
  - Утилиты `.kbd` (для keyboard hints в стиле Linear) и `.section-divider`

### Changed — Все shadcn primitives переделаны под Linear/Notion
- **`Button`** (`src/components/ui/button.tsx`):
  - default `h-8 px-3 text-sm` (было `h-10 px-4`)
  - sm `h-7 px-2.5 text-xs`, **xs `h-6 px-2`** (новый)
  - icon `h-8 w-8`, **icon-sm `h-7 w-7`**, **icon-xs `h-6 w-6`** (новые)
  - SVG `size-3.5` (14px) вместо 16px, gap `1.5` вместо `2`
  - `ring-offset-1` вместо `ring-offset-2`
- **`Card`** (`src/components/ui/card.tsx`):
  - `rounded-lg` вместо `rounded-xl`, **убран `shadow-sm`**
  - `p-4` вместо `p-6` в header/content/footer
  - CardTitle: `text-sm font-semibold leading-tight` (было без size)
  - CardDescription: `text-xs` (было text-sm)
- **`Input`**: `h-8 px-2.5 py-1` (было `h-10 px-3 py-2`), `focus-visible:ring-1 ring-offset-0`
- **`Dialog`**: `p-5 gap-3` (было `p-6 gap-4`), Title `text-base`, Description `text-xs`
- **`Label`**: `text-xs font-medium` (было text-sm)

### Changed — Cashflow страница и блоки
- **Заголовок `/cashflow`** — Notion-like: `text-lg font-semibold` + subtitle `text-xs`, border-b снизу, кнопки справа `size="sm"`
- **KPI карточки** — значения `text-xl` (было text-2xl/3xl), иконки 14px, header pb-1.5
- **Stat-custom** — компактнее counts `text-[11px]`
- **Edit mode toolbar** — pill-статус «Редактирование» в amber (Linear-style status pill), кнопки иконок svg-only при compacted
- **BlockChrome** — компактнее drag handle и кнопки (7×7 ring-1)
- **BlockSettingsDialog / AddBlockDialog** — space-y-3.5, gap-1.5, палитра цветов уменьшена с 36px до 28px

### Added — Reset layout (восстановление дефолтной раскладки)
- **API `DELETE /api/blocks/layout/[pageKey]`** — удаляет пользовательскую запись, возвращает `DEFAULT_LAYOUTS[pageKey]`
- **`deleteLayout()`** в `src/lib/blocks/queries.ts`
- **Кнопка «Сбросить»** в edit mode toolbar `BlockGrid` — с confirm() и `router.refresh()` после
- **EmptyState** — когда блоков 0 на странице, показывается плашка `border-dashed bg-muted/30` с кнопками «Вернуть по умолчанию» и «Добавить блок» (теперь пользователь с пустым layout не видит пустой экран)

### Fixed
- Проблема: после ручного удаления всех блоков `/cashflow` показывала пустой экран без выхода → теперь EmptyState + reset кнопка

### Verified
- ✅ `pnpm build` — 26 страниц, `/cashflow` 29 kB / 176 kB First Load, без регрессий

### Как восстановить дефолтные блоки
1. `/cashflow` → увидеть EmptyState или нажать «Настроить»
2. Нажать «Сбросить» → подтвердить
3. Появятся 6 дефолтных блоков (Доходы/Расходы/Баланс + Топ доходов/расходов + История операций)

---

## [0.8.1] - 2026-05-10

### Added — Полная настраиваемость блоков
- **`BlockSettingsDialog`** — `src/components/blocks/block-settings-dialog.tsx`. Настройка существующего блока в edit mode через иконку ⚙ в правом верхнем углу. 3 таба:
  - **Параметры** (если у блока есть `SettingsForm`) — block-specific опции
  - **Внешний вид** — заголовок (override displayName), цвет рамки, акцентный цвет (палитра 8 пресетов: blue/green/red/amber/violet/pink/slate), иконка (20 lucide-икон на выбор)
  - **Размер** — слайдеры W (1-12) и H (1-20) с минимальными ограничениями из `BlockDef.minSize`
- **AddBlockDialog → wizard** — `src/components/blocks/add-block-dialog.tsx`:
  - Шаг 1: выбор типа блока (поиск + категории)
  - Шаг 2: настройка параметров + внешний вид + размер до создания
  - Шаг 3: «Создать блок» — добавляется с пользовательскими настройками
  - Кнопка «Назад» возвращает к выбору типа
- **`BlockInstance.appearance`** — универсальные косметические настройки:
  - `title?: string` — override заголовка
  - `borderColor?: string` — CSS color рамки блока (применяется через box-shadow inset)
  - `accentColor?: string` — акцентный цвет (иконки, прогресс-бары, KPI значения)
  - `icon?: string` — имя lucide-иконки (используется если блок поддерживает override)
- **`BlockDef.SettingsForm`** — опциональный React-компонент с пользовательскими настройками блока. Получает `{config, onChange}`.
- **Иконка ⚙ + drag-handle + ✕** в `BlockChrome` — все три появляются в edit mode. Drag-handle стал прозрачным «уголком», иконки ⚙/✕ в правом верхнем углу.
- **Цвет рамки** через `box-shadow: inset 0 0 0 2px <color>` — не ломает компоновку, не меняет padding.
- **CSS variables** `--block-accent` / `--block-border` пробрасываются в дочерние блоки (для будущего использования).

### Added — Новый блок `stat.custom` (KPI с фильтрами)
- **`src/lib/blocks/catalog/stat-custom.tsx`** — блок «KPI с фильтрами»:
  - **metric**: income / expense / balance / count
  - **period**: month / quarter / year / **all_time** (дефолт)
  - **counterparty contains** (case-insensitive ilike) — например `ТБанк` найдёт «АО Т-БАНК», «ТБанк», «T-Bank». Datalist с автодополнением из реальных контрагентов tenant'а.
  - **source equals** — точный фильтр по источнику (`tinkoff_csv`, `manual`, ...). Кнопки-чипы со списком всех имеющихся источников.
  - Применяет appearance: иконка (20 пресетов), цвет акцента, кастомный заголовок
  - Авто-заголовок из фильтров если `appearance.title` не задан: `"Поступления за всё время · ТБанк"`
- **API `GET /api/cashflow/aggregate`** — `src/app/api/cashflow/aggregate/route.ts`. Принимает `metric`, `period`, `counterparty` (ilike), `source` (eq). Возвращает `{value, count}`.
- **API `GET /api/cashflow/meta`** — `src/app/api/cashflow/meta/route.ts`. Возвращает distinct sources и top 50 контрагентов с counts — для пикеров фильтров.

### Added — SettingsForm для всех блоков
- **`stat.income/expense/balance`** — поддерживают override иконки и accentColor (применяется к иконке + значению), title через appearance
- **`cashflow.top-categories`** — кнопки переключения income/expense + слайдер количества строк (1-20). Прогресс-бары используют `appearance.accentColor` если задан.
- **`cashflow.transactions`** — слайдер `limit` (5-200, шаг 5). Title через appearance.
- **`sheet`** — слайдеры rows (1-100) и cols (1-26). Существующие данные сохраняются при изменении размеров.

### Performance
- **icon-resolver** переписан со статического map (`src/lib/blocks/icon-resolver.ts`) — раньше `import * as LucideIcons` тянул весь набор иконок (~1500 SVG) в bundle, что увеличивало `/cashflow` First Load до **344 kB**. Теперь **176 kB** (-49%).

### Verified
- ✅ `pnpm build` — 26 страниц + новые `/api/cashflow/aggregate`, `/api/cashflow/meta`. `/cashflow` 29 kB / 176 kB First Load.

### Use case (как просил пользователь)
> «Общее поступление за всё время с определённого канала (АО ТБанк)»

1. Edit mode → «+ Добавить блок» → KPI / Статистика → **«KPI с фильтрами»**
2. На шаге настройки: metric = `Поступления`, period = `за всё время`, контрагент содержит = `ТБанк`
3. (опционально) tab «Внешний вид» → выбрать синий цвет акцента и иконку `Banknote`
4. tab «Размер» → задать ширину 6, высоту 2
5. «Создать блок» → блок появляется на странице, делает запрос к `/api/cashflow/aggregate` и показывает сумму

---

## [0.8.0] - 2026-05-10

### Added — Configurable Block-Grid Architecture (главная UI-фишка)
- **DB schema `block_layouts`** — `src/lib/db/schema/block-layouts.ts`. Хранит layout per `(tenantId, userId, pageKey)` с полями `blocks JSON` (массив `BlockInstance`), `hiddenSections JSON`. Уникальный индекс `(tenant_id, user_id, page_key)`.
- **Drizzle миграция** `drizzle/0000_abnormal_queen_noir.sql` сгенерирована (12 таблиц, включая `block_layouts`).
- **`tenant_settings.aiSystemPrompt`** в `TenantSettings` — кастомный system prompt для всех AI вызовов tenant'а.
- **Block Registry** — `src/lib/blocks/registry.ts`:
  - `getBlockDef(type)`, `listBlocksForPage(pageKey)`, `listAllBlocks()`
  - `DEFAULT_LAYOUTS.cashflow` — дефолтный layout если у пользователя нет своего
  - `sanitizeBlocks(blocks)` — обрезает блоки с неизвестным `type`
- **Каталог блоков для Cashflow** — `src/lib/blocks/catalog/cashflow.tsx`:
  - `stat.income` / `stat.expense` / `stat.balance` — KPI-карточки
  - `cashflow.top-categories` — топ категорий с прогресс-барами (configurable: `type`, `limit`, `title`)
  - `cashflow.transactions` — список операций с edit/delete иконками, "Очистить всё" и встроенными модалками подтверждения и редактирования
- **Sheet block (Excel-like)** — `src/lib/blocks/catalog/sheet.tsx`:
  - Произвольная таблица с редактируемыми ячейками (10×5 по дефолту, до 200×26)
  - Авто-сохранение состояния в `instance.config.cells` через `onConfigChange`
- **`BlockGrid` компонент** — `src/components/blocks/block-grid.tsx`:
  - Обёртка над `react-grid-layout` с responsive breakpoints (lg/md/sm/xs/xxs)
  - Edit mode toggle (кнопка «Настроить» ↔ «Готово»)
  - Drag-handle (центральная зона над блоком в edit mode), resize handles
  - Авто-сохранение layout (debounce 800ms) в API через `PUT /api/blocks/layout/[pageKey]`
  - Колбэк `onConfigChange` пробрасывается в блоки (для Sheet и future blocks)
- **`BlockChrome`** — `src/components/blocks/block-chrome.tsx`. Drag handle + кнопка удаления блока (только в edit mode).
- **`AddBlockDialog`** — `src/components/blocks/add-block-dialog.tsx`. Каталог блоков с поиском, группировкой по категориям (KPI / Таблицы / Графики / Прочее), пометкой «уже на странице».
- **API `GET/PUT /api/blocks/layout/[pageKey]`** — `src/app/api/blocks/layout/[pageKey]/route.ts`. Zod-валидация всей структуры BlockInstance, лимит 100 блоков на страницу.
- **`loadLayout` / `saveLayout`** — `src/lib/blocks/queries.ts`. Upsert через `onConflictDoUpdate` по `(tenant_id, user_id, page_key)`. Если у пользователя нет своего layout — возвращает дефолтный.
- **Cashflow-data Provider** — `src/lib/blocks/catalog/cashflow-data.tsx`. Контекст со сводкой/категориями/транзакциями страницы — все cashflow-блоки делят одну выборку, без дубликатов запросов.

### Changed
- `/cashflow` **полностью переведён на Block-Grid**:
  - `cashflow-client.tsx` теперь — обёртка с заголовком, кнопками «Импорт» / «Добавить» (модалки) и `<BlockGrid>` внутри
  - Дефолтный layout: 3 KPI (доходы / расходы / баланс), 2 топ-категории, список операций — итого 6 блоков
  - Пользователь может удалять блоки, добавлять новые из каталога (включая Sheet), drag-resize
- `/cashflow` 19.7 kB → **26.4 kB** (от добавления react-grid-layout, edit mode UI, Sheet block)
- shadcn `AlertDialog` (`@radix-ui/react-alert-dialog 1.1.15`) и `react-grid-layout 1.5.3` (стабильная v1, у v2 нет `WidthProvider`) добавлены как зависимости.

### Pending для следующих итераций
- Edit mode для **per-block config** (UI-настройки топ-категорий: тип/лимит/заголовок) — сейчас config редактируется только программно
- `/settings` — управление видимостью разделов навигации (`hiddenSections`)
- Ollama: `/api/ps`, `/api/show`, выгрузка моделей из памяти
- AI system prompt: дефолтный для qwen2.5:7b + UI-редактор в `/admin/ai`
- AI-flow «Импорт через AI» в Cashflow — анализ файла LLM перед коммитом
- Перевод `/dashboard` на Block-Grid

### Verified
- ✅ `pnpm build` — 24 страницы + `/api/blocks/layout/[pageKey]` (143 kB), middleware 53.7 kB
- ✅ `pnpm drizzle-kit generate` — миграция сгенерирована (12 таблиц)

### Migration TODO (выполнить вручную)
```bash
# Применить миграцию к локальной БД (Postgres в docker, port 5434)
pnpm db:migrate
# или для prod
DATABASE_URL=... pnpm db:migrate
```

---

## [0.7.1] - 2026-05-10

### Fixed
- **Парсер Тинькофф для ИП** (`src/lib/cashflow/import.ts`):
  - Раньше **все операции попадали как доходы** — парсер не понимал колонку «Тип операции (пополнение/списание)» (Дебет/Кредит) и брал положительную сумму как income
  - Теперь:
    - Отдельная колонка `type` в `HEADER_HINTS` распознаёт `Дебет`/`Кредит` (списание/пополнение)
    - Авто-определение формата `tinkoff` по наличию колонок «Тип операции» + «Номер счёта»
    - BOM (UTF-8) автоматически снимается
    - Авто-определение разделителя (`;` для Тинькофф, `,` для других)
    - Расширены русские синонимы: «Дата проведения», «Сумма в валюте счёта», «Описание операции», «Наименование контрагента»
  - Тестовый скрипт `scripts/test-tinkoff-import.ts` — прогон на реальной выписке ИП (данные скрыты) показал 287 операций, доходы *** ₽, расходы *** ₽, баланс *** ₽

### Added
- **Удаление и редактирование транзакций** в Cashflow:
  - Иконки ✎ / 🗑 в каждой строке таблицы (появляются на hover)
  - **AlertDialog** с подтверждением для всех деструктивных действий — `src/components/ui/alert-dialog.tsx` (на @radix-ui/react-alert-dialog)
  - Кнопка «Очистить всё» в шапке истории операций — массовое удаление всех транзакций tenant'а
  - API `DELETE /api/cashflow/transactions?confirm=true` для bulk-delete
- **Cashflow на модалках** (как просил пользователь — без inline-форм):
  - Добавление транзакции → `<Dialog>` (минималистичная модалка)
  - Редактирование транзакции → та же модалка с initial-данными, PATCH на API
  - Импорт CSV/XLSX → `<Dialog>` с превью внутри модалки
  - Универсальный `TransactionForm` для create + edit
- **shadcn компоненты:** `dialog.tsx`, `alert-dialog.tsx`, `textarea.tsx`, `switch.tsx`
- **Block-Grid фундамент:** `src/lib/blocks/types.ts` — типы `BlockInstance`, `BlockDef`, `PageLayout` для будущей конфигурируемой архитектуры (см. `PLAN.md` раздел «Configurable Block-Grid Architecture»)

### Changed
- `PLAN.md`:
  - Добавлен ключевой принцип «Block-Grid UI как Lego»
  - Добавлен раздел «Configurable Block-Grid Architecture (главная UI-фишка)» с описанием концепции, БД-схемой, каталогом блоков
  - Добавлены пометки про отложенные направления: налоги (этап 5), COM-интеграция Excel/1С, VPS, мобильное приложение, Tauri desktop, банковские интеграции
- `react-grid-layout` + `@types/react-grid-layout` + `@radix-ui/react-switch` + `@radix-ui/react-alert-dialog` добавлены как зависимости

### Verified
- ✅ `pnpm build` проходит. 24 страницы, middleware 53.7 kB. /cashflow 19.7 kB (модалки + edit)
- ✅ Парсер Тинькофф: 287 операций из реальной выписки разобраны корректно

---

## [0.7.0] - 2026-05-10

### Added
- **shadcn/ui** установлен:
  - `components.json` (style: new-york, baseColor: zinc, lucide icons)
  - `src/components/ui/`: `button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`, `alert.tsx`, `table.tsx`
  - Login/Register страницы переписаны на shadcn-компоненты
- **Cashflow модуль** (первый рабочий бизнес-модуль):
  - `src/lib/cashflow/queries.ts` — `listTransactions`, `getCashflowSummary`, `getTopCategories`, `listCategories`, `ensureDefaultCategories`. Все запросы скоупятся `tenantId`.
  - `src/lib/cashflow/import.ts` — парсер CSV (papaparse) + XLSX (xlsx). Авто-определение колонок «Дата/Сумма/Контрагент/Назначение». Поддержка форматов Тинькофф/Сбер/generic. Положительные суммы → доход, отрицательные → расход
  - `/api/cashflow/transactions` (GET/POST), `/api/cashflow/transactions/[id]` (PATCH/DELETE), `/api/cashflow/categories` (GET), `/api/cashflow/summary` (GET), `/api/cashflow/import` (POST с превью + commit)
  - `/cashflow` страница: сводка месяца (доходы/расходы/баланс), топ-5 категорий, лента последних 50 операций, формы добавления и импорта файла
  - 12 дефолтных категорий создаются при первой транзакции (Продажи маркетплейс, Закупка, Реклама, Налоги, и т.д.)
  - Dashboard: показывает баланс если есть транзакции, иначе — призыв к действию
- **SMTP через nodemailer** (с Beget по умолчанию):
  - `src/lib/email/transport.ts` — `sendMail()` с dev-fallback в консоль если SMTP не настроен
  - `src/lib/email/templates.ts` — `welcomeEmail`, `resetPasswordEmail` (минимальный inline-HTML)
  - Регистрация шлёт welcome-письмо, forgot-password шлёт reset-link
  - `docs/EMAIL_BEGET.md` — пошаговый гайд (создать ящик, SPF/DKIM/DMARC, troubleshooting)
- **Ollama менеджер моделей** (как LM Studio):
  - `src/lib/ai/providers/ollama.ts` — `isOllamaAvailable`, `listInstalledModels`, `pullModel` (со стримом прогресса), `deleteModel`, `generate`
  - `src/lib/ai/providers/ollama-catalog.ts` — каталог 6 рекомендованных моделей с метаданными (размер, RAM, для чего, рекомендация)
  - `/admin/ai/local-models` — UI: установленные модели + каталог, кнопка «Загрузить» с прогресс-баром, удаление, проверка доступности Ollama
  - API: `GET /api/admin/ai/local-models`, `POST /api/admin/ai/local-models/pull` (NDJSON стрим), `DELETE /api/admin/ai/local-models/[name]`
  - `docs/LOCAL_AI.md` — полностью переписан под Mac M3 18GB с таблицей скоростей моделей, troubleshooting, альтернативами
- **VPN proxy для зарубежных AI API:**
  - `docs/VPN_FOR_AI.md` — гайд по подключению bvpn.cc подписки (VLESS через Xray → SOCKS5 на 10808 → AI_PROXY_URL)
  - Альтернативы: WireGuard на VPS, Outline, Mullvad
- **Tauri vs Electron стратегия:**
  - `docs/DESKTOP_STRATEGY.md` — детальное сравнение для интеграций с Office Excel, 1С COM, файловый обмен
  - Решение: Tauri как основной, готовность к Electron-fork в 1 неделю если потребуется COM-автоматизация
- **Новые env**: `SMTP_HOST/PORT/USER/PASSWORD/FROM`, `APP_URL`
- **Зависимости**: `nodemailer`, `papaparse`, `xlsx` (deps); `@types/nodemailer`, `@types/papaparse` (devDeps)

### Changed
- Лендинг: версия 0.6.0 → 0.7.0
- Sidebar (`src/app/(app)/layout.tsx`): добавлена ссылка «AI модели» в админ-секцию
- `src/app/(app)/admin/page.tsx`: уточнено описание раздела локальных моделей

### Verified
- ✅ `pnpm build` проходит. **24 страницы** (было 16), middleware 53.7 kB. Все warnings — косметика (unused imports в schemas, ESLint конкретно `_`-префикс)
- ✅ Auth-пути работают: register шлёт welcome, forgot-password шлёт reset (в dev — в консоль)
- ✅ Cashflow роуты: `/cashflow`, `/api/cashflow/*` — все собраны

---

## [0.6.1] - 2026-05-10

### Fixed
- **Падение middleware на старте dev-сервера** (`ZodError: NEXTAUTH_SECRET min(32)`):
  - В `src/lib/env.ts` убрана `min(32)` валидация — теперь `optional().or(z.literal(''))`. Edge runtime корректно парсит env даже с пустыми значениями
  - Реальная проверка длины секрета теперь в `src/lib/auth/session.ts:getSecretKey()`: prod требует 32+, dev получает безопасный fallback
  - В `.env.example` добавлена подсказка `openssl rand -base64 48` для генерации
- **Build verification** — добавлено правило в memory: всегда запускать `pnpm build` перед сообщением «готово». Build проверяется на edge-runtime совместимость, Suspense boundaries, zod runtime валидацию

### Added
- Сгенерирован безопасный 64-символьный `NEXTAUTH_SECRET` в `.env.local` пользователя (через `openssl rand -base64 48`)

### Verified
- ✅ `pnpm build` проходит. 16 страниц, middleware 53.5 kB. Все warnings — косметика (unused imports)

---

## [0.6.0] - 2026-05-10

### Added
- **Реальный auth поверх JWT cookie + bcrypt** (без NextAuth, чтобы не зависеть от beta v5):
  - `src/lib/auth/password.ts` — `hashPassword`/`verifyPassword`/`generatePasswordResetToken`. bcrypt 12 rounds
  - `src/lib/auth/session.ts` — `jose` JWT в httpOnly cookie `of_session`. Edge-runtime совместимо. TTL 30 дней
  - `src/lib/auth/actions.ts` — `register`/`login`/`logout`/`requestPasswordReset`/`confirmPasswordReset`. Транзакции для атомарной regsitration (user + tenant + membership owner за раз)
  - `src/lib/auth/index.ts` — единая точка входа `auth()`/`signIn()`/`signUp()`/`signOut()`. API совместим с NextAuth v5 для будущей миграции
- **API routes:**
  - `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/forgot-password`
  - `POST /api/onboarding/complete` — фиксирует выбор шаблона и помечает tenant как прошедший онбординг
- **Страницы:**
  - `src/app/(auth)/login/page.tsx` + `register` + `forgot-password` — минималистичный UI, поддержка `?next=` редиректа
  - `src/app/(app)/layout.tsx` — приватный layout с сайдбаром, навигацией и `LogoutButton`. Для admin показывается доп. секция
  - `src/app/(app)/dashboard/page.tsx` — главный экран с проверкой onboardingCompleted
  - `src/app/(app)/onboarding/page.tsx` — упрощённый визард на одном шаге (выбор типа деятельности из 6). Полный визард — Этап 1
  - `src/app/(app)/admin/page.tsx` — админ-панель со статистикой (users/tenants/подписки), списком разделов
  - `src/components/logout-button.tsx`
- **Middleware** — реальная JWT проверка вместо заглушки:
  - Public paths: `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/api/auth`, `/api/health`
  - Admin paths: `/admin`, `/api/admin` — нужна роль `admin`/`super_admin`, иначе редирект `/dashboard` или 403 для API
  - Прокидывает `x-user-id`, `x-tenant-id`, `x-user-role` в заголовки для server components
- **Schema users расширена:** `globalRole` (`user`/`admin`/`super_admin`), `passwordResetToken`, `passwordResetExpiresAt`, `lastLoginAt`
- **CLI скрипты для админа:**
  - `pnpm db:seed` — `scripts/seed.ts` создаёт дефолтного `super_admin` с email/паролем из `SEED_*` env (дефолт: `admin@openfinance.local` / `admin12345`)
  - `pnpm admin:reset-password <email> <new-password>` — `scripts/reset-password.ts`
  - `pnpm admin:create <email> <password> [--admin|--super-admin]` — `scripts/create-user.ts`
- **Auth dependencies:** `bcryptjs`, `jose` (deps); `@types/bcryptjs`, `tsx` (devDeps)
- **`SEED_ADMIN_*`** в `.env.example`

### Changed
- **Postgres порт `5433` → `5434`** во всех файлах (.env.example, README, drizzle.config.ts) — пользователь сменил в docker-compose
- **Лендинг:** кнопка «Попробовать Pro» теперь ведёт на `/register` (раньше `/dashboard`). Версия в надписи 0.4.0 → 0.6.0

### Notes
- **Lint-ошибки про `bcryptjs`/`jose`/`@components/logout-button`** ожидаемы до `pnpm install` — после исчезнут
- Reset-password ссылка пока не отправляется на email (нет SMTP) — токен пишется в консоль сервера в dev. Email-доставка будет в Этапе 1 после интеграции SMTP/SendGrid

---

## [0.5.0] - 2026-05-10

### Fixed
- **CVE-2025-66478 в Next.js** — обновлён `next` 15.0.3 → 15.5.4 (последний патченный 15.x)
- **Turbopack + typedRoutes несовместимость** — `next.config.mjs` теперь делает `experimental.typedRoutes: true` только для webpack-режима; при `NEXT_TURBO=1` флаг не подставляется
- **Дефолтный `pnpm dev`** переключён на webpack для типизированных роутов; добавлен `pnpm dev:turbo` для Turbopack-сборки
- **drizzle-kit не подхватывает .env.local** — `drizzle.config.ts` теперь сам подгружает `.env.local`/`.env` через `dotenv`

### Changed
- **React 19 RC → React 18.3.1** — зафиксирована стабильная версия (по требованию: «зафиксируй стабильность»). React 19 вернётся когда выйдет stable
- **drizzle-orm `^0.36.4` → `^0.45.2`**, **drizzle-kit `^0.28.1` → `^0.31.10`**, **eslint-config-next `15.0.3` → `15.5.4`**
- **docker-compose.yml** переписан по образцу `/Users/firay/braint`:
  - Postgres на `5433` (чтобы не конфликтовать с другими локальными Postgres)
  - Redis на `6380`, MinIO на `9100/9101`, Adminer на `8081`
  - Все порты bind к `127.0.0.1` для безопасности
  - Healthcheck на каждый сервис, отдельный network `openfinance_network`
- **`.env.example`** дополнен: `POSTGRES_*` блок, MinIO/Adminer порты, `AI_DEFAULT_PROVIDER`, `OLLAMA_*`, `AI_MOCK_ENABLED`, `AI_PROXY_*` (VPN), `S3_REGION`/`S3_FORCE_PATH_STYLE`, feature flags (`FEATURE_OPEN_REGISTRATION`, `FEATURE_ONBOARDING_WIZARD`, `FEATURE_BILLING_MOCK`, `FEATURE_DEFAULT_PLAN`), `AUTH_DRIVER`
- **`src/lib/env.ts`** — расширена zod-схема под новые env, типизированные feature flags
- **Schema `tenants`** — добавлены поля `onboardingCompleted: boolean`, `setupAnswers: jsonb`, новый тип `SetupAnswers`. В `TenantSettings` — `aiProvider` уточнён под текущие провайдеры, добавлен `openRegistration` флаг
- **`drizzle/init/01-extensions.sql`** — добавлены `unaccent` + функция `normalize_search_text` (по образцу braint)

### Added
- **`drizzle/init/02-vector-indexes.sql`** — отдельный скрипт для индексов которые drizzle-kit не умеет: HNSW на `memory_chunks.embedding` (cosine, m=16, ef_construction=64), GIN FTS русский, trigram на `transactions.counterparty`. Применяется вручную после `db:push`
- **`docs/LOCAL_AI.md`** — гайд по локальной AI-модели через Ollama для dev (3 способа установки, выбор модели по железу, план UI в админке)
- **`docs/ONBOARDING.md`** — спецификация onboarding-визарда: 6 шагов, 6 шаблонов под тип пользователя, архитектура
- **`src/lib/onboarding/templates.ts`** — реестр шаблонов модулей и AI-агентов под тип пользователя (selller/freelancer/small_business/self_employed/personal/other)
- **`src/lib/auth/index.ts`** — точка входа auth с переключателем `AUTH_DRIVER=v5|v4` (запас на случай beta-проблем NextAuth.js 5)
- **`src/lib/billing/mock.ts`** — заглушка биллинга которая всегда возвращает success (для dev и e2e тестов; активна при `FEATURE_BILLING_MOCK=true`)
- **`src/lib/ai/providers/mock.ts`** — детерминированный AI-провайдер для разработки без API ключей (срабатывает на ключевые слова: налог/чек/баланс/дедлайн)
- **`FEED.md`** — заготовка постов для Telegram-канала Open Finance (10 готовых + 8 идей в бэклоге, стиль `@braintmind`)
- **`pnpm ollama:check`** — скрипт быстрой проверки доступности локальной Ollama
- **`dotenv`** в devDependencies — для загрузки env в drizzle-kit

### Notes
- Команды для проверки после фиксов:
  ```bash
  pnpm install --force         # переустановит с новыми версиями
  pnpm docker:up               # поднимет Postgres+Redis+MinIO+Adminer
  pnpm db:push                 # применит схемы
  docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/02-vector-indexes.sql
  pnpm dev                     # webpack + typedRoutes
  ```

---

## [0.4.0] - 2025-05-10

### Added
- **Фундамент проекта создан** — полностью с нуля под актуальный план:
  - `package.json` — Next.js 15 + React 19 RC, Drizzle ORM 0.36, Tailwind 3.4, shadcn/ui примитивы, Zustand, TanStack Query, cmdk
  - `tsconfig.json` с path aliases (`@/lib`, `@/modules`, `@/components`, `@/db`)
  - `next.config.mjs` с security headers + Tauri-friendly export режим
  - `tailwind.config.ts` + `globals.css` с CSS-переменными для тем (светлая по умолчанию)
  - `drizzle.config.ts` для миграций
  - `docker-compose.yml` — Postgres 16 с **pgvector** + Redis 7
  - `drizzle/init/01-extensions.sql` — extensions: vector, pgcrypto, pg_trgm
  - `.eslintrc.json` + `.prettierrc` + `.env.example`
- **Drizzle schemas (базовые):**
  - `tenants` — мультитенантность с тарифами и налоговыми режимами
  - `users` + `memberships` — пользователи и роли (owner/admin/manager/accountant/viewer)
  - `transactions` + `categories` — финансовые операции (в копейках для точности)
  - `blocks` — универсальные блоки модульного конструктора (Excel-like, charts, text)
  - `deadlines` — cross-cutting слой дедлайнов с recurrence + reminders
  - `memoryChunks` — RAG-память с pgvector (1536-dim embeddings)
  - `aiUsage` — счётчик токенов с лимитами по тарифу
  - `aiAuditLog` — аудит всех AI-действий с inverse_action для отката
  - `aiAgents` — кастомные AI-агенты пользователя (Phase 2)
- **AI Foundation (skeleton):**
  - `src/lib/ai/types.ts` — типы Tool, ToolContext, ChatMessage
  - `src/lib/ai/orchestrator.ts` — главная точка работы с AI + tool registry
  - `src/lib/ai/tools/index.ts` — реестр инструментов
  - `src/lib/ai/memory/search.ts` — hybrid search (semantic + FTS + RRF)
- **Module Registry:**
  - `src/lib/modules/types.ts` — Module/Widget/Plan типы
  - `src/lib/modules/registry.ts` — регистрация и поиск модулей
  - README для cashflow, inbox, communications модулей
- **App Router:**
  - `src/app/layout.tsx` с Inter + JetBrains Mono шрифтами и ThemeProvider
  - `src/app/page.tsx` — минимальный лендинг с CTA «Попробовать Pro 14 дней»
  - `src/app/api/health/route.ts` — health check endpoint
  - `src/components/theme-provider.tsx` (next-themes wrapper)
  - `src/middleware.ts` — заглушка под auth + tenant context
- **Документация для AI-агентов:**
  - `CLAUDE.md` — полностью переписан под актуальный стек (Drizzle вместо Prisma, AI-first архитектура)
  - `AGENTS.md` — универсальные правила для любого AI-агента
  - `MEMORY.md` — компактный контекст (5 разделов)
  - `README.md` — публичный README с быстрым стартом
  - `docs/MODULES.md` — как добавлять модули
  - `docs/AI_TOOLS.md` — реестр инструментов и стандарты
  - `docs/ARCHITECTURE.md` — карта архитектуры с диаграммами и потоками

### Changed
- **PLAN.md** — финальная итерация:
  - **Free тариф:** безлимитная история (убрано «30 дней»)
  - **Цены:** Pro 990 → 690 ₽/мес, Business 2 990 → 2 490 ₽, Enterprise 7 990 → 6 990 ₽ (доступнее)
  - **Trial Pro:** 14 дней без оплаты, без карты — кнопка «Попробовать»
  - **AI-агенты + счётчик токенов** — новый раздел про специализированные агенты с настраиваемыми скилами + лимиты по тарифам
  - **Tauri vs Electron сравнение** — обоснование выбора Tauri 2.0
  - **VPN-надстройка** — для зарубежных AI API через Vless/WireGuard в админке
  - **AI Orchestrator** — своя обёртка вместо Vercel AI SDK
  - **Светлая тема по умолчанию** + тёмная опция через CSS-переменные
  - **Mobile native** — React Native + Expo как приоритет (не PWA)
  - **Linear UX** — keyboard shortcuts стали опциональными, мышь+drag-n-drop по умолчанию
  - **Yandex GPT / GigaChat** — добавлены как РФ-fallback без VPN
  - **BYOK** — пользователь может вставить свой API-ключ
- **`.gitignore`:** привязка папок к корню (`/inbox/` вместо `inbox/`) — чтобы не блокировать `src/modules/inbox/`

### Memory
- Добавлено правило про обязательное использование Context7 при работе с библиотеками
- Добавлено правило безопасности (gitleaks, защита от утечек)

## [0.3.0] - 2025-05-10

### Changed
- **PLAN.md** — третья волна доработок:
  - **Free тариф:** убрано ограничение в 30 дней — теперь **безлимитная история** на всех тарифах
  - **AI-first архитектура:** добавлен большой раздел про AI как первоклассный гражданин системы (Memory Layer / Tools Layer / Orchestrator)
  - **RAG-память:** pgvector + sqlite-vec, схема `memory_chunks` с HNSW индексом, hybrid search (semantic + FTS + RRF)
  - **Tools Layer:** типизированные инструменты для AI (Zod → JSON Schema), audit log + откат
  - **Linear UX:** keyboard shortcuts стали опциональными (мышь + drag-n-drop по умолчанию, прогрессивное раскрытие подсказок)
  - **Простая структура для AI:** антипаттерны (глубокая вложенность, барреллы) + правила (плоская структура, явные импорты, comment-headers, README в папках)
  - **Файлы конвенций:** CLAUDE.md, AGENTS.md, .cursor/rules/ — для онбординга AI-агентов
  - **Стек обновлён:** добавлены pgvector, sqlite-vec, Vercel AI SDK, OpenAI embeddings, Tesseract OCR, Whisper, grammY/GramJS

### Added
- **Inbox — drop-папка для AI** (Этап 7.5): `~/OpenFinance/Inbox/` или S3-bucket, AI ежедневно проверяет, парсит чеки/договоры/Excel/заметки/голосовые → создаёт транзакции/блоки/напоминания. Auto-mode + Approve-mode + per-type rules. Email-to-Inbox через `inbox.{user}@openfinance.ru`.
- **AI-секретарь** (Этап 8): интеграция с Email IMAP, Telegram (Bot+MTProto), WhatsApp Business, VK, MAX, Google Contacts, iCloud CardDAV. Granular permissions, opt-in, audit log, кнопка «Стереть всю память».
- **`.gitignore`** — полный список исключений (.env, *.pem, базы, inbox/, data/, секретные ключи, gitignored notes)
- **`docs/SECURITY.md`** — обязательное чтение для AI и людей: правила работы с секретами, чек-листы, защита от утечек, 152-ФЗ
- **Память:** правила безопасности добавлены в MemPalace для контроля при коммитах

### Roadmap
- Расширен с 13 до **14 этапов**: добавлены Этап 7.5 (Inbox) и Этап 8 (AI-секретарь). Остальные перенумерованы.

## [0.2.0] - 2025-05-10

### Changed
- **PLAN.md** — крупный апгрейд плана:
  - **Налоги:** добавлен модуль с поддержкой всех режимов РФ (УСН 6%/15%, НДС 5%/7%/20%, ПСН, НПД, АУСН, ОСНО, ЕСХН) + AI-сценарии сравнения
  - **ORM:** Prisma → **Drizzle ORM** (детальное обоснование: bundle size, серверлесс, нативная RLS, единая схема Postgres+SQLite)
  - **Local-First версия:** новый раздел про Tauri 2.0 + SQLite + лицензирование (3 варианта монетизации: Lifetime/Subscription/Free Local)
  - **Excel-like блоки** добавлены в базовую версию (mini-spreadsheet, формулы, шаблоны: бюджет/поставки/ROI/цели/подписки)
  - **Биллинг:** Т-Касса (основной) + CloudPayments (резервный) с архитектурой `PaymentProvider` + резерв на YooKassa/Robokassa/Stripe
  - **Дедлайны и напоминания:** cross-cutting фича — на любом блоке (налоги, поставки с Китая, заказы, цели)
  - **Дизайн и UX:** отдельный блок с принципами из Notion/Linear/Obsidian/Claude Code/Codex (slash-команды, Cmd+K palette, block editor, дизайн-система, цвета, типографика)
  - **Roadmap** расширен до 13 этапов (добавлены Excel-блоки, Tauri Local-First, поставки, дедлайны)
  - **Структура проекта** обновлена под Drizzle + новые модули (supply, orders, planner, deadlines, blocks)
- **Шаблоны блоков** в базовую версию: Личный бюджет, Поставки с Китая, ROI калькулятор, Сравнение поставщиков, Долги/займы, Подписки, Цели

### Added
- **docs/BILLING.md** — пошаговая инструкция по реализации биллинга (Т-Касса + CloudPayments) для будущего AI агента: API, схема БД, безопасность, чеклист
- **docs/LICENSING.md** — инструкция по реализации лицензирования (JWT RS256, Tauri keyring, поток активации) для AI агента

## [0.1.0] - 2025-05-09

### Changed
- **PLAN.md** — полная переработка концепции проекта:
  - Убран yoolip.ai как референс, оставлен только в таблице конкурентов для сравнения
  - Новое позиционирование: AI Финансовый Управляющий (не аналитика с AI-довеском)
  - Добавлен модульный конструктор как ядро продукта (базовые / бизнес / AI-надстройки)
  - Добавлен анализ рынка: 5 российских + 4 мировых конкурента с таблицами сравнения
  - Добавлена целевая аудитория (селлеры, ИП, фрилансеры, малый бизнес)
  - Добавлена детальная AI-функциональность (предиктивный анализ, коучинг, сценарии)
  - Пересмотрены тарифы: Pro от 990₽/мес (доступность как приоритет)
  - Roadmap расширен до 10 этапов (добавлен AI Советник и Smart-уведомления отдельно)
  - Обновлена структура проекта под модульную архитектуру

### Added
- **CHANGELOG.md** — создан лог изменений проекта
