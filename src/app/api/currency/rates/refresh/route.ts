// PURPOSE: POST /api/currency/rates/refresh — принудительное обновление курсов.
// Rate-limit: 1 запрос в минуту per-tenant (защита от спам-кликов).
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { refreshCurrencyRates } from '@/lib/currency/queries';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const lastRefreshAt = new Map<string, number>();

export async function POST() {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const tenantId = session.tenantId;
    const last = lastRefreshAt.get(tenantId) ?? 0;
    const now = Date.now();
    if (now - last < RATE_LIMIT_WINDOW_MS) {
      const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - last)) / 1000);
      return NextResponse.json(
        {
          ok: false,
          error: `Слишком часто. Попробуйте через ${retryAfterSec} сек.`,
          retryAfter: retryAfterSec,
        },
        { status: 429 },
      );
    }
    lastRefreshAt.set(tenantId, now);

    const rates = await refreshCurrencyRates();
    return NextResponse.json({
      ok: true,
      rates,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[currency] POST /api/currency/rates/refresh failed:', error);
    const message =
      error instanceof Error ? error.message : 'Не удалось обновить курсы';
    const isMissingTable =
      typeof message === 'string' &&
      /relation .*currency_rates.* does not exist/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        error: isMissingTable
          ? 'Таблица currency_rates не создана. Применить SQL: docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/06-currency.sql'
          : message,
      },
      { status: isMissingTable ? 503 : 502 },
    );
  }
}
