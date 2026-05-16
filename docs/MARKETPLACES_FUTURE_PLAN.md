# MARKETPLACES_FUTURE_PLAN.md — мини-план развития интеграций (Ozon → WB → Я.Маркет)

> Этот документ — **roadmap-надстройка** над основным `PLAN.md` (Этап 6).
> Концентрируется конкретно на marketplace-интеграциях после v0.17.0 (где
> уже есть каркас Ozon Seller API + 7 стейджей синхронизации). Цель —
> зафиксировать «что делать дальше», «где смотреть изменения у Ozon»,
> и «где будет AI-документация».

## 0. Где мы сейчас (v0.17.0)

- ✅ Подключение Ozon-аккаунта через `/settings/integrations` (api_key AES-256-GCM).
- ✅ 7 стейджей синхронизации: products / prices / stocks / orders / realization / transactions / turnover.
- ✅ Тогглы «что синхронизировать», окна (orders/transactions), история job'ов.
- ✅ Plan-gate multi-store (Pro+).
- ✅ Кнопка «Загрузить из Ozon» в `unit.ozon-multi-table` и `unit.ozon-calculator` + product picker.
- ✅ Таблицы: `marketplace_accounts`, `ozon_sync_jobs`, `ozon_orders`, `ozon_realization`, `ozon_transactions`.
- ❌ Cron / авто-синхронизация (поля в схеме есть, BullMQ-воркер — TODO).
- ❌ Аналитические блоки на основе синхронизированных данных.
- ❌ WB / Я.Маркет коннекторы (схема мультимаркетная, нужен код).
- ❌ AI-документация `docs/MARKETPLACES_OZON.md`.

## 1. Приоритетный следующий блок — BullMQ cron для авто-синхронизации (Этап 6.1)

**Зачем:** пользователю должен достаточно один раз настроить тогглы и
расписание → плагин сам ходит за данными ежедневно/ежечасно.

**Что делать:**

1. Добавить `src/lib/queues/ozon-sync.ts` с `Queue('ozon-sync')` + `Worker` (BullMQ).
2. `src/workers/ozon-sync.ts` — entry-point воркера. Запуск через `pnpm worker:ozon-sync`.
3. В Worker'е: каждые 10 минут проходить по `marketplace_accounts`, где `sync_settings.autoSyncEnabled=true`, проверять cron-выражение, дёргать `runFullSync` если пора.
4. Добавить `marketplace_accounts.sync_settings.autoSyncNextRunAt` — для UI «следующая синхронизация через…».
5. Defaults для UI: cron `'0 6 * * *'` (06:00 МСК ежедневно).
6. Обновить UI `/settings/integrations`: убрать disclaimer «авто-синхронизация будет позже», показать `<Switch>` для `autoSyncEnabled`, `<Input>` для cron-expression с UI-builder'ом (preset'ы «каждый час», «каждые 6 часов», «ежедневно в 06:00»).
7. **Зависимость:** Redis уже в `docker-compose.yml`. BullMQ ещё не используется в проде — это первый воркер. Учесть в `docker-compose.yml` для prod-deploy (добавить service `worker-ozon`).

**Файлы:**
- Новые: `src/lib/queues/ozon-sync.ts`, `src/workers/ozon-sync.ts`, `src/lib/queues/index.ts` (общий queue registry).
- Изменения: `src/lib/marketplaces/queries.ts` (хелпер `findAccountsNeedingSync`), `src/app/(app)/settings/integrations/integrations-client.tsx` (UI расписания), `package.json` scripts (`worker:ozon-sync`), `docker-compose.yml`.

**Срок:** 1–2 недели.

## 2. Аналитические блоки на основе синхронизированных данных Ozon (Этап 6.2)

Все они читают из `unit_products` / `ozon_orders` / `ozon_realization` / `ozon_transactions` через tenant-scoped queries. Это **отдельная** работа по линии «Block-Grid catalog», не по линии «marketplace integrations».

### 2.1. `ozon.sales-by-sku` — продажи по SKU
- KPI: количество заказов, выручка, средний чек за период.
- Таблица: SKU × (заказы / выручка / возвраты / отмены) с фильтром по периоду (7/30/90 дней).
- Источник: агрегация `ozon_orders` по `account_id + status + period`.
- Связь: можно `@связать` SKU-строку как источник на другие блоки (`@блок.sku123.revenue`).
- **Приоритет:** высокий (это основной отчёт «как у меня дела»).

### 2.2. `ozon.commissions-vs-tariff` — план vs факт по комиссиям
- Сравнение комиссий из `ozon_realization` (факт) и из `unit_products.metadata.commissions` (план/тариф).
- Показывает аномалии: «у вас по тарифу 12.5%, а Ozon удержал 14.3% за период».
- Источник: JOIN `ozon_realization` × `unit_products`.
- **Приоритет:** средний (но это killer feature — никто из конкурентов не делает прозрачно).

### 2.3. `ozon.returns-heatmap` — карта возвратов
- Heatmap: SKU × (день недели / время дня), интенсивность = доля возвратов.
- Источник: `ozon_orders.scheme + status` (только `returned`/`cancelled`).
- **Приоритет:** низкий (cool-feature, но не critical).

### 2.4. `ozon.unit-economics-actual-vs-plan` — план vs факт по юнит-экономике
- Сравнивает результаты блока `unit.ozon-calculator` (план) и фактическую маржу из `ozon_realization`.
- Колонки: `plannedMargin`, `actualMargin`, `delta`, `deltaReason` (если можно автоматически назвать причину).
- Связь: блок принимает источник `@юнит-калькулятор` и автоматически достаёт фактику из БД.
- **Приоритет:** высокий (закрывает основной цикл «посчитал → продал → сверил»).

### 2.5. `ozon.cashflow-projection` — прогноз поступлений
- На основе `ozon_realization` и графика выплат Ozon (15-го и последнего числа): предсказать когда сколько денег придёт.
- Можно подключить к общему `cashflow.transactions` блоку через AI-агента.
- **Приоритет:** средний.

**Срок:** ~2–3 недели на все 5 (по 3–5 дней каждый, многие переиспользуют общий слой `lib/marketplaces/analytics/`).

## 3. Wildberries Statistics API + Я.Маркет Partner API (Этап 6.3)

**Подход:** копируем структуру `lib/marketplaces/ozon/*` → `lib/marketplaces/wb/*` и `lib/marketplaces/yandex/*`.

### WB
- Авторизация: `Authorization: <token>` (bearer-стиль).
- Endpoints: `statistics-api.wildberries.ru/api/v1/supplier/{sales,orders,stocks,reportDetailByPeriod}`.
- Особенности WB:
  - Один токен на все категории API, но **разные категории идут в разные хосты** (statistics, advert, content). Нужен `WbClient` с `host` параметром.
  - Rate-limit ~10 RPS (жёстче чем Ozon) → token-bucket на 8 RPS.
  - Возвращает массивы без пагинации, но окно ≤ 31 день — итерироваться по неделям.

### Я.Маркет
- Авторизация: OAuth2 (более сложно: `client_id` + `client_secret` + access token обновляется через refresh).
- Endpoints: `api.partner.market.yandex.ru/businesses/{businessId}/...`.
- Особенности Я.Маркет:
  - Нужен `businessId` (один кабинет, несколько магазинов = несколько `campaignId`).
  - OAuth refresh — хранить `refresh_token` зашифрованным, делать `refreshToken()` перед expired requests.
  - Rate-limit поспокойнее, но лимиты на количество запросов в сутки.

**Файлы (паттерн):**
- `src/lib/marketplaces/{wb,yandex}/{client,endpoints,types,upsert}.ts`
- `src/lib/marketplaces/{wb,yandex}/sync/*.ts`
- Расширить `MarketplaceKind` (уже есть `'wb'`/`'yandex'` в типах).
- UI `/settings/integrations` — отдельные карточки секций под каждый маркетплейс.
- `drizzle/init/07-marketplaces.sql` уже мультимаркетная для аккаунтов; для специфичных таблиц (заказы/реализация) — отдельные `wb_*` / `yandex_*`. Можно потом унифицировать в общий `mp_orders` если структура одинаковая, но в MVP проще держать отдельно.

**Срок:** ~3–4 недели на оба (по 2 недели каждый).

## 4. Документация для AI-агентов (`docs/MARKETPLACES_*.md`)

**Зачем:** AI-агенты (Cursor / Claude Code / Codex) при будущей правке кода
интеграций должны быстро понимать **специфику каждого API** без чтения
всего кода. Сейчас правила разбросаны по `MEMORY.md` (раздел Marketplace
Integrations) и комментариям в коде — этого пока хватает, но при росте
числа коннекторов (WB+Я.Маркет+API.OZON v6+v7…) нужен отдельный гид.

### `docs/MARKETPLACES_OZON.md` (создать первым, когда дойдём до Этапа 6.3)
**Структура:**
1. **Авторизация:** Client-Id + Api-Key, формат, где создаётся в ЛК Ozon.
2. **Версионирование endpoints:** `OZON_API_VERSION_MAP` в `endpoints.ts` — единая точка. Как мониторить deprecation.
3. **Пагинация:** разные endpoints используют разные паттерны (`last_id` для `/v3/product/list`, `cursor` для `/v5/product/info/prices`/`/v4/product/info/stocks`, `offset/limit` для `/v3/posting/fbs/list`, `page` для `/v3/finance/transaction/list`). Таблица «endpoint → пагинация».
4. **Rate-limit:** 50 RPS глобально, мы держим 40. Per-product write-limits (1 update / 30s per SKU) — не наш кейс, мы только читаем.
5. **Закрытие месяца:** `/v2/finance/realization` доступен только после закрытия отчётного периода. См. граблю в `MEMORY.md`.
6. **Известные quirks:** см. `MEMORY.md` секцию «грабли», продублировать здесь с примерами кода.
7. **Где смотреть изменения Ozon API:**
   - Официальная: <https://docs.ozon.ru/api/seller/>
   - Migration matrix: <https://docs.ozon.ru/api/seller/changelog/>
   - Telegram-канал Ozon Seller API: `@ozonseller_chat` (deprecation notices обычно постят за 1–3 месяца).
8. **Что делать при изменении endpoint версии:**
   - Шаг 1: правка `OZON_API_VERSION_MAP` в `endpoints.ts`.
   - Шаг 2: правка Zod-схемы ответа в `types.ts`.
   - Шаг 3: правка маппера в `upsert.ts` если изменилась структура полей.
   - Шаг 4: `pnpm tsx scripts/test-ozon-sync.ts` (TODO: написать smoke-скрипт с моками).
   - Шаг 5: обновить `MEMORY.md` в секции «Marketplace Integrations» — упомянуть новую версию endpoint'а.

### `docs/MARKETPLACES_WB.md` (создать при работе над WB-коннектором)
- Те же 8 пунктов, адаптированные под WB.
- Acconut: `https://seller.wildberries.ru/supplier-settings/access-to-api`.
- Changelog: <https://openapi.wildberries.ru/> (есть public OpenAPI spec, можно генерировать typed клиент).

### `docs/MARKETPLACES_YANDEX.md` (создать при работе над Я.Маркет)
- Те же 8 пунктов + специфика OAuth2.
- Account: <https://oauth.yandex.ru/client/new>.
- Changelog: <https://yandex.ru/dev/market/partner-api/doc/ru/changelog>.

### Общий гайд `docs/MARKETPLACES_AI_GUIDE.md` (создать после первого rewrite)
- Как работать с **любым** marketplace-коннектором в нашем стеке.
- Паттерны: `Client + endpoints + types + sync/* + upsert`.
- Где хранить рейт-лимиты, как делать backoff, как не палить api_key в логах.
- Чек-лист «новый marketplace добавлен правильно»:
  - [ ] AES-256-GCM для всех secret-полей (api_key, refresh_token).
  - [ ] `tenant_id` фильтрация во всех queries.
  - [ ] Top-level try/catch во всех API-роутах.
  - [ ] Token-bucket per-account rate-limit с запасом 20% от официального лимита.
  - [ ] Zod-схемы с `.passthrough()` (Ozon добавляет поля без анонса).
  - [ ] Тогглы синхронизации стейджей.
  - [ ] Plan-gate на multi-store через `canAddAccount()`.
  - [ ] UI карточка в `/settings/integrations`.

## 5. Что мониторить, чтобы не отставать от API

| Что | Где смотреть | Кто читает | Триггер действия |
|---|---|---|---|
| Ozon API changelog | <https://docs.ozon.ru/api/seller/changelog/> | разработчик при quarterly review (раз в квартал) | если deprecation окна < 60 дней — заводить задачу в PLAN.md |
| Ozon SDKs / community libs | <https://github.com/diphantxm/ozon-api-client> | при правке endpoints — сверить параметры | расхождение в схеме → апдейт `types.ts` |
| WB OpenAPI spec | <https://openapi.wildberries.ru/> | при правке WB-коннектора | можно регенерировать typed клиент |
| Я.Маркет changelog | <https://yandex.ru/dev/market/partner-api/doc/ru/changelog> | при правке Я.Маркет коннектора | OAuth обновления особенно важны |
| Внутренние мониторы | dashboard в Sentry (когда появится) | алерт на `OzonApiError` с `status=410` (Gone) или `403` (Forbidden — ключ протух) | заводить задачу в PLAN.md / связаться с пользователями |

Дополнительно: **CI-задача** (когда настроим GH Actions) — раз в неделю
дёргать health-endpoint каждого marketplace API через тестовый аккаунт
с минимальными правами и собирать схемы ответов в diff'ы. Если схема
изменилась → автоматический issue в репо.

## 6. Расширения после WB / Я.Маркет (заглавия, без деталей)

- **Telegram-бот для уведомлений о sync ошибках.** Если `OzonClient` падает с `403`/`410`, бот пишет пользователю с дип-линком в `/settings/integrations`.
- **Webhook-ингест от Ozon (Push API).** Заменит polling для критичных событий (cancellation, return). Endpoint `/api/marketplaces/ozon/webhook` + tenant lookup по `client_id`.
- **Incremental sync.** Использовать `updated_at` фильтры в запросах. Сейчас full re-sync на каждом запуске — на больших магазинах дороговато.
- **Self-hosted RUR курс и фактические комиссии для расчёта рекламы.** Связь с `currency.rates` блоком + `ozon_transactions.operation_type IN ('Реклама', 'ДРР')`.
- **Sentry/мониторинг.** Захватывать `OzonApiError` с тегом `accountId` (без api_key) для аналитики ошибок по аккаунтам/endpoint'ам.
- **AI tool `sync_ozon`** — позволить AI запускать sync голосом/командой. Прячется за audit log (как все другие AI-tools).
- **«Открыть в Ozon»** — кнопки-deeplink из таблиц в личный кабинет Ozon (`https://seller.ozon.ru/app/products/{product_id}`).

## 7. Чек-лист «marketplace интеграция готова к проду»

- [ ] AES-256-GCM на все секреты.
- [ ] Tenant-scoped queries + индексы.
- [ ] Top-level try/catch в API-роутах.
- [ ] Rate-limit per-account + retry с backoff.
- [ ] Plan-gate для multi-store.
- [ ] UI настроек с тогглами.
- [ ] Тест подключения отдельной кнопкой.
- [ ] История job'ов и polling прогресса.
- [ ] Кнопка «Загрузить из {Marketplace}» хотя бы в одном профильном блоке.
- [ ] Документация `docs/MARKETPLACES_{NAME}.md`.
- [ ] Smoke-тест с моками (`scripts/test-{marketplace}-sync.ts`).
- [ ] CHANGELOG запись + MEMORY.md обновление.
- [ ] git-команды отданы пользователю, не выполнены сами.
