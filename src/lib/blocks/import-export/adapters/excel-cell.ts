// PURPOSE: XLSX-адаптер для `excel.cell`. Одна ячейка экспортируется в A1
// (как formula `cell.f` или literal). Настройки — в `_meta`.

import * as XLSX from 'xlsx';
import type { BlockDef, BlockInstance } from '../../types';
import { buildWorkbook, metaFromSheet, metaToSheet, readWorkbook } from '../xlsx-utils';
import { buildJsonPayload, buildJsonPreview } from '../json-adapter';
import { blockHasUserData, scrubCrossRefs } from '../refs-scrubber';
import type { BlockImportExportAdapter, ImportPreview } from '../types';

function readCfg(instance: BlockInstance): Record<string, unknown> {
  return (instance.config ?? {}) as Record<string, unknown>;
}

function exportXlsx(instance: BlockInstance, _def: BlockDef): Uint8Array {
  const cfg = readCfg(instance);
  const value = typeof cfg.value === 'string' ? cfg.value : '';

  const ws: XLSX.WorkSheet = {};
  if (value.startsWith('=')) {
    ws['A1'] = { t: 'n', f: value.slice(1), v: 0 } as XLSX.CellObject;
  } else if (value.trim() !== '') {
    const num = Number(value);
    if (Number.isFinite(num)) {
      ws['A1'] = { t: 'n', v: num } as XLSX.CellObject;
    } else {
      ws['A1'] = { t: 's', v: value } as XLSX.CellObject;
    }
  }
  ws['!ref'] = 'A1:A1';

  const meta: Record<string, unknown> = {
    title: cfg.title ?? 'Доходы',
    showFormulaBar: cfg.showFormulaBar ?? true,
    showKopecks: cfg.showKopecks ?? null,
  };

  return buildWorkbook([
    { name: 'Cell', ws },
    { name: '_meta', ws: metaToSheet(meta) },
  ]);
}

function importXlsx(buffer: ArrayBuffer, current: BlockInstance): ImportPreview {
  let wb: XLSX.WorkBook;
  try {
    wb = readWorkbook(buffer);
  } catch (err) {
    return { ok: false, error: `Не удалось прочитать XLSX: ${(err as Error).message}` };
  }
  const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
  if (!ws) return { ok: false, error: 'В файле нет листов' };

  const cell = ws['A1'] as XLSX.CellObject | undefined;
  let value = '';
  let isFormula = false;
  if (cell) {
    if (cell.f) {
      value = `=${cell.f}`;
      isFormula = true;
    } else if (cell.v !== undefined && cell.v !== null) {
      value = String(cell.v);
    }
  }

  const meta = metaFromSheet(wb.Sheets['_meta']);
  const newCfg: Record<string, unknown> = {
    title: typeof meta.title === 'string' ? meta.title : 'Доходы',
    value,
    showFormulaBar: typeof meta.showFormulaBar === 'boolean' ? meta.showFormulaBar : true,
    showKopecks:
      meta.showKopecks === true || meta.showKopecks === false ? meta.showKopecks : null,
  };

  const scrub = scrubCrossRefs(newCfg, undefined);

  return {
    ok: true,
    stats: [
      { label: 'Значение', value: value.length > 20 ? value.slice(0, 20) + '…' : value || '(пусто)' },
      { label: 'Тип', value: isFormula ? 'формула' : 'число/текст' },
    ],
    scrubbedRefs: scrub.scrubbed,
    hasExistingData: blockHasUserData(current),
    patch: {
      config: scrub.config,
      dependencies: undefined,
    },
    canMerge: false,
  };
}

export const excelCellAdapter: BlockImportExportAdapter = {
  type: 'excel.cell',
  supportsXlsx: true,
  exportJson: buildJsonPayload,
  importJson: buildJsonPreview,
  exportXlsx,
  importXlsx,
};
