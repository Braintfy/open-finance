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
