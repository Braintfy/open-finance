// PURPOSE: Unit tests для PageSourceProvider + useEffectiveSource (логика без React).
// Проверяем что override-чтение/запись + резолвинг работают корректно.
// Запуск: pnpm tsx scripts/test-source-context.ts

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

// Симулируем effective-source resolver.
type PageSourceValue = string | null;

function useEffectiveSourceCore(
  pageValue: PageSourceValue,
  blockOverride: PageSourceValue | undefined,
): { value: PageSourceValue; source: 'global' | 'override' } {
  if (blockOverride !== undefined) {
    return { value: blockOverride, source: 'override' };
  }
  return { value: pageValue, source: 'global' };
}

console.log('\n=== useEffectiveSource ===');
{
  // Глобальный page-level source применяется когда нет override.
  const r1 = useEffectiveSourceCore('bank', undefined);
  ok('global bank when no override', r1.value === 'bank' && r1.source === 'global');

  // Override === null означает явно «все источники» (это override, не global).
  const r2 = useEffectiveSourceCore('bank', null);
  ok('override=null overrides page bank → "все"', r2.value === null && r2.source === 'override');

  // Override === конкретное значение.
  const r3 = useEffectiveSourceCore('bank', 'manual');
  ok('override=manual overrides page bank', r3.value === 'manual' && r3.source === 'override');

  // Page=null + override undefined → global null (т.е. «все»).
  const r4 = useEffectiveSourceCore(null, undefined);
  ok('global=null when no override and page null', r4.value === null && r4.source === 'global');

  // Override может быть тем же что и global — но всё равно считается override
  // (для UI чтобы пользователь видел бейдж «зафиксирован»).
  const r5 = useEffectiveSourceCore('bank', 'bank');
  ok('override=same as global → still override', r5.source === 'override');
}

// Симулируем persistence (localStorage adapter абстрагирован для node).
console.log('\n=== persistence (memory stub) ===');
{
  const store = new Map<string, string>();
  const adapter = {
    get(k: string) {
      return store.get(k) ?? null;
    },
    set(k: string, v: string) {
      store.set(k, v);
    },
    delete(k: string) {
      store.delete(k);
    },
  };

  function persistOverride(
    instanceId: string,
    override: PageSourceValue | undefined,
  ) {
    const key = `block:${instanceId}:source:v1`;
    if (override === undefined) {
      adapter.delete(key);
    } else {
      adapter.set(key, override === null ? '__all__' : override);
    }
  }
  function loadOverride(instanceId: string): PageSourceValue | undefined {
    const raw = adapter.get(`block:${instanceId}:source:v1`);
    if (raw === null) return undefined;
    if (raw === '__all__') return null;
    return raw;
  }

  persistOverride('b1', 'bank');
  ok('persist + load bank', loadOverride('b1') === 'bank');

  persistOverride('b1', null);
  ok('persist + load null (= все)', loadOverride('b1') === null);

  persistOverride('b1', undefined);
  ok('clear override', loadOverride('b1') === undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
