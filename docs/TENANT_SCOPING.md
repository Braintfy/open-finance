# Tenant scoping gate (I1)

Защита от cross-tenant утечек данных в Open Finance реализована **на уровне
приложения** (а не Postgres RLS). Это значит: корректность держится на дисциплине
кода, и потому зафиксирована **обязательным ревью-гейтом**, описанным здесь.

> Решение по аудиту (SECURITY_AUDIT, I1): «Postgres RLS **или** зафиксированный
> обязательный ревью-гейт». Выбран ревью-гейт (RLS — возможное усиление позже,
> см. внизу).

## Правило (обязательно)

1. **tenantId берётся ТОЛЬКО из сессии**, через `requireTenant()` /
   `requireTenantRoute()` (`src/lib/auth/guards.ts`). Никогда — из тела запроса,
   query-параметров или заголовков.
2. **Каждый** запрос (`select/insert/update/delete`) к таблице с колонкой
   `tenant_id` ОБЯЗАН фильтровать/проставлять `tenant_id` этим значением.
3. **Кросс-tenant доступ** (например, `getById`) проверяет И `id`, И `tenant_id`
   в одном `WHERE` — нельзя «сначала найти по id, потом сверить tenant».
4. **Системные/кросс-tenant операции** (воркеры, super_admin, удаление аккаунта)
   допускают обращение без tenant-фильтра ТОЛЬКО осознанно и должны быть помечены
   комментарием `// cross-tenant: <причина>`.

## Канонический паттерн

API route:

```ts
import { requireTenantRoute } from '@/lib/auth/guards';

export async function GET() {
  const t = await requireTenantRoute();
  if (!t.ok) return t.response; // 401
  const rows = await listAccounts({ tenantId: t.ctx.tenantId });
  return NextResponse.json({ ok: true, rows });
}
```

Server action / RSC / lib:

```ts
import { requireTenant } from '@/lib/auth/guards';

const { tenantId } = await requireTenant(); // бросит TenantAuthError если нет
```

Доменный query-helper — всегда принимает `tenantId` и фильтрует им:

```ts
export async function listAccounts(args: { tenantId: string }) {
  return db.select().from(marketplaceAccounts)
    .where(eq(marketplaceAccounts.tenantId, args.tenantId));
}
```

## Чек-лист PR-ревью (tenant-scope)

Перед merge любого PR, который трогает БД-запросы:

- [ ] Все новые запросы к tenant-таблицам фильтруют `tenant_id`.
- [ ] `tenantId` получен через `requireTenant()/requireTenantRoute()`, не из ввода.
- [ ] `getById`-операции проверяют `id` И `tenant_id` вместе.
- [ ] Любой запрос без tenant-фильтра помечен `// cross-tenant: причина` и оправдан.
- [ ] Прогнан `pnpm check:tenant-isolation` (зелёный).

## Smoke-канарейка

```bash
pnpm check:tenant-isolation
```

`scripts/check-tenant-isolation.ts` создаёт два tenant'а с данными и проверяет, что
запрос с фильтром `tenant_id` не отдаёт чужие строки, а обращение к чужому `id`
возвращает 0 строк. Тест-данные удаляются автоматически. Запускать на dev/CI, не на
проде.

> Канарейка проверяет инвариант на уровне БД (фильтр `tenant_id` работает). Она не
> заменяет ревью: забытый фильтр в новом helper'е поймает именно чек-лист выше.
> Расширение до endpoint-уровня (две сессии → HTTP) — возможный следующий шаг.

## Перечень tenant-таблиц

Таблицы с `tenant_id` (на момент написания): `memberships`, `categories`,
`transactions`, `deadlines`, `blocks`, `block_layouts`, `block_ai_reports`,
`section_ai_reports`, `boards`, `unit_products`, `unit_calculations`,
`unit_imports`, `unit_economics_tabs`, `inbox_channels`, `inbox_messages`,
`marketplace_accounts`, `ozon_*` (данные синка), `ai_agents`, `ai_usage`,
`ai_audit_log`, `memory_chunks`, `user_ai_credentials`, `ozon_ai_insight_reports`,
`account_deletion_requests`.

## Будущее усиление: Postgres RLS

Defense-in-depth поверх ревью-гейта. Потребует: tenant-context через
`SET LOCAL app.current_tenant_id` в транзакции на каждый запрос, `FORCE ROW LEVEL
SECURITY` + политики на всех таблицах выше, и bypass-путь для системных операций.
Это многосессионный рефактор data-слоя — выносится отдельной задачей.
