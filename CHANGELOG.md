# Changelog

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
