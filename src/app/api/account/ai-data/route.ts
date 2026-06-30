// PURPOSE: POST /api/account/ai-data — удалить все AI-данные пользователя
// (отчёты по блокам/разделам, Ozon AI-инсайты, BYOK-ключи). Скоуп — текущий
// (tenant, user). Часть 152-ФЗ self-service (право на удаление данных).
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { internalError } from '@/lib/api-error';
import { clearUserAiData } from '@/lib/account/deletion-queries';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.userId || !session.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const deleted = await clearUserAiData({
      tenantId: session.tenantId,
      userId: session.userId,
    });
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    console.error('[account] POST /ai-data failed:', e);
    return internalError();
  }
}
