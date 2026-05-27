// PURPOSE: Unit-тесты универсального Block Import/Export.
// Запуск: pnpm tsx scripts/test-block-import-export.ts

import type { BlockDef, BlockInstance } from '../src/lib/blocks/types';
import {
  buildJsonPayload,
  buildJsonPreview,
  parseJsonPayload,
} from '../src/lib/blocks/import-export/json-adapter';
import { scrubCrossRefs, blockHasUserData } from '../src/lib/blocks/import-export/refs-scrubber';
import { sheetAdapter } from '../src/lib/blocks/import-export/adapters/sheet';
import { customDataAdapter } from '../src/lib/blocks/import-export/adapters/custom-data';
import { excelCellAdapter } from '../src/lib/blocks/import-export/adapters/excel-cell';
import { kpiGridAdapter } from '../src/lib/blocks/import-export/adapters/kpi-grid';
import { myStoreTableAdapter } from '../src/lib/blocks/import-export/adapters/my-store-table';
import { getImportExportAdapter, supportsXlsx } from '../src/lib/blocks/import-export/registry';
import { BLOCK_EXPORT_SCHEMA } from '../src/lib/blocks/import-export/types';
import {
  containsAtRef,
  shiftA1Addresses,
  substituteAtRefs,
} from '../src/lib/blocks/import-export/formula-utils';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
  }
}

function makeDef(type: string, displayName = type): BlockDef {
  return {
    type,
    displayName,
    description: '',
    category: 'custom',
    icon: undefined as never,
    iconName: 'Square',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 1, h: 1 },
    pages: ['*'],
    Render: () => null,
  };
}

function makeInstance(
  type: string,
  config: Record<string, unknown>,
  patch: Partial<BlockInstance> = {},
): BlockInstance {
  return {
    id: 'test',
    type,
    x: 0,
    y: 0,
    w: 4,
    h: 3,
    config,
    ...patch,
  };
}

// ============================================================================
console.log('\n=== refs-scrubber ===');
// ============================================================================

{
  const scrub = scrubCrossRefs(
    {
      blockRefs: { income: 100, expense: 50 },
      moneyRefs: { income: true, expense: true },
      sourceBinding: { mode: 'block', blockId: 'tx-1' },
      cells: [
        { id: 'c1', sourceBindingOverride: { mode: 'block', blockId: 'tx-2' } },
        { id: 'c2', sourceBindingOverride: { mode: 'empty' } },
      ],
      rows: [
        {
          id: 'r1',
          cells: { col1: { v: '=A1', ref: 'block.field', isMoney: true } },
          bindings: { col2: { ref: 'block.field2' } },
        },
      ],
    },
    {
      sources: [{ blockId: 'src-1', field: 'value' }],
      aggregation: 'sum',
    },
  );
  ok('blockRefs scrubbed', Object.keys(scrub.config.blockRefs as Record<string, unknown>).length === 0);
  ok('moneyRefs scrubbed', Object.keys(scrub.config.moneyRefs as Record<string, unknown>).length === 0);
  ok(
    'sourceBinding empty',
    (scrub.config.sourceBinding as Record<string, unknown>).mode === 'empty',
  );
  const cells = scrub.config.cells as Array<Record<string, unknown>>;
  ok(
    'cell binding override empty',
    (cells[0].sourceBindingOverride as Record<string, unknown>).mode === 'empty',
  );
  const rows = scrub.config.rows as Array<Record<string, unknown>>;
  const rowCells = (rows[0].cells as Record<string, Record<string, unknown>>).col1;
  ok('row.cells.ref removed', !('ref' in rowCells));
  ok('row.bindings cleared', Object.keys(rows[0].bindings as Record<string, unknown>).length === 0);
  ok('dependencies.sources empty', (scrub.dependencies?.sources.length ?? 0) === 0);
  ok('scrubbed list non-empty', scrub.scrubbed.length >= 4);
}

// ============================================================================
console.log('\n=== blockHasUserData ===');
// ============================================================================

{
  ok('empty block → false', !blockHasUserData(makeInstance('any', {})));
  ok('rows non-empty → true', blockHasUserData(makeInstance('any', { rows: [{ id: 'r' }] })));
  ok(
    '2D cells with content → true',
    blockHasUserData(makeInstance('sheet', { cells: [['', '1']] })),
  );
  ok(
    '2D cells empty → false',
    !blockHasUserData(makeInstance('sheet', { cells: [['', '']] })),
  );
  ok(
    'value string non-empty → true',
    blockHasUserData(makeInstance('excel.cell', { value: '=A1' })),
  );
  ok(
    'value empty → false',
    !blockHasUserData(makeInstance('excel.cell', { value: '' })),
  );
}

// ============================================================================
console.log('\n=== JSON adapter ===');
// ============================================================================

{
  const def = makeDef('sheet', 'Таблица');
  const instance = makeInstance(
    'sheet',
    {
      title: 'Доходы',
      cells: [
        ['100', '200'],
        ['=A1+A2', '50'],
      ],
      blockRefs: { income: 100 },
    },
    {
      appearance: { title: 'Мои Доходы', accentColor: '#10b981' },
      dependencies: { sources: [{ blockId: 'x', field: 'v' }], aggregation: 'sum' },
      aiPromptSupplement: 'Отвечай кратко',
    },
  );

  const payload = buildJsonPayload(instance, def);
  ok('payload schema', payload.$schema === BLOCK_EXPORT_SCHEMA);
  ok('payload blockType', payload.blockType === 'sheet');
  ok('payload size', payload.size.w === 4 && payload.size.h === 3);
  ok('payload has config', payload.config && typeof payload.config === 'object');
  ok('payload has appearance', payload.appearance?.title === 'Мои Доходы');
  ok('payload has dependencies', payload.dependencies !== undefined);
  ok('payload aiPromptSupplement', payload.aiPromptSupplement === 'Отвечай кратко');

  const json = JSON.stringify(payload);
  const parsed = parseJsonPayload(json);
  ok('parse roundtrip ok', parsed.ok);
  if (parsed.ok) {
    ok('parsed blockType', parsed.payload.blockType === 'sheet');
  }

  if (parsed.ok) {
    // Mismatch
    const wrongTarget = makeInstance('excel.cell', {});
    const previewMismatch = buildJsonPreview(parsed.payload, wrongTarget);
    ok('type mismatch error', !previewMismatch.ok);

    // Match
    const target = makeInstance('sheet', {});
    const preview = buildJsonPreview(parsed.payload, target);
    ok('match preview ok', preview.ok);
    if (preview.ok) {
      ok('scrubbed blockRefs', preview.scrubbedRefs.some((r) => r.kind === 'blockRefs'));
      ok('scrubbed deps', preview.scrubbedRefs.some((r) => r.kind === 'dependencies'));
      ok('patch has config', preview.patch.config !== undefined);
      ok('patch has appearance', preview.patch.appearance?.title === 'Мои Доходы');
      ok(
        'patch dependencies empty sources',
        preview.patch.dependencies?.sources.length === 0,
      );
    }
  }
}

// ============================================================================
console.log('\n=== Sheet XLSX adapter ===');
// ============================================================================

{
  const def = makeDef('sheet');
  const instance = makeInstance('sheet', {
    title: 'Test',
    rows: 3,
    cols: 3,
    cells: [
      ['Name', 'Value', 'Formula'],
      ['A', '100', '=B2*2'],
      ['B', '200', '=B3*2'],
    ],
    showHeader: true,
    showFormulaBar: true,
    showKopecks: null,
  });

  const bytes = sheetAdapter.exportXlsx!(instance, def);
  ok('sheet xlsx export non-empty', bytes.byteLength > 0);

  const buf = bytes.slice().buffer as ArrayBuffer;
  const preview = sheetAdapter.importXlsx!(buf, makeInstance('sheet', {}));
  ok('sheet xlsx import ok', preview.ok);
  if (preview.ok) {
    const cfg = preview.patch.config as Record<string, unknown>;
    const cells = cfg.cells as string[][];
    ok('cells 3x3', cells.length === 3 && cells[0].length === 3);
    ok('A1 = Name', cells[0][0] === 'Name');
    ok('formula present', cells[1][2].includes('B2*2'));
  }
}

// ============================================================================
console.log('\n=== Custom-data XLSX adapter ===');
// ============================================================================

{
  const def = makeDef('custom.data');
  const instance = makeInstance('custom.data', {
    columns: [
      { id: 'amount', label: 'Сумма', format: 'rubles', publish: true },
      { id: 'qty', label: 'Кол-во', format: 'number', publish: false },
    ],
    rows: [
      { id: 'r1', label: 'Январь', cells: { amount: { v: 1000 }, qty: { v: 5 } } },
      { id: 'r2', label: 'Февраль', cells: { amount: { v: '=A2*1.1' }, qty: { v: 10 } } },
    ],
    publishMode: 'sum',
    publishColumnId: 'amount',
    showKopecks: false,
  });

  const bytes = customDataAdapter.exportXlsx!(instance, def);
  ok('custom-data xlsx export non-empty', bytes.byteLength > 0);

  const buf = bytes.slice().buffer as ArrayBuffer;
  const preview = customDataAdapter.importXlsx!(buf, makeInstance('custom.data', {}));
  ok('custom-data xlsx import ok', preview.ok);
  if (preview.ok) {
    const cfg = preview.patch.config as Record<string, unknown>;
    const cols = cfg.columns as Array<Record<string, unknown>>;
    ok('cols restored', cols.length === 2 && cols[0].label === 'Сумма');
    ok('format preserved', cols[0].format === 'rubles');
    const rows = cfg.rows as Array<Record<string, unknown>>;
    ok('rows restored', rows.length === 2);
    ok('row label', rows[0].label === 'Январь');
  }

  // Merge mode
  const currentWithData = makeInstance('custom.data', {
    columns: [{ id: 'amount', label: 'Сумма', format: 'rubles' }],
    rows: [{ id: 'old1', label: 'Декабрь', cells: { amount: { v: 500 } } }],
  });
  const previewMerge = customDataAdapter.importXlsx!(buf, currentWithData);
  ok('custom-data merge available', previewMerge.ok && previewMerge.canMerge);
  if (previewMerge.ok && previewMerge.mergePatch) {
    const mergedRows = (previewMerge.mergePatch.config as Record<string, unknown>).rows as unknown[];
    ok('merged rows = old + new', mergedRows.length === 3);
  }
}

// ============================================================================
console.log('\n=== Excel-cell XLSX adapter ===');
// ============================================================================

{
  const def = makeDef('excel.cell');
  const instance = makeInstance('excel.cell', {
    title: 'KPI',
    value: '=SUM(A1:A5)',
    showFormulaBar: true,
    showKopecks: null,
  });

  const bytes = excelCellAdapter.exportXlsx!(instance, def);
  ok('excel-cell xlsx export non-empty', bytes.byteLength > 0);

  const buf = bytes.slice().buffer as ArrayBuffer;
  const preview = excelCellAdapter.importXlsx!(buf, makeInstance('excel.cell', {}));
  ok('excel-cell xlsx import ok', preview.ok);
  if (preview.ok) {
    const cfg = preview.patch.config as Record<string, unknown>;
    ok('formula preserved', String(cfg.value).includes('SUM(A1:A5)'));
  }

  // Literal value
  const literalInstance = makeInstance('excel.cell', {
    title: 'Кол-во',
    value: '42',
  });
  const literalBytes = excelCellAdapter.exportXlsx!(literalInstance, def);
  const literalPreview = excelCellAdapter.importXlsx!(
    literalBytes.slice().buffer as ArrayBuffer,
    makeInstance('excel.cell', {}),
  );
  ok('excel-cell literal import ok', literalPreview.ok);
  if (literalPreview.ok) {
    const cfg = literalPreview.patch.config as Record<string, unknown>;
    ok('literal value = 42', String(cfg.value) === '42');
  }
}

// ============================================================================
console.log('\n=== KPI Grid XLSX adapter ===');
// ============================================================================

{
  const def = makeDef('kpi.grid');
  const instance = makeInstance('kpi.grid', {
    title: 'KPI',
    layout: 'row',
    cells: [
      { id: 'c1', metric: 'income', label: 'Доходы', format: 'rub', accentColor: '#10b981' },
      { id: 'c2', metric: 'expense', label: 'Расходы', format: 'rub', accentColor: '#ef4444' },
    ],
    defaultSourceBinding: { mode: 'block', blockId: 'tx-block' },
  });

  const bytes = kpiGridAdapter.exportXlsx!(instance, def);
  ok('kpi-grid xlsx export non-empty', bytes.byteLength > 0);

  const buf = bytes.slice().buffer as ArrayBuffer;
  const preview = kpiGridAdapter.importXlsx!(buf, makeInstance('kpi.grid', {}));
  ok('kpi-grid xlsx import ok', preview.ok);
  if (preview.ok) {
    const cfg = preview.patch.config as Record<string, unknown>;
    const cells = cfg.cells as Array<Record<string, unknown>>;
    ok('cells restored', cells.length === 2);
    ok('first metric income', cells[0].metric === 'income');
    ok(
      'defaultSourceBinding empty after import',
      (cfg.defaultSourceBinding as Record<string, unknown>).mode === 'empty',
    );
  }
}

// ============================================================================
console.log('\n=== My Store Table XLSX adapter ===');
// ============================================================================

{
  const def = makeDef('unit.my-store-table');
  const instance = makeInstance('unit.my-store-table', {
    title: 'Магазин',
    global: { vatPct: 20 },
    columns: [
      { id: 'article', label: 'Артикул', type: 'identity', width: 110 },
      { id: 'name', label: 'Название товара', type: 'identity', width: 220 },
      { id: 'cost', label: 'Себестоимость', type: 'money', width: 110 },
      { id: 'price', label: 'Цена', type: 'money', width: 110 },
    ],
    rows: [
      { id: 'r1', article: 'SKU-1', name: 'Чай', values: { cost: 100, price: 250 }, bindings: {} },
      { id: 'r2', article: 'SKU-2', name: 'Кофе', values: { cost: 200, price: 500 }, bindings: {} },
    ],
    pinnedColumns: ['article', 'name'],
  });

  const bytes = myStoreTableAdapter.exportXlsx!(instance, def);
  ok('my-store xlsx export non-empty', bytes.byteLength > 0);

  const buf = bytes.slice().buffer as ArrayBuffer;
  const preview = myStoreTableAdapter.importXlsx!(buf, makeInstance('unit.my-store-table', {}));
  ok('my-store xlsx import ok', preview.ok);
  if (preview.ok) {
    const cfg = preview.patch.config as Record<string, unknown>;
    const cols = cfg.columns as Array<Record<string, unknown>>;
    const rows = cfg.rows as Array<Record<string, unknown>>;
    ok('cols restored', cols.length === 4);
    ok('article identity', cols[0].id === 'article' && cols[0].type === 'identity');
    ok('rows restored', rows.length === 2);
    ok('row article', rows[0].article === 'SKU-1');
    ok('row name', rows[0].name === 'Чай');
  }
}

// ============================================================================
console.log('\n=== formula-utils ===');
// ============================================================================

{
  // shiftA1Addresses — базовое смещение
  ok('shiftA1 zero noop', shiftA1Addresses('A1+B2', 0, 0) === 'A1+B2');
  ok('shiftA1 +1 +1', shiftA1Addresses('A1+B2', 1, 1) === 'B2+C3');
  ok('shiftA1 -1 -1 roundtrip', shiftA1Addresses('B2+C3', -1, -1) === 'A1+B2');
  ok('shiftA1 ranges', shiftA1Addresses('SUM(A1:B5)', 1, 1) === 'SUM(B2:C6)');
  ok(
    'shiftA1 mixed expr',
    shiftA1Addresses('IF(A1>0,B2*60,C3+10)', 1, 1) === 'IF(B2>0,C3*60,D4+10)',
  );

  // shiftA1 — отрицательная координата → #REF!
  ok('shiftA1 underflow col → #REF!', shiftA1Addresses('A1', -1, 0).includes('#REF!'));
  ok('shiftA1 underflow row → #REF!', shiftA1Addresses('A1', 0, -1).includes('#REF!'));

  // shiftA1 — не трогает строковые литералы
  ok('shiftA1 ignores string', shiftA1Addresses('CONCAT("A1",B2)', 1, 1) === 'CONCAT("A1",C3)');

  // substituteAtRefs
  const live = {
    'blk1.totalRub': 12345,
    'blk2': 99,
    'page1:blk3.x': 7,
  };
  {
    const r = substituteAtRefs('@blk1.totalRub+10', live);
    ok('substitute simple', r.result === '12345+10');
    ok('substituted count', r.substituted === 1);
    ok('unresolved 0', r.unresolved === 0);
  }
  {
    const r = substituteAtRefs('@unknown.field*2', live);
    ok('substitute unresolved → 0', r.result === '0*2');
    ok('unresolved count', r.unresolved === 1);
  }
  {
    const r = substituteAtRefs('@blk1.totalRub+@blk2*0.1', live);
    ok('substitute multiple', r.result === '12345+99*0.1');
    ok('substituted x2', r.substituted === 2);
  }
  {
    const r = substituteAtRefs('@page1:blk3.x', live);
    ok('substitute scoped ref', r.result === '7');
  }

  // containsAtRef
  ok('containsAtRef positive', containsAtRef('@blk.x+10'));
  ok('containsAtRef negative', !containsAtRef('A1+B2'));
}

// ============================================================================
console.log('\n=== Custom-data XLSX A1-shift roundtrip ===');
// ============================================================================

{
  const def = makeDef('custom.data');
  // Формула =A1*60 в block-A1 (A=первая user-колонка, row 1=первая data-строка).
  const instance = makeInstance('custom.data', {
    columns: [
      { id: 'price', label: 'Цена', format: 'rubles', publish: true },
      { id: 'qty', label: 'Кол-во', format: 'number', publish: true },
    ],
    rows: [
      { id: 'r1', label: 'Товар', cells: { price: { v: '=A1*60' }, qty: { v: 5 } } },
    ],
  });

  const bytes = customDataAdapter.exportXlsx!(instance, def, { liveValues: {} });
  // Прочитать XLSX и проверить что A1*60 → B2*60 (в Excel-A1)
  const wb = (require('xlsx') as typeof import('xlsx')).read(bytes.slice().buffer, {
    type: 'array',
    cellFormula: true,
  });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Расположение: row1=header, row2=data, col A=label, col B=price (формула), col C=qty
  const b2 = ws['B2'] as import('xlsx').CellObject | undefined;
  ok('custom-data B2 has formula', Boolean(b2?.f));
  ok('custom-data shifted A1→B2 in formula', b2?.f === 'B2*60');

  // Roundtrip import
  const preview = customDataAdapter.importXlsx!(
    bytes.slice().buffer as ArrayBuffer,
    makeInstance('custom.data', {}),
  );
  ok('roundtrip import ok', preview.ok);
  if (preview.ok) {
    const newRows = (preview.patch.config as Record<string, unknown>).rows as Array<{
      cells: Record<string, { v: number | string }>;
    }>;
    const newCols = (preview.patch.config as Record<string, unknown>).columns as Array<{
      id: string;
      label: string;
    }>;
    const priceCol = newCols.find((c) => c.label === 'Цена');
    ok('price col restored', Boolean(priceCol));
    const priceCell = priceCol ? newRows[0]?.cells[priceCol.id] : undefined;
    ok(
      'formula roundtrip restored to A1',
      priceCell !== undefined && String(priceCell.v) === '=A1*60',
    );
  }
}

// ============================================================================
console.log('\n=== Custom-data @-ref substitution ===');
// ============================================================================

{
  const def = makeDef('custom.data');
  const instance = makeInstance('custom.data', {
    columns: [
      { id: 'rev', label: 'Выручка', format: 'rubles', publish: true },
    ],
    rows: [
      { id: 'r1', label: 'Янв', cells: { rev: { v: '=@external.totalRub*2' } } },
    ],
  });

  // Без liveValues — @-ref становится 0
  const bytesNoLive = customDataAdapter.exportXlsx!(instance, def);
  const wb1 = (require('xlsx') as typeof import('xlsx')).read(bytesNoLive.slice().buffer, {
    type: 'array',
    cellFormula: true,
  });
  const b2 = wb1.Sheets['Data']?.['B2'] as import('xlsx').CellObject | undefined ?? (wb1.Sheets[wb1.SheetNames[0]] as Record<string, import('xlsx').CellObject>)['B2'];
  ok('no liveValues → @-ref = 0', b2?.f === '0*2');

  // С liveValues — @-ref подставляется
  const bytesWithLive = customDataAdapter.exportXlsx!(instance, def, {
    liveValues: { 'external.totalRub': 5000 },
  });
  const wb2 = (require('xlsx') as typeof import('xlsx')).read(bytesWithLive.slice().buffer, {
    type: 'array',
    cellFormula: true,
  });
  const b2live = (wb2.Sheets[wb2.SheetNames[0]] as Record<string, import('xlsx').CellObject>)['B2'];
  ok('with liveValues → @-ref substituted', b2live?.f === '5000*2');
}

// ============================================================================
console.log('\n=== Sheet @-ref substitution ===');
// ============================================================================

{
  const def = makeDef('sheet');
  const instance = makeInstance('sheet', {
    title: 'Test',
    cells: [
      ['1', '2', '=A1+@external.x'],
    ],
    blockRefs: { 'external.x': 100 },
  });

  // Snapshot из cfg.blockRefs работает даже без liveValues
  const bytes = sheetAdapter.exportXlsx!(instance, def);
  const wb = (require('xlsx') as typeof import('xlsx')).read(bytes.slice().buffer, {
    type: 'array',
    cellFormula: true,
  });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const c1 = ws['C1'] as import('xlsx').CellObject | undefined;
  ok('sheet @-ref from snapshot', c1?.f === 'A1+100');

  // liveValues перекрывает snapshot
  const bytes2 = sheetAdapter.exportXlsx!(instance, def, {
    liveValues: { 'external.x': 999 },
  });
  const wb2 = (require('xlsx') as typeof import('xlsx')).read(bytes2.slice().buffer, {
    type: 'array',
    cellFormula: true,
  });
  const c1b = wb2.Sheets[wb2.SheetNames[0]]['C1'] as import('xlsx').CellObject | undefined;
  ok('sheet @-ref live overrides snapshot', c1b?.f === 'A1+999');
}

// ============================================================================
console.log('\n=== My-store-table binding resolution ===');
// ============================================================================

{
  const def = makeDef('unit.my-store-table');
  const instance = makeInstance('unit.my-store-table', {
    title: 'Магазин',
    global: { vatPct: 20 },
    columns: [
      { id: 'article', label: 'Артикул', type: 'identity' },
      { id: 'name', label: 'Название товара', type: 'identity' },
      { id: 'expense', label: 'Расход', type: 'money' },
    ],
    rows: [
      {
        id: 'r1',
        article: 'SKU-1',
        name: 'Товар',
        values: {},
        bindings: {
          expense: {
            mode: 'block_ref',
            ref: { blockId: 'mp-ozon-campaigns', field: 'totalExpenseRub' },
          },
        },
      },
    ],
    pinnedColumns: ['article', 'name'],
  });

  // Без liveValues — binding не резолвится → пустая ячейка
  const bytesNoLive = myStoreTableAdapter.exportXlsx!(instance, def);
  const wb1 = (require('xlsx') as typeof import('xlsx')).read(
    bytesNoLive.slice().buffer,
    { type: 'array', cellFormula: true },
  );
  const ws1 = wb1.Sheets[wb1.SheetNames[0]];
  // Row 2 (data), col C (expense)
  const c2NoLive = ws1['C2'] as import('xlsx').CellObject | undefined;
  ok('no liveValues → binding cell empty', c2NoLive === undefined || c2NoLive.v === undefined || c2NoLive.v === '');

  // С liveValues — binding резолвится в число
  const bytesLive = myStoreTableAdapter.exportXlsx!(instance, def, {
    liveValues: { 'mp-ozon-campaigns.totalExpenseRub': 89901.02 },
  });
  const wb2 = (require('xlsx') as typeof import('xlsx')).read(
    bytesLive.slice().buffer,
    { type: 'array', cellFormula: true },
  );
  const c2Live = wb2.Sheets[wb2.SheetNames[0]]['C2'] as import('xlsx').CellObject | undefined;
  ok('binding resolved to number', c2Live?.t === 'n' && c2Live?.v === 89901.02);
  ok('no @-ref in cell.f', !c2Live?.f || !String(c2Live.f).includes('@'));
}

// ============================================================================
console.log('\n=== Registry ===');
// ============================================================================

{
  ok('sheet has XLSX', supportsXlsx('sheet'));
  ok('custom.data has XLSX', supportsXlsx('custom.data'));
  ok('kpi.grid has XLSX', supportsXlsx('kpi.grid'));
  ok('excel.cell has XLSX', supportsXlsx('excel.cell'));
  ok('unit.my-store-table has XLSX', supportsXlsx('unit.my-store-table'));
  ok('stat.income no XLSX', !supportsXlsx('stat.income'));
  ok('currency.rates no XLSX', !supportsXlsx('currency.rates'));
  ok('chart.cashflow no XLSX', !supportsXlsx('chart.cashflow'));

  const adapter = getImportExportAdapter('stat.income');
  ok('JSON-only adapter for unknown', adapter.supportsXlsx === false);
  ok('JSON-only has exportJson', typeof adapter.exportJson === 'function');
}

// ============================================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
