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
  discountPct: boolean;
  cost: boolean;
  stock: boolean;
  volumeL: boolean;
  commissionPct: boolean;
  buyoutPct: boolean;
  drrPct: boolean;
  salesPerMonth: boolean;
};

export type OzonBlockSyncSettings = {
  accountId: string | null;
  conflictPolicy: 'overwrite' | 'fill-empty' | 'skip';
  matchBy: 'article' | 'sku';
  columnMap: OzonBlockSyncColumnMap;
  treatZeroAsEmpty: boolean;
  /**
   * Источник остатка для колонки Stock:
   *   - 'mode-aware' — следовать global.mode блока (FBO→stockMarketplace, FBS→stockOwn);
   *   - 'fbo'        — всегда брать stockMarketplace (склады Ozon);
   *   - 'fbs'        — всегда брать stockOwn (ваши склады + cross-border);
   *   - 'sum'        — суммировать обе ветки (legacy-поведение).
   */
  stockSource: 'mode-aware' | 'fbo' | 'fbs' | 'sum';
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
  | 'discountPct'
  | 'cost'
  | 'stock'
  | 'volumeL'
  | 'commissionPct'
  | 'buyoutPct'
  | 'drrPct'
  | 'salesPerMonth';

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
  discountPct: 'Скидка, %',
  cost: 'Себестоимость',
  stock: 'Остаток',
  volumeL: 'Объём, л',
  commissionPct: 'Комиссия, %',
  buyoutPct: 'Выкуп, %',
  drrPct: 'ДРР, %',
  salesPerMonth: 'Продаж/мес',
};

// Маппинг сync-полей → input-ключ в row.inputs. article/name — на верхнем уровне.
const INPUT_FIELD_MAP: Partial<Record<DiffField, string>> = {
  price: 'price',
  discountPct: 'discountPct',
  cost: 'cost',
  stock: 'stock',
  volumeL: 'volumeL',
  commissionPct: 'commissionPct',
  buyoutPct: 'buyoutPct',
  drrPct: 'drrPct',
  salesPerMonth: 'salesPerMonth',
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

/**
 * Резолверит число штук на остатке для записи в Stock-колонку блока в
 * зависимости от stockSource и текущего режима блока. См. подробности в
 * описании поля `OzonBlockSyncSettings.stockSource`.
 */
export function resolveStock(
  product: SyncOzonProduct,
  mode: 'fbo' | 'fbs',
  stockSource: OzonBlockSyncSettings['stockSource'],
): number {
  const fbo = product.stockMarketplace ?? 0;
  const fbs = product.stockOwn ?? 0;
  switch (stockSource) {
    case 'fbo':
      return fbo;
    case 'fbs':
      return fbs;
    case 'sum':
      return fbo + fbs;
    case 'mode-aware':
    default:
      return mode === 'fbo' ? fbo : fbs;
  }
}

/** Целевое значение поля из продукта Ozon (в «human» юнитах, не в копейках). */
function getProductValue(
  field: DiffField,
  product: SyncOzonProduct,
  mode: 'fbo' | 'fbs',
  stockSource: OzonBlockSyncSettings['stockSource'],
): string | number | null {
  switch (field) {
    case 'article':
      return product.article ?? '';
    case 'name':
      return product.name ?? '';
    case 'price': {
      // Приоритет: marketing_seller_price (актуальная цена с SPP/промо) → priceKopecks (базовая).
      // priceKopecks=0 трактуем как «нет данных»: иначе diff предложит
      // перезаписать пользовательский ввод (5990) нулём.
      const marketingPriceRub = Number((product.metadata as Record<string, unknown> | null)?.priceWithSpp ?? 0);
      if (marketingPriceRub > 0) return marketingPriceRub;
      return product.priceKopecks > 0 ? product.priceKopecks / 100 : null;
    }
    case 'cost':
      return product.costKopecks > 0 ? product.costKopecks / 100 : null;
    case 'stock':
      return resolveStock(product, mode, stockSource);
    case 'volumeL': {
      // в БД хранится x100 (например 1.5л → 150). Делим на 100 для блока.
      // volumeL=0 трактуем как «не заполнено в Ozon» — не перезаписываем
      // пользовательский ввод.
      const v = product.volumeL ?? 0;
      return v > 0 ? v / 100 : null;
    }
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
    case 'discountPct': {
      // Скидка = (basePrice - marketingPrice) / basePrice * 100
      const meta = product.metadata as Record<string, unknown> | null;
      const mktPrice = Number(meta?.priceWithSpp ?? 0);
      const basePrice = product.priceKopecks > 0 ? product.priceKopecks / 100 : 0;
      if (basePrice > 0 && mktPrice > 0 && mktPrice < basePrice) {
        return Math.round(((basePrice - mktPrice) / basePrice) * 100 * 10) / 10;
      }
      return null;
    }
    case 'drrPct': {
      const drr = (product as SyncOzonProduct & { drrPct?: number | null }).drrPct;
      return typeof drr === 'number' ? drr : null;
    }
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
    'discountPct',
    'cost',
    'stock',
    'volumeL',
    'commissionPct',
    'buyoutPct',
    'drrPct',
    'salesPerMonth',
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
        const after = getProductValue(field, product, mode, sync.stockSource);
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
      const after = getProductValue(field, product, mode, sync.stockSource);
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
