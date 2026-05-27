// PURPOSE: Реестр Import/Export-адаптеров для всех типов блоков.
// JSON-only для типов без XLSX-адаптера. XLSX — только для табличных
// блоков (sheet, custom.data, kpi.grid, excel.cell, my-store-table).

import type { BlockImportExportAdapter } from './types';
import { createJsonOnlyAdapter } from './json-adapter';
import { sheetAdapter } from './adapters/sheet';
import { customDataAdapter } from './adapters/custom-data';
import { kpiGridAdapter } from './adapters/kpi-grid';
import { excelCellAdapter } from './adapters/excel-cell';
import { myStoreTableAdapter } from './adapters/my-store-table';

const XLSX_ADAPTERS: Record<string, BlockImportExportAdapter> = {
  [sheetAdapter.type]: sheetAdapter,
  [customDataAdapter.type]: customDataAdapter,
  [kpiGridAdapter.type]: kpiGridAdapter,
  [excelCellAdapter.type]: excelCellAdapter,
  [myStoreTableAdapter.type]: myStoreTableAdapter,
};

/**
 * Возвращает адаптер для блока. Если для типа есть XLSX-адаптер — он
 * используется, иначе создаётся универсальный JSON-only fallback.
 */
export function getImportExportAdapter(blockType: string): BlockImportExportAdapter {
  return XLSX_ADAPTERS[blockType] ?? createJsonOnlyAdapter(blockType);
}

/** True если для типа блока поддерживается XLSX (используется в UI для дисэйбла). */
export function supportsXlsx(blockType: string): boolean {
  return blockType in XLSX_ADAPTERS;
}
