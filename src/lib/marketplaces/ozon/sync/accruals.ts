// PURPOSE: Стейдж `accruals` — начисления Ozon через `/v1/finance/accrual/types`
// + `/v1/finance/accrual/by-day` в ozon_accrual_types / ozon_accruals.
// Замена стейджа `transactions` (`/v3/finance/transaction/list` отключён Ozon:
// 400 obsolete с 12.09.2026, 404 с 06.10.2026). Это сырьё книги прибыли слоя
// метрик (docs/METRICS_LAYER_DESIGN.md, source_kind='ozon_accrual').
//
// Окно: по умолчанию с первого числа позапрошлого месяца по сегодня (МСК),
// override — ctx.overrideFromDate..overrideToDate (МСК, включительно). by-day
// однодневный, поэтому окно режется на дни (planAccrualWindow), дни идут от
// новых к старым.
//
// Идемпотентность — замена окна «аккаунт × день» одной транзакцией и ТОЛЬКО
// при полной выборке дня без фатальных ошибок маппинга (decideAccrualDayWrite).
// Сбой одного дня не останавливает остальные: его старые строки остаются,
// причина — в StageResult.error, стейдж ok=false (а не «тихий успех»).

import { mskDayOf } from '@/lib/metrics/period';
import { financeAccrualTypes, getFinanceAccrualsByDay } from '../endpoints';
import {
  decideAccrualDayWrite,
  mapAccrualDay,
  mapAccrualTypes,
  planAccrualWindow,
} from '../accruals-map';
import { loadOzonOfferIdBySku, replaceAccrualDay, upsertAccrualTypes } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

/** Сколько ошибок дней перечислять в error (остальные — счётчиком). */
const MAX_DAY_ERRORS = 5;
/** Сколько замечаний класть в warnings. */
const MAX_WARNINGS = 30;

export async function syncAccrualsStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const warn = (w: string) => {
      if (warnings.length < MAX_WARNINGS && !warnings.includes(w)) warnings.push(w);
    };

    const plan = planAccrualWindow({
      todayMsk: mskDayOf(new Date()),
      overrideFrom: ctx.overrideFromDate,
      overrideTo: ctx.overrideToDate,
    });
    plan.problems.forEach(warn);
    if (plan.error) throw new Error(plan.error);

    // 1. Справочник типов. Его сбой не мешает записи начислений (type_id
    // хранится числом), но и не прячется: стейдж станет ok=false.
    try {
      const types = mapAccrualTypes(await financeAccrualTypes(ctx.client));
      types.problems.forEach(warn);
      if (!types.shapeOk) {
        errors.push(`справочник типов: ${types.problems.join('; ')}`);
      } else {
        await upsertAccrualTypes(ctx, types.rows);
        if (types.rows.length === 0) warn('Справочник типов начислений пуст (/v1/finance/accrual/types)');
      }
    } catch (e) {
      errors.push(`справочник типов (/v1/finance/accrual/types): ${(e as Error).message}`);
    }

    // 2. Начисления по дням.
    const offerBySku = await loadOzonOfferIdBySku(ctx);
    let written = 0;
    let accrualsTotal = 0;
    let daysOk = 0;
    const failedDays: string[] = [];

    for (const [i, day] of plan.days.entries()) {
      try {
        const fetched = await getFinanceAccrualsByDay(ctx.client, { date: day });
        fetched.warnings.forEach(warn);
        const mapped = mapAccrualDay({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          day,
          accruals: fetched.accruals,
          offerBySku,
        });
        mapped.problems.forEach(warn);
        const decision = decideAccrualDayWrite({
          complete: fetched.complete,
          shapeOk: fetched.shapeOk,
          fatal: mapped.fatal,
        });
        if (!decision.replace) {
          failedDays.push(day);
          if (errors.length < MAX_DAY_ERRORS) {
            errors.push(`${day}: ${decision.reason} — день не перезаписан, прежние строки сохранены`);
          }
        } else {
          const { inserted, deleted } = await replaceAccrualDay({
            tenantId: ctx.tenantId,
            accountId: ctx.accountId,
            day,
            rows: mapped.rows,
          });
          if (deleted > 0 && mapped.rows.length === 0) {
            warn(`${day}: день очищен — удалено ${deleted} строк, а Ozon вернул пустой набор начислений`);
          }
          written += inserted;
          accrualsTotal += mapped.accrualCount;
          daysOk += 1;
        }
      } catch (e) {
        failedDays.push(day);
        if (errors.length < MAX_DAY_ERRORS) errors.push(`${day}: ${(e as Error).message}`);
      }
      ctx.onProgress?.(i + 1, plan.days.length);
    }

    if (failedDays.length > MAX_DAY_ERRORS) {
      errors.push(`всего не загружено дней: ${failedDays.length} из ${plan.days.length}`);
    }
    if (daysOk > 0 && accrualsTotal === 0 && plan.days.length >= 7) {
      warn(
        `За ${daysOk} дн. (${plan.from}..${plan.to}) Ozon не вернул ни одного начисления — ` +
          'проверьте права API-ключа на финансовые методы',
      );
    }

    return {
      ok: errors.length === 0,
      itemsProcessed: written,
      itemsTotal: accrualsTotal,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  });
}
