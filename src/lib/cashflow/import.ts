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

export type DetectedFormat = ParseResult['detectedFormat'];

const HEADER_HINTS = {
  date: [
    'date',
    'дата',
    'дата операции',
    'дата платежа',
    'дата проведения', // Тинькофф
  ],
  amount: [
    'amount',
    'сумма',
    'сумма операции',
    'сумма (руб)',
    'сумма платежа',
    'сумма в валюте счёта', // Тинькофф
    'сумма в валюте счета',
  ],
  description: [
    'description',
    'описание',
    'назначение',
    'назначение платежа',
    'комментарий',
    'описание операции', // Тинькофф
  ],
  counterparty: [
    'counterparty',
    'контрагент',
    'получатель',
    'плательщик',
    'наименование операции',
    'наименование контрагента', // Тинькофф
  ],
  // Отдельная колонка типа операции (Дебет/Кредит в Тинькофф)
  type: [
    'тип операции (пополнение/списание)',
    'тип операции',
    'type',
    'операция',
  ],
};

function parseTypeFromColumn(value: unknown): 'income' | 'expense' | null {
  if (!value) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  // Тинькофф: «Кредит» = поступление на счёт (доход),
  // «Дебет» = списание со счёта (расход).
  if (s.startsWith('кредит') || s.startsWith('попол') || s === 'credit' || s === 'income') {
    return 'income';
  }
  if (s.startsWith('дебет') || s.startsWith('списа') || s === 'debit' || s === 'expense') {
    return 'expense';
  }
  return null;
}

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

function rowsToTransactions(
  records: Array<Record<string, unknown>>,
  headers: string[],
  baseFormat: ParseResult['detectedFormat'] = 'generic-csv'
): ParseResult {
  const errors: string[] = [];
  if (records.length === 0) {
    return { rows: [], detectedFormat: 'unknown', errors: ['Файл пустой'] };
  }

  const dateKey = findHeader(headers, HEADER_HINTS.date);
  const amountKey = findHeader(headers, HEADER_HINTS.amount);
  const descKey = findHeader(headers, HEADER_HINTS.description);
  const cpKey = findHeader(headers, HEADER_HINTS.counterparty);
  const typeKey = findHeader(headers, HEADER_HINTS.type);

  // Авто-определение формата Тинькофф (есть колонка типа + русские заголовки)
  const isTinkoff = !!typeKey && headers.some((h) => /номер сч/i.test(h ?? ''));
  const detectedFormat: ParseResult['detectedFormat'] = isTinkoff ? 'tinkoff' : baseFormat;

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
      continue;
    }
    // Если есть отдельная колонка типа (Тинькофф Дебет/Кредит) — используем её,
    // иначе от знака суммы (отрицательная = расход).
    const typeFromCol = typeKey ? parseTypeFromColumn(r[typeKey]) : null;
    const finalType: 'income' | 'expense' = typeFromCol ?? amt.type;

    rows.push({
      date,
      amount: amt.amount,
      type: finalType,
      counterparty: cpKey ? String(r[cpKey] ?? '').trim() || undefined : undefined,
      description: descKey ? String(r[descKey] ?? '').trim() || undefined : undefined,
      raw: r,
    });
  }

  return { rows, detectedFormat, errors };
}

function detectDelimiter(text: string): string {
  // Берём первую непустую строку (заголовок) и сравниваем счётчики ; , \t
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  const counts: Record<string, number> = {
    ';': (firstLine.match(/;/g) ?? []).length,
    ',': (firstLine.match(/,/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
  };
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 0 ? top[0] : ',';
}

export function parseCsv(text: string): ParseResult {
  // Снимаем BOM если есть (Тинькофф пишет UTF-8 с BOM).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter,
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
