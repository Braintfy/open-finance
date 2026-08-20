// PURPOSE: Стейдж синхронизации помесячного отчёта о реализации (приложение к УПД).
// Source: Seller API `POST /v2/finance/realization` — тело `{ year, month }` ЧИСЛАМИ.
// Sink: `ozon_realization` (нетто-реализация на (account, period, sku)).
//
// Тянем 2 последних ЗАКРЫТЫХ месяца: текущий месяц Ozon не отдаёт вовсе, а
// предпоследний ещё догружается корректировками.
//
// Грабли:
// 1. Тело `{ date: 'YYYY-MM' }` (форма v1) даёт 400 «invalid
//    GetRealizationReportRequestV2.Year» — до v0.51.1 стейдж молча ел эту ошибку
//    в console.warn и рапортовал успех, поэтому таблица месяцами стояла пустой.
//    Отсюда правило: провал ВСЕХ месяцев = ошибка стейджа (её видит
//    `lastSyncStatus` и UI), провал части месяцев = warning в StageResult.
// 2. Схема ответа держит денежные поля обязательными + запрос идёт
//    `{ strict: true }`: смена формы обязана падать громко, а не писать нули.

import { financeRealization } from '../endpoints';
import { insertRealizationBatch } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

/** Сколько закрытых месяцев тянем за один прогон. */
const MONTHS_BACK = 2;

type MonthWindow = {
  key: string;
  year: number;
  month: number;
  /** Границы периода в UTC-полночь: `timestamp` в БД без таймзоны, и границы
   *  месяца не должны зависеть от таймзоны процесса (иначе повторный синк
   *  с другого хоста запишет тот же месяц под другим `period_from`). */
  from: Date;
  to: Date;
};

function lastClosedMonths(count: number): MonthWindow[] {
  const out: MonthWindow[] = [];
  const now = new Date();
  // Отсчёт от первого дня текущего месяца по МСК: под UTC-полночь 1-го числа
  // «сейчас» в Москве уже следующий месяц, и без сдвига мы бы на несколько
  // часов в месяц запрашивали лишний период.
  const msc = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  let year = msc.getUTCFullYear();
  let monthIdx = msc.getUTCMonth();
  for (let i = 0; i < count; i += 1) {
    monthIdx -= 1;
    if (monthIdx < 0) {
      monthIdx = 11;
      year -= 1;
    }
    out.push({
      key: `${year}-${String(monthIdx + 1).padStart(2, '0')}`,
      year,
      month: monthIdx + 1,
      from: new Date(Date.UTC(year, monthIdx, 1)),
      to: new Date(Date.UTC(year, monthIdx + 1, 1)),
    });
  }
  return out;
}

export async function syncRealizationStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const months = lastClosedMonths(MONTHS_BACK);
    const warnings: string[] = [];
    const failures: string[] = [];
    let processed = 0;
    let fetched = 0;

    for (const m of months) {
      try {
        const res = await financeRealization(ctx.client, { year: m.year, month: m.month });
        const rows = res.result?.rows ?? [];
        const header = res.result?.header ?? null;
        fetched += rows.length;
        if (rows.length === 0) {
          warnings.push(`Отчёт о реализации за ${m.key}: пустой ответ Ozon (0 строк).`);
          continue;
        }
        const { inserted, mismatched } = await insertRealizationBatch(ctx, {
          periodFrom: m.from,
          periodTo: m.to,
          rows,
          header,
        });
        processed += inserted;
        if (mismatched > 0) {
          warnings.push(
            `Отчёт о реализации за ${m.key}: у ${mismatched} из ${inserted} строк ` +
              '«итого к начислению + вознаграждение» не сходится с суммой выплат — ' +
              'вероятно, Ozon добавил новый вид выплат. Строки записаны, сверьте raw.',
          );
        }
        ctx.onProgress?.(processed, fetched);
      } catch (e) {
        failures.push(`${m.key}: ${(e as Error).message}`);
      }
    }

    // Провал ВСЕХ месяцев — это ошибка стейджа, а не «успех с нулём строк».
    if (failures.length === months.length) {
      throw new Error(`Отчёт о реализации не загружен ни за один месяц — ${failures.join('; ')}`);
    }
    if (failures.length > 0) {
      warnings.push(`Часть месяцев не загрузилась: ${failures.join('; ')}`);
    }

    return { itemsProcessed: processed, itemsTotal: fetched, warnings };
  });
}
