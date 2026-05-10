// PURPOSE: CLI для создания пользователя из терминала
// Запуск: pnpm admin:create <email> <password> [--admin]

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { users, memberships } from '../src/lib/db/schema/users';
import { tenants } from '../src/lib/db/schema/tenants';

loadEnv({ path: '.env.local' });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://openfinance_user:openfinance_local_dev@localhost:5434/openfinance_dev';

async function main() {
  const args = process.argv.slice(2);
  const email = args[0]?.toLowerCase();
  const password = args[1];
  const isAdmin = args.includes('--admin') || args.includes('--super-admin');
  const isSuper = args.includes('--super-admin');

  if (!email || !password) {
    console.error('Usage: pnpm admin:create <email> <password> [--admin|--super-admin]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('✗ Пароль минимум 8 символов');
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(sql);

  try {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      console.error(`✗ Пользователь ${email} уже существует`);
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const role = isSuper ? 'super_admin' : isAdmin ? 'admin' : 'user';

    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          name: email.split('@')[0],
          globalRole: role,
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });

      const slug = email.replace(/[^a-z0-9]/g, '-').slice(0, 60) + '-' + Math.random().toString(36).slice(2, 6);
      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: email.split('@')[0],
          slug,
          plan: 'trial',
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          settings: { theme: 'light', locale: 'ru' },
        })
        .returning({ id: tenants.id });

      await tx.insert(memberships).values({
        userId: user!.id,
        tenantId: tenant!.id,
        role: 'owner',
      });
    });

    console.log(`✓ Создан ${email} (роль: ${role})`);
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Failed:', err);
    process.exit(1);
  });
