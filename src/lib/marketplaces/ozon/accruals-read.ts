// PURPOSE: Единственная точка чтения сумм из ozon_accruals. В колонке
// amount_kopecks лежат и итог начисления (line_kind='total'), и его разбивка
// (item_fee, commission_*, delivery_*): SUM без фильтра по line_kind задваивает
// сумму, а без фильтра по currency смешивает валюты. Поэтому line_kind здесь —
// ОБЯЗАТЕЛЬНЫЙ параметр, а суммируются только рубли (currency RUB или NULL).
// Будущий слой метрик (source_kind='ozon_accrual') читает начисления так же.

import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonAccruals, type OzonAccrualLineKind } from '@/lib/db/schema/marketplaces';
import { assertNonOverlappingKinds } from './accruals-map';

export type OzonAccrualSumRow = {
  accrualDate: string;
  lineKind: OzonAccrualLineKind;
  amountKopecks: number;
  rows: number;
};

/**
 * Суммы начислений по дню и виду строки за период [fromDate..toDate] (МСК,
 * включительно). `lineKinds` обязателен и не может быть пустым — смешивать
 * итог и разбивку в одной сумме нельзя (см. OzonAccrualLineKind).
 */
export async function sumOzonAccruals(args: {
  tenantId: string;
  accountId: string;
  fromDate: string;
  toDate: string;
  lineKinds: readonly [OzonAccrualLineKind, ...OzonAccrualLineKind[]];
}): Promise<OzonAccrualSumRow[]> {
  if (args.lineKinds.length === 0) throw new Error('sumOzonAccruals: lineKinds пуст');
  assertNonOverlappingKinds(args.lineKinds);
  const rows = await db
    .select({
      accrualDate: ozonAccruals.accrualDate,
      lineKind: ozonAccruals.lineKind,
      amountKopecks: sql<string>`coalesce(sum(${ozonAccruals.amountKopecks}), 0)`,
      rows: sql<string>`count(*)`,
    })
    .from(ozonAccruals)
    .where(
      and(
        eq(ozonAccruals.tenantId, args.tenantId),
        eq(ozonAccruals.accountId, args.accountId),
        gte(ozonAccruals.accrualDate, args.fromDate),
        lte(ozonAccruals.accrualDate, args.toDate),
        inArray(ozonAccruals.lineKind, [...args.lineKinds]),
        or(isNull(ozonAccruals.currency), eq(ozonAccruals.currency, 'RUB')),
      ),
    )
    .groupBy(ozonAccruals.accrualDate, ozonAccruals.lineKind)
    .orderBy(ozonAccruals.accrualDate, ozonAccruals.lineKind);
  return rows.map((r) => ({
    accrualDate: r.accrualDate,
    lineKind: r.lineKind,
    amountKopecks: Number(r.amountKopecks),
    rows: Number(r.rows),
  }));
}
