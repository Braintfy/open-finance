// PURPOSE: Smoke-тесты чистого автоподбора сшивки товар ↔ SKU канала
// (src/lib/stock/links.ts) и справочника встроенных мест (src/lib/stock/places.ts).
// Канон — docs/STOCK_MODULE_DESIGN.md §8 шаг 3 (цепочка штрихкод → имя →
// дозировка), §2.3 (qty_per_unit), §3 (авторитет мест), §12.3 (WB и ЯМ).
// Запуск: pnpm tsx scripts/test-stock-matching.ts

import {
  MIN_AUTO_CONFIDENCE,
  extractDosage,
  extractPackQty,
  nameTokens,
  normalizeBarcode,
  normalizeName,
  normalizeSku,
  rankCandidates,
  suggestLink,
  suggestLinks,
  type MatchItem,
  type MatchRow,
} from '../src/lib/stock/links';
import {
  BUILTIN_PLACE_CODES,
  BUILTIN_STOCK_PLACES,
  LOSS_PLACE_CODE,
  OWN_PLACE_CODE,
  canHoldMoves,
  externalPlaceCodes,
  getBuiltinPlace,
  isBuiltinPlaceCode,
  ledgerPlaceCodes,
  placeChannel,
} from '../src/lib/stock/places';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, hint?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}${hint ? ' — ' + hint : ''}`);
    failed += 1;
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(label, same, same ? undefined : `получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`);
}

// Каталог: две соседние карточки одного бренда, отличающиеся ТОЛЬКО дозировкой.
const SPD500: MatchItem = {
  id: 'i-spd-500',
  sku: 'SPD-500-60',
  name: 'Спермидин 500 мг, 60 капсул',
  barcode: '4600000000017',
  brand: 'ShopA',
};
const SPD250: MatchItem = {
  id: 'i-spd-250',
  sku: 'SPD-250-60',
  name: 'Спермидин 250 мг, 60 капсул',
  barcode: '4600000000024',
  brand: 'ShopA',
};
const NMN: MatchItem = {
  id: 'i-nmn-250',
  sku: 'NMN-250-90',
  name: 'НМН 250 мг, 90 капсул',
  barcode: '4600000000031',
  brand: 'Restoreage',
};
const CATALOG: MatchItem[] = [SPD500, SPD250, NMN];

function row(partial: Partial<MatchRow> & Pick<MatchRow, 'externalId'>): MatchRow {
  return { ...partial };
}

// ===========================================================================
console.log('\n=== Нормализация ===');
// ===========================================================================
eq('ё → е, регистр, пунктуация, схлопывание пробелов', normalizeName('  Спермидин «Ёлка»,  500 МГ  '), 'спермидин елка 500 мг');
eq('пустой вход не падает', normalizeName(null), '');
eq('штрихкод — только цифры', normalizeBarcode(' 4600000000017 '), '4600000000017');
eq('короткий «штрихкод» считается отсутствующим', normalizeBarcode('123'), '');
eq('артикул: регистр и разделители не важны', normalizeSku('spd_500-60'), 'spd50060');
eq('шумовые слова выброшены из токенов', nameTokens('Спермидин 500 мг, 60 капсул'), ['спермидин', '500', 'мг', '60']);

// ===========================================================================
console.log('\n=== Дозировка (главный предохранитель от ложной сшивки) ===');
// ===========================================================================
eq('мг перед запятой распознаётся (JS \\b тут не работает)', extractDosage('Спермидин 500 мг, 60 капсул'), { mg: 500, count: 60 });
eq('мг в конце строки', extractDosage('Спермидин 500 мг').mg, 500);
eq('«капсулы» с любым окончанием', extractDosage('90 капсулы').count, 90);
eq('«таблеток»', extractDosage('30 таблеток').count, 30);
eq('латинские единицы', extractDosage('500 mg, 60 caps'), { mg: 500, count: 60 });
eq('миллилитры', extractDosage('Витамин D3 30 мл').ml, 30);
eq('граммы только когда нет мг', extractDosage('Коллаген 200 г').g, 200);
eq('дробная дозировка через запятую', extractDosage('Омега 1,5 г').g, 1.5);
eq('без чисел — пустой объект', extractDosage('Спермидин'), {});

// ===========================================================================
console.log('\n=== Фасовка qty_per_unit (ошибка здесь портит COGS КРАТНО) ===');
// ===========================================================================
eq('«набор 3 банки» → 3', extractPackQty('Спермидин 500 мг, 60 капсул — набор 3 банки'), 3);
eq('«набор из 2» → 2', extractPackQty('Набор из 2'), 2);
eq('«комплект 4» → 4', extractPackQty('Комплект 4 упаковки'), 4);
eq('«2 упаковки» → 2', extractPackQty('Спермидин, 2 упаковки'), 2);
eq('«x3» латинская → 3', extractPackQty('Спермидин x3'), 3);
eq('«х3» кириллическая → 3', extractPackQty('Спермидин х3'), 3);
eq('ЛОВУШКА: «500 мг х 60 капсул» — дозировка, а не 60 банок', extractPackQty('Спермидин 500 мг х 60 капсул'), 1);
eq('ЛОВУШКА: «60 капсул» фасовкой не считается', extractPackQty('Спермидин 500 мг, 60 капсул'), 1);
eq('обычная карточка → 1', extractPackQty('Спермидин'), 1);
eq('мусор на входе → 1', extractPackQty(null), 1);

// ===========================================================================
console.log('\n=== Цепочка подбора: штрихкод → артикул → имя ===');
// ===========================================================================
{
  const s = suggestLink(row({ externalId: 'OZ-777', name: 'Абсолютно другое название', barcode: '4600000000017' }), CATALOG);
  ok('штрихкод бьёт всё остальное', s?.itemId === SPD500.id && s?.source === 'barcode');
  eq('уверенность по штрихкоду — 100', s?.confidence, 100);
}
{
  const s = suggestLink(row({ externalId: 'SPD-500-60' }), CATALOG);
  ok('offer_id == нашему артикулу', s?.itemId === SPD500.id && s?.source === 'sku');
  eq('уверенность по артикулу — 95', s?.confidence, 95);
}
{
  const s = suggestLink(row({ externalId: 'OZ-1', externalSku: 'NMN-250-90', name: '' }), CATALOG);
  ok('числовой sku канала тоже ключ', s?.itemId === NMN.id && s?.source === 'sku');
}
{
  const s = suggestLink(row({ externalId: 'OZ-2', name: 'спермидин  250 МГ,   60 капсул' }), CATALOG);
  ok('нормализованное имя совпало', s?.itemId === SPD250.id && s?.source === 'name');
  eq('уверенность по точному имени — 85', s?.confidence, 85);
}

// ===========================================================================
console.log('\n=== Предохранители: дозировка, бренд, неоднозначность ===');
// ===========================================================================
{
  const s = suggestLink(row({ externalId: 'OZ-3', name: 'Спермидин 500 мг, 60 капсул' }), [SPD250]);
  eq('500 мг НЕ сшивается с 250 мг — молчим и ждём человека', s, null);
  eq('и в кандидатах его тоже нет', rankCandidates(row({ externalId: 'OZ-3', name: 'Спермидин 500 мг, 60 капсул' }), [SPD250]).length, 0);
}
{
  const s = suggestLink(row({ externalId: 'OZ-4', name: 'НМН 250 мг, 60 капсул' }), [NMN]);
  eq('то же число мг, но разное число капсул — тоже отказ', s, null);
}
{
  const s = suggestLink(row({ externalId: 'OZ-5', name: 'Спермидин 500 мг, 60 капсул', brand: 'Чужой Бренд' }), CATALOG);
  eq('конфликт бренда блокирует сшивку по имени', s, null);
}
{
  const twins: MatchItem[] = [
    { id: 'i-a', sku: 'A-1', name: 'Витамин D3 2000 МЕ' },
    { id: 'i-b', sku: 'B-1', name: 'Витамин D3 2000 МЕ' },
  ];
  const r = row({ externalId: 'OZ-D3', name: 'Витамин D3 2000 МЕ' });
  eq('две одинаковые карточки → ничья → автосшивки нет', suggestLink(r, twins), null);
  eq('но обе видны на экране сопоставления', rankCandidates(r, twins).length, 2);
}
eq('пустой каталог — не падаем', suggestLink(row({ externalId: 'OZ-6', name: 'Спермидин' }), []), null);
eq('несвязанный товар — не выдумываем', suggestLink(row({ externalId: 'OZ-7', name: 'Кофеварка Bosch' }), CATALOG), null);
ok('порог автоподбора задан явно', MIN_AUTO_CONFIDENCE === 70);

// ===========================================================================
console.log('\n=== qty_per_unit выводится и из фасовки, и из числа капсул ===');
// ===========================================================================
{
  const s = suggestLink(row({ externalId: 'OZ-SET3', name: 'Спермидин 500 мг, 60 капсул — набор 3 банки' }), CATALOG);
  ok('карточка-набор сшита с базовой банкой', s?.itemId === SPD500.id);
  eq('qty_per_unit = 3 (иначе остатки поедут втрое)', s?.qtyPerUnit, 3);
}
{
  const s = suggestLink(row({ externalId: 'OZ-180', name: 'Спермидин 500 мг, 180 капсул' }), CATALOG);
  ok('180 капсул = 3 наши банки по 60', s?.itemId === SPD500.id);
  eq('qty_per_unit выведен из кратности капсул', s?.qtyPerUnit, 3);
}
{
  const s = suggestLink(row({ externalId: 'SPD-500-60', name: 'Спермидин 500 мг, 60 капсул' }), CATALOG);
  eq('обычная карточка — qty_per_unit = 1', s?.qtyPerUnit, 1);
}

// ===========================================================================
console.log('\n=== Детерминизм и пакетный режим ===');
// ===========================================================================
{
  const r = row({ externalId: 'OZ-8', name: 'Спермидин 500 мг' });
  const a = rankCandidates(r, CATALOG);
  const b = rankCandidates(r, [...CATALOG].reverse());
  eq('порядок каталога не влияет на ранжирование', JSON.stringify(a), JSON.stringify(b));
  ok('кандидаты отсортированы по убыванию уверенности', a.every((c, i) => i === 0 || a[i - 1].confidence >= c.confidence));
}
{
  const rows = [
    row({ externalId: 'OZ-777', barcode: '4600000000017' }),
    row({ externalId: 'OZ-X', name: 'Кофеварка' }),
    row({ externalId: 'SPD-250-60' }),
  ];
  const res = suggestLinks(rows, CATALOG);
  eq('порядок строк сохраняется', res.map((x) => x.row.externalId), ['OZ-777', 'OZ-X', 'SPD-250-60']);
  eq('сшилось 2 из 3, третья ждёт человека', res.filter((x) => x.suggestion !== null).length, 2);
  ok('несопоставленная строка отдаёт пустой список кандидатов', res[1].candidates.length === 0);
}

// ===========================================================================
console.log('\n=== Встроенные места (§3 + §12.3) ===');
// ===========================================================================
eq('девять встроенных мест', BUILTIN_STOCK_PLACES.length, 9);
eq(
  'состав и порядок кодов',
  BUILTIN_PLACE_CODES,
  ['own', 'transit_ozon', 'ozon_fbo', 'ozon_fbs', 'wb', 'yandex', 'site_shopb', 'site_shopa', 'loss'],
);
eq('коды уникальны', new Set(BUILTIN_PLACE_CODES).size, BUILTIN_PLACE_CODES.length);
eq('склады Ozon — единственные external (остаток отдаёт API)', externalPlaceCodes(), ['ozon_fbo', 'ozon_fbs']);
ok('журнальные места — все остальные', ledgerPlaceCodes().length === 7);
ok(
  '§12.3: WB и Яндекс ведутся журналом — коннектора нет, только импорт файлов',
  getBuiltinPlace('wb')?.authority === 'ledger' && getBuiltinPlace('yandex')?.authority === 'ledger',
);
ok(
  '§3: движения нельзя вешать на external-место',
  !canHoldMoves({ authority: 'external' }) && canHoldMoves({ authority: 'ledger' }),
);
eq('source склада Ozon совпадает с ozon_warehouse_stocks.source', getBuiltinPlace('ozon_fbo')?.externalSource, 'FBO');
eq('транзит на Ozon относится к каналу ozon', placeChannel('transit_ozon'), 'ozon');
eq('свой склад к каналу не привязан', placeChannel(OWN_PLACE_CODE), null);
eq('место потерь виртуальное', getBuiltinPlace(LOSS_PLACE_CODE)?.kind, 'virtual');
ok('sort_order строго возрастает', BUILTIN_STOCK_PLACES.every((p, i) => i === 0 || BUILTIN_STOCK_PLACES[i - 1].sortOrder < p.sortOrder));
ok('неизвестный код не проходит', !isBuiltinPlaceCode('ozon_fbw') && isBuiltinPlaceCode('own'));

console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
