// PURPOSE: Пользовательские вкладки раздела «Юнит-экономика» (v0.22.0).
// До v0.22.0 список вкладок был захардкожен в unit-economics-client.tsx
// (Ozon, Ozon мульти, Яндекс, Мой магазин). Теперь пользователь может
// переименовать, создать новую (custom), скопировать существующую и удалить.
//
// Default-вкладки (kind='default') можно переименовать, но при удалении
// они только помечаются `hidden`, чтобы восстановить через «Сбросить».
// Custom-вкладки (kind='custom') удаляются физически + cascade чистит
// связанный block_layouts.
//
// pageKey-конвенция:
//   - default: 'unit-economics-{ozon|ozon-multi|yandex|my-store}'
//   - custom:  'unit-economics-custom-{nanoid(8)}'

import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const unitEconomicsTabs = pgTable(
  'unit_economics_tabs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** pageKey-ссылка на block_layouts (unique per user × tenant). */
    pageKey: varchar('page_key', { length: 96 }).notNull(),
    /** Отображаемое название вкладки. */
    label: varchar('label', { length: 80 }).notNull(),
    /** Lucide icon name (e.g. 'Calculator', 'Store'). null → дефолтная иконка. */
    icon: varchar('icon', { length: 40 }),
    /** Порядок отображения в табах. */
    order: integer('order').notNull().default(0),
    /**
     * 'default' — одна из 4 системных вкладок (Ozon/Ozon multi/Yandex/My Store).
     * 'custom'  — создана пользователем (любой набор блоков).
     */
    kind: varchar('kind', { length: 16 }).notNull().default('custom'),
    /**
     * Для kind='default' — ключ системной вкладки ('ozon'|'ozon-multi'|'yandex'|'my-store').
     * Используется при «Сбросить» чтобы восстановить дефолты.
     */
    defaultKey: varchar('default_key', { length: 32 }),
    /** Скрытая default-вкладка (мягкое удаление). Custom удаляются физически. */
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('unit_economics_tabs_tenant_user_page_idx').on(
      t.tenantId,
      t.userId,
      t.pageKey,
    ),
  ],
);

export type UnitEconomicsTab = typeof unitEconomicsTabs.$inferSelect;
export type NewUnitEconomicsTab = typeof unitEconomicsTabs.$inferInsert;

/** Конфигурация дефолтных вкладок (используется при seed'е). */
export const DEFAULT_UNIT_TABS: Array<{
  defaultKey: string;
  pageKey: string;
  label: string;
  icon: string;
  order: number;
}> = [
  { defaultKey: 'ozon', pageKey: 'unit-economics-ozon', label: 'Ozon', icon: 'Calculator', order: 0 },
  {
    defaultKey: 'ozon-multi',
    pageKey: 'unit-economics-ozon-multi',
    label: 'Ozon мульти-артикул',
    icon: 'Table',
    order: 1,
  },
  { defaultKey: 'yandex', pageKey: 'unit-economics-yandex', label: 'Яндекс Маркет', icon: 'Layers', order: 2 },
  {
    defaultKey: 'my-store',
    pageKey: 'unit-economics-my-store',
    label: 'Мой магазин',
    icon: 'Store',
    order: 3,
  },
];
