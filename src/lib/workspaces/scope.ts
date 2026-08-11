// PURPOSE: Чистые правила скоупинга воркспейсов («кабинетов») — без БД и без
// next/headers, поэтому модуль импортируется и сервером, и smoke-тестами.
//
// Ключевое разделение (LK_V2_PLAN.md Этап 3):
//   - СТРАНИЧНЫЕ раскладки (dashboard/cashflow/unit-economics-*/marketplaces/
//     inbox) — живут в АКТИВНОМ кабинете;
//   - ОБЩИЕ раскладки ('nav' = сайдбар, 'board-*' = доски) — ВСЕГДА в
//     DEFAULT-кабинете (доски и сайдбар общие между кабинетами).
//
// includeLegacy: строки с workspace_id IS NULL (AI-отчёты и вкладки, созданные
// до миграции 0010/0011) считаются принадлежащими DEFAULT-кабинету — только там
// они видны. В остальных кабинетах их нет.

/** Имя httpOnly-куки с id активного кабинета. */
export const WORKSPACE_COOKIE = 'of_active_workspace';

/** Активный + default кабинет пары (tenant,user) на текущий запрос. */
export type ActiveWorkspaceScope = {
  activeId: string;
  activeTemplate: string;
  defaultId: string;
  defaultTemplate: string;
};

/** Скоуп конкретной страницы — что подставлять в запросы к block_layouts и др. */
export type PageWorkspaceScope = {
  workspaceId: string;
  /** Шаблон кабинета — влияет на код-дефолт раскладки (getDefaultLayout). */
  template: string;
  /** Видны ли legacy-строки с workspace_id IS NULL (только в default-кабинете). */
  includeLegacy: boolean;
};

/** Раскладки, общие между кабинетами: сайдбар + доски. */
export function isSharedPageKey(pageKey: string): boolean {
  return pageKey === 'nav' || pageKey.startsWith('board-');
}

/**
 * Скоуп «активного кабинета» без привязки к конкретной странице — для сущностей,
 * которые целиком живут в активном кабинете (сейчас это вкладки юнит-экономики).
 *
 * AI-отчёты идут НЕ сюда, а через pageWorkspaceScope(pageKey): у общих страниц
 * ('nav'/'board-*') они попадают в default-кабинет и потому общие.
 */
export function activeWorkspaceScope(
  scope: ActiveWorkspaceScope,
): PageWorkspaceScope {
  return {
    workspaceId: scope.activeId,
    template: scope.activeTemplate,
    includeLegacy: scope.activeId === scope.defaultId,
  };
}

/** Скоуп страницы: общие ключи → default-кабинет, остальные → активный. */
export function pageWorkspaceScope(
  scope: ActiveWorkspaceScope,
  pageKey: string,
): PageWorkspaceScope {
  if (isSharedPageKey(pageKey)) {
    return {
      workspaceId: scope.defaultId,
      template: scope.defaultTemplate,
      includeLegacy: true,
    };
  }
  return activeWorkspaceScope(scope);
}

/** UUID v4-ish проверка — защита от невалидной куки (Postgres падает на uuid-каст). */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
