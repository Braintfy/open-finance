// PURPOSE: Пользователи и связь с tenants (multi-tenant + RBAC)
import { pgTable, uuid, text, timestamp, varchar, boolean, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/** Персональные настройки пользователя (JSONB). Мержится через `|| ...::jsonb`. */
export type UserSettings = {
  /** ID активного воркспейса («кабинета»). Резолвится resolveActiveWorkspace(). */
  activeWorkspaceId?: string;
};

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash'),
  name: varchar('name', { length: 200 }),
  // Глобальная роль платформы. Для tenant-уровня — memberships.role
  globalRole: varchar('global_role', { length: 20 }).notNull().default('user'),
  // 'user' | 'admin' | 'super_admin'
  emailVerifiedAt: timestamp('email_verified_at'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  // Сброс пароля
  passwordResetToken: varchar('password_reset_token', { length: 100 }),
  passwordResetExpiresAt: timestamp('password_reset_expires_at'),
  lastLoginAt: timestamp('last_login_at'),
  // Согласие с политикой конфиденциальности / обработкой ПДн (152-ФЗ).
  // version = идентификатор редакции политики на момент согласия.
  consentVersion: varchar('consent_version', { length: 20 }),
  consentAt: timestamp('consent_at'),
  // Персональные настройки (активный воркспейс и т.п.). Мержить через `|| ...::jsonb`.
  settings: jsonb('settings').$type<UserSettings>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull().default('owner'),
  // 'owner' | 'admin' | 'manager' | 'accountant' | 'viewer'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
