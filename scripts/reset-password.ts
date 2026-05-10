// PURPOSE: CLI для смены пароля любого пользователя.
// Запуск: pnpm admin:reset-password <email> <new-password>
// Пример: pnpm admin:reset-password admin@openfinance.local NewSecret123

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { users } from '../src/lib/db/schema/users';

loadEnv({ path: '.env.local' });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://openfinance_user:openfinance_local_dev@localhost:5434/openfinance_dev';

async function main() {
  const [, , emailArg, passwordArg] = process.argv;
  if (!emailArg || !passwordArg) {
    console.error('Usage: pnpm admin:reset-password <email> <new-password>');
    process.exit(1);
  }

  const email = emailArg.toLowerCase();
  if (passwordArg.length < 8) {
    console.error('✗ Пароль должен быть не короче 8 символов');
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(sql);

  try {
    const passwordHash = await bcrypt.hash(passwordArg, 12);
    const result = await db
      .update(users)
      .set({
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email))
      .returning({ id: users.id });

    if (result.length === 0) {
      console.error(`✗ Пользователь ${email} не найден`);
      process.exit(1);
    }

    console.log(`✓ Пароль для ${email} обновлён.`);
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
