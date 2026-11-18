# STOCK_MODULE_DESIGN.md — модуль «Склад · Поставки · Себестоимость»

> **Поправки 2026-11-18 — хэндофф, не выполнено в коде** (номера строк — по редакции коммита `91e2275`, до этой пометки). Решение владельца «хаб — голова и центр по остаткам» (`docs/SITES_HUB_ARCHITECTURE.md`) заменяет в этом документе:
> - места (`:58-61`, `:253-263`; код `src/lib/stock/places.ts`): склад FBS — это `own`; `ozon_fbs` остаётся `external` и в итог денег в товаре не входит; `site_shopb`/`site_shopa` — каналы, не места хранения (сейчас `ledger` — итог в `stock.balances`, `:374`, посчитал бы одну полку трижды);
> - внешний ключ сайта (`:112`): ключ варианта `productId:variantId`, а не `Product.sku`;
> - продажа на Ozon FBS (`:329`) и с сайта (`:331`): расход с `own` по отправлениям `/v4/posting/fbs/list` и по журналу службы склада на VPS; отчёт о реализации и события заказов сайтов — только для денег; брони сайтов — из журнала службы (в v1 склад броней не ведёт, `:431`);
> - сопоставление товаров сайтов (`:396`) — по выгрузке `/api/hub/v1/catalog`; «на сайтах ничего не меняем» (`:402`) больше неверно;
> - открытый вопрос `:476` закрыт: заказы сайтов отгружаются с того же склада, что FBS Ozon;
> - догон после простоя упирается в закрытый период (`assertPeriodOpen`, `posting.ts:514`) — нужен корректирующий документ текущей датой со ссылкой на событие.

> Составлен 2026-08-12 мультиагентным проектированием: три независимых архитектурных предложения
> (минимальный рабочий / полноценный товароучёт / «выводим из каналов») → три судьи
> (владелец бизнеса, инженер репозитория, скептик по целостности данных) → синтез победителя
> с прививкой лучших идей проигравших.
>
> **Зачем модуль:** закупки и поставки ведутся на бумаге, себестоимости нет ни в одной системе,
> сшивки «товар ↔ SKU канала» не существует. Это блокирует P&L (Этап D `ROADMAP_V2.md`)
> и цифровизацию бизнеса (Этап F).
>
> Статус: **дизайн утверждён, реализация не начата.** Перед первой миграцией — ответы на §11.

# ИТОГОВЫЙ ДИЗАЙН МОДУЛЯ «Склад · Поставки · Себестоимость» (Open Finance)

## 0. Что решено и на чём основано

**База — `pragmatic`** (журнал только по подконтрольным местам, остатки маркетплейса не дублируем, оценка по скользящей средней). **Привито из `canonical`:** документ-шапка у ВСЕХ операций, партии с точной суммой вместо цены-за-штуку, `qty_per_unit` в сшивке, НДС/валюта с первого дня, сторно вместо удаления, материализованная сверка, `brand`/`category`, FEFO-список, `cost_source`, экран сопоставления. **Добавлено сверх обоих (закрывает находки судей):** документ `regrade` для пересортицы, цепочка `own → transit → приёмка` с материализацией потерь маркетплейса, блокировка периода, массовое переключение `cost_source` с превью дельты, карантин «продажи без себестоимости», разбор ловушки `unit_products.stock_own`.

**Проверено по коду перед проектированием** (не по описаниям):
- `unit_products` (`src/lib/db/schema/unit-economics.ts:22-67`) — `costKopecks integer`, `stockMarketplace`, `stockOwn`, уник-индекс `unit_products_tenant_mp_article_idx` по **nullable** `article` (ловушка NULL-уникальности Postgres — в новых таблицах не повторяем).
- `src/lib/marketplaces/ozon/upsert.ts:104-110` — синк **обновляет** `stock_marketplace`/`stock_own` (это FBO/FBS-остатки Ozon, а НЕ наш склад — имя колонки врёт) и **не трогает** `cost_kopecks`. Значит: писать назад можно только себестоимость, количества — территория синка.
- `unit-ozon-analytics-queries.ts:281,331,340` и `api/marketplaces/analytics/ozon/route.ts:432,522` — `totalStockValueKopecks = cost_kopecks × (stock_marketplace + stock_own)`. После writeback эта метрика становится «деньги в товаре **на складах Ozon**» — корректной, но неполной. Разбор в §6.1.
- Миграции: последняя — `0012_ozon_fbs_stocks`, init — `17-ozon-fbs-stocks.sql`. Наши: **`0013_stock`** + **`drizzle/init/18-stock.sql`**.
- Тест-раннера нет — 40+ standalone `scripts/test-*.ts`. Конвенция соблюдена.
- `PAGE_LABELS` дублируется в 4 файлах (`api/blocks/sources`, `api/blocks/relations`, `api/unit-economics/import/table-source`, `lib/ai/page-labels`) + `components/blocks/cross-page-pin.tsx` — новую страницу регистрировать во всех.
- Фоновой очереди нет; `sync/full.ts` — последовательный цикл в web-процессе. **Ни один код склада не встраивается в `runFullSync`.**

---

## 1. Инварианты модуля (нарушение = баг, проверяется тестом/ревью)

1. **Единственный источник правды по подконтрольным местам — `stock_moves`.** Любой остаток = `SUM(qty_delta)`, любая стоимость = `SUM(value_delta_kopecks)`.
2. **Остатки на складах Ozon мы НЕ ведём.** Их отдаёт `ozon_warehouse_stocks`. Продажи на Ozon **не порождают движений** (v1).
3. **Ни одной операции без документа.** `adjust`, `writeoff`, `transfer`, `regrade` — тоже документы со строками.
4. **Физического удаления проведённого нет.** Только `void` → сторно-движения. `DELETE` разрешён лишь для `draft` (у него нет движений).
5. **Деньги — копейки, `bigint` везде.** Стоимость хранится **суммой** (`value_kopecks`), не ценой за штуку; цена за штуку — производная.
6. **Списание = доля от остаточной стоимости пула**, не `qty × unit_cost`. При полном исчерпании пула забирается остаток целиком (нулевой дрейф).
7. **`tenantId` только из сессии** (`requireTenantRoute()`), в каждой таблице `tenant_id NOT NULL`.
8. **Потери ≠ COGS.** `writeoff`/`mp_shortage` идут отдельной статьёй, не в себестоимость проданного.
9. **Никакого кода склада внутри `runFullSync`.**
10. **Молчаливого нуля не бывает.** Продажа без сшивки или без себестоимости попадает в карантин с суммой выручки, а не считается «COGS = 0».

---

## 2. Схема БД

Файлы: `src/lib/db/schema/stock.ts` (справочники) и `src/lib/db/schema/stock-ledger.ts` (документы и лента) → экспорт в `schema/index.ts` → `drizzle/init/18-stock.sql` → `pnpm db:generate` → миграция `0013_stock` (**команды миграции даёт пользователь, автоматически не запускаем**).

Общие правила: `id uuid defaultRandom pk`; `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`; таймстемпы `timestamp({ withTimezone: true })` (конвенция `workspaces.ts`); даты документов — `date`; деньги — `bigint({mode:'number'})`. **`workspace_id` не добавляется ни в одну таблицу** (см. Вопрос 1).

### 2.1 `stock_places` — места хранения (включая виртуальные)

| колонка | тип | примечание |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid NN FK tenants cascade | |
| `code` | varchar(40) NN | `own`, `transit_ozon`, `ozon_fbo`, `ozon_fbs`, `site_shopb`, `wb`, `yandex`, `loss` |
| `name` | varchar(200) NN | |
| `kind` | varchar(16) NN | `own` \| `transit` \| `marketplace` \| `site` \| `virtual` |
| `authority` | varchar(10) NN default `'ledger'` | **`ledger`** — остаток из журнала; **`external`** — остаток из API маркетплейса, журнальных строк не бывает |
| `account_id` | uuid FK marketplace_accounts set null | |
| `external_source` | varchar(8) | `'FBO'`/`'FBS'` — те же значения, что `ozon_warehouse_stocks.source` |
| `cluster_id` | varchar(50) | |
| `is_active` | boolean NN default true | |
| `sort_order` | integer NN default 0 | |
| `created_at` / `updated_at` | timestamptz NN | |

Индексы: `uniqueIndex stock_places_tenant_code_idx (tenant_id, code)`; `index stock_places_tenant_kind_idx (tenant_id, kind)`.

Встроенные места сидятся при первом входе в раздел из `src/lib/stock/places.ts`; места Ozon автосоздаются одной кнопкой из `DISTINCT (warehouse_name, source, cluster_id)` в `ozon_warehouse_stocks`.

### 2.2 `stock_items` — каноническая номенклатура (закрывает F1 + E1)

| колонка | тип | примечание |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid NN | |
| `user_id` | uuid NN FK users cascade | конвенция всех tenant-таблиц проекта |
| `sku` | varchar(80) NN | внутренний артикул |
| `name` | varchar(500) NN default `''` | |
| `brand` | varchar(120) | **сквозное измерение (E1)** |
| `category` | varchar(160) | |
| `unit` | varchar(16) NN default `'шт'` | |
| `barcode` | varchar(200) | |
| `expiry_control` | boolean NN default true | БАДы — да |
| `shelf_life_days` | integer | |
| `qty_pool` | integer NN default 0 | **кэш** реплея: штук в journaled-местах |
| `value_pool_kopecks` | bigint NN default 0 | **кэш**: стоимость пула |
| `avg_cost_kopecks` | bigint NN default 0 | **кэш**: `round(value_pool/qty_pool)`, «липкая» при нулевом пуле |
| `last_cost_kopecks` | bigint NN default 0 | цена последней закупки (для «цена выросла на X%») |
| `cost_override_kopecks` | bigint | ручной override; если NOT NULL — наружу отдаётся он |
| `cost_updated_at` | timestamptz | |
| `min_qty` | integer NN default 0 | порог «пора закупать» |
| `is_active` | boolean NN default true | |
| `note` | text | |
| `created_at` / `updated_at` | timestamptz NN | |

Индексы: `uniqueIndex stock_items_tenant_sku_idx (tenant_id, sku)`; `index stock_items_tenant_active_idx (tenant_id, is_active)`; `index stock_items_tenant_brand_idx (tenant_id, brand)`; `index stock_items_tenant_barcode_idx (tenant_id, barcode)`.

> `qty_pool`/`value_pool_kopecks`/`avg_cost_kopecks` — **кэш**, правда всегда в `stock_moves`. `scripts/test-stock-costing.ts` проверяет совпадение.

### 2.3 `stock_item_links` — сшивка каналов (**блокер релиза, без неё нельзя**)

| колонка | тип | примечание |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid NN | |
| `item_id` | uuid NN FK stock_items cascade | |
| `channel` | varchar(16) NN | `ozon` \| `wb` \| `yandex` \| `site` |
| `scope_key` | varchar(64) NN | `account_id::text` для маркетплейсов, `shopb`/`shopa` для сайтов, `'-'` если нет. **NOT NULL сознательно** — nullable-колонка в уникальном индексе Postgres пропускает дубли (ровно дефект существующего `unit_products_tenant_mp_article_idx`) |
| `external_id` | varchar(200) NN | `offer_id` / `nmId` / `shopSku` / `Product.sku` сайта |
| `external_sku` | varchar(200) | числовой `sku` Ozon как второй ключ |
| `qty_per_unit` | integer NN default 1 | **карточка «3 банки» = 3 базовые единицы.** Без этого остатки и COGS едут кратно |
| `unit_product_id` | uuid FK unit_products set null | мост к юнитке |
| `account_id` | uuid FK marketplace_accounts set null | |
| `match_source` | varchar(16) NN default `'manual'` | `manual` \| `barcode` \| `name` \| `sku` |
| `match_confidence` | integer NN default 100 | 0–100 |
| `created_at` / `updated_at` | timestamptz NN | |

Индексы: `uniqueIndex stock_links_uniq_idx (tenant_id, channel, scope_key, external_id)`; `index stock_links_item_idx (tenant_id, item_id)`; `index stock_links_up_idx (unit_product_id)`; `index stock_links_extsku_idx (tenant_id, channel, external_sku)`.

### 2.4 `stock_docs` — шапка любой операции

| колонка | тип | примечание |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid NN | |
| `user_id` | uuid NN FK users cascade | |
| `kind` | varchar(16) NN | `opening` \| `purchase` \| `transfer` \| `accept` \| `writeoff` \| `adjust` \| `return_in` \| `regrade` |
| `status` | varchar(8) NN default `'draft'` | `draft` \| `posted` \| `void` |
| `number` | varchar(40) | человекочитаемый, `ПОСТ-2026-0001`, генерится сервером |
| `doc_date` | date NN | **дата хозоперации — единственное обязательное поле формы** |
| `posted_at` / `voided_at` | timestamptz | |
| `from_place_id` / `to_place_id` | uuid FK stock_places set null | |
| `supplier` | varchar(200) NN default `''` | текстом + автокомплит `SELECT DISTINCT`; справочника в v1 нет |
| `supplier_inn` | varchar(12) | задел под нормализацию без миграции данных |
| `doc_number` | varchar(80) | номер накладной поставщика |
| `currency` | varchar(3) NN default `'RUB'` | |
| `fx_rate` | numeric(18,6) | согласовано с `currency_rates.rate_rub` |
| `amount_orig_minor` | bigint NN default 0 | сумма в валюте документа |
| `price_includes_vat` | boolean NN default true | |
| `extra_cost_kopecks` | bigint NN default 0 | доставка/пошлина/сертификация одной суммой |
| `extra_alloc` | varchar(10) NN default `'by_value'` | `by_value` \| `by_qty` \| `none` |
| `total_kopecks` | bigint NN default 0 | кэш; **обязан биться с Σ строк** |
| `vat_total_kopecks` | bigint NN default 0 | |
| `payment_status` | varchar(8) NN default `'paid'` | `paid`\|`unpaid`\|`partial` — задел под платёжный календарь D3 |
| `reason` | varchar(24) | `expired`\|`damaged`\|`lost`\|`sample`\|`mp_shortage`\|`recount` |
| `reverses_doc_id` | uuid | сторно ссылается на оригинал |
| `source` | varchar(32) NN default `'manual'` | `manual`\|`import`\|`inbox`\|`site:shopb`\|… |
| `source_ref` | varchar(200) | ключ идемпотентности внешних импортов |
| `comment` | text | |
| `attachments` | jsonb NN default `'[]'` | |
| `created_at` / `updated_at` | timestamptz NN | |

Индексы: `index stock_docs_tenant_date_idx (tenant_id, doc_date)`; `index stock_docs_tenant_kind_status_idx (tenant_id, kind, status)`; `uniqueIndex stock_docs_number_idx (tenant_id, number)` `.where(number is not null)`; `uniqueIndex stock_docs_source_idx (tenant_id, source, source_ref)` `.where(source_ref is not null)`.

### 2.5 `stock_doc_lines` — строки документа (то, что ввёл человек)

| колонка | тип | примечание |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid NN | |
| `doc_id` | uuid NN FK stock_docs **cascade** | |
| `line_no` | integer NN | |
| `item_id` | uuid NN FK stock_items **restrict** | |
| `direction` | varchar(3) NN | `in` \| `out` — позволяет `regrade` держать обе стороны в одном документе |
| `qty` | integer NN | всегда положительное |
| `unit_price_kopecks` | bigint NN default 0 | цена как в накладной |
| `vat_rate_bp` | integer NN default 0 | базисные пункты: 500 = 5 % |
| `vat_kopecks` | bigint NN default 0 | |
| `extra_alloc_kopecks` | bigint NN default 0 | доля доп. расходов (проставляется при проводке) |
| `value_kopecks` | bigint NN default 0 | **итоговая сумма строки** (landed). У расходных строк заполняет движок |
| `batch_number` | varchar(64) | номер партии производителя |
| `expires_at` | date | |
| `is_estimated` | boolean NN default false | «цена по памяти» — тянется в партию и в отчёты |
| `counted_qty` | integer | только для `adjust`: введённый факт |
| `comment` | text | |

Индексы: `uniqueIndex stock_lines_doc_no_idx (doc_id, line_no)`; `index stock_lines_tenant_item_idx (tenant_id, item_id)`.

### 2.6 `stock_batches` — партии (цена, поставщик, срок годности; FIFO-ready)

| колонка | тип | примечание |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid NN | |
| `item_id` | uuid NN FK stock_items restrict | |
| `doc_id` / `line_id` | uuid FK … set null | приходный документ |
| `lot_no` | varchar(40) | наш, `LOT-2026-0001` |
| `batch_number` | varchar(64) | производителя |
| `supplier` | varchar(200) NN default `''` | |
| `received_at` | date NN | порядок FIFO/срок хранения |
| `expires_at` | date | |
| `qty_in` | integer NN | |
| `qty_left` | integer NN | уменьшается FIFO/FEFO — **для сроков годности и истории, не для оценки** (v1) |
| `unit_cost_kopecks` | bigint NN default 0 | `round(value_in/qty_in)` — витринное |
| `value_in_kopecks` | bigint NN default 0 | **точная landed-сумма партии** |
| `vat_kopecks` | bigint NN default 0 | |
| `is_estimated` | boolean NN default false | |
| `closed_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz NN | |

Индексы: `index stock_batches_fifo_idx (tenant_id, item_id, received_at, id)` `.where(qty_left > 0)`; `index stock_batches_expiry_idx (tenant_id, expires_at)` `.where(qty_left > 0)`; `index stock_batches_doc_idx (doc_id)`.

### 2.7 `stock_moves` — неизменяемая лента (сердце модуля)

| колонка | тип | примечание |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid NN | |
| `seq` | bigint generated always as identity | детерминированный порядок проводки |
| `doc_id` | uuid NN FK stock_docs **cascade** | движений без документа не бывает |
| `line_id` | uuid FK stock_doc_lines cascade | |
| `item_id` | uuid NN FK stock_items restrict | |
| `place_id` | uuid NN FK stock_places restrict | место, чей остаток меняется (**всегда `authority='ledger'`**) |
| `counter_place_id` | uuid FK stock_places set null | вторая сторона перемещения (может быть `external`) |
| `qty_delta` | integer NN | знаковое |
| `value_delta_kopecks` | bigint NN | знаковое |
| `unit_value_kopecks` | bigint NN default 0 | снимок себестоимости на момент проводки |
| `kind` | varchar(16) NN | денормализация `stock_docs.kind` ради отчётов |
| `reason` | varchar(24) | |
| `doc_date` | date NN | денормализация |
| `lot_alloc` | jsonb NN default `'[]'` | `[{batchId, qty}]` — из каких партий ушло (вместо 10-й таблицы) |
| `reverses_move_id` | uuid | сторно |
| `created_at` | timestamptz NN | |

Индексы: `index stock_moves_item_date_idx (tenant_id, item_id, doc_date, seq)`; `index stock_moves_place_idx (tenant_id, place_id)`; `index stock_moves_doc_idx (doc_id)`; `index stock_moves_kind_date_idx (tenant_id, kind, doc_date)`.

**`UPDATE`/`DELETE` по этой таблице запрещены в `src/lib/stock/queries.ts`** — единственное исключение — `recalcFrom()` (см. §4.7), который переписывает только `value_delta_kopecks`/`unit_value_kopecks`/`lot_alloc` и логирует факт пересчёта.

### 2.8 `stock_settings` — одна строка на tenant

`id`, `tenant_id` (**uniqueIndex**), `costing_mode varchar(8) NN default 'avg'` (`avg`\|`fifo`), `lot_policy varchar(6) NN default 'fefo'` (`fifo`\|`fefo` — порядок списания штук из партий), `cost_basis varchar(5) NN default 'gross'` (`net`\|`gross` — включать ли НДС в себестоимость), `ledger_start_date date`, `locked_through date`, `allow_negative boolean NN default true`, `number_prefixes jsonb`, `updated_at timestamptz NN`.

### 2.9 `stock_recon` — сверка с маркетплейсом (создаётся в 0013, наполняется в Релизе 2)

`id`, `tenant_id`, `account_id`, `place_id`, `item_id`, `snapshot_at timestamptz NN`, `ledger_qty integer NN`, `external_qty integer NN`, `delta_qty integer NN`, `status varchar(10) NN default 'open'` (`open`\|`accepted`\|`ignored`), `resolved_doc_id uuid FK stock_docs set null`, `created_at`.
Индексы: `uniqueIndex stock_recon_uniq_idx (tenant_id, account_id, item_id, place_id, snapshot_at)`; `index stock_recon_open_idx (tenant_id, status)` `.where(status = 'open')`.

### 2.10 Правка существующей `unit_products` (2 колонки, ничего не ломает)

```
cost_source     varchar(16) NOT NULL DEFAULT 'manual'   -- 'manual' | 'inventory'
cost_updated_at timestamp
```
Связь идёт через `stock_item_links.unit_product_id` (many→one). **Дефолт `manual` не меняет поведение ни у кого**; переключение — пообъектно или пакетно с превью дельты (§6.1). Инвариант `upsert.ts:104-110` («синк владеет количествами, не трогает `cost_kopecks`») сохраняется; единственное исключение — writeback склада при `cost_source='inventory'`.

---

## 3. Места хранения и кто их авторитет

| код | kind | authority | остаток берётся из |
|---|---|---|---|
| `own` | own | **ledger** | журнал |
| `transit_ozon` | transit | **ledger** | журнал (отгружено, ещё не принято) |
| `ozon_fbo` | marketplace | **external** | `ozon_warehouse_stocks` (`source='FBO'`), разрез по кластерам |
| `ozon_fbs` | marketplace | **external** | `ozon_warehouse_stocks` (`source='FBS'`) |
| `site_shopb`, `site_shopa` | site | **ledger** | журнал (если отгрузка физически со своего склада — см. Вопрос 5) |
| `wb`, `yandex` | marketplace | external/ledger | по ответу на Вопрос 4 |
| `loss` | virtual | ledger | приёмник списаний/потерь |

**Правило:** `stock_moves.place_id` всегда указывает на место с `authority='ledger'`. Перемещение `own → ozon_fbo` — это ОДНА расходная строка на `own` с `counter_place_id = ozon_fbo`; положительной строки на стороне Ozon не бывает никогда. Это и есть структурное решение проблемы «Ozon двигает товар без нашего ведома»: расходиться нечему.

---

## 4. Модель себестоимости

### 4.1 Выбор
**v1 — скользящая средневзвешенная по пулу товара; партии хранятся физически.** `stock_settings.costing_mode='fifo'` включается в Релизе 4 как **вторая функция реплея над тем же журналом** — миграции данных не потребуется. Обоснование выбора (секундный ввод, замыкание возвратов, детерминированный ввод задним числом) принято от `pragmatic`; арифметика взята от `canonical`.

### 4.2 Пул и арифметика (`src/lib/stock/costing.ts` — чистый модуль, БЕЗ импорта db)

Состояние на товар: `Q` (штук в ledger-местах), `V` (стоимость, копейки).

```
приход (q, v):     Q += q;  V += v
расход q:
   если Q > 0:  value_out = (q >= Q) ? V : round(V * q / Q)     ← доля от ОСТАТОЧНОЙ стоимости
   иначе:       value_out = q * avg_cost_kopecks                 ← пул пуст, берём «липкую» среднюю
   Q -= q;  V -= value_out;  если Q <= 0 → V = 0
avg_cost_kopecks = Q > 0 ? round(V / Q) : (прежнее значение, «липкое»)
```

**Почему не `qty × unit_cost`:** при дроблении партий это систематически теряет/создаёт копейки, и «Деньги в товаре» перестают биться с суммой поставок. Доля от остаточной стоимости с точным забором остатка при исчерпании даёт нулевой дрейф.

**Разнесение `extra_cost_kopecks` по строкам — метод наибольших остатков**, не `round()` по каждой строке: `Σ alloc == extra_cost` ровно, остаток кидается в строку с наибольшей дробной частью. `value_kopecks` строки = `qty × unit_price + alloc` (+ `vat_kopecks`, если `cost_basis='gross'`).

**Партии** параллельно уменьшают `qty_left` по `lot_policy` (FEFO по умолчанию — у БАДов это физика), результат пишется в `stock_moves.lot_alloc`. В режиме `avg` партия — носитель **штук, срока и истории цен**; оценка живёт на уровне пула. Инвариант: `Σ batches.qty_left == Q`.

### 4.3 Возвраты
Каждое расходное движение хранит `unit_value_kopecks`. Возврат на свой склад — документ `return_in`, строка ссылается на исходное движение → приходуется **ровно списанная стоимость**, партия та же (`qty_left` восстанавливается). Возврат без идентифицируемого источника — по текущей средней с `is_estimated=true`. Возврат на Ozon FBO журнал не трогает: в P&L сторнируется расчётный COGS.

### 4.4 Списания
`writeoff` с `reason` (`expired`/`damaged`/`lost`/`sample`) — расход по средней, стоимость уходит в место `loss`. **Отдельная статья потерь, НЕ COGS** — инвариант, зафиксированный в контракте с будущим P&L (D1). Иначе валовая маржа врёт в обе стороны.

### 4.5 Пересортица (`regrade`) — то, чего не было ни в одном предложении
Один документ, минимум две строки: `direction='out'` по товару A на N штук и `direction='in'` по товару B на N штук. Приходная строка получает **ровно ту стоимость, что списана** с A (`Σ value_delta по документу == 0`), поэтому пересорт не создаёт и не съедает прибыль. Обе стороны связаны `doc_id` — через год видно, что это была одна операция.

### 4.6 Инвентаризация (`adjust`)
Строка содержит `counted_qty`. Излишек — приход по **текущей средней** (среднюю не искажает), недостача — расход по средней. Проводится только по тем строкам, где факт разошёлся с расчётом.

### 4.7 Ввод задним числом и блокировка периода
- Проводка с `doc_date <= stock_settings.locked_through` → **403** с явным текстом «период закрыт по DD.MM.YYYY, введите корректирующим документом текущей датой».
- Проводка задним числом внутри открытого периода → `recalcFrom(item_ids, date)`: детерминированный реплей по `(doc_date, seq)`, переписываются снимки стоимости у последующих движений. **UI обязан предупредить диалогом**: «Себестоимость и прибыль с DD.MM.YYYY будут пересчитаны» — иначе пользователь решит, что система переписала прошлое.
- `allow_negative=true` по умолчанию (иначе забытая поставка блокирует ввод); отрицательный пул подсвечивается в блоке «Пробелы».

### 4.8 Инварианты, вынесенные в `scripts/test-stock-costing.ts`
1. `Σ moves.qty_delta == stock_items.qty_pool`; `Σ moves.value_delta == value_pool_kopecks`.
2. `qty_pool == 0 ⇒ value_pool_kopecks == 0`.
3. `Σ doc_lines.value_kopecks == docs.total_kopecks`; `Σ extra_alloc == extra_cost_kopecks`.
4. `Σ batches.qty_left == qty_pool`; закрытая партия ⇒ `qty_left = 0`.
5. Возврат восстанавливает ровно списанную сумму.
6. `regrade`: `Σ value_delta по документу == 0`.
7. Повторный реплей даёт побайтово те же значения (детерминизм).
8. Сторно `void`: `Σ value_delta оригинала + сторно == 0`.
9. Идемпотентность импорта по `(source, source_ref)`.

---

## 5. Сценарии

**Новая поставка (30–60 сек).** «Поставки» → «Новая» → дата (предзаполнена) + поставщик (свободный текст с автокомплитом) + строки (комбобокс номенклатуры, кол-во, цена в рублях ×100 на входе, Enter → следующая) + «доставка, ₽» с переключателем разнесения. Сохранение = одна транзакция: `stock_docs` + строки + партии + движения `in` на `own` → `recalc(items)` → writeback в `unit_products`.

**Отгрузка на Ozon.** Быстрый ввод → «Отгрузка»: строки (товар, кол-во) → `transfer` `own → transit_ozon`. Свой склад уменьшается сразу.

**Приёмка Ozon.** Блок остатков подсказывает по росту `free_to_sell_amount`; кнопка «Принять» → документ `accept` `transit_ozon → ozon_fbo` с полем «принято фактически». Разница между отгруженным и принятым проводится строкой `writeoff` `reason='mp_shortage'` в место `loss`. **Через год видно суммой, сколько товара съел маркетплейс** — отдельная статья P&L, а не растворённая в средней.

**Продажа на Ozon.** Движений НЕТ. COGS за период = `Σ ozon_realization.qty × qty_per_unit × costAt(item, дата периода)`. Работает даже для периодов, когда склад ещё не вёлся (тогда честно 0 и позиция попадает в карантин).

**Продажа с сайта.** Релиз 1 — движений нет, свой склад выравнивается инвентаризацией. Релиз 3 — ночной pull `GET /api/export/orders?since=` под API-ключом (шифруется тем же `src/lib/inbox/crypto.ts`), документ `writeoff`-типа `out` с `source_ref='site:shopb:order:42'` → повторный pull идемпотентен.

**Инвентаризация.** Блок остатков → режим «Факт» → вводится только там, где разошлось → «Провести».

**Списание просрочки.** Блок «Сроки годности» → светофор по `expires_at` → «Списать» → `writeoff` `reason='expired'`.

---

## 6. Интеграция с существующим кодом

### 6.1 `unit_products` — главный рычаг, и ловушка `stock_own`

**Что пишем назад:** только `cost_kopecks` (+`cost_source`, `cost_updated_at`) при `cost_source='inventory'` по всем `unit_products`, связанным через `stock_item_links`. Значение = `cost_override_kopecks ?? avg_cost_kopecks`, умноженное на `qty_per_unit` (себестоимость карточки-набора = 3 × себестоимость банки).

**Что НЕ пишем назад — и это важно:** `stock_marketplace`/`stock_own`. Проверено (`upsert.ts:104-110`): их владеет синк, и это остатки **FBO и FBS Ozon**, а не наш склад (имя `stock_own` вводит в заблуждение). Следствие: после writeback `totalStockValueKopecks` в `unit-ozon-analytics-queries.ts:340` и `analytics/ozon/route.ts:522` становится корректной метрикой **«деньги в товаре на складах Ozon»**. Требуется ровно одно изменение — **переименовать подпись** метрики на «Деньги в товаре (Ozon)». Полная капитализация (свой склад + в пути + Ozon + сайты) публикуется новым блоком `stock.balances`. Так мы не создаём гибрид «свежая цена × чужое количество» и не переписываем 9 файлов-потребителей.

**Оживает без единой правки:** `unit-ozon-analytics-queries.ts:281`, `api/marketplaces/analytics/ozon/route.ts:432`, блок «Мой магазин», `ozon-product-picker-dialog.tsx`, `ozon-sync-diff.ts`, ABC-блок, `unit-ozon-ai-insights-types.ts`, оба калькулятора.

**Массовое переключение — обязательная часть Релиза 1.** Диалог «Перевести себестоимость на склад»: таблица «товар / было ₽ / станет ₽ / Δ%», чекбоксы, «Применить». Без него дефолт `manual` означает, что после всей работы аналитика продолжит показывать старые ручные цифры и рычаг не сработает.

### 6.2 `ozon_warehouse_stocks`
Не дублируем. Блок остатков строит UNION: журнал по `authority='ledger'` + агрегат `ozon_warehouse_stocks` по `source`/кластеру. Ключ сшивки: `offer_id → stock_item_links(channel='ozon', scope_key=accountId, external_id) → item_id`, fallback по `external_sku`, затем `stock_items.sku`. Несопоставленное — отдельная группа с кнопкой привязки. Оттуда же автосоздание мест и (Релиз 2) наполнение `stock_recon`.

### 6.3 `ozon_realization` — закрытие разрыва Этапа D
Таблица синкается и не читается ни одним блоком. Модуль даёт ей вторую половину: выручка/комиссии оттуда, COGS — из `costAt()`. Это и есть недостающий вход для D1 (ОПиУ), и ради него ничего дополнительно писать не нужно.

### 6.4 Синк
**Ни строки кода склада в `runFullSync`.** Сверка (`stock_recon`) — отдельный роут `/api/stock/recon/refresh`, вызывается кнопкой и (позже) кроном. Причина проверена: очереди нет, `sync/full.ts` — последовательный цикл в web-процессе с потолком 300 с, на Pi это блокер (ROADMAP Этап G).

### 6.5 Сайты, WB, Яндекс
Каналы заводятся в `stock_item_links` сразу; продажи до появления коннекторов вводятся импортом CSV/XLSX (механизм `sheet-import.ts` + `unit_imports` как образец). Префикс `store_*` **не занимаем** — он зарезервирован ROADMAP F2 под коннектор сайтов; наш префикс `stock_*`.

### 6.6 AI Tools Layer
Только через инструменты (`of-new-ai-tool`): `stock_query_balances`, `stock_explain_cost` (read) и `stock_create_supply_draft` — **создаёт только `draft`, AI не проводит документы**. Плюс `src/lib/ai/prompts/block-skills/stock.ts` для «AI Анализ блока».

---

## 7. Блоки BlockGrid и страница

Новый раздел **«Склад»**, страница `/app/warehouse`, `pageKey='warehouse'`. Раскладка per-workspace бесплатно через `block_layouts.workspace_id`.

| # | тип | релиз | что делает |
|---|---|---|---|
| 1 | `stock.balances` | **R1** | Главный экран. Строка = товар; колонки: Свой склад · В пути · Ozon FBO · Ozon FBS · Сайты · ИТОГО · Себестоимость · Стоимость остатка · Дней запаса. Группировка по бренду/категории. Режим «Инвентаризация» превращает «Свой склад» в редактируемую «Факт». Группа «Не сопоставлено» с кнопкой привязки. Публикует `stockValueKopecks` (`__money`) |
| 2 | `stock.docs` | **R1** | Журнал документов с фильтрами (тип/статус/период) + диалог создания/проводки + `void` через `AlertDialog`. Публикует `purchasesKopecks` за период (`usesPeriod: true`) |
| 3 | `stock.quick-entry` | **R2** | 4 кнопки: Приход · Отгрузка · Списание · Инвентаризация. Формы из 2–3 полей |
| 4 | `stock.cost` | **R2** | Себестоимость и партии: средняя, цена последней закупки, Δ%, число открытых партий, `is_estimated`-бейдж, переключатель `cost_source` на строку + массовое переключение |
| 5 | `stock.expiry` | **R2** | Партии с истекающим сроком, светофор, кнопка «Списать». Для БАДов — самый дешёвый способ окупить модуль |
| 6 | `stock.gaps` | **R2** | Единый карантин: несопоставленные позиции · **продажи без себестоимости за период с суммой выручки** · расхождения `stock_recon` · отрицательные остатки |
| 7 | `stock.supply-plan` | **R3** | Сколько и куда везти (закрывает E5) |

Отдельных KPI-блоков нет: значения публикуются через `useBlockValuePublisher` с маркером `__money`, «Деньги в товаре» / «Закуплено за месяц» / «Списано» пользователь собирает существующими `kpi.grid` / `excel.cell` / `computed.sum`.

**Чек-лист регистрации каждого блока** (`of-new-block`): catalog-файл → `registry.ts` (`ALL_BLOCKS` + `BLOCK_META` с `iconName`/`tags`/`recommendedFor`/`usesPeriod`/`skeletonVariant`) → `TYPE_LABELS` в `src/app/api/blocks/sources/route.ts:102` (категория «Склад», добавить в `CATEGORY_ORDER`) → `PAGE_LABELS` **в четырёх местах** (`api/blocks/sources:88`, `api/blocks/relations:22`, `api/unit-economics/import/table-source:22`, `lib/ai/page-labels:5`) + `components/blocks/cross-page-pin.tsx:11` → `DEFAULT_LAYOUTS['warehouse']` в `src/lib/blocks/default-layouts.ts` → пункт nav → block-skill промпт. Иконки: `Warehouse`, `ClipboardList`, `PackagePlus`, `Scale`, `CalendarClock`, `AlertTriangle`, `Truck`.

Диалоги — только `Dialog`/`AlertDialog`; выпадающие — `DropdownSelect` из `src/components/blocks/settings/`; деньги вводятся в рублях, хранятся ×100.

---

## 8. План перехода пользователя с бумаги

| шаг | время | что происходит |
|---|---|---|
| **1. Номенклатура из Ozon** | 1 клик, 5 сек | `INSERT INTO stock_items` из `unit_products WHERE marketplace='ozon'` (sku←article, name, barcode) + автосоздание `stock_item_links` с `unit_product_id`. Ozon-каталог сшит без ручного ввода |
| **2. Места** | 1 клик | Автосоздание `stock_places` из `DISTINCT (warehouse_name, source, cluster_id)` в `ozon_warehouse_stocks` + `own`, `transit_ozon`, `loss` |
| **3. Экран сопоставления (79 товаров сайтов)** | 30–40 мин, **разово** | На сайте один SQL выгружает `sku,name` в TSV → paste в диалог. Двухколоночный UI с автоподбором по цепочке **штрихкод → нормализованное имя → дозировка/число капсул**, с `match_source`/`match_confidence`. **Здесь же обязательный вопрос про `qty_per_unit`** для карточек-наборов — единственный момент, когда пользователь помнит, что «3 банки» это набор. Тут закрывается дыра «сшивки нет ни у одного из 79 товаров» — один раз |
| **4. Перенос бумаги** | 15–20 мин, разово | Документ `opening` на дату отсечки, режим Excel-таблицы с протяжкой (паттерн из `unit-my-store-table.tsx`). Количества по местам Ozon **предзаполняются фактом из API**. Строки с `qty=0` не сохраняются. Цену не помнят → галочка «оценочно» (`is_estimated`), а не выдуманное число. Товар без цены получает бейдж «нет себестоимости» — это рабочий to-do список |
| **5. Переключение себестоимости** | 2 мин | Диалог «было / станет / Δ%» → `cost_source='inventory'`. **Точка, после которой вся существующая аналитика показывает реальную маржу** |
| **6. Ежедневно** | 30–60 сек | Новая закупка вводится в момент приезда/оплаты. Бумага для закупок больше не нужна |
| **7. Еженедельно** | 5 мин | Инвентаризация своего склада — колонка «Факт» только там, где разошлось |

**Чего НЕ требуется:** менять что-либо на сайтах и в их SQLite, заполнять `ozonSku`/`wbSku` в Prisma (сшивка живёт у нас; выгрузку CSV для их полей отдаём по желанию), переносить исторические закупки — журнал начинается с даты отсечки, за прошлое P&L честно скажет «себестоимость неизвестна».

---

## 9. Поэтапный план реализации

### Релиз 1 — «бумага для закупок больше не нужна» (1 плотная сессия)
1. `src/lib/db/schema/stock.ts` + `stock-ledger.ts` → `schema/index.ts` → `drizzle/init/18-stock.sql` → `pnpm db:generate` (**`0013_stock`**) → команды миграции пользователю.
2. `src/lib/stock/costing.ts` — **чистый, без db-клиента** + `scripts/test-stock-costing.ts` с 9 инвариантами §4.8. **Пишется до всякого UI** — это единственное место, где можно ошибиться молча.
3. `src/lib/stock/places.ts` (сиды) · `links.ts` (автоподбор — тоже чистый, + `scripts/test-stock-matching.ts`) · `queries.ts` · `posting.ts` (`postDoc` / `voidDoc` / `recalcFrom` в одной транзакции) · `writeback.ts`.
4. Роуты `/api/stock/{items,links,docs,balances,settings}` — все через `requireTenantRoute()`, `tenantId` только из сессии, `DELETE` только для `draft`.
5. Блоки `stock.balances` + `stock.docs`, страница `/app/warehouse`, nav, `DEFAULT_LAYOUTS`.
6. Импорт номенклатуры из Ozon одной кнопкой + экран сопоставления + `opening`-документ.
7. Writeback + **диалог массового переключения с превью дельты**.
8. `of-verify` (`rm -rf .next` перед build — менялись экспорты каталога) → `of-review` → CHANGELOG/MEMORY → `of-deploy-pi`.

### Релиз 2 — операционка (≈1 сессия)
`transfer`/`accept`/`writeoff`/`adjust`/`regrade` + блоки `quick-entry`, `cost`, `expiry`, `gaps` + наполнение `stock_recon` отдельным роутом + блокировка периода в UI.

### Релиз 3 — каналы
Read-only эндпоинты сайтов + идемпотентный pull → движения; импорт продаж WB/ЯМ из CSV; consumption-движения из `ozon_realization` (не из `ozon_orders` — там ключ `posting_number` дробится на частичные отгрузки, а realization имеет естественный ключ `(account, period, sku)`); блок `supply-plan` (E5).

### Релиз 4 — точность и автоматизация
`costing_mode='fifo'` как вторая функция реплея (миграция данных не нужна); OCR накладной из inbox → `draft` поставки; P&L (D1) поверх готовой себестоимости; AI-tools.

---

## 10. Что сознательно НЕ делаем в v1 и остаточные риски

**Не делаем:** собственный расчётный остаток на складах Ozon (структурно исключено, а не «сверяем каждый день»); автогенерацию отгрузок из `ozon_orders`; справочник поставщиков (текст + `supplier_inn` задел); резервы под неотгруженные заказы; комплекты/переупаковку (`assembly`) — зависит от Вопроса 3; мультивалютный расчёт (поля есть, логика позже); дробные количества (`qty integer`, штуки).

**Остаточные риски, принятые осознанно:**
1. Средняя сглаживает маржу при скачке закупочной цены — снимается переключателем `costing_mode='fifo'` без миграции данных.
2. Товар на складах Ozon оценивается по **текущей** средней, а не по средней на момент отгрузки. Снимок в `stock_moves.unit_value_kopecks` есть — точный режим доступен в Релизе 4.
3. Между еженедельными инвентаризациями остаток своего склада дрейфует на объём сайтовых/WB/ЯМ продаж. **Себестоимость от этого не страдает** (зависит только от приходов), деградирует только количество.
4. Пересчёт задним числом меняет исторический COGS — закрыт блокировкой периода и явным предупреждением, но не устранён.
5. 9 таблиц и ~6 роутов — новые места ошибиться с `tenant_id`. Обязательный review-gate `docs/TENANT_SCOPING.md` для `src/lib/stock/**` и `src/app/api/stock/**` до релиза. (`scripts/check-tenant-isolation.ts` — рантайм-канарейка по фиксированному набору таблиц, покрытия путей она не даёт.)
6. Ошибка `qty_per_unit` при сопоставлении портит остатки и COGS кратно — поэтому шаг 3 миграции требует явного подтверждения человеком, а автосоздание `stock_items` из канала запрещено.

---

## 11. ВОПРОСЫ К ПОЛЬЗОВАТЕЛЮ — ответить ДО первой миграции

1. **Склад общий или на кабинет?** Проектируем tenant-scoped (склад физически один, `workspace_id` нет ни в одной таблице). Если кабинеты используются/будут использоваться как **разные бизнесы или юрлица** — нужно решить сейчас: добавить `workspace_id` после накопления данных = миграция с бэкфиллом.

2. **НДС.** УСН с НДС 5 % с 2026 или без НДС? И себестоимость хранить **с НДС** (`cost_basis='gross'`) или **без** (`net`)? Колонки `vat_rate_bp`/`vat_kopecks` заводим в любом случае, но базис определяет, какие числа лягут в партии — ретроспективно расщепить исторические партии на netto/brutto невозможно.

3. **Наборы и переупаковка.** Есть ли на Ozon/сайтах карточки-комплекты («3 банки», оптовые фасовки) — и разбираете ли вы физически большую упаковку на мелкие? Первое закрывается полем `qty_per_unit` (уже в схеме), второе требует документа `assembly` — решаем, входит ли он в Релиз 2.

4. **Wildberries и Яндекс.Маркет.** Активны сейчас, и надо ли учитывать их продажи с первого дня (хотя бы импортом CSV)? Если продажи есть, а движений нет — остаток своего склада будет систематически завышен, и план поставок занижен.

5. **Сайты.** Заказы с `shopb.example`/`shopa.example` отгружаются физически с того же склада, что и поставки на Ozon? И есть ли сетевой путь Pi ↔ Beget (белый IP / туннель) — от этого зависит, идём ли мы в Релизе 3 на автосписание по эндпоинту или остаёмся на еженедельной инвентаризации.

6. **Дата отсечки и цены остатков.** С какой даты начинаем журнал, и известны ли закупочные цены по товарам, которые сейчас лежат на складах? Неизвестные пойдут как `is_estimated` и будут помечены во всех отчётах — нужно понимать, какая доля позиций окажется оценочной в первые месяцы.

*(Не блокирует, но зафиксируйте на будущее: валютные/импортные закупки — поля `currency`/`fx_rate`/`amount_orig_minor` заводим сразу, расчёт включим, когда появятся реальные импортные поставки.)*

---

## 12. ОТВЕТЫ ПОЛЬЗОВАТЕЛЯ (2026-08-13) — обязательны к исполнению

1. **Склад — ОДИН общий на весь бизнес.** `workspace_id` не добавляется ни в одну таблицу модуля; скоуп — `tenant_id` (+ `user_id` по конвенции проекта). Кабинеты остаются разными взглядами на один и тот же склад.

2. **НДС — ДВА РЕЖИМА, переключаемых.** По умолчанию — `gross` (себестоимость с НДС, сумма из накладной как есть). Второй режим — `net` — включается, когда сменится налоговый режим.
   **Следствие для схемы (уточнение против §2):** `cost_basis` хранится **на документе поступления и в партии**, а НЕ только в глобальных настройках. Глобальная настройка задаёт лишь значение по умолчанию для новых документов. Причина: ретроспективно расщепить партию на netto/brutto невозможно, поэтому переключение режима действует ТОЛЬКО ВПЕРЁД, а исторические партии остаются корректно интерпретируемыми (у каждой видно, в каком базисе она заведена).
   В отчётах, где смешиваются партии разных базисов, — явная пометка; при переключении режима в UI предупреждение «действует только для новых поступлений».

3. **Wildberries и Яндекс.Маркет учитываем С ПЕРВОГО ДНЯ** — минимум импортом файлов (продажи → расходные движения). Без этого остаток своего склада завышается, а план поставок занижается. Это поднимает импорт продаж WB/ЯМ из Релиза 3 в Релиз 2.

4. **Закупочные цены известны по большинству позиций** — стартовый документ `opening` вводится с реальными ценами; неизвестные помечаются `is_estimated` и подсвечиваются в отчётах до уточнения.

### Остаётся уточнить по ходу работы (не блокирует старт)

- Наборы/комплекты на Ozon и сайтах («3 банки», оптовые фасовки) и физическая переупаковка — первое закрывается `qty_per_unit` (в схеме есть), второе требует документа `assembly` (кандидат в Релиз 2).
- Отгружаются ли заказы сайтов с того же физического склада, что поставки на Ozon.
- Сетевой путь Pi ↔ Beget для автосписания по эндпоинту (сейчас Pi доступен только в локальной сети; при отсутствии пути Релиз 3 остаётся на импорте/инвентаризации).
- Дата отсечки, с которой начинаем вести журнал.
