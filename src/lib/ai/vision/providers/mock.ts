// PURPOSE: Mock vision provider — для тестов и dev без API-ключей.
// Возвращает deterministic ExtractedData по имени файла (если есть).

import type { VisionProvider, ExtractedData } from '../types';

export const mockVisionProvider: VisionProvider = {
  id: 'mock',
  label: 'Mock (для тестов)',
  requiresVpn: false, // сети нет вообще
  supports: () => true,
  recognize: async (input, hint): Promise<ExtractedData> => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 200));
    const filename = input.kind === 'buffer' ? input.filename ?? '' : new URL(input.url).pathname;
    const hasReceipt = /чек|chek|receipt|kassovyy/i.test(filename);
    const hasInvoice = /счет|schet|invoice/i.test(filename);
    const type: ExtractedData['type'] =
      hint === 'auto' ? (hasReceipt ? 'receipt' : hasInvoice ? 'invoice' : 'other') : (hint as ExtractedData['type']);
    return {
      vendor: 'ИП Тестовый Тест',
      vendorInn: '7707083893',
      date: new Date().toISOString().slice(0, 10),
      amount: 123450,
      currency: 'RUB',
      type,
      items: [
        { name: 'Тестовый товар', qty: 1, price: 100000, total: 100000 },
        { name: 'НДС 20%', qty: 1, price: 23450, total: 23450 },
      ],
      rawText: `Mock vision response for "${filename}", hint=${hint}`,
      provider: 'mock',
      durationMs: Date.now() - start,
    };
  },
};
