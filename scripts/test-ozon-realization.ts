// PURPOSE: Диагностика стейджа «отчёт о реализации» (/v2/finance/realization).
// Таблица `ozon_realization` пуста, потому что API отвечает 400 на нашу форму
// запроса, а стейдж глотает ошибку в console.warn и рапортует успех. Скрипт
// перебирает форматы тела запроса и печатает, какой принят и что вернулось —
// чтобы форма запроса и схема ответа проверялись фактом, а не догадкой.
//
// С v0.51.1 скрипт ещё и ПРОВЕРЯЕТ МАППИНГ ДЕНЕГ:
//  1. прогоняет живой ответ через `RealizationResponseSchema` (строгие денежные
//     поля) — если схема не сходится с API, это видно сразу, до записи в БД;
//  2. проверяет арифметику строки (amount + выплаты − вознаграждение = total)
//     на ВСЕХ строках месяца, а не на одной подсмотренной;
//  3. считает итоги по `mapRealizationRow` и сверяет их с независимым
//     источником — `ozon_transactions` за тот же период (accruals_for_sale /
//     sale_commission из `raw`). Расхождение в разы = маппинг неверен.
//
// Запуск (на сервере, где креды расшифровываются):
//   pnpm tsx scripts/test-ozon-realization.ts
//   pnpm tsx scripts/test-ozon-realization.ts <accountId>
//   pnpm tsx scripts/test-ozon-realization.ts --full --month=2026-07
//
// Скрипт read-only: в БД не пишет, только читает креды/транзакции и дёргает API.

import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db/client';
import { marketplaceAccounts, ozonRealization } from '../src/lib/db/schema/marketplaces';
import { decryptAccountApiKey } from '../src/lib/marketplaces/queries';
import { OzonClient } from '../src/lib/marketplaces/ozon/client';
import { RealizationResponseSchema } from '../src/lib/marketplaces/ozon/types';
import {
  MISMATCH_TOLERANCE_RUB,
  mapRealizationRow,
} from '../src/lib/marketplaces/ozon/realization-map';

/** Последний закрытый месяц — по нему отчёт точно должен существовать. */
function lastClosedMonth(): { year: number; month: number } {
  const now = new Date();
  const c = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: c.getFullYear(), month: c.getMonth() + 1 };
}

const rub = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Поля денежного блока строки — для статистики «какие вообще заполнены». */
const MONEY_FIELDS = [
  'quantity',
  'price_per_instance',
  'amount',
  'bonus',
  'compensation',
  'commission',
  'standard_fee',
  'stars',
  'bank_coinvestment',
  'pick_up_point_coinvestment',
  'total',
] as const;

type Block = Record<string, unknown> | null | undefined;

function n(block: Block, key: string): number {
  const v = (block ?? {})[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Сумма компонентов выручки блока (то, что Ozon платит продавцу до вычета). */
function partsRub(b: Block): number {
  return (
    n(b, 'amount') +
    n(b, 'bonus') +
    n(b, 'compensation') +
    n(b, 'bank_coinvestment') +
    n(b, 'stars') +
    n(b, 'pick_up_point_coinvestment')
  );
}

/** Печатает статистику заполненности и проверку арифметики по всем строкам. */
function analyzeRows(rowsArr: Array<Record<string, unknown>>) {
  const stats = new Map<string, { nonZero: number; min: number; max: number }>();
  let withReturn = 0;
  let sampleReturn: Record<string, unknown> | null = null;
  let missingSku = 0;
  let missingDelivery = 0;

  // Кандидаты трактовки «что именно удерживает Ozon»: считаем, на скольких
  // строках сходится тождество «выплаты − удержание = total».
  const fits = { standardFee: 0, commission: 0, both: 0 };
  let maxResidual = 0;

  for (const r of rowsArr) {
    const item = r.item as Record<string, unknown> | undefined;
    if (item?.sku === undefined || item?.sku === null) missingSku += 1;
    const d = r.delivery_commission as Block;
    const ret = r.return_commission as Block;
    if (!d) missingDelivery += 1;
    if (ret) {
      withReturn += 1;
      if (!sampleReturn) sampleReturn = r;
    }

    for (const b of [d, ret]) {
      if (!b) continue;
      for (const f of MONEY_FIELDS) {
        const v = n(b, f);
        const s = stats.get(f) ?? { nonZero: 0, min: Infinity, max: -Infinity };
        if (v !== 0) s.nonZero += 1;
        s.min = Math.min(s.min, v);
        s.max = Math.max(s.max, v);
        stats.set(f, s);
      }
    }

    for (const b of [d, ret]) {
      if (!b) continue;
      const parts = partsRub(b);
      const total = n(b, 'total');
      const fee = n(b, 'standard_fee');
      const com = n(b, 'commission');
      if (Math.abs(parts - fee - total) <= 0.01) fits.standardFee += 1;
      if (Math.abs(parts - com - total) <= 0.01) fits.commission += 1;
      if (Math.abs(parts - fee - com - total) <= 0.01) fits.both += 1;
      maxResidual = Math.max(maxResidual, Math.abs(parts - fee - com - total));
    }
  }

  console.log(`\n  --- заполненность полей (${rowsArr.length} строк, блоков с данными) ---`);
  for (const f of MONEY_FIELDS) {
    const s = stats.get(f);
    if (!s) {
      console.log(`     ${f.padEnd(28)} поля нет в ответе`);
      continue;
    }
    console.log(
      `     ${f.padEnd(28)} ненулевых: ${String(s.nonZero).padStart(5)}   min ${rub(
        s.min === Infinity ? 0 : s.min,
      )}   max ${rub(s.max === -Infinity ? 0 : s.max)}`,
    );
  }
  console.log(`     строк без item.sku: ${missingSku}, без delivery_commission: ${missingDelivery}`);
  console.log(`     строк с return_commission: ${withReturn}`);

  console.log('\n  --- какое поле реально удерживается (тождество выплаты − X = total) ---');
  console.log(`     X = standard_fee              совпало блоков: ${fits.standardFee}`);
  console.log(`     X = commission                совпало блоков: ${fits.commission}`);
  console.log(`     X = standard_fee + commission совпало блоков: ${fits.both}`);
  console.log(`     макс. остаток при X = standard_fee + commission: ${rub(maxResidual)} ₽`);

  if (sampleReturn) {
    console.log('\n  --- пример строки с возвратом (знак полей возврата) ---');
    console.log(JSON.stringify(sampleReturn, null, 2).slice(0, 1200));
  }
}

async function crossCheckTransactions(args: {
  tenantId: string;
  accountId: string;
  monthKey: string;
  nextMonthKey: string;
  grossRub: number;
  commissionRub: number;
  netRub: number;
}) {
  type TxRow = {
    operation_type: string | null;
    cnt: number;
    accruals: string | number | null;
    sale_commission: string | number | null;
    amount_kop: string | number | null;
  };

  // Независимый источник: `/v3/finance/transaction/list`, сохранённый в
  // ozon_transactions. `accruals_for_sale` — стоимость товаров с учётом скидок
  // продавца (аналог нашего gross), `sale_commission` — вознаграждение Ozon
  // (приходит со знаком минус). Оба поля лежат в raw, отдельных колонок нет.
  const res = await db.execute<TxRow>(sql`
    SELECT operation_type,
           COUNT(*)::int AS cnt,
           COALESCE(SUM((raw->>'accruals_for_sale')::numeric), 0) AS accruals,
           COALESCE(SUM((raw->>'sale_commission')::numeric), 0) AS sale_commission,
           COALESCE(SUM(amount_kopecks), 0)::bigint AS amount_kop
    FROM ozon_transactions
    WHERE tenant_id = ${args.tenantId}
      AND account_id = ${args.accountId}
      AND operation_date >= ${`${args.monthKey}-01`}::timestamp
      AND operation_date <  ${`${args.nextMonthKey}-01`}::timestamp
    GROUP BY operation_type
    ORDER BY 2 DESC
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows: TxRow[] }).rows) ?? [];

  if (rows.length === 0) {
    console.log(
      `\n  --- сверка с ozon_transactions за ${args.monthKey} ---\n` +
        '     транзакций за период в БД нет — сверить не с чем ' +
        '(запустите стейдж transactions на этот период).',
    );
    return;
  }

  console.log(`\n  --- сверка с ozon_transactions за ${args.monthKey} ---`);
  let accruals = 0;
  let commission = 0;
  let amount = 0;
  for (const r of rows) {
    const a = Number(r.accruals ?? 0);
    const c = Number(r.sale_commission ?? 0);
    const amt = Number(r.amount_kop ?? 0) / 100;
    accruals += a;
    commission += c;
    amount += amt;
    console.log(
      `     ${String(r.operation_type ?? '—').padEnd(38)} n=${String(r.cnt).padStart(5)}  ` +
        `accruals ${rub(a).padStart(14)}  sale_commission ${rub(c).padStart(14)}  amount ${rub(amt).padStart(14)}`,
    );
  }

  const ratio = (a: number, b: number) => (b === 0 ? '—' : (a / b).toFixed(3));
  console.log(`\n     ИТОГО транзакции: accruals ${rub(accruals)} ₽, sale_commission ${rub(commission)} ₽, amount ${rub(amount)} ₽`);
  console.log(`     ИТОГО реализация: gross    ${rub(args.grossRub)} ₽, commission      ${rub(-Math.abs(args.commissionRub))} ₽, итого ${rub(args.netRub)} ₽`);
  console.log(`     отношение gross/accruals: ${ratio(args.grossRub, accruals)}  (1.0 = маппинг сходится)`);
  console.log(
    `     отношение commission/sale_commission: ${ratio(Math.abs(args.commissionRub), Math.abs(commission))}`,
  );
}

async function main() {
  const filterId = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  // --full печатает первую строку и header целиком: нужно, когда сверяешь
  // zod-схему и маппинг с фактическим ответом API.
  const full = process.argv.includes('--full');
  const monthArg = process.argv.find((a) => a.startsWith('--month='))?.slice('--month='.length);

  const rows = await db.select().from(marketplaceAccounts);

  const accounts = filterId ? rows.filter((r) => r.id === filterId) : rows;
  if (accounts.length === 0) {
    console.log('Аккаунтов Ozon не найдено.');
    return;
  }

  const stored = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ozonRealization);
  console.log(`Строк в ozon_realization сейчас: ${stored[0]?.n ?? 0}\n`);

  let year: number;
  let month: number;
  if (monthArg && /^\d{4}-\d{2}$/.test(monthArg)) {
    year = Number(monthArg.slice(0, 4));
    month = Number(monthArg.slice(5, 7));
  } else {
    ({ year, month } = lastClosedMonth());
  }
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const nextMonthKey =
    month === 12
      ? `${year + 1}-01`
      : `${year}-${String(month + 1).padStart(2, '0')}`;
  console.log(`Пробуем месяц: ${monthKey}\n`);

  // Кандидаты формы тела запроса. Ошибка Ozon («invalid
  // GetRealizationReportRequestV2.Year») говорит, что v2 ждёт числовые
  // year/month; остальные варианты оставлены, чтобы отличить «не та форма»
  // от «нет данных» и чтобы скрипт пережил смену версии эндпоинта.
  const candidates: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: 'v2: { year, month } числами', body: { year, month } },
    { label: 'v2: { year, month } строками', body: { year: String(year), month: String(month) } },
    { label: 'v1-стиль: { date: "YYYY-MM" } (старый код)', body: { date: monthKey } },
    { label: 'v1-стиль: { date: "YYYY-MM-DD" }', body: { date: `${monthKey}-01` } },
  ];

  let failures = 0;

  for (const acc of accounts) {
    console.log(`=== ${acc.name} (${acc.id}) ===`);
    let apiKey: string;
    try {
      apiKey = decryptAccountApiKey(acc);
    } catch (e) {
      console.log(`  ключ не расшифровался: ${(e as Error).message}`);
      console.log('  → ключи, вероятно, зашифрованы другим MARKETPLACE_SECRET_KEY.\n');
      continue;
    }

    const client = new OzonClient({ clientId: acc.clientId, apiKey });

    for (const c of candidates) {
      process.stdout.write(`  ${c.label.padEnd(44)} `);
      let res: unknown;
      try {
        // Сырой ответ без zod-схемы: цель — увидеть фактическую форму,
        // а не прогнать её через возможно неверную схему.
        res = (await client.post('/v2/finance/realization', c.body)) as unknown;
      } catch (e) {
        console.log(`FAIL — ${(e as Error).message.slice(0, 120)}`);
        continue;
      }

      const obj = res as Record<string, unknown>;
      const result = obj?.result as Record<string, unknown> | undefined;
      const rowsArr = (result?.rows ?? obj?.rows) as Array<Record<string, unknown>> | undefined;
      console.log(`OK, строк: ${Array.isArray(rowsArr) ? rowsArr.length : '—'}`);
      console.log(`     ключи ответа: ${Object.keys(obj ?? {}).join(', ') || '—'}`);
      if (result) console.log(`     ключи result: ${Object.keys(result).join(', ') || '—'}`);
      if (!Array.isArray(rowsArr) || rowsArr.length === 0) {
        console.log('     строк нет — анализировать нечего');
        break;
      }

      console.log(`     ключи строки:  ${Object.keys(rowsArr[0]).join(', ')}`);
      if (full) {
        console.log('     --- полная первая строка ---');
        console.log(JSON.stringify(rowsArr[0], null, 2));
        if (result?.header) {
          console.log('     --- header ---');
          console.log(JSON.stringify(result.header, null, 2).slice(0, 1500));
        }
      } else {
        console.log(`     пример: ${JSON.stringify(rowsArr[0]).slice(0, 400)}`);
      }

      // 1. Схема. Строгая: денежные поля обязательны, поэтому падение здесь
      //    означает, что маппинг записал бы нули.
      const parsed = RealizationResponseSchema.safeParse(res);
      if (parsed.success) {
        console.log(`\n  ✅ RealizationResponseSchema: ответ разобран целиком (${rowsArr.length} строк)`);
      } else {
        failures += 1;
        const issues = parsed.error.issues.slice(0, 5);
        console.log(`\n  ❌ RealizationResponseSchema: ${parsed.error.issues.length} расхождений`);
        for (const i of issues) console.log(`     ${i.path.join('.')}: ${i.message}`);
      }

      // 2. Арифметика строки на всех строках месяца.
      analyzeRows(rowsArr);

      // 3. Итоги нашего маппинга (то, что легло бы в ozon_realization).
      const typedRows = parsed.success ? parsed.data.result?.rows ?? [] : [];
      if (typedRows.length > 0) {
        let qty = 0;
        let grossKop = 0;
        let commissionKop = 0;
        let mismatched = 0;
        let worst = 0;
        for (const r of typedRows) {
          const plan = mapRealizationRow(r);
          qty += plan.qty;
          grossKop += plan.grossKopecks;
          commissionKop += plan.commissionKopecks;
          if (plan.residualRub > MISMATCH_TOLERANCE_RUB) mismatched += 1;
          worst = Math.max(worst, plan.residualRub);
        }
        const grossRub = grossKop / 100;
        const commissionRub = commissionKop / 100;
        console.log('\n  --- итоги mapRealizationRow (что уйдёт в ozon_realization) ---');
        console.log(`     строк: ${typedRows.length}, qty (нетто): ${qty}`);
        console.log(`     gross_kopecks:      ${rub(grossRub)} ₽`);
        console.log(`     commission_kopecks: ${rub(commissionRub)} ₽`);
        console.log(`     итого к начислению: ${rub(grossRub - commissionRub)} ₽`);
        console.log(
          `     доля вознаграждения: ${grossRub ? ((commissionRub / grossRub) * 100).toFixed(1) : '—'}%`,
        );
        console.log(`     строк с расхождением > ${MISMATCH_TOLERANCE_RUB} ₽: ${mismatched} (макс. ${rub(worst)} ₽)`);
        if (mismatched > 0) failures += 1;

        // 4. Сверка с независимым источником.
        await crossCheckTransactions({
          tenantId: acc.tenantId,
          accountId: acc.id,
          monthKey,
          nextMonthKey,
          grossRub,
          commissionRub,
          netRub: grossRub - commissionRub,
        });
      }

      break; // форма принята — дальше перебирать незачем
    }
    console.log('');
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
