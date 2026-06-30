// PURPOSE: Заявки на удаление аккаунта (152-ФЗ «право на удаление»).
// Поток: self-service запрос пользователя → ручное подтверждение super_admin в
// админке → каскадное физическое удаление tenant + user (FK ON DELETE CASCADE).
// FK здесь — ON DELETE SET NULL + email-снапшот, чтобы аудит-строка пережила
// удаление пользователя и осталась доказательством обработки запроса.
import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/** Статусы жизненного цикла заявки. */
export type DeletionRequestStatus = 'pending' | 'completed' | 'rejected' | 'cancelled';

export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // SET NULL: строка-аудит остаётся после физического удаления user/tenant.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    /** Снапшот email на момент заявки (аудит после удаления пользователя). */
    email: varchar('email', { length: 255 }).notNull(),
    /** Причина со слов пользователя (опционально). */
    reason: text('reason'),
    /** 'pending' | 'completed' | 'rejected' | 'cancelled' */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    /** Кто обработал (super_admin). */
    processedBy: uuid('processed_by').references(() => users.id, { onDelete: 'set null' }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Заметка администратора (например причина отклонения). */
    note: text('note'),
  },
  (t) => [index('account_deletion_requests_status_idx').on(t.status, t.requestedAt)],
);

export type AccountDeletionRequest = typeof accountDeletionRequests.$inferSelect;
export type NewAccountDeletionRequest = typeof accountDeletionRequests.$inferInsert;
