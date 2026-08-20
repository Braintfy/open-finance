// PURPOSE: CLI управления паролями пользователей — сброс, генерация нового, список.
//
// Запуск (локально):
//   pnpm admin:reset-password --list                    список пользователей
//   pnpm admin:reset-password <email>                   СГЕНЕРИРОВАТЬ надёжный пароль и показать
//   pnpm admin:reset-password <email> --stdin           прочитать пароль из stdin (не попадает в историю)
//   pnpm admin:reset-password <email> <пароль>          задать явно (НЕ рекомендуется — см. ниже)
//
// На проде (Raspberry Pi) — обёртка `sudo of-passwd …`, она сама подставит DATABASE_URL
// из .env.production. Подробности: deploy/pi-status/README.md
//
// ВАЖНО: пароль, переданный аргументом, остаётся в истории оболочки (~/.bash_history)
// и виден в `ps` любому пользователю системы, пока команда выполняется. Поэтому
// по умолчанию пароль ГЕНЕРИРУЕТСЯ, а для своего варианта есть `--stdin`.

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { users } from '../src/lib/db/schema/users';

loadEnv({ path: '.env.local' });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://openfinance_user:openfinance_local_dev@localhost:5434/openfinance_dev';

const MIN_LENGTH = 12;

/**
 * Генерирует пароль из алфавита без визуально неоднозначных символов
 * (нет 0/O, 1/l/I) — его придётся диктовать и вводить руками.
 * Источник случайности — crypto.randomInt, а не Math.random.
 */
function generatePassword(length = 20): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#%^&*-_=+?';
  const all = lower + upper + digits + symbols;

  // Гарантируем по одному символу каждого класса, остальное — случайно.
  const chars = [
    lower[randomInt(lower.length)],
    upper[randomInt(upper.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);

  // Перемешивание Фишера-Йетса, чтобы обязательные символы не стояли в начале.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const args = process.argv.slice(2);

  const sql = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(sql);

  try {
    // ── Список пользователей ───────────────────────────────────
    if (args[0] === '--list' || args.length === 0) {
      const rows = await db
        .select({
          email: users.email,
          name: users.name,
          role: users.globalRole,
          createdAt: users.createdAt,
        })
        .from(users);

      if (rows.length === 0) {
        console.log('Пользователей нет. Создать: pnpm admin:create');
      } else {
        console.log(`Пользователей: ${rows.length}\n`);
        for (const u of rows) {
          const created = u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '—';
          console.log(`  ${u.email.padEnd(32)} ${String(u.role).padEnd(12)} создан ${created}`);
        }
        console.log('\nСменить пароль:  pnpm admin:reset-password <email>            (сгенерирует надёжный)');
        console.log('Свой пароль:     pnpm admin:reset-password <email> --stdin     (ввод не попадёт в историю)');
      }
      if (args.length === 0) process.exitCode = 0;
      return;
    }

    const email = args[0].toLowerCase();
    const rest = args.slice(1);

    let password: string;
    let generated = false;

    if (rest.includes('--stdin')) {
      password = await readStdin();
      if (!password) {
        console.error('✗ Пустой ввод. Пример: echo -n "мой-пароль" | pnpm admin:reset-password user@example.com --stdin');
        process.exit(1);
      }
    } else if (rest.length > 0 && !rest[0].startsWith('--')) {
      password = rest[0];
      console.warn('⚠ Пароль передан аргументом — он остался в истории оболочки и был виден в `ps`.');
      console.warn('  Безопаснее: без аргумента (сгенерируется) либо через --stdin.');
    } else {
      password = generatePassword();
      generated = true;
    }

    if (password.length < MIN_LENGTH) {
      console.error(`✗ Пароль должен быть не короче ${MIN_LENGTH} символов (получено ${password.length}).`);
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db
      .update(users)
      .set({
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email))
      .returning({ id: users.id, role: users.globalRole });

    if (result.length === 0) {
      console.error(`✗ Пользователь ${email} не найден. Список: pnpm admin:reset-password --list`);
      process.exit(1);
    }

    console.log(`\n✓ Пароль для ${email} обновлён (роль: ${result[0].role}).`);
    if (generated) {
      console.log('\n  ┌─────────────────────────────────────────────┐');
      console.log(`    НОВЫЙ ПАРОЛЬ:  ${password}`);
      console.log('  └─────────────────────────────────────────────┘');
      console.log('\n  Сохраните его сейчас — восстановить нельзя, только сгенерировать заново.');
    }
    console.log('\n  Активные сессии НЕ инвалидируются: JWT живёт до 30 дней (см. блокеры публичного запуска).');
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('✗ Ошибка:', err);
    process.exit(1);
  });
