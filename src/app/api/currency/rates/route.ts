// PURPOSE: GET /api/currency/rates — список snapshot'ов курсов валют.
// При устаревании (>23h) делает background-refresh, не блокируя ответ.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getCurrencyRates,
  getStaleness,
  refreshCurrencyRates,
} from '@/lib/currency/queries';

/** Защита от параллельных refresh'ей (несколько одновременных GET-запросов). */
let inflightRefresh: Promise<unknown> | null = null;

function backgroundRefresh(): void {
  if (inflightRefresh) return;
  inflightRefresh = refreshCurrencyRates()
    .catch((error) => {
      console.error('[currency] background refresh failed:', error);
    })
    .finally(() => {
      inflightRefresh = null;
    });
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const codesParam = url.searchParams.get('codes');
    const codes = codesParam
      ? codesParam.split(',').map((c) => c.trim()).filter(Boolean)
      : undefined;

    const [rates, staleness] = await Promise.all([
      getCurrencyRates(codes),
      getStaleness(),
    ]);

    if (staleness.isStale) {
      backgroundRefresh();
    }

    return NextResponse.json({
      ok: true,
      rates,
      staleness: {
        ageMs:
          staleness.ageMs === Number.POSITIVE_INFINITY ? null : staleness.ageMs,
        isStale: staleness.isStale,
        lastUpdatedAt: staleness.lastUpdatedAt,
      },
    });
  } catch (error) {
    console.error('[currency] GET /api/currency/rates failed:', error);
    const message =
      error instanceof Error ? error.message : 'Внутренняя ошибка сервера';
    // Частая причина: не применена SQL-миграция (relation "currency_rates" does not exist)
    const isMissingTable =
      typeof message === 'string' &&
      /relation .*currency_rates.* does not exist/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        error: isMissingTable
          ? 'Таблица currency_rates не создана. Применить SQL: docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/06-currency.sql'
          : `Ошибка чтения курсов: ${message}`,
      },
      { status: isMissingTable ? 503 : 500 },
    );
  }
}
