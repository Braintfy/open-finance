// PURPOSE: XLSX-адаптер для `kpi.grid`. Каждая KPI-ячейка экспортируется как
// строка на листе `Cells`. Source binding'и в XLSX не сохраняются — при
// импорте они становятся `{mode: 'empty'}` и пользователь привязывает заново.

import * as XLSX from 'xlsx';
import type { BlockDef, BlockInstance } from '../../types';
import { buildWorkbook, metaFromSheet, metaToSheet, readWorkbook } from '../xlsx-utils';
import { buildJsonPayload, buildJsonPreview } from '../json-adapter';
import { blockHasUserData, scrubCrossRefs } from '../refs-scrubber';
import type { BlockImportExportAdapter, ImportPreview } from '../types';

type RawCell = {
  id: string;
  metric: string;
  label?: string;
  format?: string;
  accentColor?: string;
  categoryName?: string;
  counterparty?: string;
  periodOverride?: { preset: string; customFrom: string | null; customTo: string | null } | null;
  sourceOverride?: string | null;
  sourceBindingOverride?: Record<string, unknown>;
};

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function readCfg(instance: BlockInstance): Record<string, unknown> {
  return (instance.config ?? {}) as Record<string, unknown>;
}

function exportXlsx(instance: BlockInstance, _def: BlockDef): Uint8Array {
  const cfg = readCfg(instance);
  const cells = Array.isArray(cfg.cells) ? (cfg.cells as RawCell[]) : [];

  const headers = [
    'id',
    'metric',
    'label',
    'format',
    'accentColor',
    'categoryName',
    'counterparty',
    'periodPreset',
    'periodFrom',
    'periodTo',
    'sourceOverride',
  ];
  const aoa: unknown[][] = [headers];
  for (const cell of cells) {
    aoa.push([
      cell.id,
      cell.metric,
      cell.label ?? '',
      cell.format ?? 'rub',
      cell.accentColor ?? '',
      cell.categoryName ?? '',
      cell.counterparty ?? '',
      cell.periodOverride?.preset ?? '',
      cell.periodOverride?.customFrom ?? '',
      cell.periodOverride?.customTo ?? '',
      cell.sourceOverride ?? '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const meta: Record<string, unknown> = {
    title: cfg.title ?? 'KPI',
    layout: cfg.layout ?? 'row',
    defaultPeriodOverride: cfg.defaultPeriodOverride ?? null,
    // sourceBinding'и не экспортируются (см. шапку файла).
  };

  return buildWorkbook([
    { name: 'Cells', ws },
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

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (rows.length === 0) return { ok: false, error: 'Не найдены KPI-ячейки' };
  if (rows.length > 6) {
    return { ok: false, error: `Максимум 6 ячеек, в файле ${rows.length}` };
  }

  const cells: RawCell[] = [];
  for (const row of rows) {
    const metric = String(row.metric ?? 'income').trim();
    const periodPreset = String(row.periodPreset ?? '').trim();
    const periodFrom = String(row.periodFrom ?? '').trim();
    const periodTo = String(row.periodTo ?? '').trim();
    const periodOverride =
      periodPreset !== ''
        ? {
            preset: periodPreset,
            customFrom: periodFrom || null,
            customTo: periodTo || null,
          }
        : null;
    const cell: RawCell = {
      id: typeof row.id === 'string' && row.id ? row.id : makeId('cell'),
      metric,
      label: row.label ? String(row.label) : undefined,
      format: row.format ? String(row.format) : 'rub',
      accentColor: row.accentColor ? String(row.accentColor) : undefined,
      categoryName: row.categoryName ? String(row.categoryName) : undefined,
      counterparty: row.counterparty ? String(row.counterparty) : undefined,
      periodOverride,
      sourceOverride: row.sourceOverride ? String(row.sourceOverride) : null,
    };
    cells.push(cell);
  }

  const meta = metaFromSheet(wb.Sheets['_meta']);
  const newCfg: Record<string, unknown> = {
    title: typeof meta.title === 'string' ? meta.title : 'KPI',
    layout: typeof meta.layout === 'string' ? meta.layout : 'row',
    cells,
    defaultPeriodOverride: meta.defaultPeriodOverride ?? null,
    defaultSourceBinding: { mode: 'empty' },
  };

  const scrub = scrubCrossRefs(newCfg, undefined);

  return {
    ok: true,
    stats: [
      { label: 'Ячеек', value: String(cells.length) },
      { label: 'Layout', value: String(meta.layout ?? 'row') },
      { label: 'Period override', value: cells.filter((c) => c.periodOverride).length > 0 ? 'есть' : 'нет' },
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

export const kpiGridAdapter: BlockImportExportAdapter = {
  type: 'kpi.grid',
  supportsXlsx: true,
  exportJson: buildJsonPayload,
  importJson: buildJsonPreview,
  exportXlsx,
  importXlsx,
};
