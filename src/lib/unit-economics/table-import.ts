// PURPOSE: Источник-агностичный слой «умного импорта» в блок «Мой магазин · таблица».
// Нормализованная модель таблицы (ImportTable) + сопоставление колонок по названию
// + построение/применение плана импорта (matched → существующая колонка,
// без матча → новая; merge/replace; перезапись значений/формул; пропуск категорий).
//
// Используется и на сервере (нормализация конфигов блоков), и на клиенте (модалка,
// merge в config). Чистый TS без client-only зависимостей.

export type ImportColumnType = 'number' | 'percent' | 'money' | 'text' | 'formula';

/** Колонка нормализованной таблицы-источника. `type` — тип-значение (не формула),
 * `formula` (если есть) — блочная формула на ключах колонок этой же таблицы. */
export type ImportColumn = {
  /** Стабильный идентификатор-источник (валидный JS-идентификатор). */
  key: string;
  label: string;
  type: ImportColumnType;
  unit?: string;
  /** Блочная формула вида `=keyA*keyB` (ссылки = key других колонок). */
  formula?: string;
  /** Роль для идентификации строки (имя/артикул). */
  role?: 'name' | 'article';
};

export type ImportRow = {
  article: string;
  name: string;
  /** Значения по ключам колонок (для не-формульных и кэш формульных). */
  values: Record<string, number | string>;
  /** Строка-категория (есть название, но нет «денежных» значений). */
  isCategory?: boolean;
};

export type ImportTable = {
  columns: ImportColumn[];
  rows: ImportRow[];
  source: {
    kind: 'xlsx' | 'block';
    label: string;
    sheetName?: string;
    blockType?: string;
  };
};

/** Минимальная форма целевой колонки блока «Мой магазин». */
export type TargetColumn = {
  id: string;
  label: string;
  type: string;
  unit?: string;
  formula?: string;
  width?: number;
  positive?: boolean;
  hidden?: boolean;
};

/** Минимальная форма целевой строки блока «Мой магазин». */
export type TargetRow = {
  id: string;
  article: string;
  name: string;
  values: Record<string, number | string>;
  bindings: Record<string, unknown>;
};

// ============================================================================
// Транслитерация и slug → валидный идентификатор формул
// ============================================================================

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterate(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    out += TRANSLIT[ch] ?? ch;
  }
  return out;
}

/**
 * Превращает произвольную метку в валидный идентификатор формул (camelCase,
 * начинается с буквы). Гарантирует уникальность относительно `taken`.
 */
export function slugifyIdentifier(label: string, taken: Set<string>): string {
  const translit = transliterate(label.trim());
  const words = translit
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  let base = words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  if (!base) base = 'col';
  if (!/^[a-zA-Z_$]/.test(base)) base = `c_${base}`;
  let candidate = base;
  let n = 1;
  while (taken.has(candidate)) {
    candidate = `${base}${++n}`;
  }
  taken.add(candidate);
  return candidate;
}

/** Нормализует метку для сопоставления (lower, ё→е, без пробелов/пунктуации). */
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

// ============================================================================
// Преобразование значений по типу
// ============================================================================

// Деньги: цены/себестоимость/прибыль/выручка/налог-как-сумма и т.п.
// (без \b — в JS \b не работает с кириллицей).
const MONEY_RE = /цен|себес|маржа|приб|выручк|стоим|оборот|доход|расход|налог|наценк|₽|руб|rub|cost|price|margin|profit|revenue/i;
// Процент: только однозначно-процентные термины. Налог/НДС/комиссия —
// неоднозначны (бывают и суммой), поэтому распознаются процентом лишь по
// формату ячейки '%', а не по названию.
const PERCENT_RE = /%|процент|маржинальн|рентабельн|дрр|drr|ctr|конверси/i;

/** Эвристика типа колонки по метке (когда формат XLSX не даёт точного типа). */
export function guessTypeFromLabel(label: string): ImportColumnType {
  if (PERCENT_RE.test(label)) return 'percent';
  if (MONEY_RE.test(label)) return 'money';
  return 'number';
}

// ============================================================================
// Конвертация формул Excel → блочные формулы
// ============================================================================

/**
 * Конвертирует постфиксный Excel-оператор `%` в деление на 100.
 * `100%` → `(100/100)`, `(100-31)%` → `((100-31)/100)`, `key%` → `(key/100)`.
 */
export function convertExcelPercent(expr: string): string {
  let out = expr;
  // number% и identifier%
  out = out.replace(/(\d+(?:[.,]\d+)?)%/g, '($1/100)');
  out = out.replace(/([A-Za-z_$][A-Za-z0-9_$]*)%/g, '($1/100)');
  // (...)%  — ищем '%' сразу после ')' и оборачиваем сбалансированную группу
  let guard = 0;
  while (guard++ < 100) {
    const pctIdx = findParenPercent(out);
    if (pctIdx < 0) break;
    // pctIdx указывает на '%', перед ним ')'
    const closeIdx = pctIdx - 1;
    let depth = 0;
    let openIdx = -1;
    for (let i = closeIdx; i >= 0; i--) {
      if (out[i] === ')') depth++;
      else if (out[i] === '(') {
        depth--;
        if (depth === 0) {
          openIdx = i;
          break;
        }
      }
    }
    if (openIdx < 0) break;
    const group = out.slice(openIdx, closeIdx + 1); // включает скобки
    out = `${out.slice(0, openIdx)}(${group}/100)${out.slice(pctIdx + 1)}`;
  }
  return out;
}

function findParenPercent(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '%' && s[i - 1] === ')') return i;
  }
  return -1;
}

/**
 * Результат конвертации одной Excel-формулы для конкретной колонки.
 * `ok=false` → формулу нельзя представить per-row (диапазоны / cross-row) —
 * колонку импортируем как значение.
 */
export type FormulaConversion =
  | { ok: true; formula: string }
  | { ok: false; reason: string };

/**
 * Конвертирует Excel-формулу (из ячейки строки `excelRow`) в блочную формулу.
 * Ссылки на ячейки той же строки → key соответствующей колонки.
 * Cross-row ссылки → подстановка значения из `crossRowValue(addr)` (константа).
 * Диапазоны (A1:B3) не поддержаны → ok:false.
 *
 * @param letterToKey  карта «буква колонки Excel» → key колонки таблицы.
 */
export function convertExcelFormula(
  raw: string,
  excelRow: number,
  letterToKey: Map<string, string>,
  crossRowValue?: (col: string, row: number) => number | null,
): FormulaConversion {
  let expr = raw.startsWith('=') ? raw.slice(1) : raw;

  // Диапазоны не поддерживаются в per-row модели.
  if (/[A-Z]+\d+\s*:\s*[A-Z]+\d+/.test(expr)) {
    return { ok: false, reason: 'range' };
  }

  // Заменяем ссылки на ячейки: COL + ROW (с опц. $). Lookbehind/ahead защищают
  // от ложных совпадений внутри идентификаторов/имён функций.
  expr = expr.replace(/(?<![A-Za-z0-9_$])\$?([A-Z]{1,3})\$?(\d+)(?![A-Za-z0-9_$])/g, (match, col: string, rowStr: string) => {
    const row = Number(rowStr);
    if (row === excelRow) {
      const key = letterToKey.get(col);
      return key ?? match;
    }
    // cross-row → константа
    const v = crossRowValue?.(col, row);
    return v !== null && v !== undefined ? `(${v})` : '0';
  });

  expr = convertExcelPercent(expr);

  return { ok: true, formula: `=${expr}` };
}

// ============================================================================
// Сопоставление колонок и план импорта
// ============================================================================

export type ColumnMapping = {
  column: ImportColumn;
  include: boolean;
  /** Целевой id колонки блока (существующей или новой). */
  targetId: string;
  /** true — создаём новую колонку. */
  isNew: boolean;
  /** Импортировать как формулу (если у колонки есть formula). */
  asFormula: boolean;
  /** Метка существующей колонки при матче (для UI). */
  matchedLabel?: string;
};

export type ImportOptions = {
  matchBy: 'article' | 'name';
  mode: 'merge' | 'replace';
  /** Политика для колонок, совпавших с существующими. */
  overwriteMatched: 'values' | 'values_and_formulas' | 'skip';
  skipCategoryRows: boolean;
};

/**
 * Строит дефолтные сопоставления: матч по нормализованной метке с существующими
 * колонками блока; иначе — новая колонка с уникальным id.
 */
export function buildDefaultMappings(
  table: ImportTable,
  existingColumns: TargetColumn[],
): ColumnMapping[] {
  const byLabel = new Map<string, TargetColumn>();
  for (const c of existingColumns) byLabel.set(normalizeLabel(c.label), c);
  const taken = new Set<string>(existingColumns.map((c) => c.id));

  const mappings: ColumnMapping[] = [];
  for (const column of table.columns) {
    // identity-роли матчатся к зарезервированным article/name (не отдельные колонки).
    if (column.role === 'name' || column.role === 'article') continue;
    const match = byLabel.get(normalizeLabel(column.label));
    if (match) {
      mappings.push({
        column,
        include: true,
        targetId: match.id,
        isNew: false,
        asFormula: Boolean(column.formula),
        matchedLabel: match.label,
      });
    } else {
      const targetId = slugifyIdentifier(column.key || column.label, taken);
      mappings.push({
        column,
        include: true,
        targetId,
        isNew: true,
        asFormula: Boolean(column.formula),
      });
    }
  }
  return mappings;
}

/** Переписывает формулу с key-источников на целевые id колонок. */
function rewriteFormula(formula: string, keyToTarget: Map<string, string>): string {
  const body = formula.startsWith('=') ? formula.slice(1) : formula;
  // По убыванию длины ключа — чтобы `price` не съел `priceRetail`.
  const keys = Array.from(keyToTarget.keys()).sort((a, b) => b.length - a.length);
  let out = body;
  for (const key of keys) {
    const target = keyToTarget.get(key)!;
    if (key === target) continue;
    const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_$])${safe}(?![A-Za-z0-9_$])`, 'g');
    out = out.replace(re, target);
  }
  return `=${out}`;
}

/** Идентификаторы, встречающиеся в формуле. */
function formulaTokens(formula: string): string[] {
  const body = formula.startsWith('=') ? formula.slice(1) : formula;
  return body.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
}

export type ApplyResult = {
  columns: TargetColumn[];
  rows: TargetRow[];
  stats: {
    rowsAdded: number;
    rowsUpdated: number;
    columnsAdded: number;
    columnsMatched: number;
    rowsSkipped: number;
  };
};

/**
 * Применяет план импорта к текущим columns/rows блока.
 * Возвращает новые columns/rows (без мутации входа) + статистику.
 */
export function applyImportPlan(args: {
  table: ImportTable;
  mappings: ColumnMapping[];
  options: ImportOptions;
  existingColumns: TargetColumn[];
  existingRows: TargetRow[];
  makeId: (prefix: string) => string;
}): ApplyResult {
  const { table, options, existingColumns, existingRows, makeId } = args;

  // 1. Карта key → mapping (только потенциально включаемые).
  const mappingByKey = new Map<string, ColumnMapping>();
  for (const m of args.mappings) mappingByKey.set(m.column.key, m);

  // 2. Замыкание зависимостей: формула включённой колонки тянет за собой
  //    колонки, на которые ссылается (иначе формула сломается).
  const include = new Set<string>();
  for (const m of args.mappings) if (m.include) include.add(m.column.key);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (const key of Array.from(include)) {
      const m = mappingByKey.get(key);
      if (!m || !m.asFormula || !m.column.formula) continue;
      for (const tok of formulaTokens(m.column.formula)) {
        if (mappingByKey.has(tok) && !include.has(tok)) {
          include.add(tok);
          changed = true;
        }
      }
    }
  }

  // 3. key → targetId (для переписи формул).
  const keyToTarget = new Map<string, string>();
  for (const m of args.mappings) {
    if (include.has(m.column.key)) keyToTarget.set(m.column.key, m.targetId);
  }

  // 4. Колонки.
  const columns: TargetColumn[] = existingColumns.map((c) => ({ ...c }));
  const colById = new Map(columns.map((c) => [c.id, c]));
  let columnsAdded = 0;
  let columnsMatched = 0;

  for (const m of args.mappings) {
    if (!include.has(m.column.key)) continue;
    const useFormula = m.asFormula && Boolean(m.column.formula);
    if (m.isNew) {
      const col: TargetColumn = {
        id: m.targetId,
        label: m.column.label,
        type: useFormula ? 'formula' : m.column.type,
        unit: m.column.unit,
        width: m.column.type === 'text' ? 160 : useFormula ? 120 : 100,
      };
      if (useFormula && m.column.formula) {
        col.formula = rewriteFormula(m.column.formula, keyToTarget);
        col.positive = true;
      }
      columns.push(col);
      colById.set(col.id, col);
      columnsAdded++;
    } else {
      columnsMatched++;
      const existing = colById.get(m.targetId);
      if (existing && options.overwriteMatched === 'values_and_formulas' && useFormula && m.column.formula) {
        existing.type = 'formula';
        existing.formula = rewriteFormula(m.column.formula, keyToTarget);
      }
    }
  }

  // 5. Строки.
  const dataKeys = args.mappings
    .filter((m) => include.has(m.column.key))
    .filter((m) => {
      const col = colById.get(m.targetId);
      return col?.type !== 'formula'; // в формульные колонки значения не пишем
    });

  const keyField = (r: { article: string; name: string }) =>
    normalizeLabel(options.matchBy === 'name' ? r.name : r.article);

  const baseRows: TargetRow[] = options.mode === 'replace' ? [] : existingRows.map((r) => ({
    ...r,
    values: { ...r.values },
    bindings: { ...r.bindings },
  }));
  const byKey = new Map<string, TargetRow>();
  for (const r of baseRows) {
    const k = keyField(r);
    if (k) byKey.set(k, r);
  }

  let rowsAdded = 0;
  let rowsUpdated = 0;
  let rowsSkipped = 0;
  const order: TargetRow[] = [...baseRows];

  for (const importRow of table.rows) {
    if (options.skipCategoryRows && importRow.isCategory) {
      rowsSkipped++;
      continue;
    }
    const k = keyField(importRow);
    if (!k) {
      rowsSkipped++;
      continue;
    }
    const existing = byKey.get(k);
    if (existing) {
      for (const m of dataKeys) {
        if (!m.isNew && options.overwriteMatched === 'skip') continue;
        const v = importRow.values[m.column.key];
        if (v !== undefined && v !== '') existing.values[m.targetId] = v;
      }
      if (!existing.article && importRow.article) existing.article = importRow.article;
      if (!existing.name && importRow.name) existing.name = importRow.name;
      rowsUpdated++;
    } else {
      const values: Record<string, number | string> = {};
      for (const m of dataKeys) {
        const v = importRow.values[m.column.key];
        if (v !== undefined && v !== '') values[m.targetId] = v;
      }
      const row: TargetRow = {
        id: makeId('r'),
        article: importRow.article,
        name: importRow.name,
        values,
        bindings: {},
      };
      byKey.set(k, row);
      order.push(row);
      rowsAdded++;
    }
  }

  return {
    columns,
    rows: order,
    stats: { rowsAdded, rowsUpdated, columnsAdded, columnsMatched, rowsSkipped },
  };
}
