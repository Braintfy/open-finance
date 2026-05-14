// PURPOSE: API сохранённых расчётов unit_calculations.

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  listUnitCalculations,
  saveUnitCalculation,
} from '@/lib/unit-economics/queries';
import type {
  UnitCalculationMode,
  UnitMarketplace,
} from '@/lib/db/schema/unit-economics';

const ALLOWED_MP: UnitMarketplace[] = ['ozon', 'yandex'];
const ALLOWED_MODES: UnitCalculationMode[] = [
  'ozon_fbo',
  'ozon_fbs',
  'yandex_fby',
  'yandex_fbs',
  'yandex_dbs',
  'yandex_express',
];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const mp = url.searchParams.get('marketplace');
  const marketplace = mp && (ALLOWED_MP as string[]).includes(mp) ? (mp as UnitMarketplace) : undefined;
  const calculations = await listUnitCalculations({
    tenantId: session.tenantId,
    marketplace,
  });
  return NextResponse.json({ ok: true, calculations });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });

  const mp = String(body.marketplace ?? '');
  if (!(ALLOWED_MP as string[]).includes(mp)) {
    return NextResponse.json({ ok: false, error: 'Invalid marketplace' }, { status: 400 });
  }
  const mode = String(body.mode ?? '');
  if (!(ALLOWED_MODES as string[]).includes(mode)) {
    return NextResponse.json({ ok: false, error: 'Invalid mode' }, { status: 400 });
  }

  const calc = await saveUnitCalculation({
    tenantId: session.tenantId,
    userId: session.userId,
    productId: typeof body.productId === 'string' ? body.productId : null,
    marketplace: mp as UnitMarketplace,
    mode: mode as UnitCalculationMode,
    tariffVersion: typeof body.tariffVersion === 'string' ? body.tariffVersion : 'unknown',
    inputs: (body.inputs && typeof body.inputs === 'object'
      ? (body.inputs as Record<string, unknown>)
      : {}),
    bindings: (body.bindings && typeof body.bindings === 'object'
      ? (body.bindings as Record<string, unknown>)
      : {}),
    results: (body.results && typeof body.results === 'object'
      ? (body.results as Record<string, unknown>)
      : {}),
  });

  return NextResponse.json({ ok: true, calculation: calc });
}
