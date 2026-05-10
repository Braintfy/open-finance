// PURPOSE: POST /api/cashflow/import — приём файла CSV/XLSX с банковской выпиской.
// Возвращает превью разобранных строк (без сохранения). Сохранение — отдельным вызовом.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { parseCsv, parseXlsx } from '@/lib/cashflow/import';
import { db } from '@/lib/db/client';
import { transactions } from '@/lib/db/schema/transactions';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const commit = form.get('commit') === 'true';

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'Файл не получен' }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  let parsed;
  if (name.endsWith('.csv')) {
    const text = await file.text();
    parsed = parseCsv(text);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    parsed = parseXlsx(buf);
  } else {
    return NextResponse.json(
      { ok: false, error: 'Поддерживаются только CSV и XLSX файлы' },
      { status: 400 }
    );
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'Не удалось разобрать ни одной строки',
      detectedFormat: parsed.detectedFormat,
      errors: parsed.errors,
    });
  }

  if (!commit) {
    // Превью — первые 50 строк
    return NextResponse.json({
      ok: true,
      preview: true,
      detectedFormat: parsed.detectedFormat,
      totalRows: parsed.rows.length,
      sample: parsed.rows.slice(0, 50),
      errors: parsed.errors,
    });
  }

  // Сохраняем все строки
  await db.insert(transactions).values(
    parsed.rows.map((r) => ({
      tenantId: session.tenantId!,
      amount: r.amount,
      type: r.type,
      description: r.description ?? null,
      counterparty: r.counterparty ?? null,
      source: 'bank' as const,
      occurredAt: r.date,
    }))
  );

  return NextResponse.json({
    ok: true,
    imported: parsed.rows.length,
    detectedFormat: parsed.detectedFormat,
  });
}
