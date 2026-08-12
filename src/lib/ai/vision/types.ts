// PURPOSE: AI Vision module — типы и контракты для multi-provider распознавания
// чеков, счетов, договоров. Provider implementations см. ./providers/*.
//
// Контракт: VisionProvider.recognize(file, hint) → ExtractedData.
// Router выбирает реализацию по tenant settings (vision.provider).

import type { ProxyConfig } from '@/lib/ai/providers/proxy';

export type VisionHint = 'receipt' | 'invoice' | 'contract' | 'auto';

export type ExtractedItem = {
  name: string;
  qty?: number;
  price?: number; // в рублях (с копейками)
  total?: number;
};

export type ExtractedData = {
  /** Поставщик / контрагент (ИП Иванов, ООО Ромашка). */
  vendor?: string;
  /** ИНН (если виден). */
  vendorInn?: string;
  /** Дата документа в ISO формате (YYYY-MM-DD). */
  date?: string;
  /** Итоговая сумма (в копейках, чтобы сразу класть в transactions). */
  amount?: number;
  currency?: string;
  /** Тип документа (если provider смог определить). */
  type?: 'receipt' | 'invoice' | 'contract' | 'other';
  /** Список позиций (для чеков и счетов). */
  items?: ExtractedItem[];
  /** Полный распознанный текст (для аудита и доп. обработки). */
  rawText?: string;
  /** Провайдер, выполнивший распознавание (для аудит-лога). */
  provider?: string;
  /** Время выполнения в мс. */
  durationMs?: number;
  /** Полный raw response от LLM (для отладки). */
  rawResponse?: unknown;
};

export type VisionInput =
  | { kind: 'buffer'; buffer: Buffer; mimeType: string; filename?: string }
  | { kind: 'url'; url: string; mimeType?: string };

export type VisionContext = {
  tenantId: string;
  userId: string;
  /**
   * tenant.settings.aiProxy — HTTP-прокси (обычно локальный Xray 127.0.0.1:10809).
   * Применяется только провайдерами с requiresVpn=true (claude/openai);
   * yandex/tesseract/mock игнорируют. Резолвится на вызывающей стороне
   * (см. /api/inbox/messages/[id]/recognize).
   */
  proxy?: ProxyConfig;
};

export type VisionProvider = {
  /** Уникальный id провайдера (claude / openai / yandex / tesseract / mock). */
  id: string;
  /** Человекочитаемое название. */
  label: string;
  /**
   * API провайдера недоступен из РФ напрямую → запросы идут через ctx.proxy,
   * если он включён. Семантика та же, что у PROVIDER_META.requiresVpn для чата.
   */
  requiresVpn: boolean;
  /** Может ли провайдер обработать изображение этого mime-type. */
  supports: (mimeType: string) => boolean;
  /** Основной метод. */
  recognize: (
    input: VisionInput,
    hint: VisionHint,
    ctx: VisionContext,
  ) => Promise<ExtractedData>;
};

export type VisionProviderId = 'claude' | 'openai' | 'yandex' | 'tesseract' | 'mock';

/**
 * Стандартный prompt для LLM-based provider'ов (Claude / OpenAI).
 * Просим вернуть строгий JSON по схеме ExtractedData.
 */
export function buildExtractionPrompt(hint: VisionHint): string {
  const hintMap: Record<VisionHint, string> = {
    receipt: 'кассовый или товарный чек',
    invoice: 'счёт на оплату / счёт-фактура / акт',
    contract: 'договор / приложение',
    auto: 'финансовый документ',
  };
  return `Распознай этот ${hintMap[hint]} и верни ТОЛЬКО валидный JSON по схеме:
{
  "vendor": "название поставщика как в шапке документа",
  "vendorInn": "ИНН (только цифры) или null",
  "date": "YYYY-MM-DD или null",
  "amount": число — итоговая сумма в копейках (например 1234.50 руб → 123450),
  "currency": "RUB" | "USD" | "EUR",
  "type": "receipt" | "invoice" | "contract" | "other",
  "items": [{"name": "...", "qty": 1, "price": цена_в_копейках, "total": сумма_в_копейках}] или []
}

Правила:
- Если сумма указана в рублях с копейками (1 234,56 ₽) — конвертируй в копейки (123456).
- Если сомневаешься — поставь null. Не выдумывай данные.
- НЕ оборачивай JSON в markdown code-fence (\`\`\`).
- Верни только JSON, без сопроводительного текста.`;
}

/**
 * Парсинг JSON-ответа от LLM. Терпим к markdown-обёрткам и trailing-комментариям.
 */
export function parseExtractedJson(raw: string): ExtractedData {
  let text = raw.trim();
  // Снимаем markdown code-fence если есть
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  // Иногда LLM добавляет лишний текст до/после JSON — берём первый {} блок
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) text = objMatch[0];

  try {
    const parsed = JSON.parse(text) as Partial<ExtractedData>;
    return {
      vendor: typeof parsed.vendor === 'string' ? parsed.vendor : undefined,
      vendorInn: typeof parsed.vendorInn === 'string' ? parsed.vendorInn : undefined,
      date: typeof parsed.date === 'string' ? parsed.date : undefined,
      amount: typeof parsed.amount === 'number' ? Math.round(parsed.amount) : undefined,
      currency: typeof parsed.currency === 'string' ? parsed.currency : 'RUB',
      type: ['receipt', 'invoice', 'contract', 'other'].includes(parsed.type as string)
        ? (parsed.type as ExtractedData['type'])
        : undefined,
      items: Array.isArray(parsed.items)
        ? parsed.items
            .filter((it) => it && typeof it === 'object' && typeof it.name === 'string')
            .map((it) => ({
              name: it.name as string,
              qty: typeof it.qty === 'number' ? it.qty : undefined,
              price: typeof it.price === 'number' ? Math.round(it.price) : undefined,
              total: typeof it.total === 'number' ? Math.round(it.total) : undefined,
            }))
        : undefined,
    };
  } catch {
    return { rawText: raw };
  }
}
