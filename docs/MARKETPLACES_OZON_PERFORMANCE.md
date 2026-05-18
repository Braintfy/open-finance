# Ozon Performance API — интеграция

## Что это

Ozon Performance API — отдельный API для рекламной аналитики (CTR/CPC/CPO, поисковые фразы, кампании). Отличается от Seller API:

| Параметр | Seller API | Performance API |
|----------|-----------|-----------------|
| Хост | `api-seller.ozon.ru` | `api-performance.ozon.ru` |
| Авторизация | `Client-Id` + `Api-Key` (headers) | OAuth 2.0 client_credentials (Bearer token) |
| Креды | Из ЛК Ozon → Settings → Seller API | Из ЛК Ozon → Settings → Performance API |
| Срок действия | 180 дней | 6 месяцев |

В Open Finance Performance API — **опциональный**. Без него работают все базовые блоки (KPI/Chart/Analytics), но в качестве источника расхода используется эвристика по `ozon_transactions.operation_type LIKE '%promot%|advertis|marketing%'`. С Performance API становятся доступны точные метрики и блоки `unit.ozon-top-ads`, `unit.ozon-campaigns`, `unit.ozon-search-phrases`.

---

## Как получить ключ

1. Откройте ЛК продавца Ozon: <https://seller.ozon.ru/app/settings/api-keys>
2. Перейдите на вкладку **Performance API**.
3. Создайте новый ключ — Ozon выдаст **Client ID** (видимый) и **Client Secret** (секрет, показывается только один раз).
4. Скопируйте оба значения в Open Finance: **Настройки → Интеграции → Magazin Ozon → Performance API**.

---

## Архитектура в коде

```
src/lib/marketplaces/ozon/performance/
├── client.ts         # OzonPerformanceClient: OAuth + Bearer + rate-limit
├── endpoints.ts      # listCampaigns / generate*Report / downloadReport / CSV-parsers
└── on-demand.ts      # Pure-функции мерджа historical + today

src/lib/marketplaces/ozon/sync/
├── perf-campaigns.ts # Sync кампаний (синхронный)
├── perf-sku-stats.ts # Sync SKU-stats (async-отчёт через polling + CSV)
└── perf-phrases.ts   # TODO real-implementation (заглушка)
```

### OAuth и кэш токена

`OzonPerformanceClient.getAccessToken()`:

1. Проверяет кэш Redis (ключ `perf:token:{accountId}`).
2. Если нет / истёк — POST `https://api-performance.ozon.ru/api/client/token` с `client_credentials`.
3. Кэширует на `expires_in - 60` секунд (запас на сетевую задержку).

В dev-окружении Redis замещается in-memory shim (см. `src/lib/redis.ts`). Для prod / горизонтального масштаба — подключите ioredis.

### Async-отчёты (SKU stats)

Performance API SKU-статистику отдаёт асинхронно:

1. `GET /api/client/statistics/all_sku_promo/products/generate?dateFrom=...&dateTo=...` → возвращает UUID отчёта.
2. Поллим `GET /api/client/statistics/{uuid}` каждые 10 секунд (до 60 попыток ≈ 10 минут).
3. При `state === 'OK'` получаем `link` на CSV.
4. Скачиваем CSV, парсим, upsert'им в `ozon_perf_sku_stats`.

См. [`syncPerfSkuStatsStage`](../src/lib/marketplaces/ozon/sync/perf-sku-stats.ts).

### CSV-парсер

`parseCsv()` поддерживает Ozon-формат: разделитель `;`, кавычки (`"`), эскейпинг `""`. `parseRuNumber('1 234,56')` → `1234.56`. `parseSkuStatsRow()` — устойчив к разному регистру / русским названиям колонок.

---

## Endpoints (наши API routes)

| Endpoint | Источник данных | Блок-потребитель |
|----------|-----------------|------------------|
| `GET /api/marketplaces/ozon/kpi` | `ozon_orders` + (perf или transactions-эвристика) | `unit.ozon-kpi` |
| `GET /api/marketplaces/ozon/timeseries` | `ozon_orders` + perf | `unit.ozon-chart` |
| `GET /api/marketplaces/ozon/top-ads` | `ozon_perf_sku_stats` × `unit_products` | `unit.ozon-top-ads` |
| `GET /api/marketplaces/ozon/stock-clusters` | `unit_products.metadata.stockByType` | `unit.ozon-stock-clusters` |
| `GET /api/marketplaces/ozon/search-phrases` | `ozon_perf_phrases` | `unit.ozon-search-phrases` |
| `GET /api/marketplaces/ozon/campaigns` | `ozon_perf_campaigns` + agg `ozon_perf_sku_stats` | `unit.ozon-campaigns` |
| `GET /api/marketplaces/ozon/abc` | `ozon_orders` (delivered) | `unit.ozon-abc` |
| `GET /api/marketplaces/analytics/ozon` | `ozon_orders` + `ozon_transactions` + `unit_products` | `unit.ozon-analytics` |
| `POST /api/marketplaces/accounts/[id]/test-perf` | Performance API token endpoint | UI «Тест Performance» |

Все routes используют `auth()` и **обязательно фильтруют по `tenant_id`** в каждом SQL.

---

## Sync-окна и кэш

- **Sync-стейджи Performance API** запускаются как часть `runFullSync()`. По умолчанию окно `perfWindowDays = 30` (настройка `OzonSyncSettings.perfWindowDays`).
- **On-demand для текущего дня**: блоки могут позвать Performance API напрямую за «сегодня» (т.к. sync обычно идёт раз в сутки). Это делается через `mergeHistoricalAndOnDemand` в `performance/on-demand.ts`. Кэш Redis 10 минут — `perf:ondemand:{accountId}:{date}`.

---

## Troubleshooting

| Симптом | Причина | Действие |
|---------|--------|----------|
| «Performance API не подключён» в блоке `unit.ozon-top-ads` | Нет `perfClientId/Secret` у аккаунта | Подключить в Настройках → Интеграции → раскрыть аккаунт → секция Performance |
| «Тест Performance» возвращает 401 | Истёк ключ или ошибка в Client Secret | Перевыпустить в ЛК Ozon, обновить через «Изменить» |
| Sync `perfSkuStats` зависает > 10 мин | Отчёт большой / Ozon тормозит | Можно увеличить `maxAttempts` в [`syncPerfSkuStatsStage`](../src/lib/marketplaces/ozon/sync/perf-sku-stats.ts) |
| Поисковые фразы не приходят | TODO real-implementation в `perf-phrases.ts` | Ожидание появления стабильного endpoint в Performance API |
| 429 Too Many Requests | Rate-limit (10 RPS) | Client уже ретраит с backoff; если регулярно — снизить параллелизм |

---

## Безопасность

- `perf_client_secret_enc` — AES-256-GCM шифрование (тот же ключ `INBOX_SECRET_KEY`, в Phase 2 — отдельный `MARKETPLACE_SECRET_KEY`).
- Сырой `client_secret` НИ В КАКОМ ЛОГЕ не появляется. `console.log` в OAuth-обработчике выводит только статус и summary ошибки.
- На клиент возвращается только маска `perfSecretMasked` (формат `v1•••••Dh`).
- Все API routes авторизованы через `auth()` и фильтруют по `tenantId`.

---

## Что добавить в будущих итерациях

1. **`perf-phrases.ts`**: реальный async-отчёт когда Ozon стабилизирует endpoint.
2. **Performance media-кампании** (баннеры, видео): отдельный sync-стейдж `perfMediaStats` + блок `unit.ozon-media`.
3. **Refresh token rotation**: на текущий момент токен запрашивается заново при истечении. Если Ozon добавит refresh — добавить.
4. **Реальный AI в `unit.ozon-ai-insights`**: вместо rule-based — обращение к `/api/ai/chat` с типом `quickAction: 'ozon-snapshot-analysis'` и system-prompt «Ozon-аналитик».
