// PURPOSE: Backward-compat миграция «сырых» Ozon-конфигов до текущей формы
// OzonInputs / GlobalParams. Вызывается ДО zod-парсинга, чтобы старые поля
// перешли в новые без потери пользовательских данных.
//
// Покрывает миграции:
//  - `fbsWarehouse: string`        → `fbsClusters: [{ key, sharePct: 100 }]`
//  - `taxMode: 'nds'`              → `taxMode: 'osno'`
//  - `taxDeductExpenses: boolean`  → `documentedExpensesMonth: 0` (флаг
//    более не учитывается — нужна сумма; при необходимости пользователь введёт)

type AnyRecord = Record<string, unknown>;

/**
 * Применяет миграции к произвольному объекту. Не валидирует — только сдвигает
 * поля. Безопасно вызывать дважды (idempotent).
 */
export function migrateOzonRaw<T extends AnyRecord>(raw: T | null | undefined): T {
  if (!raw || typeof raw !== 'object') return {} as T;
  const out: AnyRecord = { ...raw };

  // 1. fbsWarehouse → fbsClusters
  const hasClusters =
    Array.isArray(out.fbsClusters) && (out.fbsClusters as unknown[]).length > 0;
  const legacyWarehouse = typeof out.fbsWarehouse === 'string' ? out.fbsWarehouse.trim() : '';
  if (!hasClusters && legacyWarehouse) {
    out.fbsClusters = [{ key: legacyWarehouse, sharePct: 100 }];
  }
  delete out.fbsWarehouse;

  // 2. taxMode 'nds' → 'osno'
  if (out.taxMode === 'nds') {
    out.taxMode = 'osno';
  }

  // 3. taxDeductExpenses → documentedExpensesMonth (0, пользователь введёт)
  if ('taxDeductExpenses' in out) {
    if (out.documentedExpensesMonth === undefined) {
      out.documentedExpensesMonth = 0;
    }
    delete out.taxDeductExpenses;
  }

  // 4. fbsDropoffPoint 'ozon_warehouse' → 'sorting_center' (опции больше нет)
  if (out.fbsDropoffPoint === 'ozon_warehouse') {
    out.fbsDropoffPoint = 'sorting_center';
  }

  return out as T;
}
