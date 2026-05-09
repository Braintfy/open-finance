# Inbox Module

**Назначение:** drop-папка для AI — пользователь кидает что угодно (чеки, договоры, заметки, голосовые), AI сам разносит.

## Что внутри (Этап 7.5 PLAN.md)
- Виджет «Inbox queue» — список ожидающих обработки файлов
- Worker `workers/inbox-watcher.ts` — ежедневная проверка + fs.watch / S3 events
- OCR pipeline (Tesseract local / Google Vision cloud)
- Whisper для голосовых заметок
- Парсеры: чек, договор, Excel, текстовая заметка, скриншот, email-forwarded
- AI tools: `process_inbox_file`, `approve_inbox_draft`, `revert_inbox_action`

## Расположение Inbox
- **SaaS:** S3-bucket `inbox/{userId}/`
- **Local-First:** локальная папка `~/OpenFinance/Inbox/` (настраивается)
- **Mobile:** share extension — поделиться из любого приложения
- **Email:** уникальный адрес `inbox.{user}@openfinance.ru`

## Режимы
- **Auto-mode** (по умолчанию) — AI сам всё разносит, дайджест в Telegram
- **Approve-mode** — AI готовит черновики, пользователь утверждает
- **Per-type rules** — например, чеки авто, договоры — approve

## Минимальный план: Pro
Free пользователь может загрузить 10 файлов/месяц. Pro — безлимит.
