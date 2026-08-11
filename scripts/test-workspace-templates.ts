// PURPOSE: Smoke-тесты чистой логики воркспейсов (Этап 3 LK_V2_PLAN.md):
//   - WORKSPACE_TEMPLATES: 'seller-ozon' (Ozon-дашборд) и 'blank' (пусто везде)
//   - getDefaultLayout(pageKey, template) — template-aware код-дефолты
//   - DEFAULT_LAYOUTS.dashboard переписан (нет legacy stat.*/inbox/navigate.card)
//   - правила скоупинга: isSharedPageKey / pageWorkspaceScope / activeWorkspaceScope
// Запуск: pnpm tsx scripts/test-workspace-templates.ts

import {
  DEFAULT_LAYOUTS,
  DEFAULT_WORKSPACE_TEMPLATE,
  WORKSPACE_TEMPLATES,
  WORKSPACE_TEMPLATE_IDS,
  getDefaultLayout,
  isWorkspaceTemplateId,
  listWorkspaceTemplates,
} from '../src/lib/blocks/default-layouts';
import {
  WORKSPACE_COOKIE,
  activeWorkspaceScope,
  isSharedPageKey,
  isUuid,
  pageWorkspaceScope,
  type ActiveWorkspaceScope,
} from '../src/lib/workspaces/scope';

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

console.log('\n=== WORKSPACE_TEMPLATES ===');
ok('два шаблона: seller-ozon и blank', WORKSPACE_TEMPLATE_IDS.join(',') === 'seller-ozon,blank');
ok('дефолт нового кабинета — seller-ozon', DEFAULT_WORKSPACE_TEMPLATE === 'seller-ozon');
ok('isWorkspaceTemplateId валидирует', isWorkspaceTemplateId('blank') && !isWorkspaceTemplateId('nope'));
ok(
  'listWorkspaceTemplates отдаёт метаданные без раскладок',
  listWorkspaceTemplates().every(
    (t) => t.label.length > 0 && t.description.length > 0 && t.iconName.length > 0,
  ),
);
ok(
  'seller-ozon наследует общие дефолты, blank — нет',
  WORKSPACE_TEMPLATES['seller-ozon'].inheritDefaults &&
    !WORKSPACE_TEMPLATES.blank.inheritDefaults,
);

console.log('\n=== getDefaultLayout: seller-ozon ===');
{
  const dash = getDefaultLayout('dashboard', 'seller-ozon');
  const types = dash.blocks.map((b) => b.type);
  ok('дашборд не пустой', dash.blocks.length > 0);
  ok('есть Ozon KPI', types.includes('unit.ozon-kpi'));
  ok('есть динамика (chart)', types.includes('unit.ozon-chart'));
  ok('есть аналитика по SKU', types.includes('unit.ozon-analytics'));
  ok('есть остатки по складам', types.includes('unit.ozon-warehouse-clusters'));
  ok('есть ABC', types.includes('unit.ozon-abc'));
  ok('есть здоровье данных', types.includes('unit.ozon-data-health'));
  ok('есть примеры custom.data и excel.cell', types.includes('custom.data') && types.includes('excel.cell'));
  const wh = dash.blocks.find((b) => b.type === 'unit.ozon-warehouse-clusters');
  ok(
    'остатки в разрезе складов (groupBy=warehouse)',
    (wh?.config as { groupBy?: string } | undefined)?.groupBy === 'warehouse',
  );
  ok('нет legacy stat.*', !types.some((t) => t.startsWith('stat.')));
  ok('нет пустого inbox.dashboard', !types.includes('inbox.dashboard'));
  ok('нет мёртвой navigate.card', !types.includes('navigate.card'));
  ok(
    'уникальные id блоков',
    new Set(dash.blocks.map((b) => b.id)).size === dash.blocks.length,
  );
  ok(
    'блоки в пределах 12 колонок',
    dash.blocks.every((b) => b.x >= 0 && b.w >= 1 && b.x + b.w <= 12),
  );
  ok(
    'прочие страницы наследуют DEFAULT_LAYOUTS',
    getDefaultLayout('cashflow', 'seller-ozon').blocks.length ===
      DEFAULT_LAYOUTS.cashflow.blocks.length,
  );
}

console.log('\n=== getDefaultLayout: blank ===');
{
  const pages = ['dashboard', 'cashflow', 'unit-economics-ozon', 'marketplaces-ozon-dashboard'];
  ok(
    'все страницы пустые',
    pages.every((k) => getDefaultLayout(k, 'blank').blocks.length === 0),
  );
  ok(
    'pageKey сохраняется в пустой раскладке',
    getDefaultLayout('cashflow', 'blank').pageKey === 'cashflow',
  );
}

console.log('\n=== getDefaultLayout: без шаблона / неизвестный ===');
ok(
  'без template — прежнее поведение (DEFAULT_LAYOUTS)',
  getDefaultLayout('dashboard').blocks.length === DEFAULT_LAYOUTS.dashboard.blocks.length,
);
ok(
  'неизвестный template — фолбэк на DEFAULT_LAYOUTS',
  getDefaultLayout('dashboard', 'wat').blocks.length === DEFAULT_LAYOUTS.dashboard.blocks.length,
);
ok(
  'неизвестная страница — пустая раскладка',
  getDefaultLayout('unknown-page', 'seller-ozon').blocks.length === 0,
);

console.log('\n=== Скоуп кабинетов ===');
ok('имя куки стабильно', WORKSPACE_COOKIE === 'of_active_workspace');
ok(
  'общие ключи: nav и board-*',
  isSharedPageKey('nav') && isSharedPageKey('board-abc') && !isSharedPageKey('dashboard'),
);
ok(
  'unit-economics-* НЕ общие',
  !isSharedPageKey('unit-economics-ozon') && !isSharedPageKey('unit-economics-custom-abcd1234'),
);

{
  const scope: ActiveWorkspaceScope = {
    activeId: 'ws-active',
    activeTemplate: 'blank',
    defaultId: 'ws-default',
    defaultTemplate: 'seller-ozon',
  };
  const dash = pageWorkspaceScope(scope, 'dashboard');
  const nav = pageWorkspaceScope(scope, 'nav');
  const board = pageWorkspaceScope(scope, 'board-42');

  ok('страничная раскладка → активный кабинет', dash.workspaceId === 'ws-active');
  ok('шаблон берётся у активного кабинета', dash.template === 'blank');
  ok('в НЕ-default кабинете legacy-строки скрыты', dash.includeLegacy === false);
  ok('сайдбар nav → default-кабинет', nav.workspaceId === 'ws-default' && nav.includeLegacy);
  ok('доски → default-кабинет', board.workspaceId === 'ws-default' && board.includeLegacy);
  ok(
    'activeWorkspaceScope == скоуп страничного ключа',
    activeWorkspaceScope(scope).workspaceId === dash.workspaceId &&
      activeWorkspaceScope(scope).includeLegacy === dash.includeLegacy,
  );

  const single: ActiveWorkspaceScope = {
    activeId: 'ws-default',
    activeTemplate: 'seller-ozon',
    defaultId: 'ws-default',
    defaultTemplate: 'seller-ozon',
  };
  ok(
    'в default-кабинете legacy-строки видны',
    pageWorkspaceScope(single, 'dashboard').includeLegacy === true,
  );
}

console.log('\n=== isUuid (защита куки от мусора) ===');
ok('валидный uuid', isUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301'));
ok('мусор отклоняется', !isUuid("'; DROP TABLE workspaces;--"));
ok('пустая строка отклоняется', !isUuid(''));

console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
