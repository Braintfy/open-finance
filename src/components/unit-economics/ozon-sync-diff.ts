// PURPOSE: Pure-function diff builder для применения данных синхронизации
// Ozon к строкам блока unit.ozon-multi-table. Testable, без побочных эффектов.
//
// Логика:
//   1) Индексируем currentRows по matchBy (article|sku).
//   2) Для каждого ozonProduct:
//      - Если match — собираем cell-by-cell diff по columnMap.
//        policy='skip'       → если в любой columnMap-колонке row уже есть значение → skip всю строку.
//        policy='fill-empty' → обновляем только пустые ячейки (treatZeroAsEmpty).
//        policy='overwrite'  → обновляем все ячейки из columnMap.
//      - Если match не найден — action='create'.
//   3) Для строк без match с Ozon → unchanged.
//   4) commissionPct берётся из metadata.commissions.{fboPct|fbsPct} в зависимости от mode.
//   5) salesPerMonth/buyoutPct — из агрегатов (если переданы).

export type OzonBlockSyncColumnMap = {
  article: boolean;
  name: boolean;
  price: boolean;
  cost: boolean;
  stock: boolean;
  volumeL: boolean;
  commissionPct: boolean;
  salesPerMonth: boolean;
  buyoutPct: boolean;
};

export type OzonBlockSyncSettings = {
  accountId: string | null;
  conflictPolicy: 'overwrite' | 'fill-empty' | 'skip';
  matchBy: 'article' | 'sku';
  columnMap: OzonBlockSyncColumnMap;
  treatZeroAsEmpty: boolean;
};

export type SyncRowSnapshot = {
  id: string;
  productId?: string | null;
  article: string;
  name: string;
  inputs: Record<string, unknown>;
  bindings: Record<string, unknown>;
};

export type SyncOzonProduct = {
  id: string;
  article: string | null;
  sku: string | null;
  name: string;
  priceKopecks: number;
  costKopecks: number;
  stockMarketplace: number;
  stockOwn: number;
  /** volumeL хранится в БД как x100 (см. unit-economics/types.ts) */
  volumeL: number;
  metadata?: Record<string, unknown> | null;
  /** Опциональные агрегаты из include=aggregates */
  salesPerMonth?: number | null;
  buyoutPct?: number | null;
};

export type CellAction = 'create' | 'update' | 'skip' | 'unchanged';

export type DiffField =
  | 'article'
  | 'name'
  | 'price'
  | 'cost'
  | 'stock'
  | 'volumeL'
  | 'commissionPct'
  | 'salesPerMonth'
  | 'buyoutPct';

export type CellChange = {
  /** article исходной строки или 'NEW:{ozonArticle}' для новых строк */
  rowKey: string;
  rowName: string;
  field: DiffField;
  fieldLabel: string;
  before: string | number | null;
  after: string | number | null;
  action: CellAction;
  /** Причина skip (для UI tooltip) */
  reason?: string;
};

export type SyncDiff = {
  totals: {
    newRows: number;
    updatedRows: number;
    skippedRows: number;
    unchangedRows: number;
    cellsChanged: number;
    cellsSkipped: number;
  };
  changes: CellChange[];
  /** Полностью готовые ряды для persist({ rows }) */
  resultRows: SyncRowSnapshot[];
};

export const FIELD_LABELS: Record<DiffField, string> = {
  article: 'Артикул',
  name: 'Название',
  price: 'Цена',
  cost: 'Себестоимость',
  stock: 'Остаток',
  volumeL: 'Объём, л',
  commissionPct: 'Комиссия, %',
  salesPerMonth: 'Продаж/мес',
  buyoutPct: 'Выкуп, %',
};

// Маппинг сync-полей → input-ключ в row.inputs. article/name — на верхнем уровне.
const INPUT_FIELD_MAP: Partial<Record<DiffField, string>> = {
  price: 'price',
  cost: 'cost',
  stock: 'stock',
  volumeL: 'volumeL',
  commissionPct: 'commissionPct',
  salesPerMonth: 'salesPerMonth',
  buyoutPct: 'buyoutPct',
};

function makeRowId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}_${crypto.randomUUID().slice(0, 8)}`
    : `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function isEmpty(value: unknown, treatZeroAsEmpty: boolean): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return true;
    if (treatZeroAsEmpty && value === 0) return true;
    return false;
  }
  return false;
}

/** Текущее значение поля в строке (нормализованное). */
function getRowValue(row: SyncRowSnapshot, field: DiffField): string | number | null {
  if (field === 'article') return row.article ?? '';
  if (field === 'name') return row.name ?? '';
  const key = INPUT_FIELD_MAP[field];
  if (!key) return null;
  const raw = row.inputs[key];
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const num = Number(raw.replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/** Целевое значение поля из продукта Ozon (в «human» юнитах, не в копейках). */
function getProductValue(
  field: DiffField,
  product: SyncOzonProduct,
  mode: 'fbo' | 'fbs',
): string | number | null {
  switch (field) {
    case 'article':
      return product.article ?? '';
    case 'name':
      return product.name ?? '';
    case 'price':
      return product.priceKopecks / 100;
    case 'cost':
      return product.costKopecks / 100;
    case 'stock':
      return (product.stockMarketplace ?? 0) + (product.stockOwn ?? 0);
    case 'volumeL':
      // в БД хранится x100 (например 1.5л → 150). Делим на 100 для блока.
      return (product.volumeL ?? 0) / 100;
    case 'commissionPct': {
      const commissions = (product.metadata?.commissions ?? null) as
        | { fboPct?: number | null; fbsPct?: number | null }
        | null;
      if (!commissions) return null;
      const pct = mode === 'fbo' ? commissions.fboPct : commissions.fbsPct;
      return typeof pct === 'number' ? pct : null;
    }
    case 'salesPerMonth':
      return typeof product.salesPerMonth === 'number' ? product.salesPerMonth : null;
    case 'buyoutPct':
      return typeof product.buyoutPct === 'number' ? product.buyoutPct : null;
    default:
      return null;
  }
}

/** Применяет одно изменение к строке (immutable copy). */
function applyChange(
  row: SyncRowSnapshot,
  field: DiffField,
  value: string | number | null,
): SyncRowSnapshot {
  if (value === null || value === undefined) return row;
  if (field === 'article') return { ...row, article: String(value) };
  if (field === 'name') return { ...row, name: String(value) };
  const key = INPUT_FIELD_MAP[field];
  if (!key) return row;
  return {
    ...row,
    inputs: { ...row.inputs, [key]: value },
  };
}

/** Список полей по columnMap (отфильтрованные включённые). */
function enabledFields(columnMap: OzonBlockSyncColumnMap): DiffField[] {
  const all: DiffField[] = [
    'article',
    'name',
    'price',
    'cost',
    'stock',
    'volumeL',
    'commissionPct',
    'salesPerMonth',
    'buyoutPct',
  ];
  return all.filter((f) => columnMap[f]);
}

export type BuildDiffOptions = {
  currentRows: SyncRowSnapshot[];
  ozonProducts: SyncOzonProduct[];
  sync: OzonBlockSyncSettings;
  mode: 'fbo' | 'fbs';
};

export function buildSyncDiff(opts: BuildDiffOptions): SyncDiff {
  const { currentRows, ozonProducts, sync, mode } = opts;
  const fields = enabledFields(sync.columnMap);
  const matchKey = sync.matchBy;

  // Индекс currentRows по matchBy. Дубликаты — last-wins, добавляем warning?
  // Для простоты — last-wins, считаем дубликат как ошибку модели данных.
  const index = new Map<string, SyncRowSnapshot>();
  const indexKeyForRow = (r: SyncRowSnapshot): string | null => {
    if (matchKey === 'article') return r.article ? r.article.trim().toLowerCase() : null;
    // matchBy=sku — у row есть productId (sku в нашей схеме), но fallback на article если sku нет
    return r.productId ? String(r.productId) : null;
  };
  for (const r of currentRows) {
    const k = indexKeyForRow(r);
    if (k) index.set(k, r);
  }

  const matchedKeys = new Set<string>();
  const changes: CellChange[] = [];
  let newRows = 0;
  let updatedRows = 0;
  let skippedRows = 0;
  let cellsChanged = 0;
  let cellsSkipped = 0;

  const resultRowsById = new Map<string, SyncRowSnapshot>();
  for (const r of currentRows) resultRowsById.set(r.id, r);

  for (const product of ozonProducts) {
    const productKey =
      matchKey === 'article'
        ? (product.article ?? '').trim().toLowerCase()
        : String(product.id ?? '');
    if (!productKey) continue;

    const existing = index.get(productKey);

    if (!existing) {
      // CREATE: новая строка со всеми включёнными полями.
      const baseRow: SyncRowSnapshot = {
        id: makeRowId('r'),
        productId: product.id,
        article: '',
        name: '',
        inputs: {},
        bindings: {},
      };
      let newRow = baseRow;
      for (const field of fields) {
        const after = getProductValue(field, product, mode);
        if (after === null) continue;
        newRow = applyChange(newRow, field, after);
        changes.push({
          rowKey: `NEW:${product.article ?? product.id}`,
          rowName: product.name ?? '',
          field,
          fieldLabel: FIELD_LABELS[field],
          before: null,
          after,
          action: 'create',
        });
        cellsChanged += 1;
      }
      newRows += 1;
      resultRowsById.set(newRow.id, newRow);
      continue;
    }

    matchedKeys.add(productKey);

    // UPDATE: cell-by-cell. Сначала проверяем policy='skip'.
    if (sync.conflictPolicy === 'skip') {
      const rowHasAnyValue = fields.some((f) => {
        // Не считаем article/name (это идентификаторы, а не «данные»).
        if (f === 'article' || f === 'name') return false;
        const cur = getRowValue(existing, f);
        return !isEmpty(cur, sync.treatZeroAsEmpty);
      });
      if (rowHasAnyValue) {
        // Пропускаем всю строку.
        changes.push({
          rowKey: existing.article,
          rowName: existing.name,
          field: 'name', // sentinel; UI покажет «вся строка пропущена»
          fieldLabel: 'Строка',
          before: 'есть данные',
          after: 'не изменено',
          action: 'skip',
          reason: 'Строка содержит ручные данные. Политика конфликтов — «пропустить заполненные».',
        });
        skippedRows += 1;
        continue;
      }
    }

    let modifiedRow = existing;
    let rowHasChanges = false;
    let rowSkippedCells = 0;
    for (const field of fields) {
      const before = getRowValue(existing, field);
      const after = getProductValue(field, product, mode);
      if (after === null || after === undefined) continue;
      // Для article/name skip если ничего не изменилось.
      const stringBefore = before === null ? '' : String(before);
      const stringAfter = after === null ? '' : String(after);
      if (stringBefore === stringAfter) continue;

      // policy === 'fill-empty' — обновляем только пустые ячейки.
      if (sync.conflictPolicy === 'fill-empty') {
        if (!isEmpty(before, sync.treatZeroAsEmpty)) {
          changes.push({
            rowKey: existing.article,
            rowName: existing.name,
            field,
            fieldLabel: FIELD_LABELS[field],
            before,
            after,
            action: 'skip',
            reason: 'Ячейка уже заполнена. Политика — «дополнить пустые».',
          });
          rowSkippedCells += 1;
          continue;
        }
      }
      modifiedRow = applyChange(modifiedRow, field, after);
      changes.push({
        rowKey: existing.article,
        rowName: existing.name,
        field,
        fieldLabel: FIELD_LABELS[field],
        before,
        after,
        action: 'update',
      });
      cellsChanged += 1;
      rowHasChanges = true;
    }

    cellsSkipped += rowSkippedCells;
    if (rowHasChanges) {
      updatedRows += 1;
      resultRowsById.set(modifiedRow.id, modifiedRow);
    }
  }

  const unchangedRows = currentRows.length - updatedRows - skippedRows;

  // Финальный список — сначала исходный порядок текущих строк (с правками),
  // затем новые строки (в порядке их появления в ozonProducts).
  const resultRows: SyncRowSnapshot[] = [];
  const newRowIds = new Set<string>();
  for (const r of currentRows) {
    resultRows.push(resultRowsById.get(r.id) ?? r);
  }
  for (const [id, row] of resultRowsById) {
    if (!currentRows.some((r) => r.id === id) && !newRowIds.has(id)) {
      newRowIds.add(id);
      resultRows.push(row);
    }
  }

  return {
    totals: {
      newRows,
      updatedRows,
      skippedRows,
      unchangedRows: Math.max(0, unchangedRows),
      cellsChanged,
      cellsSkipped,
    },
    changes,
    resultRows,
  };
}
