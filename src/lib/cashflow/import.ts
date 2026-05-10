// PURPOSE: Парсинг CSV/XLSX выписок и нормализация в наш формат транзакций.
// Поддерживает наиболее частые форматы: Тинькофф (CSV), Сбер (CSV/XLSX), стандартный CSV.

import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export type ParsedRow = {
  date: Date;
  amount: number; // в копейках, всегда положительное
  type: 'income' | 'expense';
  counterparty?: string;
  description?: string;
  raw: Record<string, unknown>;
};

export type ParseResult = {
  rows: ParsedRow[];
  detectedFormat: 'tinkoff' | 'sber' | 'generic-csv' | 'generic-xlsx' | 'unknown';
  errors: string[];
};

const HEADER_HINTS = {
  date: ['date', 'дата', 'дата операции', 'дата платежа'],
  amount: ['amount', 'сумма', 'сумма операции', 'сумма (руб)', 'сумма платежа'],
  description: ['description', 'описание', 'назначение', 'назначение платежа', 'комментарий'],
  counterparty: ['counterparty', 'контрагент', 'получатель', 'плательщик', 'наименование операции'],
};

function findHeader(headers: string[], hints: string[]): string | undefined {
  const lower = headers.map((h) => (h ?? '').toString().trim().toLowerCase());
  for (const hint of hints) {
    const idx = lower.indexOf(hint);
    if (idx >= 0) return headers[idx];
  }
  // partial match
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx >= 0) return headers[idx];
  }
  return undefined;
}

function parseAmountToKopecks(value: unknown): { amount: number; type: 'income' | 'expense' } | null {
  if (value == null || value === '') return null;
  const str = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-+]/g, '');
  const num = Number(str);
  if (!Number.isFinite(num) || num === 0) return null;
  return {
    amount: Math.abs(Math.round(num * 100)),
    type: num >= 0 ? 'income' : 'expense',
  };
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value).trim();
  // dd.mm.yyyy
  const ddmmyyyy = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(str);
  if (ddmmyyyy) {
    return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
  }
  // yyyy-mm-dd
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(str);
  if (iso) return new Date(str);
  // fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function rowsToTransactions(records: Array<Record<string, unknown>>, headers: string[]): ParseResult {
  const errors: string[] = [];
  if (records.length === 0) {
    return { rows: [], detectedFormat: 'unknown', errors: ['Файл пустой'] };
  }

  const dateKey = findHeader(headers, HEADER_HINTS.date);
  const amountKey = findHeader(headers, HEADER_HINTS.amount);
  const descKey = findHeader(headers, HEADER_HINTS.description);
  const cpKey = findHeader(headers, HEADER_HINTS.counterparty);

  if (!dateKey || !amountKey) {
    return {
      rows: [],
      detectedFormat: 'unknown',
      errors: [
        'Не удалось определить колонки даты и суммы. Ожидаются: "Дата" и "Сумма" (или Date/Amount). Найдены колонки: ' +
          headers.join(', '),
      ],
    };
  }

  const rows: ParsedRow[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const date = parseDate(r[dateKey]);
    const amt = parseAmountToKopecks(r[amountKey]);
    if (!date || !amt) {
      // пропускаем но не считаем ошибкой (часто пустые/итоговые строки)
      continue;
    }
    rows.push({
      date,
      amount: amt.amount,
      type: amt.type,
      counterparty: cpKey ? String(r[cpKey] ?? '').trim() || undefined : undefined,
      description: descKey ? String(r[descKey] ?? '').trim() || undefined : undefined,
      raw: r,
    });
  }

  return { rows, detectedFormat: 'generic-csv', errors };
}

export function parseCsv(text: string): ParseResult {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: text.includes(';') && !text.includes(',') ? ';' : undefined,
  });
  if (result.errors.length > 0) {
    return {
      rows: [],
      detectedFormat: 'unknown',
      errors: result.errors.slice(0, 3).map((e: { message: string }) => e.message),
    };
  }
  const headers = result.meta.fields ?? [];
  return rowsToTransactions(result.data, headers);
}

export function parseXlsx(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], detectedFormat: 'unknown', errors: ['В файле нет листов'] };
  }
  const ws = wb.Sheets[firstSheetName]!;
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const headers = records[0] ? Object.keys(records[0]) : [];
  const result = rowsToTransactions(records, headers);
  return { ...result, detectedFormat: 'generic-xlsx' };
}
