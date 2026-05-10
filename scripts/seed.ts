// PURPOSE: Seed дефолтного супер-админа и tenant'а для разработки.
// Запуск: pnpm db:seed
// Email/пароль читаются из env (с дефолтами для dev — ВАЖНО сменить в проде).

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { tenants } from '../src/lib/db/schema/tenants';
import { users, memberships } from '../src/lib/db/schema/users';

loadEnv({ path: '.env.local' });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://openfinance_user:openfinance_local_dev@localhost:5434/openfinance_dev';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@openfinance.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Super Admin';

async function main() {
  console.log('🌱 Seeding...');
  console.log(`  DB: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  const sql = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(sql);

  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ADMIN_EMAIL.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      console.log(`✓ Админ ${ADMIN_EMAIL} уже существует — пропускаю.`);
      console.log('  Сменить пароль: pnpm admin:reset-password');
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: ADMIN_EMAIL.toLowerCase(),
          passwordHash,
          name: ADMIN_NAME,
          globalRole: 'super_admin',
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });

      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: 'Open Finance HQ',
          slug: 'openfinance-hq',
          plan: 'enterprise',
          onboardingCompleted: true,
          settings: { theme: 'light', locale: 'ru', openRegistration: true },
        })
        .returning({ id: tenants.id });

      await tx.insert(memberships).values({
        userId: user!.id,
        tenantId: tenant!.id,
        role: 'owner',
      });
    });

    console.log('✓ Создан super-admin:');
    console.log(`    email:    ${ADMIN_EMAIL}`);
    console.log(`    password: ${ADMIN_PASSWORD}`);
    console.log(`    role:     super_admin`);
    console.log('');
    console.log('🔑 Сохраните эти данные. Сменить пароль: pnpm admin:reset-password');
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Seed failed:', err);
    process.exit(1);
  });
