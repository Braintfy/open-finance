# LK_V2_PLAN.md — воркспейсы (именованные кабинеты), переработка блоков, VLESS-VPN

> План «плотной работы» после первого деплоя на Raspberry Pi 5 (v0.47.2). Составлен 2026-08-07 по мультиагентному анализу (6 агентов: дев-БД, каталог блоков, блок остатков, миграция данных, VLESS-дизайн, дизайн версий кабинета).
> Решения пользователя: Ozon на Pi — ввод ключей руками; кабинеты — **много именованных** (не просто v1/v2); v2-кабинет отличается **только наполнением страниц** (сайдбар общий); VPN — **оба режима: одна VLESS-ссылка ИЛИ URL подписки, с переключателем**.

## Контекст-факты из анализа (не перепроверять заново)

- Дев-БД: 9 страниц, 53 инстанса, 31/33 типов размещены; не использованы `inbox.dashboard`, `unit.yandex-calculator`. 1 tenant / 1 user.
- Раскладки: `block_layouts (tenant_id, user_id, page_key)` + jsonb; нет строки → код-дефолт `DEFAULT_LAYOUTS` (`getDefaultLayout`). Грабля: `BlockInstanceSchema` в `api/blocks/layout/[pageKey]` вырезает незадекларированные поля при PUT.
- Discoverability сломана механически: `listRecommendedForPage` не учитывает `pages:['*']` → 7 универсальных блоков никогда не в «Рекомендуемых»; все 8 `BLOCK_PRESETS` лезут на все страницы (cashflow-пресеты первыми на Ozon-дашборде). Механизма «скрыть блок» нет; `legacy`-тег только сортирует. `sheet` отсутствует в `BLOCK_META`.
- Cashflow-блоки (8 шт) у Ozon-селлера пустые: автоподкачки Ozon→cashflow нет.
- Остатки: **подтверждённый баг** — `cluster-stocks-v2/route.ts:160` читает склад заказа из `raw->>'warehouseName'`, а он лежит в `raw->'analytics_data'->>'warehouse_name'` → вся выручка/заказы в «Без кластера»; JOIN по имени склада регистрозависим (регистры расходятся). Стейдж clusters грузит только `CLUSTER_TYPE_OZON` (CIS-кластеры → «Без кластера»). FBS-склады (у пользователя 2079 шт > FBO 1455 шт) не синкаются вообще — Seller `/v2/analytics/stock_on_warehouses` FBO-only; нужны `/v1/warehouse/list` + `/v1/product/info/stocks-by-warehouse/fbs` + колонки source/warehouse_id (миграция). `skuCount` = COUNT(*) строк, не distinct.
- VLESS: Node не умеет REALITY — на хосте всегда Xray (http-inbound 127.0.0.1:10809), приложение ходит через существующий `aiProxy` (undici ProxyAgent). Vision-провайдеры прокси игнорируют (отдельная задача). `undici ^7.29.0` уже в deps.
- Перенос дев-БД на Pi отменён: вводится руками 5 полей в `/app/settings/integrations` (все 15 sync-тогглов дефолтны). users/tenants не переносить (конфликт с seed).

## Этап 0 — инфраструктура (сразу)

1. **Xray на Pi** (ждёт VLESS-ссылку/подписку от пользователя): установка xray-core arm64, конфиг из ссылки, systemd-сервис, inbound `http 127.0.0.1:10809`, проверка `curl -x ... api.anthropic.com`. В админке Pi: прокси `http://127.0.0.1:10809` + галки useProxy.
2. **Ozon на Pi**: пользователь вводит 5 полей (name, Client-Id, Api-Key, Perf Client-Id, Perf Secret) → «Тест подключения» → «Тест Performance» → полный синк.

## Этап 1 — быстрые победы: discoverability + баги остатков (~1 день, дев)

1. `listRecommendedForPage`: учитывать `pages:['*']` ИЛИ проставить `recommendedFor` универсальным блокам (sheet, custom.data, excel.cell, computed.sum, note.markdown, currency.rates) на релевантные страницы.
2. `BLOCK_PRESETS.pages`: убрать `'*'` — cashflow-пресеты только на cashflow/dashboard.
3. `sheet` добавить в `BLOCK_META` (iconName, tags, recommendedFor).
4. Флаг `hidden?: boolean` в BlockDef + фильтр в диалоге добавления (НЕ трогая `listAllBlocks`/`getBlockDef` — размещённые инстансы живут). Кандидаты на скрытие по умолчанию: `inbox.dashboard` (пока нет каналов), `navigate.card` (ведёт на несуществующий раздел), решить по legacy stat.* после переписывания дефолтов.
5. Остатки-фиксы: JSON-путь склада заказа + `lower(trim())` в JOIN; clusters грузить OZON+CIS; skuCount → distinct; разделить «нет кластера» и «склад не найден».
6. `experimental.typedRoutes` → `typedRoutes` в next.config.mjs (варнинг сборки).

## Этап 2 — остатки «всё по всем складам»

- **2a (без миграции, ~0.5 дня):** API `groupBy=cluster|warehouse` (иерархия кластер→склады), колонка «Склад», объединение складов с остатком ∪ складов с заказами периода (показывать выбитые в ноль), toggle в блоке, серверная агрегация + лимиты.
- **2b (FBS, +миграция, ~1 день):** эндпоинты `/v1/warehouse/list`, `/v1/product/info/stocks-by-warehouse/fbs` в OZON_API_VERSION_MAP; колонки `source ('FBO'|'FBS')`, `warehouse_id`, `warehouse_type` в `ozon_warehouse_stocks` + расширение uniq-индекса полем source; стейдж fbsWarehouseStocks; фильтр по источнику в блоке. **Миграцию запускает пользователь** (`pnpm db:generate` → `pnpm db:migrate`).
- **2c (надёжность):** батч-инсерт по 500 + транзакция DELETE+INSERT, warning при MAX_PAGES.
- Синхронно 4 места колонок блока (скил `of-ozon-column`).

## Этап 3 — воркспейсы (именованные кабинеты) + стартовый дашборд

Решение: сразу **вариант В** (сущность), т.к. целевое состояние — «много именованных кабинетов», путь через префиксы был бы двойной работой.

- **Схема:** таблица `workspaces (id, tenant_id, user_id, name, slug, template, is_default, sort_order, timestamps)`; `block_layouts.workspace_id` FK cascade. Миграция двухфазная: nullable → бэкфилл (создать «Кабинет 1» для каждой пары tenant+user со строками) → NOT NULL + uniq `(workspace_id, page_key)`. **Запускает пользователь.**
- **Скоуп версионирования** (дефолт, согласован логикой «v2 = только страницы»): раскладки страниц и вкладки юнит-экономики (`unit_economics_tabs.workspace_id`) — раздельные per-workspace; AI-отчёты (`block_ai_reports`, `section_ai_reports`) — раздельные; **доски (boards) — общие** (отдельная сущность). Сайдбар общий.
- **Активный воркспейс:** httpOnly-кука + `users.settings jsonb` (одна миграция) как персист; RSC читают куку, POST `/api/workspace/active` + `router.refresh()`. BlockGrid ремоунт по `key={workspaceId+pageKey}` (защита от pending-save в чужой воркспейс).
- **API:** `/api/workspaces` CRUD (list/create/rename/clone/delete, clone по образцу `createTab({cloneFromPageKey})` — копия всех строк block_layouts). `getOrCreateDefaultWorkspace()` на read-пути.
- **UI:** переключатель-дропдаун над дашбордом/в шапке (`layout.tsx`): список кабинетов, ✎ переименовать, + новый (пустой / клон текущего / из шаблона), удалить с подтверждением (Dialog, не confirm()).
- **Стартовый дашборд по умолчанию:** `WORKSPACE_TEMPLATES` в registry: 'seller-ozon' (дефолт нового кабинета: Ozon KPI, динамика, аналитика, остатки-по-складам, ABC, data-health + custom.data и excel.cell примеры), 'blank'. Дефолты — код (getDefaultLayout по template), без INSERT'ов. Сюда же — переписать `DEFAULT_LAYOUTS.dashboard` (убрать legacy stat.*, пустой inbox, мёртвую navigate.card).
- **Изоляция ссылок:** cross-workspace @-ссылки запрещаем — фильтр страниц активного воркспейса в `/api/blocks/sources` и `/api/blocks/relations` (заодно не удваивает их стоимость).
- **Zod:** `BlockInstanceSchema` не меняется (workspace_id не внутри блока); PageKey regex не меняется.

## Этап 4 — VLESS/VPN в админке (оба режима с переключалкой)

Архитектура В2 из анализа (web-процесс без exec/sudo):

- **Ядро:** `src/lib/ai/vpn/vless.ts` — `parseVlessLink()` (vless:// + REALITY/TLS, транспорты tcp/ws/grpc, жёсткий zod), `parseSubscription()` (base64-список ссылок → массив серверов), `buildXrayConfig(params, {httpPort:10809})`. Смоук `scripts/test-vless-parse.ts`.
- **Настройки** (`tenants.settings.aiVpn`, шифровать `encryptSecret`, добавить в `reencrypt-secrets.ts`): `{ enabled, mode: 'link'|'subscription', linkEnc?, subscriptionUrlEnc?, servers?: [{id, label, host, port, fingerprint8}] (кэш метаданных, БЕЗ секретов), selectedServerId?, lastFetchedAt?, appliedFingerprint?, lastError? }`.
- **UI-карточка** в `/app/admin/ai/providers`: переключатель «Ссылка | Подписка»; режим ссылки — textarea + «Проверить и применить»; режим подписки — URL + «Обновить список» → выбор сервера из списка → «Применить»; статус: применённый сервер, внешний IP/страна через `getExternalIp`, время применения. Ссылку/URL наружу не отдавать никогда (только host:port + 8 символов хеша).
- **Применение:** роут пишет валидированный config.json в spool `/var/lib/open-finance/xray/config.json` (0600); root-овый systemd `.path`-юнит → `of-xray-apply.sh`: jq-проверка (inbound строго 127.0.0.1:10809, log.access='none') → `xray run -test` → install → `systemctl restart xray` → `status.json`. Xray НЕ от root. Гейт super_admin + rateLimit + aiAuditLog.
- **SSRF-меры для подписки:** только https, таймаут 10с, лимит размера 256KB, запрет приватных/loopback IP после резолва, фетч только по кнопке админа (не по крону).
- **UX-обвязка:** после успешного apply автоматически `aiProxy={enabled,url:http://127.0.0.1:10809,type:http}` + `useProxy=true` у провайдеров с requiresVpn. At-boot реконсиляция (расхождение appliedFingerprint ↔ status.json → баннер).
- **Следом (отдельно):** протащить dispatcher в vision-провайдеры (OCR сейчас игнорирует прокси); поправить docs/VPN_FOR_AI.md (противоречит коду: мёртвые AI_PROXY_*, socks5, несуществующие файлы).

## Порядок исполнения

Этап 0 → 1 → 2a → 3 → 2b → 4 (2b после 3, чтобы миграции FBS и workspaces пользователь накатывал осознанно и раздельно; 4 — когда VPN уже работает через Этап 0 и жать не горит). Исполнение — субагенты Opus 5, оркестрация/ревью — Fable. Верификация каждого этапа: `of-verify` + smoke-тесты + ревью `of-review` перед git-командами.
