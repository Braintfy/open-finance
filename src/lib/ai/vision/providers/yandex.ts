// PURPOSE: Yandex Vision provider — использует Yandex OCR (Vision API) для
// извлечения текста, затем LLM (через openai-compat fallback или простой regex)
// для парсинга в ExtractedData. Требует YANDEX_OAUTH_TOKEN или YANDEX_API_KEY.
//
// Это лёгкая реализация: OCR → текст → эвристики. Для качественного парсинга
// рекомендуется поверх OCR прогонять Yandex GPT.

import type {
  VisionProvider,
  VisionInput,
  VisionHint,
  VisionContext,
  ExtractedData,
} from '../types';

const VISION_URL = 'https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze';

async function inputToBase64(input: VisionInput): Promise<string> {
  if (input.kind === 'buffer') return input.buffer.toString('base64');
  const r = await fetch(input.url);
  if (!r.ok) throw new Error(`Не удалось скачать ${input.url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

/**
 * Эвристический парсер OCR-текста: ищем сумму, ИНН, дату.
 * Это базовая реализация — для production стоит прогонять через Yandex GPT.
 */
function heuristicParse(text: string, hint: VisionHint): ExtractedData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // ИНН: 10 или 12 цифр после "ИНН"
  const innMatch = text.match(/ИНН\s*[:#]?\s*(\d{10}|\d{12})/i);
  const vendorInn = innMatch?.[1];

  // Дата: ДД.ММ.ГГГГ или ДД/ММ/ГГГГ → ISO
  const dateMatch = text.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : undefined;

  // Сумма: «ИТОГО», «Всего», «К оплате» + число с пробелами + точкой/запятой + ₽
  const amountMatch =
    text.match(/(?:ИТОГО|Всего|К\s*оплате|Сумма)\s*[:№]?\s*([\d\s]+[.,]?\d{0,2})/i) ??
    text.match(/(\d{1,3}(?:\s\d{3})*[.,]\d{2})\s*₽/);
  let amount: number | undefined;
  if (amountMatch) {
    const num = parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(num)) amount = Math.round(num * 100);
  }

  // Vendor: первые 2-3 строки часто содержат название
  const vendor = lines.slice(0, 3).find((l) => /(ИП|ООО|ЗАО|АО|ТОО)/i.test(l)) ?? lines[0];

  const type: ExtractedData['type'] = hint === 'auto' ? 'receipt' : (hint as ExtractedData['type']);

  return {
    vendor,
    vendorInn,
    date,
    amount,
    currency: 'RUB',
    type,
    rawText: text,
  };
}

export const yandexVisionProvider: VisionProvider = {
  id: 'yandex',
  label: 'Yandex Vision (OCR)',
  supports: (mt) => ['image/jpeg', 'image/png', 'application/pdf'].includes(mt),
  async recognize(
    input: VisionInput,
    hint: VisionHint,
    _ctx: VisionContext,
  ): Promise<ExtractedData> {
    void _ctx;
    const start = Date.now();
    const iamToken = process.env.YANDEX_IAM_TOKEN;
    const apiKey = process.env.YANDEX_API_KEY;
    const folderId = process.env.YANDEX_FOLDER_ID;
    if (!folderId) throw new Error('YANDEX_FOLDER_ID не задан');
    if (!iamToken && !apiKey) throw new Error('Нужен YANDEX_IAM_TOKEN или YANDEX_API_KEY');

    const base64 = await inputToBase64(input);

    const resp = await fetch(VISION_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: iamToken ? `Bearer ${iamToken}` : `Api-Key ${apiKey}`,
      },
      body: JSON.stringify({
        folderId,
        analyze_specs: [
          {
            content: base64,
            features: [
              {
                type: 'TEXT_DETECTION',
                text_detection_config: { language_codes: ['ru', 'en'] },
              },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Yandex Vision ${resp.status}: ${text.slice(0, 200)}`);
    }
    type YandexVisionResp = {
      results?: Array<{
        results?: Array<{
          textDetection?: {
            pages?: Array<{
              blocks?: Array<{
                lines?: Array<{ text?: string }>;
              }>;
            }>;
          };
        }>;
      }>;
    };
    const data = (await resp.json()) as YandexVisionResp;
    // Собираем плоский текст
    const lines: string[] = [];
    for (const r of data.results ?? []) {
      for (const sub of r.results ?? []) {
        for (const page of sub.textDetection?.pages ?? []) {
          for (const block of page.blocks ?? []) {
            for (const line of block.lines ?? []) {
              if (line.text) lines.push(line.text);
            }
          }
        }
      }
    }
    const fullText = lines.join('\n');
    const parsed = heuristicParse(fullText, hint);
    return {
      ...parsed,
      provider: 'yandex',
      durationMs: Date.now() - start,
      rawResponse: data,
    };
  },
};
