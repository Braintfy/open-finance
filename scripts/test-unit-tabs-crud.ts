// PURPOSE: Тесты для unit-economics-tabs CRUD логики (v0.22.0).
// Покрытие:
//   - DEFAULT_UNIT_TABS содержит 4 ожидаемых вкладки
//   - PageKey-конвенция: default = 'unit-economics-{key}', custom = 'unit-economics-custom-*'
//   - Replicated merge-and-sort логика
// Запуск: pnpm tsx scripts/test-unit-tabs-crud.ts

import { DEFAULT_UNIT_TABS } from '../src/lib/db/schema/unit-economics-tabs';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
  }
}

console.log('\n=== DEFAULT_UNIT_TABS ===');
ok('4 default-вкладки', DEFAULT_UNIT_TABS.length === 4);
ok(
  'ключи: ozon, ozon-multi, yandex, my-store',
  DEFAULT_UNIT_TABS.map((t) => t.defaultKey).join(',') ===
    'ozon,ozon-multi,yandex,my-store',
);
ok(
  'pageKeys = unit-economics-{key}',
  DEFAULT_UNIT_TABS.every((t) => t.pageKey === `unit-economics-${t.defaultKey}`),
);
ok(
  'все имеют order 0..3',
  DEFAULT_UNIT_TABS.map((t) => t.order).join(',') === '0,1,2,3',
);

console.log('\n=== custom pageKey шаблон ===');
{
  const re = /^unit-economics-custom-[a-z0-9]{8}$/;
  ok('unit-economics-custom-abcd1234 валиден', re.test('unit-economics-custom-abcd1234'));
  ok('UPPERCASE не валиден', !re.test('unit-economics-custom-ABCDEF12'));
  ok('короче не валиден', !re.test('unit-economics-custom-abc'));
}

// ============================================================================
// Replicated tab management logic

type Tab = {
  id: string;
  pageKey: string;
  label: string;
  order: number;
  kind: 'default' | 'custom';
};

function reorderAfterCreate(tabs: Tab[], newTab: Omit<Tab, 'order'>): Tab[] {
  const maxOrder = tabs.reduce((m, t) => Math.max(m, t.order), -1);
  return [...tabs, { ...newTab, order: maxOrder + 1 }].sort(
    (a, b) => a.order - b.order,
  );
}

function deleteWithFallback(tabs: Tab[], deletedId: string, currentActive: string): {
  remaining: Tab[];
  nextActive: string | null;
} {
  const remaining = tabs.filter((t) => t.id !== deletedId);
  const nextActive = currentActive === deletedId ? remaining[0]?.id ?? null : currentActive;
  return { remaining, nextActive };
}

console.log('\n=== reorder after create ===');
{
  const tabs: Tab[] = [
    { id: '1', pageKey: 'unit-economics-ozon', label: 'Ozon', order: 0, kind: 'default' },
    { id: '2', pageKey: 'unit-economics-yandex', label: 'Yandex', order: 1, kind: 'default' },
  ];
  const result = reorderAfterCreate(tabs, {
    id: '3',
    pageKey: 'unit-economics-custom-abc',
    label: 'Custom',
    kind: 'custom',
  });
  ok('новая вкладка в конце', result[2].id === '3');
  ok('order = 2', result[2].order === 2);
}

console.log('\n=== delete with active fallback ===');
{
  const tabs: Tab[] = [
    { id: '1', pageKey: 'p1', label: 'A', order: 0, kind: 'default' },
    { id: '2', pageKey: 'p2', label: 'B', order: 1, kind: 'default' },
    { id: '3', pageKey: 'p3', label: 'C', order: 2, kind: 'custom' },
  ];
  // Удаление активной
  const r1 = deleteWithFallback(tabs, '2', '2');
  ok('удалена активная → fallback на первую остальную', r1.nextActive === '1');
  ok('remaining = 2', r1.remaining.length === 2);

  // Удаление НЕ активной
  const r2 = deleteWithFallback(tabs, '3', '1');
  ok('удалена не активная → active не меняется', r2.nextActive === '1');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
