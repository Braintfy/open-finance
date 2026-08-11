// PURPOSE: Резолв АКТИВНОГО кабинета на текущий запрос (RSC + route handlers).
// Источник истины по приоритету: httpOnly-кука `of_active_workspace` →
// users.settings.activeWorkspaceId → default-кабинет пары (tenant,user).
//
// Модуль импортирует next/headers, поэтому НЕ используется в чистых модулях и
// smoke-тестах — правила скоупинга живут в ./scope.ts (без зависимостей).
// React cache() дедуплицирует резолв в рамках одного запроса (страница + её
// вложенные server-компоненты дергают его многократно).

import { cache } from 'react';
import { cookies } from 'next/headers';
import {
  getOrCreateDefaultWorkspace,
  getWorkspaceById,
  resolveActiveWorkspace,
} from './queries';
import {
  WORKSPACE_COOKIE,
  activeWorkspaceScope,
  isUuid,
  pageWorkspaceScope,
  type ActiveWorkspaceScope,
  type PageWorkspaceScope,
} from './scope';

/** Активный + default кабинет пары (tenant,user). Кэшируется на запрос. */
export const getWorkspaceScope = cache(
  async (tenantId: string, userId: string): Promise<ActiveWorkspaceScope> => {
    const def = await getOrCreateDefaultWorkspace(tenantId, userId);

    let cookieId: string | undefined;
    try {
      cookieId = (await cookies()).get(WORKSPACE_COOKIE)?.value;
    } catch {
      // cookies() недоступен (например, статический рендер) — фолбэк на settings.
      cookieId = undefined;
    }

    if (cookieId && isUuid(cookieId)) {
      if (cookieId === def.id) {
        return scopeOf(def, def);
      }
      const fromCookie = await getWorkspaceById({
        tenantId,
        userId,
        id: cookieId,
      });
      if (fromCookie) return scopeOf(fromCookie, def);
    }

    // Куки нет / кабинет удалён → персист в users.settings, иначе default.
    const active = await resolveActiveWorkspace(tenantId, userId);
    return scopeOf(active, def);
  },
);

/** Скоуп конкретной страницы (общие ключи → default-кабинет). */
export async function getPageWorkspaceScope(
  tenantId: string,
  userId: string,
  pageKey: string,
): Promise<PageWorkspaceScope> {
  const scope = await getWorkspaceScope(tenantId, userId);
  return pageWorkspaceScope(scope, pageKey);
}

/**
 * Скоуп активного кабинета без привязки к странице — сейчас только для вкладок
 * юнит-экономики (они не бывают «общими», в отличие от 'nav'/'board-*').
 *
 * AI-отчёты сюда НЕ относятся: все 4 роута (block-reports, section-reports,
 * analyze-block, analyze-section) резолвят скоуп через getPageWorkspaceScope
 * (по pageKey), поэтому отчёты общих страниц 'board-*' лежат в default-кабинете
 * и общие для всех кабинетов.
 */
export async function getActiveWorkspacePageScope(
  tenantId: string,
  userId: string,
): Promise<PageWorkspaceScope> {
  return activeWorkspaceScope(await getWorkspaceScope(tenantId, userId));
}

function scopeOf(
  active: { id: string; template: string },
  def: { id: string; template: string },
): ActiveWorkspaceScope {
  return {
    activeId: active.id,
    activeTemplate: active.template,
    defaultId: def.id,
    defaultTemplate: def.template,
  };
}
