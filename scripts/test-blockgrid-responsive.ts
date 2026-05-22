// PURPOSE: Unit-тест для логики «canonical breakpoint» в BlockGrid.
// Проверяет, что мы НЕ перезаписываем lg-layout позициями с узких экранов.
// Запуск: pnpm tsx scripts/test-blockgrid-responsive.ts

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

// Зеркало констант из BlockGrid.tsx — должны быть согласованы.
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };

function widthToBreakpoint(width: number): string {
  if (width < BREAKPOINTS.xs) return 'xxs';
  if (width < BREAKPOINTS.sm) return 'xs';
  if (width < BREAKPOINTS.md) return 'sm';
  if (width < BREAKPOINTS.lg) return 'md';
  return 'lg';
}

function isCanonical(bp: string): boolean {
  return bp === 'lg' || bp === 'md';
}

console.log('\n=== breakpoint detection from container width ===');
{
  ok('width=1920 → lg', widthToBreakpoint(1920) === 'lg');
  ok('width=1200 → lg', widthToBreakpoint(1200) === 'lg');
  ok('width=1199 → md', widthToBreakpoint(1199) === 'md');
  ok('width=996 → md', widthToBreakpoint(996) === 'md');
  ok('width=900 → sm', widthToBreakpoint(900) === 'sm');
  ok('width=768 → sm', widthToBreakpoint(768) === 'sm');
  ok('width=767 → xs', widthToBreakpoint(767) === 'xs');
  ok('width=480 → xs', widthToBreakpoint(480) === 'xs');
  ok('width=479 → xxs', widthToBreakpoint(479) === 'xxs');
  ok('width=0 → xxs', widthToBreakpoint(0) === 'xxs');
}

console.log('\n=== canonical breakpoint guard ===');
{
  // md и lg оба имеют 12 cols → можно безопасно сохранять.
  ok('lg → canonical (write blocks OK)', isCanonical('lg'));
  ok('md → canonical (write blocks OK)', isCanonical('md'));
  // sm/xs/xxs — layout сжат, перезаписывать lg НЕЛЬЗЯ.
  ok('sm → NOT canonical (skip write)', !isCanonical('sm'));
  ok('xs → NOT canonical (skip write)', !isCanonical('xs'));
  ok('xxs → NOT canonical (skip write)', !isCanonical('xxs'));

  // Проверка: количество cols для canonical совпадает.
  ok('lg cols === md cols (12)', COLS.lg === COLS.md);
}

console.log('\n=== bug scenario: lg→sm→lg preserves layout ===');
{
  // Симулируем: пользователь начинает с lg layout w=12,
  // ресайзит окно в sm (RGL автоматически сжимает в 6 cols),
  // ресайзит обратно в lg → лейаут восстанавливается.
  const blocks = [{ id: 'a', x: 0, y: 0, w: 12, h: 3 }];

  function onLayoutChange(layout: typeof blocks, currentBp: string): typeof blocks {
    // Новая логика: skip if not canonical.
    if (!isCanonical(currentBp)) return blocks;
    return layout.map((l) => ({ ...l }));
  }

  // sm-layout от RGL (сжатый до 6 cols).
  const smLayout = [{ id: 'a', x: 0, y: 0, w: 6, h: 3 }];

  // Старый bug: writeBlocks(smLayout) — теряем оригинал.
  // Новая логика: skip write because bp === 'sm'.
  const afterSm = onLayoutChange(smLayout, 'sm');
  ok(
    'sm onLayoutChange НЕ перезаписывает blocks (w остался 12)',
    afterSm[0].w === 12,
  );

  // Дальше пользователь возвращается в lg → RGL отдаёт оригинал.
  const lgLayout = [{ id: 'a', x: 0, y: 0, w: 12, h: 3 }];
  const afterLg = onLayoutChange(lgLayout, 'lg');
  ok(
    'lg onLayoutChange сохраняет оригинальные размеры (w=12)',
    afterLg[0].w === 12,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
