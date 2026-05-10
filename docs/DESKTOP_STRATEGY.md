# Desktop strategy: Tauri vs Electron vs Hybrid

> Решение принято: **Tauri 2 как основной**, с архитектурной готовностью к Electron-fork-у при необходимости COM-автоматизации.

## Проблема

Open Finance планирует local-first / desktop версию для:
- Селлеров маркетплейсов (Wildberries, Ozon)
- ИП на УСН с локальной 1С
- Малого бизнеса (Office Excel, Word, 1С на одном ПК)

Ключевой вопрос: **какие интеграции нужны и какой рантайм их даёт?**

## Сравнение

| Параметр | Tauri 2 | Electron | Hybrid (Tauri + Sidecar) |
|----------|---------|----------|--------------------------|
| **Размер бандла** | 10 МБ | 150 МБ | 30 МБ |
| **RAM idle** | 80 МБ | 300 МБ | 150 МБ |
| **Backend** | Rust | Node.js | Rust + .NET/Python sidecar |
| **`.xlsx` файлы (read/write)** | `calamine`/`umya-spreadsheet` или `exceljs` в WebView | `exceljs`, `xlsx` | `exceljs` |
| **Excel COM (автоматизация)** | ❌ нет | ✅ `node-activex`, `winax` | ✅ через C# sidecar |
| **1С COM-коннектор V8** | ❌ нет | ✅ `node-activex` | ✅ через C# sidecar |
| **1С HTTP-сервисы / oData** | ✅ | ✅ | ✅ |
| **1С через файловый обмен** | ✅ | ✅ | ✅ |
| **Печать ETN, отчётов** | ✅ | ✅ | ✅ |
| **Sandbox/Security** | ✅ строгий | ⚠️ требует настройки | ✅ |
| **Updater** | ✅ встроенный | electron-updater | ✅ |
| **OS support** | macOS/Win/Linux | macOS/Win/Linux | macOS/Win/Linux |
| **App Store** | ✅ macOS Store/Microsoft Store | ⚠️ сложнее | ✅ |
| **Mobile (iOS/Android)** | ✅ Tauri Mobile (alpha) | ❌ | ✅ |

## Когда нужен Electron вместо Tauri

**Только если ключевая фича = COM-автоматизация Excel/1С:**

- «Открой Excel, пробеги по ячейкам активного листа, синхронизируй с базой» — Electron сильно проще
- «Подключись через V8 COMConnector к 1С Бухгалтерия 8.3, прочитай регистры, запиши документ» — Electron сильно проще
- «Запусти макрос в Word и подставь данные клиента» — Electron сильно проще

## Когда Tauri достаточно (90% случаев в РФ малом бизнесе)

- Импорт `.xlsx` выписок банка → ✅ `exceljs`
- Экспорт отчётов в `.xlsx`, `.pdf`, `.docx` → ✅ `exceljs` + `pdfkit` + `docx`
- Обмен с 1С через **выгрузку CommerceML / Excel / oData / HTTP-сервисы** → ✅
- Локальная база SQLite + sync с облаком → ✅
- Подключение к API банков (Тинькофф, Сбер) через REST → ✅
- AI-агенты, чтение почты, сканирование файлов → ✅

## Решение: гибрид

**Базовая версия — Tauri 2.** Этого достаточно для:
- Local-first SaaS (offline-режим)
- Импорт-экспорт через файлы
- HTTP-интеграции с банками и 1С

**Если на этапе бета-тестирования** окажется что **>20% пользователей** требуют COM-автоматизацию (опрос покажет):

### Вариант A — Electron-fork
- Сделать `apps/desktop-pro/` с тем же Next.js frontend
- Обернуть в Electron вместо Tauri
- Бандл 150 МБ, но с полной COM-автоматизацией
- **Стоимость:** 1 неделя работы

### Вариант B — Tauri + .NET Sidecar
- Tauri вызывает локальный .NET процесс через UDS/HTTP
- .NET делает COM-вызовы к Excel/1С
- Бандл +30 МБ для Windows, на macOS не нужен
- **Стоимость:** 2 недели + поддержка двух runtime

**Предпочтительный путь — A** (Electron Pro Desktop как премиум-функция за +доплату).

## Архитектурные правила сейчас

Чтобы Electron-fork занимал 1 день а не 1 месяц:

1. ✅ **Вся бизнес-логика — в Next.js / lib/**
2. ✅ **Никаких Tauri-specific API в компонентах** — только в `lib/desktop/tauri.ts` адаптере
3. ✅ **Если нужно нативное API (FS, dialogs, notifications)** — обёртка в `lib/desktop/native.ts`, которая под Tauri использует `@tauri-apps/api`, под Electron — `electron.ipcRenderer`
4. ✅ **Импорт/экспорт `.xlsx`** — всегда через JS-либы (`exceljs`, `papaparse`) которые работают в обоих рантаймах

## Roadmap

| Phase | Что | Срок |
|-------|-----|------|
| **Phase 1 (сейчас)** | SaaS only — без десктопа | Foundation–MVP |
| **Phase 2** | Tauri 2 build с offline-режимом | Q3-Q4 |
| **Phase 2.5** | Опрос пользователей про COM-нужду | при 100+ юзерах |
| **Phase 3 (если нужно)** | Electron Pro Desktop с COM | 1 неделя fork-а |

## Ссылки

- [Tauri 2 docs](https://v2.tauri.app/)
- [Tauri Mobile](https://v2.tauri.app/start/prerequisites/#mobile-targets)
- [Electron + node-activex](https://github.com/durs/node-activex)
- [calamine — Rust xlsx parser](https://github.com/tafia/calamine)
- [exceljs — Node + browser xlsx](https://github.com/exceljs/exceljs)
