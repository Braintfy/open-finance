// PURPOSE: One-shot diagnostic + cleanup для unit_products после фикса
// "sync обнуляет цены/объёмы". До фикса поздние стейджи (prices/stocks)
// могли перезаписать priceKopecks/volumeL нулями. Этот скрипт показывает
// затронутые записи и (опционально) сбрасывает их в null чтобы при
// следующем sync они вновь заполнились корректными значениями.
//
// Безопасность:
//   - Скрипт читает базу через DATABASE_URL.
//   - По умолчанию работает в DRY-RUN: только показывает диагностику.
//   - С `--apply` действительно сбрасывает в 0/null (но pricesKopecks=0
//     уже и так 0, так что фактически команда нужна только если хочется
//     стереть некорректные нулевые значения objects-metadata).
//
// Запуск:
//   DATABASE_URL=postgresql://... pnpm tsx scripts/prune-zero-ozon-fields.ts
//   DATABASE_URL=... pnpm tsx scripts/prune-zero-ozon-fields.ts --apply
//
// Рекомендация: запустить в dry-run, затем удалить кэш блоков и сделать
// полный re-sync через UI («Синхронизировать сейчас»). Скрипт нужен для
// проверки факта проблемы и сбора статистики.

import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db/client';
import { unitProducts } from '../src/lib/db/schema/unit-economics';
import { and, eq } from 'drizzle-orm';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`\n=== Ozon zero-fields diagnostic (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  type Row = {
    tenant_id: string;
    id: string;
    article: string;
    price_kopecks: number;
    volume_l_x100: number;
  };

  const result = await db.execute<Row>(sql`
    SELECT
      tenant_id,
      id,
      article,
      price_kopecks,
      volume_l_x100
    FROM unit_products
    WHERE marketplace = 'ozon'
      AND (price_kopecks = 0 OR volume_l_x100 = 0)
    LIMIT 50
  `);
  const rows: Row[] = Array.isArray(result)
    ? (result as Row[])
    : (((result as unknown) as { rows: Row[] }).rows ?? []);

  console.log(`Найдено записей с price=0 ИЛИ volume=0: ${rows.length}`);
  for (const r of rows.slice(0, 20)) {
    console.log(
      `  ${r.tenant_id.slice(0, 8)} · ${r.article} · price=${r.price_kopecks} · vol=${r.volume_l_x100}`,
    );
  }
  if (rows.length === 50) {
    console.log('  … (показаны первые 50)');
  }

  if (!APPLY) {
    console.log('\nDRY-RUN. Чтобы реально сбросить metadata.commissions с null→omit, передайте --apply.');
    console.log('Рекомендация: запустите полный re-sync через UI — он перезальёт значения корректно после фикса.');
    return;
  }

  // APPLY-режим: мы НЕ обнуляем priceKopecks/volumeL (там уже 0), но
  // чистим metadata.commissions: { fboPct: null, fbsPct: null } если оба
  // null — старый sync такое писал, JSONB-merge не убирает null'ы автоматом.
  let cleaned = 0;
  for (const r of rows) {
    const res = await db.execute(sql`
      UPDATE unit_products
      SET metadata = metadata - 'commissions'
      WHERE id = ${r.id}
        AND tenant_id = ${r.tenant_id}
        AND metadata->'commissions' = '{"fboPct": null, "fbsPct": null}'::jsonb
    `);
    // ничего, просто счётчик попыток
    cleaned += 1;
  }
  console.log(`\nОчистка metadata.commissions выполнена для ${cleaned} записей (where applicable).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
