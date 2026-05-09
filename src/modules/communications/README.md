# Communications Module — AI-секретарь

**Назначение:** интеграция с email/Telegram/WhatsApp/VK/MAX для понимания контекста, поиска связей и автонапоминаний.

## Что внутри (Этап 8 PLAN.md)
- Connectors: IMAP, Telegram Bot+MTProto, WhatsApp Business, VK API, MAX (когда API)
- Worker `workers/communications-sync.ts` — ежечасная синхронизация
- AI tools: `extract_contact`, `link_chat_to_order`, `create_reminder_from_chat`, `summarize_thread`
- НЕ хранит raw сообщения — только embeddings + извлечённые сущности

## Принципы privacy
- **Opt-in** — каждый канал подключается явно
- **Granular access** — выбор конкретных чатов/папок/тегов
- **Local processing** где возможно (Whisper local, парсинг local)
- **No raw storage** — храним embeddings + sanitized excerpts
- **Полное удаление** — кнопка «Стереть всё» в settings
- **Audit log** — пользователь видит ВСЁ что AI сделал

## Roadmap по интеграциям
- **Phase 1:** Email IMAP (Gmail/Outlook/Yandex/Mail.ru), Telegram Bot
- **Phase 2:** Telegram MTProto (личный аккаунт), Google Contacts, iCloud CardDAV
- **Phase 3:** WhatsApp Business API, VK
- **Phase 4:** MAX (когда API), доп. провайдеры

## Минимальный план: Pro
Free и Trial Pro имеют доступ только к Telegram Bot для уведомлений.
Полные коммуникации (IMAP, MTProto и т.д.) — от Pro.
