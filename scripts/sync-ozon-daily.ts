// PURPOSE: Headless ежедневный запуск полной синхронизации Ozon по всем
// активным аккаунтам во всех арендаторах. Точка входа для systemd-таймера
// `of-ozon-sync.timer` (см. deploy/ozon-sync/README.md).
//
// Зачем: в приложении нет внутреннего планировщика — sync стартует только
// когда человек нажал кнопку в браузере. Пропущенная неделя превращается в
// дыру в аналитике и в фантомное «падение выручки» на дашборде.
//
// ЭТО СИСТЕМНАЯ ЗАДАЧА, СЕССИИ НЕТ. Единственный намеренно глобальный запрос —
// первичная выборка активных Ozon-аккаунтов (помечена в коде большим блоком).
// Дальше каждый вызов скоуплен `tenantId` из строки аккаунта: сам аккаунт,
// его job'ы, поиск системного пользователя и `runFullSync` получают tenantId
// только оттуда. Ничего глобального после первой выборки быть не должно.
//
// Запуск:
//   pnpm tsx scripts/sync-ozon-daily.ts --dry-run     # ничего не пишет
//   pnpm tsx scripts/sync-ozon-daily.ts
//   pnpm tsx scripts/sync-ozon-daily.ts --account=<uuid>
//   pnpm tsx scripts/sync-ozon-daily.ts --take-over-stale
//
// Коды возврата (их читает systemd):
//   0 — всё синхронизировано, либо пропущено из-за уже идущего синка
//   1 — хотя бы один аккаунт упал (исключение или job.status='error')
//   2 — ошибка запуска (нет DATABASE_URL, битые аргументы)

import path from 'path';
import { config as loadEnv } from 'dotenv';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  marketplaceAccounts,
  ozonSyncJobs,
  type OzonSyncSettings,
  type SyncStageState,
} from '../src/lib/db/schema/marketplaces';
import { tenants } from '../src/lib/db/schema/tenants';
import { memberships, users } from '../src/lib/db/schema/users';
import type { DB } from '../src/lib/db/client';
import { OZON_FULL_STAGES, type OzonStageKind } from '../src/lib/marketplaces/types';

// ---------------------------------------------------------------------------
// ENV. Грузим ДО динамического импорта db-клиента: `src/lib/env.ts` валидирует
// DATABASE_URL в момент импорта модуля, поэтому все env-зависимые модули ниже
// подключаются через await import() внутри main(), а не статически.
// dotenv по умолчанию НЕ перетирает уже заданные переменные, поэтому под
// systemd выигрывает EnvironmentFile, а локально — .env.local.
// ---------------------------------------------------------------------------

const REPO_ROOT = (() => {
  try {
    return path.resolve(__dirname, '..');
  } catch {
    return process.cwd();
  }
})();

for (const file of ['.env.local', '.env.production', '.env']) {
  loadEnv({ path: path.join(REPO_ROOT, file) });
}

// ---------------------------------------------------------------------------
// Аргументы
// ---------------------------------------------------------------------------

type Options = {
  dryRun: boolean;
  accountId: string | null;
  tenantId: string | null;
  takeOverStale: boolean;
  staleMinutes: number;
  strict: boolean;
};

const DEFAULT_STALE_MINUTES = 90;

const HELP = `
Ежедневная синхронизация Ozon (headless).

  --dry-run               Ничего не пишет: печатает список аккаунтов, идущие
                          job'ы и что было бы запущено.
  --account=<uuid>        Только этот аккаунт.
  --tenant=<uuid>         Только аккаунты этого арендатора.
  --take-over-stale       Считать job'ы pending/running без активности дольше
                          порога мёртвыми: закрыть как error и синхронизировать.
                          Без флага такой аккаунт просто пропускается.
  --stale-minutes=<N>     Порог «мёртвого» job'а, минут (по умолчанию ${DEFAULT_STALE_MINUTES}).
  --strict                Считать ошибкой и частичный синк (job.status='partial').
  --help                  Эта справка.
`;

function parseArgs(argv: string[]): Options | null {
  const opts: Options = {
    dryRun: false,
    accountId: null,
    tenantId: null,
    takeOverStale: false,
    staleMinutes: DEFAULT_STALE_MINUTES,
    strict: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--take-over-stale') opts.takeOverStale = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg.startsWith('--account=')) opts.accountId = arg.slice('--account='.length);
    else if (arg.startsWith('--tenant=')) opts.tenantId = arg.slice('--tenant='.length);
    else if (arg.startsWith('--stale-minutes=')) {
      const n = Number(arg.slice('--stale-minutes='.length));
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`✗ Некорректный --stale-minutes: ${arg}`);
        return null;
      }
      opts.staleMinutes = n;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`✗ Неизвестный аргумент: ${arg}`);
      console.log(HELP);
      return null;
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Форматирование
// ---------------------------------------------------------------------------

const MSK = 'Europe/Moscow';

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleString('ru-RU', {
    timeZone: MSK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} с`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min} м ${sec} с`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} ч ${min % 60} м`;
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
}

function fmtAgo(from: Date | null | undefined, now: Date): string {
  if (!from) return 'никогда';
  return `${fmtDuration(now.getTime() - from.getTime())} назад`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Основной сценарий
// ---------------------------------------------------------------------------

type AccountRow = {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  clientId: string;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  syncSettings: OzonSyncSettings;
  tenantName: string;
};

type ActiveJobRow = {
  id: string;
  status: string;
  kind: string;
  createdAt: Date;
  startedAt: Date | null;
  updatedAt: Date;
};

type AccountOutcome = 'synced' | 'partial' | 'skipped' | 'failed' | 'planned';

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) return 2;

  if (!process.env.DATABASE_URL) {
    console.error(
      '✗ DATABASE_URL не задан. Под systemd его даёт EnvironmentFile=.env.production,\n' +
        '  локально — .env.local в корне репозитория.',
    );
    return 2;
  }

  // env-зависимые модули — только здесь, после loadEnv() выше.
  const { db } = await import('../src/lib/db/client');
  const { createSyncJob, getSyncJob } = await import('../src/lib/marketplaces/queries');
  const { runFullSync } = await import('../src/lib/marketplaces/ozon/sync/full');

  const startedAt = new Date();
  const staleCutoff = new Date(startedAt.getTime() - opts.staleMinutes * 60_000);

  console.log(`\n=== Ozon daily sync — ${fmtDateTime(startedAt)} МСК ===`);
  console.log(
    opts.dryRun
      ? 'Режим: ПРОВЕРКА (--dry-run) — ни одной записи в БД и ни одного запроса в Ozon.'
      : 'Режим: РЕАЛЬНЫЙ ЗАПУСК',
  );
  console.log(
    `Порог «мёртвого» job'а: ${opts.staleMinutes} мин; перехват мёртвых: ${
      opts.takeOverStale ? 'да (--take-over-stale)' : 'нет'
    }`,
  );

  // -------------------------------------------------------------------------
  // cross-tenant: системная задача без сессии — tenantId неоткуда взять, кроме
  // как из самих строк аккаунтов. Это ЕДИНСТВЕННЫЙ запрос без tenant-фильтра во
  // всём скрипте; всё, что ниже, скоуплено `acc.tenantId` (см.
  // docs/TENANT_SCOPING.md, п. «Системные/кросс-tenant операции»).
  // -------------------------------------------------------------------------
  const accountConds = [
    eq(marketplaceAccounts.marketplace, 'ozon'),
    eq(marketplaceAccounts.status, 'active'),
  ];
  if (opts.accountId) accountConds.push(eq(marketplaceAccounts.id, opts.accountId));
  if (opts.tenantId) accountConds.push(eq(marketplaceAccounts.tenantId, opts.tenantId));

  const accounts: AccountRow[] = await db
    .select({
      id: marketplaceAccounts.id,
      tenantId: marketplaceAccounts.tenantId,
      userId: marketplaceAccounts.userId,
      name: marketplaceAccounts.name,
      clientId: marketplaceAccounts.clientId,
      lastSyncAt: marketplaceAccounts.lastSyncAt,
      lastSyncStatus: marketplaceAccounts.lastSyncStatus,
      syncSettings: marketplaceAccounts.syncSettings,
      tenantName: tenants.name,
    })
    .from(marketplaceAccounts)
    .innerJoin(tenants, eq(tenants.id, marketplaceAccounts.tenantId))
    .where(and(...accountConds))
    .orderBy(asc(marketplaceAccounts.tenantId), asc(marketplaceAccounts.createdAt));

  const tenantCount = new Set(accounts.map((a) => a.tenantId)).size;
  console.log(`\nАктивных Ozon-аккаунтов: ${accounts.length} (арендаторов: ${tenantCount})`);

  if (accounts.length === 0) {
    console.log('Синхронизировать нечего.');
    return 0;
  }

  const outcomes: Array<{ account: AccountRow; outcome: AccountOutcome; note: string }> = [];

  // Аккаунты строго последовательно: token-bucket Ozon (40 RPS) считается
  // per-clientId и живёт внутри процесса — параллельные синки его обходят.
  let index = 0;
  for (const acc of accounts) {
    index += 1;
    console.log(
      `\n[${index}/${accounts.length}] «${acc.name || 'Магазин'}» ` +
        `(account ${shortId(acc.id)}…, tenant ${shortId(acc.tenantId)}… «${acc.tenantName}», Client-Id ${acc.clientId})`,
    );
    console.log(
      `      последний синк: ${fmtDateTime(acc.lastSyncAt)} (${fmtAgo(acc.lastSyncAt, startedAt)})` +
        `${acc.lastSyncStatus ? `, статус ${acc.lastSyncStatus}` : ''}`,
    );
    if (acc.syncSettings?.autoSyncEnabled !== true) {
      // Легаси-тоггл из UI под так и не написанный BullMQ-воркер. Таймер его
      // намеренно игнорирует: иначе фича молча не работала бы у всех, у кого
      // тоггл в дефолтном false.
      console.log("      прим.: syncSettings.autoSyncEnabled=false — таймер этот тоггл не смотрит");
    }

    // --- Кто «запускает» синк от лица системы -----------------------------
    const systemUser = await resolveSystemUser(db, acc);
    if (!systemUser) {
      console.log(
        '      ✗ ПРОПУСК: в арендаторе не нашлось ни одного пользователя — некому атрибутировать записи',
      );
      outcomes.push({ account: acc, outcome: 'failed', note: 'нет пользователя для атрибуции' });
      continue;
    }
    console.log(`      системный userId: ${shortId(systemUser.id)}… (${systemUser.reason})`);

    // --- Защита от параллельного синка ------------------------------------
    const activeJobs: ActiveJobRow[] = await db
      .select({
        id: ozonSyncJobs.id,
        status: ozonSyncJobs.status,
        kind: ozonSyncJobs.kind,
        createdAt: ozonSyncJobs.createdAt,
        startedAt: ozonSyncJobs.startedAt,
        updatedAt: ozonSyncJobs.updatedAt,
      })
      .from(ozonSyncJobs)
      .where(
        and(
          eq(ozonSyncJobs.tenantId, acc.tenantId),
          eq(ozonSyncJobs.accountId, acc.id),
          inArray(ozonSyncJobs.status, ['pending', 'running']),
        ),
      )
      .orderBy(desc(ozonSyncJobs.createdAt))
      .limit(10);

    const live = activeJobs.filter((j) => lastActivity(j) >= staleCutoff);
    const stale = activeJobs.filter((j) => lastActivity(j) < staleCutoff);

    if (live.length > 0) {
      for (const j of live) {
        console.log(
          `      идёт job ${shortId(j.id)}… (${j.kind}, ${j.status}, активность ${fmtAgo(lastActivity(j), startedAt)})`,
        );
      }
      console.log('      ⏭ ПРОПУСК: синк уже идёт — второй запуск порвал бы job и token-bucket');
      outcomes.push({ account: acc, outcome: 'skipped', note: 'синк уже идёт' });
      continue;
    }

    if (stale.length > 0) {
      for (const j of stale) {
        console.log(
          `      ⚠ подвисший job ${shortId(j.id)}… (${j.kind}, ${j.status}, без активности ${fmtAgo(lastActivity(j), startedAt)})`,
        );
      }
      if (!opts.takeOverStale) {
        console.log(
          '      ⏭ ПРОПУСК: job числится активным. Если процесс, который его вёл, давно умер —\n' +
            '        перезапустите с --take-over-stale (или добавьте флаг в ExecStart юнита).',
        );
        outcomes.push({ account: acc, outcome: 'skipped', note: 'подвисший job, перехват выключен' });
        continue;
      }
      if (opts.dryRun) {
        console.log(`      [dry-run] закрыл бы как error подвисших job'ов: ${stale.length}`);
      } else {
        const closed = await closeStaleJobs(db, acc.tenantId, stale.map((j) => j.id), opts.staleMinutes);
        console.log(`      подвисших job'ов закрыто как error: ${closed}`);
      }
    }

    if (activeJobs.length === 0) {
      console.log('      активных job\'ов нет');
    }

    // --- Собственно запуск -------------------------------------------------
    if (opts.dryRun) {
      console.log(
        `      [dry-run] создал бы job kind='full' (${OZON_FULL_STAGES.length} стейджей) и запустил runFullSync`,
      );
      outcomes.push({ account: acc, outcome: 'planned', note: 'запустился бы' });
      continue;
    }

    const initStages = ([...OZON_FULL_STAGES] as OzonStageKind[]).reduce<
      Record<string, SyncStageState>
    >((acc2, s) => {
      acc2[s] = { status: 'pending' };
      return acc2;
    }, {});

    const accStartedAt = Date.now();
    try {
      const job = await createSyncJob({
        tenantId: acc.tenantId,
        accountId: acc.id,
        kind: 'full',
        stages: initStages,
      });
      console.log(`      job ${shortId(job.id)}… создан, синхронизирую…`);

      await runFullSync({
        tenantId: acc.tenantId,
        userId: systemUser.id,
        accountId: acc.id,
        jobId: job.id,
      });

      const finished = await getSyncJob({ tenantId: acc.tenantId, jobId: job.id });
      const stages = (finished?.stages ?? {}) as Record<string, SyncStageState>;
      const ok = Object.values(stages).filter((s) => s.status === 'success').length;
      const failed = Object.entries(stages).filter(([, s]) => s.status === 'error');
      const skipped = Object.values(stages).filter((s) => s.status === 'skipped').length;

      console.log(
        `      ${fmtDuration(Date.now() - accStartedAt)} — стейджей ok ${ok}, ошибок ${failed.length}, ` +
          `пропущено ${skipped}, записей ${finished?.itemsProcessed ?? 0}`,
      );
      for (const [stage, s] of failed) {
        console.log(`      ✗ ${stage}: ${s.error ?? 'неизвестная ошибка'}`);
      }
      for (const [stage, s] of Object.entries(stages)) {
        for (const w of s.warnings ?? []) console.log(`      ⚠ ${stage}: ${w}`);
      }

      const status = finished?.status ?? 'error';
      console.log(`      итог job: ${status}`);

      if (status === 'error') {
        outcomes.push({ account: acc, outcome: 'failed', note: 'job.status=error' });
      } else if (status === 'partial') {
        outcomes.push({
          account: acc,
          outcome: 'partial',
          note: `стейджи с ошибкой: ${failed.map(([s]) => s).join(', ') || '—'}`,
        });
      } else {
        outcomes.push({ account: acc, outcome: 'synced', note: '' });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`      ✗ ОШИБКА за ${fmtDuration(Date.now() - accStartedAt)}: ${message}`);
      outcomes.push({ account: acc, outcome: 'failed', note: message });
    }
  }

  // -------------------------------------------------------------------------
  // Итог
  // -------------------------------------------------------------------------
  const count = (o: AccountOutcome) => outcomes.filter((r) => r.outcome === o).length;
  console.log('\n=== Итог ===');
  if (opts.dryRun) {
    console.log(
      `Запустилось бы: ${count('planned')}, пропущено: ${count('skipped')}, без пользователя: ${count('failed')}`,
    );
  } else {
    console.log(
      `Синхронизировано: ${count('synced')}, частично: ${count('partial')}, ` +
        `пропущено: ${count('skipped')}, с ошибкой: ${count('failed')}`,
    );
  }
  for (const r of outcomes) {
    if (r.outcome === 'failed' || r.outcome === 'partial' || r.outcome === 'skipped') {
      console.log(`  ${r.outcome}: «${r.account.name || 'Магазин'}» — ${r.note}`);
    }
  }
  console.log(`Время работы: ${fmtDuration(Date.now() - startedAt.getTime())}`);

  const hardFailures = count('failed');
  const partials = count('partial');
  if (hardFailures > 0) return 1;
  if (opts.strict && partials > 0) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Хелперы
// ---------------------------------------------------------------------------

function lastActivity(job: ActiveJobRow): Date {
  return new Date(
    Math.max(
      job.updatedAt?.getTime() ?? 0,
      job.startedAt?.getTime() ?? 0,
      job.createdAt?.getTime() ?? 0,
    ),
  );
}

/**
 * Кто «запускает» синк, когда сессии нет. `ctx.userId` уходит в
 * `unit_products.user_id` при INSERT новых товаров — то есть это атрибуция
 * авторства, а не право доступа (tenant-скоуп даёт `tenantId`).
 *
 * Приоритет:
 *   1. `marketplace_accounts.user_id` — тот, кто подключил интеграцию.
 *      Ровно тот же userId, что записался бы при ручном синке из браузера,
 *      поэтому фон и ручной запуск не расходятся в данных.
 *   2. Владелец арендатора (`memberships.role='owner'`, самый ранний) —
 *      если пользователь из п.1 больше не состоит в этом арендаторе.
 *   3. Самый ранний участник арендатора любой роли.
 * Всё tenant-скоуплено: membership ищется строго в `acc.tenantId`.
 */
async function resolveSystemUser(
  db: DB,
  acc: AccountRow,
): Promise<{ id: string; reason: string } | null> {
  const [ownRow] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, acc.tenantId), eq(memberships.userId, acc.userId)))
    .limit(1);
  if (ownRow) return { id: ownRow.userId, reason: 'подключил интеграцию' };

  const fallback = await db
    .select({ userId: memberships.userId, role: memberships.role, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, acc.tenantId))
    .orderBy(asc(memberships.createdAt))
    .limit(20);

  const owner = fallback.find((m) => m.role === 'owner');
  if (owner) {
    return { id: owner.userId, reason: `владелец арендатора ${owner.email} — автор интеграции выбыл` };
  }
  const anyMember = fallback[0];
  if (anyMember) {
    return {
      id: anyMember.userId,
      reason: `участник ${anyMember.email} (${anyMember.role}) — владельца в арендаторе нет`,
    };
  }
  return null;
}

/** Закрывает подвисшие job'ы как error. Tenant-скоуплено и не трогает job'ы,
 *  которые успели уйти из pending/running между SELECT и UPDATE. */
async function closeStaleJobs(
  db: DB,
  tenantId: string,
  jobIds: string[],
  staleMinutes: number,
): Promise<number> {
  if (jobIds.length === 0) return 0;
  const rows = await db
    .update(ozonSyncJobs)
    .set({
      status: 'error',
      finishedAt: new Date(),
      errors: [
        {
          message:
            `Job числился активным дольше ${staleMinutes} мин без прогресса — закрыт ` +
            'ежедневным синком (процесс-владелец не найден)',
          at: new Date().toISOString(),
        },
      ],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ozonSyncJobs.tenantId, tenantId),
        inArray(ozonSyncJobs.id, jobIds),
        inArray(ozonSyncJobs.status, ['pending', 'running']),
      ),
    )
    .returning({ id: ozonSyncJobs.id });
  return rows.length;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('✗ Ежедневный синк упал:', e);
    process.exit(1);
  });
