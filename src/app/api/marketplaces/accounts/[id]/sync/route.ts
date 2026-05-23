// PURPOSE: POST /api/marketplaces/accounts/[id]/sync — запуск ручной
// синхронизации. Создаёт job, запускает runFullSync асинхронно (не блокируем
// ответ — клиент поллит /jobs/[jobId]). Опциональный body: { stage }
// — синхронизировать только один стейдж.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { createSyncJob, getAccount } from '@/lib/marketplaces/queries';
import { runFullSync } from '@/lib/marketplaces/ozon/sync/full';
import {
  OZON_FULL_STAGES,
  type OzonStageKind,
} from '@/lib/marketplaces/types';
import type { SyncStageState } from '@/lib/db/schema/marketplaces';

export const runtime = 'nodejs';
export const maxDuration = 300; // запас на Vercel-deploy

type RouteCtx = { params: Promise<{ id: string }> };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const BodySchema = z
  .object({
    /** Запустить только один стейдж (все остальные — skipped). */
    stage: z.enum(OZON_FULL_STAGES).optional(),
    /**
     * Полный sync, но только с включёнными стейджами. UI блока аналитики
     * отправляет это, чтобы пользователь мог выбрать набор стейджей.
     * Незаявленные стейджи останутся со значением из account.syncSettings.
     */
    stages: z.record(z.enum(OZON_FULL_STAGES), z.boolean()).optional(),
    /**
     * v0.22.1: Override sliding-window для date-aware стейджей. Если задано
     * (оба поля) — стейдж analyticsData/orders/transactions/perf-* загружает
     * только этот диапазон, а не settings.*WindowDays. Формат YYYY-MM-DD MSC.
     * Для catalog/snapshot-стейджей (products/prices/stocks/turnover/clusters/
     * warehouseStocks/realization) — игнорируется.
     */
    fromDate: z.string().regex(ISO_DATE_RE).optional(),
    toDate: z.string().regex(ISO_DATE_RE).optional(),
    /**
     * v0.22.1: Принудительная перезапись существующих rows в окне (DELETE+INSERT).
     * Сейчас daily-таблицы и так перезаписывают окно — флаг зарезервирован под
     * будущую оптимизацию skip-if-already-loaded.
     */
    force: z.boolean().optional(),
    /** Декоративное поле от UI, нам не нужно. */
    kind: z.string().optional(),
  })
  .passthrough()
  .optional();

export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const session = await auth();
    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const account = await getAccount({ tenantId: session.tenantId, id });
    if (!account) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    let body: z.infer<typeof BodySchema> = undefined;
    try {
      const raw = await req.text();
      body = raw ? BodySchema.parse(JSON.parse(raw)) : undefined;
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues[0]?.message : 'Invalid body';
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    const onlyStage = body?.stage as OzonStageKind | undefined;
    const stagesOverride = body?.stages as
      | Partial<Record<OzonStageKind, boolean>>
      | undefined;
    const overrideFromDate = body?.fromDate;
    const overrideToDate = body?.toDate;
    const force = body?.force === true;

    // Если задано одно из date-полей — нужны оба.
    if ((overrideFromDate && !overrideToDate) || (!overrideFromDate && overrideToDate)) {
      return NextResponse.json(
        { ok: false, error: 'fromDate и toDate должны быть заданы вместе' },
        { status: 400 },
      );
    }
    if (overrideFromDate && overrideToDate && overrideFromDate > overrideToDate) {
      return NextResponse.json(
        { ok: false, error: 'fromDate должно быть <= toDate' },
        { status: 400 },
      );
    }

    const initStages = (
      onlyStage ? [onlyStage] : ([...OZON_FULL_STAGES] as OzonStageKind[])
    ).reduce<Record<string, SyncStageState>>((acc, s) => {
      acc[s] = { status: 'pending' };
      return acc;
    }, {});

    const job = await createSyncJob({
      tenantId: session.tenantId,
      accountId: id,
      kind: onlyStage ?? 'full',
      stages: initStages,
    });

    // Запускаем в фоне (в том же процессе), не блокируем ответ.
    // Ошибки логируем — финальный статус будет записан в БД оркестратором.
    runFullSync({
      tenantId: session.tenantId,
      userId: session.userId,
      accountId: id,
      jobId: job.id,
      onlyStage,
      stagesOverride,
      overrideFromDate,
      overrideToDate,
      force,
    }).catch((e) => {
      console.error('[marketplaces] runFullSync background error:', e);
    });

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (e) {
    console.error('[marketplaces] POST /accounts/[id]/sync failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
