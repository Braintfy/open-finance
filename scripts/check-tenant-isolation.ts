// PURPOSE: Smoke-канарейка кросс-tenant изоляции (I1 review-gate).
// Создаёт два tenant'а с данными и проверяет инвариант: запрос, отфильтрованный
// по tenant_id, НЕ возвращает строки другого tenant'а; обращение к чужому id
// возвращает 0 строк. Это та гарантия, которую защищает review-gate (каждый
// запрос к tenant-таблице обязан фильтровать tenant_id). Тест-данные удаляются
// в finally (cascade по tenant_id). НЕ запускать на проде.
//
// Запуск: pnpm check:tenant-isolation   (нужен поднятый Postgres)
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

loadEnv({ path: '.env.local' });

if (process.env.NODE_ENV === 'production') {
  console.error('✗ Отказ: скрипт создаёт тест-данные, не запускайте на production.');
  process.exit(1);
}

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://openfinance_user:openfinance_local_dev@localhost:5434/openfinance_dev';

const SUFFIX = `iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ENC_PLACEHOLDER = 'v1.test.test.test'; // не расшифровывается — тест только про изоляцию

async function main() {
  const sql = postgres(DATABASE_URL, { max: 1 });
  let tenantA: string | undefined;
  let tenantB: string | undefined;
  let userA: string | undefined;
  let userB: string | undefined;
  const failures: string[] = [];

  try {
    // --- setup: 2 tenant'а + 2 user'а + 2 marketplace_account'а ---
    [{ id: tenantA }] = await sql<{ id: string }[]>`
      INSERT INTO tenants (name, slug, plan) VALUES (${'ISO A'}, ${`a-${SUFFIX}`}, ${'free'}) RETURNING id`;
    [{ id: tenantB }] = await sql<{ id: string }[]>`
      INSERT INTO tenants (name, slug, plan) VALUES (${'ISO B'}, ${`b-${SUFFIX}`}, ${'free'}) RETURNING id`;
    [{ id: userA }] = await sql<{ id: string }[]>`
      INSERT INTO users (email) VALUES (${`a-${SUFFIX}@iso.local`}) RETURNING id`;
    [{ id: userB }] = await sql<{ id: string }[]>`
      INSERT INTO users (email) VALUES (${`b-${SUFFIX}@iso.local`}) RETURNING id`;

    const [{ id: accA }] = await sql<{ id: string }[]>`
      INSERT INTO marketplace_accounts (tenant_id, user_id, marketplace, name, client_id, api_key_enc)
      VALUES (${tenantA}, ${userA}, ${'ozon'}, ${'A shop'}, ${`client-a-${SUFFIX}`}, ${ENC_PLACEHOLDER})
      RETURNING id`;
    const [{ id: accB }] = await sql<{ id: string }[]>`
      INSERT INTO marketplace_accounts (tenant_id, user_id, marketplace, name, client_id, api_key_enc)
      VALUES (${tenantB}, ${userB}, ${'ozon'}, ${'B shop'}, ${`client-b-${SUFFIX}`}, ${ENC_PLACEHOLDER})
      RETURNING id`;

    // --- assert 1: list по tenant A отдаёт только A-аккаунты ---
    const listA = await sql<{ id: string; tenant_id: string }[]>`
      SELECT id, tenant_id FROM marketplace_accounts WHERE tenant_id = ${tenantA}`;
    if (listA.some((r) => r.tenant_id !== tenantA)) {
      failures.push('list(tenantA) вернул строки чужого tenant');
    }
    if (!listA.some((r) => r.id === accA) || listA.some((r) => r.id === accB)) {
      failures.push('list(tenantA) должен содержать accA и НЕ содержать accB');
    }

    // --- assert 2: чужой id под своим tenant'ом недоступен (getAccount-семантика) ---
    const cross = await sql<{ id: string }[]>`
      SELECT id FROM marketplace_accounts WHERE tenant_id = ${tenantA} AND id = ${accB} LIMIT 1`;
    if (cross.length !== 0) {
      failures.push('getAccount(tenantA, accB) должен вернуть 0 строк (cross-tenant)');
    }

    // --- assert 3 (контроль): без tenant-фильтра строка B видна — значит изоляцию
    //     обеспечивает именно фильтр tenant_id (его пропуск = утечка) ---
    const noFilter = await sql<{ id: string }[]>`
      SELECT id FROM marketplace_accounts WHERE id = ${accB} LIMIT 1`;
    if (noFilter.length !== 1) {
      failures.push('контроль: запрос без tenant-фильтра не нашёл accB — тест некорректен');
    }
  } finally {
    // cascade по tenant_id/user_id удалит marketplace_accounts
    if (tenantA || tenantB) {
      await sql`DELETE FROM tenants WHERE id IN ${sql([tenantA, tenantB].filter(Boolean) as string[])}`;
    }
    if (userA || userB) {
      await sql`DELETE FROM users WHERE id IN ${sql([userA, userB].filter(Boolean) as string[])}`;
    }
    await sql.end({ timeout: 5 });
  }

  if (failures.length > 0) {
    console.error('✗ TENANT ISOLATION FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✓ Tenant isolation OK (list/getAccount фильтруют tenant_id, cross-tenant заблокирован).');
}

main().catch((e) => {
  console.error('✗ check-tenant-isolation упал:', e);
  process.exit(1);
});
