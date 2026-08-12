# VPN для зарубежных AI API

Как это работает **сейчас** (после Этапа 4, `docs/LK_V2_PLAN.md`). Документ описывает
только устройство и настройку из приложения; установка юнитов на сервере —
**`deploy/xray/README.md`** (не дублируем).

## Проблема и решение в одном абзаце

`api.anthropic.com` и `api.openai.com` из РФ недоступны. Node не умеет VLESS/REALITY,
поэтому VPN живёт **вне** приложения: на хосте работает **Xray** с единственным
inbound'ом `http://127.0.0.1:10809`, а приложение ходит в зарубежные API через этот
локальный HTTP-прокси (undici `ProxyAgent`). Никакого системного VPN и TUN — только
прокси для конкретных исходящих запросов.

```
Next.js (undici ProxyAgent) ──► http://127.0.0.1:10809 (Xray, systemd) ──VLESS──► api.anthropic.com
```

## Что где настраивается

| Что | Где | Комментарий |
|-----|-----|-------------|
| Адрес прокси | Админка → **AI Провайдеры и Сеть** → «VPN / Прокси» → `tenants.settings.aiProxy` | `{enabled, url, type:'http'\|'https', username?, password?}` |
| Использовать прокси для чата | там же, галка «Через прокси» у провайдера → `aiExternal.useProxy`; per-user — `user_ai_credentials.use_proxy` | у провайдеров с `requiresVpn` (`PROVIDER_META`) |
| VLESS-конфиг самого Xray | там же, карточка **«VLESS / Xray (VPN на сервере)»** → `tenants.settings.aiVpn` | режимы «Ссылка» / «Подписка», см. ниже |
| Диагностика | там же, «Диагностика» → `GET /api/admin/ai/diagnostics` | показывает внешний IP через прокси (`getExternalIp`) |

**SOCKS5 не поддерживается** — `createProxyDispatcher` бросает явную ошибку. Xray
специально настроен как HTTP-inbound.

## Карточка «VLESS / Xray» (Этап 4)

Доступна только **super_admin**. Два режима:

- **Ссылка** — вставить `vless://…` (REALITY/TLS, транспорты tcp/ws/grpc, flow
  `xtls-rprx-vision`) → «Проверить и применить».
- **Подписка** — URL подписки (только `https`) → «Обновить список» → выбрать сервер →
  «Применить». Ссылки серверов **не хранятся**: в БД лежит только кэш метаданных
  (`label/host/port/fingerprint8`), подписка перекачивается на каждое применение.

Секреты (ссылка и URL подписки) шифруются `encryptSecret` (AES-256-GCM) и наружу
никогда не отдаются — в UI видно только `host:port` и 8 символов отпечатка.
Фетч подписки — только по кнопке админа, с SSRF-мерами (https, таймаут 10с,
лимит 256KB, запрет приватных IP после DNS-резолва, пиннинг адреса).

### Как применяется конфиг

Приложение **не имеет sudo и не запускает процессы**:

```
POST /api/admin/ai/vpn/apply
  → spool /var/lib/open-finance/xray/config.json (0600, атомарный mv)
  → systemd path-юнит (root) → of-xray-apply.sh: jq-инварианты → xray run -test
    → install → systemctl restart xray → status.json
  → GET /api/admin/ai/vpn/status читает status.json (честный отчёт хоста)
```

Инварианты, которые хост перепроверяет перед установкой (inbound строго
`127.0.0.1:10809`, `log.access="none"`, нет секции `api`), права на файлы, откат при
неудачном рестарте и траблшутинг — **`deploy/xray/README.md`**.

После успешного применения роут сам проставляет
`aiProxy = {enabled:true, url:'http://127.0.0.1:10809', type:'http'}` и `useProxy=true`
провайдерам с `requiresVpn` (tenant-level и user-level ключи).

## Кто ходит через прокси

| Клиент | Файл | Через прокси |
|--------|------|--------------|
| Чат / анализ (OpenAI-compat) | `src/lib/ai/providers/openai-compat.ts` | да, если `config.useProxy && aiProxy.enabled` |
| Диагностика внешнего IP | `src/lib/ai/providers/proxy.ts` (`getExternalIp`) | да |
| **Vision: Claude** | `src/lib/ai/vision/providers/claude.ts` | **да** (`requiresVpn: true`) |
| **Vision: OpenAI** | `src/lib/ai/vision/providers/openai.ts` | **да** (`requiresVpn: true`) |
| Vision: Yandex | `src/lib/ai/vision/providers/yandex.ts` | нет — Yandex Cloud доступен из РФ |
| Vision: Tesseract / Mock | `providers/{tesseract,mock}.ts` | нет — работают локально |
| Ollama | `src/lib/ai/providers/ollama.ts` | нет — localhost |

Vision-провайдеры получают прокси через `VisionContext.proxy`, который резолвит
`/api/inbox/messages/[id]/recognize` из `tenants.settings.aiProxy` (только когда
`provider.requiresVpn`). Общий код — `src/lib/ai/vision/proxy-fetch.ts`. Скачивание
самого вложения (S3/attachment URL) идёт **напрямую**, мимо прокси — это внутренний
трафик. Если прокси включён, но dispatcher не создаётся (нет `undici`, указан
socks5) — запрос падает с явной причиной, а не молча уходит напрямую в таймаут.

## Проверка

```bash
# на сервере — прокси живой?
curl -x http://127.0.0.1:10809 -m 15 https://api.ipify.org; echo
curl -x http://127.0.0.1:10809 -m 15 -o /dev/null -w '%{http_code}\n' https://api.anthropic.com/v1/models

# из приложения
GET /api/admin/ai/diagnostics        # проверки Ollama / External AI / Proxy
GET /api/admin/ai/vpn/status?checkIp=1   # применённый сервер + внешний IP + отчёт хоста
```

## Локальная разработка (macOS)

Xray на dev-машине не обязателен. Варианты:

1. Ничего не настраивать и работать с российскими провайдерами (DeepSeek, Yandex,
   GigaChat) или Ollama — прокси им не нужен.
2. Поднять любой локальный HTTP-прокси (в т.ч. свой Xray с http-inbound) и вписать
   его URL в админке → «VPN / Прокси». Карточка VLESS в dev обычно не работает:
   spool-директории нет, роут честно скажет «нет прав на запись» — это ожидаемо,
   применением конфига занимается только сервер.

## Устаревшее (чего в коде НЕТ)

Раньше этот файл описывал `AI_PROXY_URL` / `AI_PROXY_USERNAME` / `AI_PROXY_PASSWORD`,
socks5-inbound на порту 10808 и файлы `src/lib/ai/providers/{anthropic,openai}.ts` с
`socks-proxy-agent`. Ничего из этого не существует:

- переменные `AI_PROXY_*` остались в `src/lib/env.ts`/`.env.example` как исторические,
  **никакой код их не читает** — источник правды это `tenants.settings.aiProxy`;
- socks5 явно не поддержан (`createProxyDispatcher` бросает ошибку);
- прокси-агенты — только `undici` (`ProxyAgent`), пакетов `socks-proxy-agent` /
  `https-proxy-agent` в зависимостях нет.

## Безопасность

- Ссылки/URL подписки — только зашифрованными в БД, в UI и логах замаскированы
  (`maskVlessLink`, `maskSubscriptionUrl`); в `ai_audit_log` пишутся `host:port` и
  `fingerprint8`, никогда uuid/ключи.
- Пароль прокси в админку возвращается маской `••••`; при сохранении маска означает
  «оставить прежний».
- Смена `MARKETPLACE_SECRET_KEY`/`INBOX_SECRET_KEY` требует
  `pnpm admin:reencrypt-secrets` — иначе сохранённая VLESS-ссылка перестанет
  расшифровываться (UI покажет предупреждение).
- Общие правила по секретам — `docs/SECURITY.md`.
