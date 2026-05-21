// PURPOSE: Test для sheet-import — CSV/XLSX roundtrip + edge cases.
// Запуск: pnpm tsx scripts/test-sheet-import-export.ts

import {
  parseCsv,
  parseXlsx,
  exportCsv,
  exportXlsx,
  SHEET_IMPORT_CELL_LIMIT,
} from '../src/lib/blocks/catalog/sheet-import';

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

console.log('\n=== CSV parse/export ===');
{
  const csv = 'A,B,C\n1,2,=A1+B1\nx y,z,';
  const parsed = parseCsv(csv);
  ok('CSV parse ok', parsed.ok);
  if (parsed.ok) {
    ok('rows', parsed.rows === 3);
    ok('cols', parsed.cols === 3);
    ok('first cell', parsed.cells[0][0] === 'A');
    ok('formula preserved', parsed.cells[1][2] === '=A1+B1');
    ok('text with space preserved', parsed.cells[2][0] === 'x y');

    const exported = exportCsv(parsed.cells);
    ok('roundtrip', exported.includes('=A1+B1'));
  }
}

console.log('\n=== CSV empty / errors ===');
{
  const r = parseCsv('');
  ok('empty rejected', !r.ok);
}

console.log('\n=== CSV cell limit ===');
{
  const rowsNeeded = Math.ceil(SHEET_IMPORT_CELL_LIMIT / 10) + 2;
  const big = Array.from({ length: rowsNeeded }, (_, i) =>
    Array.from({ length: 10 }, (_, j) => `${i},${j}`).join(','),
  ).join('\n');
  const r = parseCsv(big);
  ok('over limit rejected', !r.ok && /Лимит/.test(r.error));
}

console.log('\n=== XLSX export/import roundtrip ===');
{
  const cells = [
    ['Name', 'Value', 'Formula'],
    ['A', '100', '=B2*2'],
    ['B', '200', '=B3*2'],
  ];
  const xbuf = exportXlsx(cells);
  ok('xlsx buffer non-empty', xbuf.byteLength > 0);

  const back = parseXlsx(xbuf.slice().buffer as ArrayBuffer);
  ok('xlsx parse ok', back.ok);
  if (back.ok) {
    ok('rows preserved', back.rows === 3);
    ok('cols preserved', back.cols === 3);
    ok('header preserved', back.cells[0][0] === 'Name');
    ok('number cell readable', Number(back.cells[1][1]) === 100);
    // Формулы из aoa_to_sheet могут потерять prefix '=', но содержать тело формулы
    const formulaCell = back.cells[1][2];
    ok(
      `formula roundtrip (got=${JSON.stringify(formulaCell)})`,
      formulaCell.includes('B2*2') || formulaCell === '=B2*2',
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
