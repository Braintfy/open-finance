// PURPOSE: Tesseract OCR provider — локальное распознавание текста через
// tesseract.js (опц. зависимость). Если tesseract.js не установлен — даёт
// дружелюбную ошибку с инструкцией.
//
// Note: tesseract.js работает в Node через WASM. Для production предпочтительнее
// проксировать через серверный binary, но для прототипа достаточно WASM.

import type {
  VisionProvider,
  VisionInput,
  VisionHint,
  VisionContext,
  ExtractedData,
} from '../types';

function heuristicParse(text: string, hint: VisionHint): ExtractedData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const innMatch = text.match(/ИНН\s*[:#]?\s*(\d{10}|\d{12})/i);
  const dateMatch = text.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
  const amountMatch =
    text.match(/(?:ИТОГО|Всего|К\s*оплате|Сумма)\s*[:№]?\s*([\d\s]+[.,]?\d{0,2})/i) ??
    text.match(/(\d{1,3}(?:\s\d{3})*[.,]\d{2})\s*₽/);
  let amount: number | undefined;
  if (amountMatch) {
    const num = parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(num)) amount = Math.round(num * 100);
  }
  const vendor = lines.slice(0, 3).find((l) => /(ИП|ООО|ЗАО|АО)/i.test(l)) ?? lines[0];
  return {
    vendor,
    vendorInn: innMatch?.[1],
    date: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : undefined,
    amount,
    currency: 'RUB',
    type: hint === 'auto' ? 'receipt' : (hint as ExtractedData['type']),
    rawText: text,
  };
}

export const tesseractVisionProvider: VisionProvider = {
  id: 'tesseract',
  label: 'Tesseract.js (локально)',
  requiresVpn: false, // OCR выполняется в процессе, наружу не ходит
  supports: (mt) => ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'].includes(mt),
  async recognize(
    input: VisionInput,
    hint: VisionHint,
    _ctx: VisionContext,
  ): Promise<ExtractedData> {
    void _ctx;
    const start = Date.now();
    type TesseractModule = {
      recognize: (
        image: Buffer | string,
        lang: string,
      ) => Promise<{ data: { text: string } }>;
    };
    let tesseract: TesseractModule;
    try {
      // dynamic import — необязательная peerDep
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tesseract = (await import(/* webpackIgnore: true */ 'tesseract.js' as any)) as TesseractModule;
    } catch {
      throw new Error(
        'tesseract.js не установлен. Запустите: pnpm add tesseract.js',
      );
    }
    if (input.kind === 'url') {
      const r = await fetch(input.url);
      if (!r.ok) throw new Error(`Не удалось скачать ${input.url}: ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      input = {
        kind: 'buffer',
        buffer: buf,
        mimeType: input.mimeType ?? r.headers.get('content-type') ?? 'image/jpeg',
      };
    }
    const { data } = await tesseract.recognize(input.buffer, 'rus+eng');
    const text = data.text;
    const parsed = heuristicParse(text, hint);
    return {
      ...parsed,
      provider: 'tesseract',
      durationMs: Date.now() - start,
    };
  },
};
