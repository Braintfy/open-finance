// PURPOSE: Удаление cross-block ссылок из импортируемого config'а.
//
// При импорте блока в другой проект/аккаунт ссылки на _другие блоки_
// становятся битыми. Этот модуль:
//   1. Рекурсивно сканирует config и считает / описывает найденные ссылки.
//   2. Возвращает deep-clone без этих ссылок (для безопасного применения).
//
// Что зачищается:
//   - dependencies.sources[]              — массив очищается
//   - config.blockRefs / config.moneyRefs — объекты очищаются
//   - config.sourceBinding                — { mode: 'empty' }
//   - config.defaultSourceBinding         — { mode: 'empty' }
//   - rows[].cells[].ref / cells.ref      — поле удаляется
//   - rows[].bindings                     — объект очищается (my-store-table)
//   - cell.sourceBindingOverride (kpi.grid cells) — { mode: 'empty' }
//
// Формулы с @-токенами в строках (sheet cells, custom-data formula text,
// excel.cell value) НЕ изменяются — пользователь увидит #REF! в UI и сможет
// перепривязать. В preview просто считаем такие токены.

import type { BlockDependencies, BlockInstance } from '../types';
import type { ScrubbedRef } from './types';

const FORMULA_REF_RE = /@([A-Za-z0-9_.:-]+)/g;

const EMPTY_BINDING = { mode: 'empty' as const };

export type ScrubResult = {
  /** Зачищенный config (deep clone). */
  config: Record<string, unknown>;
  /** Зачищенные dependencies (или undefined если их не было). */
  dependencies?: BlockDependencies;
  /** Описание того, что было зачищено. */
  scrubbed: ScrubbedRef[];
};

/** Глубокая копия. JSON-clone безопасен — config всегда сериализуется в JSON в DB. */
function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Зачищает cross-refs из payload, возвращает deep clone + список зачищенного.
 *
 * @param config        исходный config блока (immutable, не модифицируется)
 * @param dependencies  исходные dependencies блока
 */
export function scrubCrossRefs(
  config: Record<string, unknown> | undefined,
  dependencies: BlockDependencies | undefined,
): ScrubResult {
  const scrubbed: ScrubbedRef[] = [];
  const result: Record<string, unknown> = config ? cloneDeep(config) : {};

  // 1. dependencies.sources
  let nextDeps: BlockDependencies | undefined;
  if (dependencies && Array.isArray(dependencies.sources) && dependencies.sources.length > 0) {
    scrubbed.push({
      kind: 'dependencies',
      description: `${dependencies.sources.length} источник(а) формулы`,
    });
    nextDeps = { ...cloneDeep(dependencies), sources: [] };
  } else if (dependencies) {
    nextDeps = cloneDeep(dependencies);
  }

  // 2. config.blockRefs + config.moneyRefs
  if (isPlainObject(result.blockRefs)) {
    const count = Object.keys(result.blockRefs as Record<string, unknown>).length;
    if (count > 0) {
      scrubbed.push({
        kind: 'blockRefs',
        description: `${count} @-ссылк${count === 1 ? 'а' : count < 5 ? 'и' : 'ок'} на другие блоки`,
      });
      result.blockRefs = {};
      if (isPlainObject(result.moneyRefs)) result.moneyRefs = {};
    }
  }

  // 3. config.sourceBinding (cashflow-bound блоки)
  const sb = result.sourceBinding;
  if (isPlainObject(sb) && (sb as Record<string, unknown>).mode === 'block') {
    scrubbed.push({
      kind: 'binding',
      description: 'Привязка к блоку-источнику cashflow',
    });
    result.sourceBinding = { ...EMPTY_BINDING };
  }

  // 4. config.defaultSourceBinding (kpi.grid)
  const dsb = result.defaultSourceBinding;
  if (isPlainObject(dsb) && (dsb as Record<string, unknown>).mode === 'block') {
    scrubbed.push({
      kind: 'binding',
      description: 'Дефолтная привязка KPI-сетки',
    });
    result.defaultSourceBinding = { ...EMPTY_BINDING };
  }

  // 5. kpi.grid: cells[].sourceBindingOverride
  if (Array.isArray(result.cells)) {
    let cellBindingCount = 0;
    const nextCells = (result.cells as Array<Record<string, unknown>>).map((cell) => {
      if (!isPlainObject(cell)) return cell;
      const out = { ...cell };
      const ov = out.sourceBindingOverride;
      if (isPlainObject(ov) && (ov as Record<string, unknown>).mode === 'block') {
        cellBindingCount += 1;
        out.sourceBindingOverride = { ...EMPTY_BINDING };
      }
      return out;
    });
    if (cellBindingCount > 0) {
      scrubbed.push({
        kind: 'cell-binding',
        description: `${cellBindingCount} ячеек(а) KPI с привязкой к блоку`,
      });
    }
    result.cells = nextCells;
  }

  // 6. custom-data: rows[].cells[colId].ref → удалить ref
  if (Array.isArray(result.rows)) {
    let cellRefCount = 0;
    const nextRows = (result.rows as Array<Record<string, unknown>>).map((row) => {
      if (!isPlainObject(row)) return row;
      const next = { ...row };
      if (isPlainObject(next.cells)) {
        const nextCells: Record<string, unknown> = {};
        for (const [colId, cellValue] of Object.entries(next.cells as Record<string, unknown>)) {
          if (isPlainObject(cellValue) && (cellValue as Record<string, unknown>).ref) {
            cellRefCount += 1;
            const copy = { ...(cellValue as Record<string, unknown>) };
            delete copy.ref;
            delete copy.isMoney;
            nextCells[colId] = copy;
          } else {
            nextCells[colId] = cellValue;
          }
        }
        next.cells = nextCells;
      }
      // my-store-table: rows[].bindings
      if (isPlainObject(next.bindings)) {
        const bindingCount = Object.keys(next.bindings as Record<string, unknown>).length;
        if (bindingCount > 0) {
          cellRefCount += bindingCount;
          next.bindings = {};
        }
      }
      return next;
    });
    if (cellRefCount > 0) {
      scrubbed.push({
        kind: 'cell-binding',
        description: `${cellRefCount} ячеек(а) таблицы с binding-ссылками`,
      });
    }
    result.rows = nextRows;
  }

  // 7. Считаем сколько @-токенов осталось в формулах (информативно).
  const formulaTokens = countFormulaTokens(result);
  if (formulaTokens > 0) {
    scrubbed.push({
      kind: 'formula-ref',
      description: `${formulaTokens} @-ссыло${formulaTokens === 1 ? 'к' : formulaTokens < 5 ? 'ки' : 'ок'} в формулах останется битыми`,
    });
  }

  return { config: result, dependencies: nextDeps, scrubbed };
}

/** Считает все @-токены в строках config'а (для информирования пользователя). */
function countFormulaTokens(config: Record<string, unknown>): number {
  let count = 0;
  function scan(value: unknown, depth: number) {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      FORMULA_REF_RE.lastIndex = 0;
      const matches = value.match(FORMULA_REF_RE);
      if (matches) count += matches.length;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => scan(item, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        // moneyRefs пуст по построению — пропускаем
        if (key === 'moneyRefs') continue;
        scan(item, depth + 1);
      }
    }
  }
  scan(config, 0);
  return count;
}

/** Проверяет, есть ли у блока пользовательские данные (для UI «перезаписать?»). */
export function blockHasUserData(instance: BlockInstance): boolean {
  const cfg = instance.config ?? {};
  // Любое из ключевых полей: rows / cells (2D) / cells (array) / value (не пустое)
  // / headerCells / columns с >1 элементом.
  if (Array.isArray((cfg as Record<string, unknown>).rows) && ((cfg as Record<string, unknown>).rows as unknown[]).length > 0) {
    return true;
  }
  const cells = (cfg as Record<string, unknown>).cells;
  if (Array.isArray(cells)) {
    if (cells.length === 0) return false;
    // 2D массив (sheet)
    if (Array.isArray(cells[0])) {
      return (cells as unknown[][]).some((row) => row.some((c) => c !== '' && c !== null && c !== undefined));
    }
    // 1D массив объектов (kpi.grid cells)
    return cells.length > 0;
  }
  const value = (cfg as Record<string, unknown>).value;
  if (typeof value === 'string' && value.trim().length > 0) return true;

  const headerCells = (cfg as Record<string, unknown>).headerCells;
  if (Array.isArray(headerCells) && headerCells.length > 0) return true;

  // dependencies.sources
  if ((instance.dependencies?.sources ?? []).length > 0) return true;

  return false;
}
