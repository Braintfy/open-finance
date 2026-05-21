# AI Vision Providers

Multi-provider module для распознавания чеков, счетов и договоров. Используется в Inbox для конвертации сообщений с вложениями в готовые транзакции.

## Архитектура

```
src/lib/ai/vision/
├── types.ts                 # Контракт: VisionProvider, ExtractedData, hint
├── router.ts                # getVisionProvider() с auto-fallback
├── index.ts                 # Public API (re-exports)
└── providers/
    ├── claude.ts            # Anthropic Messages API + image content
    ├── openai.ts            # GPT-4o + response_format=json_object
    ├── yandex.ts            # Yandex Vision API (OCR) + heuristic parse
    ├── tesseract.ts         # Local tesseract.js OCR + heuristic parse
    └── mock.ts              # Deterministic ответы для dev/тестов
```

## Контракт

```typescript
type VisionProvider = {
  id: 'claude' | 'openai' | 'yandex' | 'tesseract' | 'mock';
  label: string;
  supports: (mimeType: string) => boolean;
  recognize: (input: VisionInput, hint: VisionHint, ctx: VisionContext) => Promise<ExtractedData>;
};

type ExtractedData = {
  vendor?: string;           // "ИП Иванов"
  vendorInn?: string;        // "7707083893"
  date?: string;             // "2026-05-21" (ISO)
  amount?: number;           // ВСЕГДА в копейках (123450 = 1234.50 ₽)
  currency?: string;         // "RUB"
  type?: 'receipt' | 'invoice' | 'contract' | 'other';
  items?: ExtractedItem[];   // позиции (для чеков и счетов)
  rawText?: string;          // полный OCR-текст (для аудита)
  provider?: string;         // 'claude' | 'openai' | 'yandex' | 'tesseract' | 'mock'
  durationMs?: number;
};
```

## Setup

### Claude (Anthropic)
```bash
ANTHROPIC_API_KEY=sk-ant-...
# опционально
ANTHROPIC_VISION_MODEL=claude-3-5-sonnet-20241022
```

Лучший качественный анализ + поддержка русского. Цена ~$0.003 за изображение.

### OpenAI (GPT-4o)
```bash
OPENAI_API_KEY=sk-...
# опционально
OPENAI_VISION_MODEL=gpt-4o-mini    # дешевле, чуть хуже качество
# OPENAI_VISION_MODEL=gpt-4o       # лучшее качество
```

`response_format: json_object` гарантирует валидный JSON.

### Yandex Vision (OCR)
```bash
YANDEX_FOLDER_ID=b1g...           # ID каталога в Yandex Cloud
# либо IAM token (рекомендуется)
YANDEX_IAM_TOKEN=t1.9...
# либо service account API key
YANDEX_API_KEY=AQVN...
```

Только OCR (текст) + эвристический парсер для vendor/inn/date/amount. Для качественного парсинга стоит дополнительно прогонять через Yandex GPT (TODO).

### Tesseract.js (local, бесплатный)
```bash
pnpm add tesseract.js
```

WASM-based, работает в Node. Поддерживает русский (`rus+eng`). Качество хуже LLM, но **полностью бесплатный** и работает оффлайн.

### Mock (для разработки)
Без env работает автоматически. Возвращает deterministic ответы по filename (`*chek*` → receipt, `*schet*` → invoice).

## Выбор провайдера

```typescript
import { getVisionProvider } from '@/lib/ai/vision';

const provider = getVisionProvider({ override: 'claude' });    // явный override
const provider = getVisionProvider();                          // auto по env
```

Приоритет:
1. `override` (query-param `?provider=claude`)
2. tenant settings (TODO)
3. `process.env.VISION_PROVIDER`
4. Auto: `ANTHROPIC_API_KEY` → claude, `OPENAI_API_KEY` → openai, `YANDEX_FOLDER_ID + KEY` → yandex
5. Fallback: `mock`

## API

```typescript
POST /api/inbox/messages/[id]/recognize?hint=receipt&provider=claude
Content-Type: multipart/form-data

file: <image file>
```

Или с attachment из metadata:
```typescript
POST /api/inbox/messages/[id]/recognize?hint=auto
```

Response:
```json
{
  "ok": true,
  "extracted": { /* ExtractedData */ },
  "provider": "claude"
}
```

Результат автоматически сохраняется в `inbox_messages.aiExtracted` + `aiProvider` + `aiExtractedAt`.

## UI

В блоке `inbox.channel-feed` появляется `AiRecognizePanel`:
- Выбор hint: Авто/Чек/Счёт/Договор.
- Выбор провайдера (по умолчанию из env).
- Кнопка «Распознать из письма» (использует первое вложение из metadata).
- Кнопка «Из файла» (multipart upload).
- Panel с распознанными полями.
- Кнопка «Создать транзакцию» — POST `/api/cashflow/transactions` с pre-filled данными.

## Тесты

```bash
pnpm tsx scripts/test-vision-router.ts
```

Проверяет: getVisionProvider env/override/fallback, listVisionProviders, parseExtractedJson (markdown unwrap, messy text), mock provider.

## Безопасность и лимиты

- **Сумма всегда в копейках** — конвертация на стороне LLM через prompt.
- **`parseExtractedJson`** — терпим к LLM-output (markdown code-fence, trailing text); валидирует типы.
- **Heuristic fallback** — для Yandex/Tesseract (regex для ИНН, даты, суммы) — для production стоит прогонять OCR через Yandex GPT / LLM.
- **Rate limit** (TODO) — для платных провайдеров (Claude/OpenAI) ограничить N запросов/час на tenant.
- **Audit log** (TODO) — все recognize-операции в `ai_audit_logs` с extracted summary.

## Будущие улучшения

- [ ] tenant settings UI для выбора провайдера.
- [ ] OCR (Tesseract/Yandex) → LLM (Claude/OpenAI/Yandex GPT) pipeline для гибридного распознавания.
- [ ] Кэширование по hash(image) (повторное распознавание того же файла).
- [ ] Bulk recognize — обработать все непрочитанные письма с вложениями.
- [ ] Связывание `inbox.messageId` ↔ `transaction.id` (двусторонняя ссылка).
