// PURPOSE: Импорт XLSX с ценами Ozon. POST multipart/form-data:
// - file: файл .xlsx
// - commit: 'true' | 'false' (default false → preview only)
// При commit=true сохраняет товары в unit_products + запись unit_imports.

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { parseOzonPriceTemplate } from '@/lib/unit-economics/import/ozon-price-template';
import {
  bulkUpsertUnitProducts,
  recordUnitImport,
} from '@/lib/unit-economics/queries';
import { rublesToKopecks } from '@/lib/unit-economics/types';

export const runtime = 'nodejs'; // нам нужен Node для xlsx + zlib

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: 'Invalid form' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'No file' }, { status: 400 });
  }
  const commit = String(form.get('commit') ?? 'false') === 'true';

  const buffer = await file.arrayBuffer();
  const parsed = parseOzonPriceTemplate(buffer);

  const sample = parsed.rows.slice(0, 10).map((row) => ({
    article: row.article,
    sku: row.sku,
    name: row.name,
    stockMarketplace: row.stockMarketplace,
    stockOwn: row.stockOwn,
    price: row.price,
    cost: row.cost,
  }));

  if (!commit) {
    return NextResponse.json({
      ok: true,
      preview: true,
      filename: file.name,
      totalRows: parsed.totalRows,
      sample,
      warnings: parsed.warnings,
      recognizedColumns: parsed.recognizedColumns,
      unrecognizedColumns: parsed.unrecognizedColumns,
    });
  }

  const upsertRows = parsed.rows
    .filter((r) => r.article || r.sku || r.name)
    .map((r) => {
      const commissions: Record<string, number> = {};
      if (typeof r.fboCommissionPct === 'number' && r.fboCommissionPct > 0)
        commissions.fboPct = r.fboCommissionPct;
      if (typeof r.fbsCommissionPct === 'number' && r.fbsCommissionPct > 0)
        commissions.fbsPct = r.fbsCommissionPct;
      const metadata: Record<string, unknown> = {
        raw: r.raw,
        volumetricWeightKg: r.volumetricWeightKg,
      };
      if (r.oldPrice > 0) metadata.oldPrice = r.oldPrice;
      if (r.minPrice > 0) metadata.minPrice = r.minPrice;
      if (r.vatPct > 0) metadata.vatPct = r.vatPct;
      if (Object.keys(commissions).length > 0) metadata.commissions = commissions;
      if (typeof r.acquiringPct === 'number' && r.acquiringPct > 0)
        metadata.acquiringPct = r.acquiringPct;
      return {
        tenantId: session.tenantId!,
        userId: session.userId!,
        marketplace: 'ozon' as const,
        article: r.article,
        sku: r.sku,
        barcode: r.barcode,
        name: r.name,
        status: r.status,
        visibility: r.visibility,
        stockMarketplace: r.stockMarketplace,
        stockOwn: r.stockOwn,
        priceKopecks: rublesToKopecks(r.price),
        costKopecks: rublesToKopecks(r.cost),
        volumeL: Math.round(r.volumeL * 100),
        metadata,
      };
    });

  const { inserted } = await bulkUpsertUnitProducts(upsertRows);

  await recordUnitImport({
    tenantId: session.tenantId,
    userId: session.userId,
    source: 'ozon-price-template',
    filename: file.name,
    rowsTotal: parsed.totalRows,
    rowsImported: inserted,
    errors: parsed.warnings.map((message) => ({ message })),
    summary: {
      recognizedColumns: parsed.recognizedColumns,
      unrecognizedColumns: parsed.unrecognizedColumns,
    },
  });

  return NextResponse.json({
    ok: true,
    committed: true,
    filename: file.name,
    totalRows: parsed.totalRows,
    inserted,
    warnings: parsed.warnings,
  });
}
