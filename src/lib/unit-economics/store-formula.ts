// PURPOSE: Лёгкий evaluator формул для блока «Мой магазин».
// Формулы — выражения от имён колонок строки и глобальных переменных
// (`vatPct`, `taxRatePct`, `salesPerMonth`, ...). Поддерживаем `=` в начале,
// арифметику и стандартные функции через fast-formula-parser; защита от
// циклов: уже посещённые ключи во время рекурсии возвращают `'#CYCLE'`.

import FormulaParser from 'fast-formula-parser';

export type StoreScope = Record<string, number | string | null | undefined>;
export type StoreFormulas = Record<string, string | undefined>;

const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
    if (NUMBER_RE.test(normalized)) return Number(normalized);
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stripLeadingEquals(formula: string): string {
  return formula.startsWith('=') ? formula.slice(1) : formula;
}

/**
 * Заменить идентификаторы в формуле на их числовые значения.
 * Идёт по убыванию длины ключа, чтобы `priceRetail` не был частично
 * заменён по правилу `price`.
 */
function substituteIdentifiers(formula: string, scope: StoreScope): string {
  const keys = Object.keys(scope).sort((a, b) => b.length - a.length);
  let out = formula;
  for (const key of keys) {
    if (!key) continue;
    const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_$])${safe}(?![A-Za-z0-9_$(])`, 'g');
    out = out.replace(re, () => String(asNumber(scope[key])));
  }
  return out;
}

let sharedParser: FormulaParser | null = null;
function getParser(): FormulaParser {
  if (!sharedParser) {
    sharedParser = new FormulaParser({
      onCell: () => 0,
      onRange: () => [[0]],
    });
  }
  return sharedParser;
}

/**
 * Вычислить одну формулу по плоскому контексту значений.
 * Возвращает число, либо `'#CYCLE'`/`'#ERR'` при ошибках.
 */
export function evalSingleFormula(formula: string, scope: StoreScope): number | '#ERR' | '#CYCLE' {
  const trimmed = stripLeadingEquals(String(formula ?? '').trim());
  if (!trimmed) return 0;

  const expr = substituteIdentifiers(trimmed, scope);
  // Простой случай: только числа и операторы — eval через Function
  if (/^[\d\s+\-*/().,%]+$/.test(expr)) {
    try {
      const result = new Function('return (' + expr.replace(/(\d),(\d)/g, '$1.$2') + ')')();
      if (typeof result === 'number' && Number.isFinite(result)) return result;
    } catch {
      // fallthrough to fast-formula-parser
    }
  }
  try {
    const parser = getParser();
    const result = parser.parse(expr, { row: 1, col: 1, sheet: 'Store' });
    if (typeof result === 'number' && Number.isFinite(result)) return result;
    if (typeof result === 'boolean') return result ? 1 : 0;
    if (typeof result === 'string') {
      const parsed = Number.parseFloat(result);
      return Number.isFinite(parsed) ? parsed : '#ERR';
    }
    return '#ERR';
  } catch {
    return '#ERR';
  }
}

/**
 * Извлечь идентификаторы из формулы (для построения графа зависимостей).
 * Возвращает имена, которые присутствуют в `formulas` или `manualKeys`.
 */
function extractDependencies(
  formula: string,
  formulas: StoreFormulas,
  manualKeys: Set<string>,
): string[] {
  const trimmed = stripLeadingEquals(String(formula ?? '').trim());
  const candidates = new Set<string>();
  for (const match of trimmed.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const ident = match[0];
    if (formulas[ident] !== undefined || manualKeys.has(ident)) candidates.add(ident);
  }
  return Array.from(candidates);
}

/**
 * Вычислить все формулы строки с учётом зависимостей.
 *
 * @param manualValues — значения колонок-вводов (после применения bindings).
 * @param formulas    — карта `colId -> формула`.
 * @returns карта `colId -> число | '#CYCLE' | '#ERR'`.
 */
export function evalRowFormulas(
  manualValues: StoreScope,
  formulas: StoreFormulas,
): Record<string, number | '#CYCLE' | '#ERR'> {
  const results: Record<string, number | '#CYCLE' | '#ERR'> = {};
  const visiting = new Set<string>();
  const cache = new Map<string, number | '#CYCLE' | '#ERR'>();
  const manualKeys = new Set(Object.keys(manualValues));

  function getValue(key: string): number | '#CYCLE' | '#ERR' {
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key)) {
      cache.set(key, '#CYCLE');
      return '#CYCLE';
    }
    const formula = formulas[key];
    if (formula === undefined || formula === '') {
      const v = manualValues[key];
      const num = asNumber(v);
      cache.set(key, num);
      return num;
    }
    visiting.add(key);
    const deps = extractDependencies(formula, formulas, manualKeys);
    const scope: StoreScope = { ...manualValues };
    let cycled = false;
    for (const dep of deps) {
      if (dep === key) {
        cycled = true;
        continue;
      }
      const val = getValue(dep);
      if (val === '#CYCLE') {
        cycled = true;
        scope[dep] = 0;
      } else if (val === '#ERR') {
        scope[dep] = 0;
      } else {
        scope[dep] = val;
      }
    }
    visiting.delete(key);
    if (cycled) {
      cache.set(key, '#CYCLE');
      return '#CYCLE';
    }
    const computed = evalSingleFormula(formula, scope);
    cache.set(key, computed);
    return computed;
  }

  for (const key of Object.keys(formulas)) {
    results[key] = getValue(key);
  }
  return results;
}
