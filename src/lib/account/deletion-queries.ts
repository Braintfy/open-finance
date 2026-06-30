// PURPOSE: Queries-слой для 152-ФЗ self-service: заявки на удаление аккаунта +
// очистка AI-данных пользователя. RBAC проверяется в routes, тут — только доступ
// к БД. Каскадное удаление опирается на FK ON DELETE CASCADE (tenant/user).
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  accountDeletionRequests,
  type AccountDeletionRequest,
} from '@/lib/db/schema/account-deletion';
import { tenants } from '@/lib/db/schema/tenants';
import { users } from '@/lib/db/schema/users';
import { blockAiReports } from '@/lib/db/schema/block-ai-reports';
import { sectionAiReports } from '@/lib/db/schema/section-ai-reports';
import { ozonAiInsightReports } from '@/lib/db/schema/ozon-ai-insights';
import { userAiCredentials } from '@/lib/db/schema/user-ai-credentials';

/** Активная (ожидающая обработки) заявка пользователя, либо null. */
export async function getActiveDeletionRequest(
  userId: string,
): Promise<AccountDeletionRequest | null> {
  const [row] = await db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        eq(accountDeletionRequests.status, 'pending'),
      ),
    )
    .orderBy(desc(accountDeletionRequests.requestedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Создать заявку на удаление. Идемпотентно: если уже есть pending-заявка —
 * возвращает её (повторный клик не плодит дубли).
 */
export async function createDeletionRequest(args: {
  userId: string;
  tenantId: string;
  email: string;
  reason?: string | null;
}): Promise<AccountDeletionRequest> {
  const existing = await getActiveDeletionRequest(args.userId);
  if (existing) return existing;

  const [row] = await db
    .insert(accountDeletionRequests)
    .values({
      userId: args.userId,
      tenantId: args.tenantId,
      email: args.email,
      reason: args.reason?.trim() || null,
      status: 'pending',
    })
    .returning();
  return row!;
}

/** Отменить собственную pending-заявку (пользователь передумал). */
export async function cancelDeletionRequest(args: {
  userId: string;
}): Promise<boolean> {
  const res = await db
    .update(accountDeletionRequests)
    .set({ status: 'cancelled', processedAt: new Date() })
    .where(
      and(
        eq(accountDeletionRequests.userId, args.userId),
        eq(accountDeletionRequests.status, 'pending'),
      ),
    )
    .returning({ id: accountDeletionRequests.id });
  return res.length > 0;
}

/** Список заявок для админки (по умолчанию pending первыми, новые сверху). */
export async function listDeletionRequests(opts?: {
  status?: AccountDeletionRequest['status'];
  limit?: number;
}): Promise<AccountDeletionRequest[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const base = db.select().from(accountDeletionRequests);
  const rows = opts?.status
    ? await base
        .where(eq(accountDeletionRequests.status, opts.status))
        .orderBy(desc(accountDeletionRequests.requestedAt))
        .limit(limit)
    : await base.orderBy(desc(accountDeletionRequests.requestedAt)).limit(limit);
  return rows;
}

/**
 * Удалить все AI-данные пользователя (отчёты по блокам/разделам, Ozon AI-инсайты,
 * BYOK-ключи). Скоуп — (tenantId, userId). Возвращает счётчики удалённого.
 */
export async function clearUserAiData(args: {
  tenantId: string;
  userId: string;
}): Promise<{
  blockReports: number;
  sectionReports: number;
  ozonInsights: number;
  credentials: number;
}> {
  const [block, section, ozon, creds] = await Promise.all([
    db
      .delete(blockAiReports)
      .where(and(eq(blockAiReports.tenantId, args.tenantId), eq(blockAiReports.userId, args.userId)))
      .returning({ id: blockAiReports.id }),
    db
      .delete(sectionAiReports)
      .where(and(eq(sectionAiReports.tenantId, args.tenantId), eq(sectionAiReports.userId, args.userId)))
      .returning({ id: sectionAiReports.id }),
    db
      .delete(ozonAiInsightReports)
      .where(
        and(eq(ozonAiInsightReports.tenantId, args.tenantId), eq(ozonAiInsightReports.userId, args.userId)),
      )
      .returning({ id: ozonAiInsightReports.id }),
    db
      .delete(userAiCredentials)
      .where(and(eq(userAiCredentials.tenantId, args.tenantId), eq(userAiCredentials.userId, args.userId)))
      .returning({ id: userAiCredentials.id }),
  ]);
  return {
    blockReports: block.length,
    sectionReports: section.length,
    ozonInsights: ozon.length,
    credentials: creds.length,
  };
}

export type ProcessResult =
  | { ok: true; action: 'completed' | 'rejected' }
  | { ok: false; error: string };

/**
 * Обработать заявку (только super_admin — проверка в route).
 * complete → каскадное физическое удаление tenant + user (FK CASCADE снесёт все
 * дочерние данные). reject → пометить отклонённой с заметкой.
 * ВНИМАНИЕ: удаляется ВЕСЬ tenant — если в нём несколько участников, доступ
 * потеряют все. В текущей модели tenant односоставный (owner = заявитель).
 */
export async function processDeletionRequest(args: {
  requestId: string;
  processedBy: string;
  action: 'complete' | 'reject';
  note?: string | null;
}): Promise<ProcessResult> {
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.id, args.requestId))
      .limit(1);

    if (!req) return { ok: false, error: 'Заявка не найдена' };
    if (req.status !== 'pending') {
      return { ok: false, error: 'Заявка уже обработана' };
    }

    if (args.action === 'reject') {
      await tx
        .update(accountDeletionRequests)
        .set({
          status: 'rejected',
          processedBy: args.processedBy,
          processedAt: new Date(),
          note: args.note?.trim() || null,
        })
        .where(eq(accountDeletionRequests.id, req.id));
      return { ok: true, action: 'rejected' };
    }

    // action === 'complete' — помечаем выполненной, затем каскадно удаляем.
    await tx
      .update(accountDeletionRequests)
      .set({
        status: 'completed',
        processedBy: args.processedBy,
        processedAt: new Date(),
        note: args.note?.trim() || null,
      })
      .where(eq(accountDeletionRequests.id, req.id));

    if (req.tenantId) {
      await tx.delete(tenants).where(eq(tenants.id, req.tenantId));
    }
    if (req.userId) {
      await tx.delete(users).where(eq(users.id, req.userId));
    }
    return { ok: true, action: 'completed' };
  });
}
