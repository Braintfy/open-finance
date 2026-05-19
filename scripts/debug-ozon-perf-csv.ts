// PURPOSE: Standalone CLI для диагностики формата CSV Ozon Performance API.
// Берёт один accountId, выгружает отчёт для одной (первой найденной) Search
// Promo кампании, печатает:
//   - первые 5 строк raw CSV
//   - результат detectHeaderIndex
//   - keys первой data-row после parseCsv
//   - isSkuStatsHeader + parseSkuStatsRow(rows[0])
//
// Запуск:
//   pnpm tsx scripts/debug-ozon-perf-csv.ts <accountId>
// Аккаунт должен иметь подключённый Performance API. Скрипт read-only.

import { and, eq } from 'drizzle-orm';
import { db } from '../src/lib/db/client';
import {
  marketplaceAccounts,
  ozonPerfCampaigns,
} from '../src/lib/db/schema/marketplaces';
import { decryptAccountPerfSecret } from '../src/lib/marketplaces/queries';
import { OzonPerformanceClient } from '../src/lib/marketplaces/ozon/performance/client';
import {
  submitStatisticsReport,
  waitForReport,
  downloadReport,
  parseCsv,
  detectHeaderIndex,
  isSkuStatsHeader,
  isCpoDailyHeader,
  parseSkuStatsRow,
  parseCpoDailyRow,
} from '../src/lib/marketplaces/ozon/performance/endpoints';
import { buildPerfPeriod } from '../src/lib/marketplaces/ozon/sync/perf-period';

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error('Usage: pnpm tsx scripts/debug-ozon-perf-csv.ts <accountId>');
    process.exit(2);
  }

  const accountRows = await db
    .select()
    .from(marketplaceAccounts)
    .where(eq(marketplaceAccounts.id, accountId))
    .limit(1);
  const account = accountRows[0];
  if (!account) {
    console.error(`Account ${accountId} not found.`);
    process.exit(2);
  }
  if (account.marketplace !== 'ozon') {
    console.error(`Account ${accountId} is not Ozon.`);
    process.exit(2);
  }
  if (!account.perfClientId) {
    console.error('Performance API не подключён у этого аккаунта.');
    process.exit(2);
  }

  const perfSecret = decryptAccountPerfSecret(account);
  if (!perfSecret) {
    console.error('Не удалось расшифровать perf_client_secret.');
    process.exit(2);
  }

  const client = new OzonPerformanceClient({
    accountId: account.id,
    clientId: account.perfClientId,
    clientSecret: perfSecret,
  });

  const campaigns = await db
    .select()
    .from(ozonPerfCampaigns)
    .where(
      and(
        eq(ozonPerfCampaigns.tenantId, account.tenantId),
        eq(ozonPerfCampaigns.accountId, account.id),
      ),
    );

  console.log(`\n=== Кампании в БД для аккаунта ${account.id} (${campaigns.length}) ===`);
  for (const c of campaigns.slice(0, 5)) {
    console.log(
      `  campaign_id=${c.campaignId} state=${c.state ?? '—'} adv=${c.advObjectType ?? '—'} payment=${c.paymentType ?? '—'}`,
    );
  }

  const searchPromo = campaigns.filter((c) =>
    ['SKU', 'SEARCH_PROMO'].includes(c.advObjectType ?? ''),
  );
  const allSkuPromo = campaigns.filter((c) => c.advObjectType === 'ALL_SKU_PROMO');

  console.log(
    `\n=== Распределение: SKU/SEARCH_PROMO=${searchPromo.length}, ALL_SKU_PROMO=${allSkuPromo.length} ===`,
  );

  const target = searchPromo[0] ?? campaigns[0];
  if (!target) {
    console.error('Нет ни одной кампании в БД. Запустите perfCampaigns sync.');
    process.exit(2);
  }

  console.log(`\n=== Тест на кампании ${target.campaignId} (adv=${target.advObjectType}) ===`);

  const period = buildPerfPeriod(7, new Date(), 2);
  console.log(`Period: ${period.dateFrom} → ${period.dateTo}`);

  let uuid: string;
  try {
    uuid = await submitStatisticsReport(client, {
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      campaigns: [target.campaignId],
      groupBy: 'DATE',
    });
    console.log(`Report UUID: ${uuid}`);
  } catch (e) {
    console.error('SubmitStatisticsReport FAILED:', e);
    process.exit(1);
  }

  let link: string;
  try {
    link = await waitForReport(client, uuid, { maxAttempts: 60, intervalMs: 10_000 });
    console.log(`Report link: ${link}`);
  } catch (e) {
    console.error('waitForReport FAILED:', e);
    process.exit(1);
  }

  let csv: string;
  try {
    csv = await downloadReport(client, link);
  } catch (e) {
    console.error('downloadReport FAILED:', e);
    process.exit(1);
  }

  console.log(`\n=== RAW CSV (length=${csv.length}) ===`);
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  for (let i = 0; i < Math.min(10, lines.length); i += 1) {
    console.log(`  [${i.toString().padStart(2)}] ${lines[i].slice(0, 200)}`);
  }
  if (lines.length > 10) console.log(`  ... (${lines.length - 10} more lines)`);

  const headerIdx = detectHeaderIndex(lines);
  console.log(`\n=== detectHeaderIndex → ${headerIdx} ===`);
  console.log(`Header line: ${lines[headerIdx]?.slice(0, 300)}`);

  const rows = parseCsv(csv);
  console.log(`\n=== parseCsv → ${rows.length} rows ===`);
  if (rows.length > 0) {
    const firstKeys = Object.keys(rows[0]);
    console.log(`First row keys (${firstKeys.length}): ${firstKeys.slice(0, 10).join(' | ')}`);
    console.log('First row values (truncated):');
    for (const k of firstKeys.slice(0, 10)) {
      console.log(`  ${k}: ${String(rows[0][k]).slice(0, 80)}`);
    }
  }

  console.log(`\n=== isSkuStatsHeader(rows[0]) → ${rows[0] ? isSkuStatsHeader(rows[0]) : 'no rows'} ===`);
  console.log(`=== isCpoDailyHeader(rows[0]) → ${rows[0] ? isCpoDailyHeader(rows[0]) : 'no rows'} ===`);

  if (rows.length > 0 && isSkuStatsHeader(rows[0])) {
    const parsed = parseSkuStatsRow(rows[0]);
    console.log(`\n=== parseSkuStatsRow(rows[0]) ===`);
    console.log(JSON.stringify(parsed, null, 2));
  }

  if (rows.length > 0 && isCpoDailyHeader(rows[0])) {
    const parsedCpo = parseCpoDailyRow(rows[0]);
    console.log(`\n=== parseCpoDailyRow(rows[0]) ===`);
    console.log(JSON.stringify(parsedCpo, null, 2));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
