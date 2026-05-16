// PURPOSE: Загрузчик курсов с ЦБ РФ через cbr-xml-daily.ru (community JSON-mirror).
// Бесплатно, без ключей, без лимитов. Обновление 11:30 МСК. Ответ нормализуем
// к формату CurrencyRate (1 единица валюты → рубли).
import type { CurrencyRate } from '../types';

const CBR_DAILY_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const FETCH_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 800;

type CbrValute = {
  ID: string;
  NumCode: string;
  CharCode: string;
  Nominal: number;
  Name: string;
  Value: number;
  Previous: number;
};

type CbrDaily = {
  Date: string;
  PreviousDate: string;
  Valute: Record<string, CbrValute>;
};

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json, text/javascript' },
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Тянет daily JSON у ЦБ и нормализует к CurrencyRate[].
 * При ошибке делает один retry с задержкой 800мс. Кидает Error при
 * повторной неудаче — caller (refresh) должен это поймать.
 */
export async function fetchCbrDaily(): Promise<CurrencyRate[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(CBR_DAILY_URL, FETCH_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error(`CBR responded with ${response.status}`);
      }
      const data = (await response.json()) as CbrDaily;
      if (!data?.Valute || typeof data.Valute !== 'object') {
        throw new Error('CBR response missing Valute');
      }
      const parsedDate = data.Date ? new Date(data.Date) : new Date();
      const sourceDate = !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();
      const updatedAt = new Date().toISOString();
      const rates: CurrencyRate[] = [];
      for (const v of Object.values(data.Valute)) {
        if (!v?.CharCode || !Number.isFinite(v.Value) || !Number.isFinite(v.Nominal)) {
          continue;
        }
        const nominal = v.Nominal > 0 ? v.Nominal : 1;
        rates.push({
          code: v.CharCode,
          nominal,
          name: v.Name,
          rateRub: v.Value / nominal,
          previousRub:
            Number.isFinite(v.Previous) && v.Previous > 0 ? v.Previous / nominal : null,
          source: 'cbr',
          sourceDate,
          updatedAt,
        });
      }
      return rates;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw new Error(
    `Не удалось получить курсы ЦБ: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
