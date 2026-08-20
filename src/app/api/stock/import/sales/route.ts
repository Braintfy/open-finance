// PURPOSE: POST /api/stock/import/sales — импорт продаж Wildberries и
// Яндекс.Маркета из файла (§12.3: эти каналы учитываются с первого дня, иначе
// остаток своего склада систематически завышается, а план поставок занижается).
//
// multipart/form-data:
//   file        — .xlsx / .xls / .csv выгрузка продаж канала
//   channel     — 'wb' | 'yandex'
//   dryRun      — '1' (по умолчанию): только превью, ничего не пишем
//   fromPlace   — код места списания (по умолчанию 'own')
//   sheet       — имя листа (необязательно)
//   mapping     — JSON {date,externalId,qty,revenue,docType,name} с индексами
//                 колонок, если человек поправил автоподбор
//
// Файл разбирается ЗДЕСЬ, а не на клиенте: разбор — чистый модуль с тестами
// (src/lib/stock/import-sales.ts), и второй его реализации в браузере быть не
// должно. Клиент присылает файл и получает готовое превью.
//
// РАЗМЕР ОТСЕКАЕТСЯ ДВАЖДЫ: по Content-Length ДО чтения тела (иначе книга
// целиком материализуется в памяти ещё до проверки) и по реальному file.size
// после разбора формы (Content-Length приходит от клиента и ему нельзя верить).

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { requireTenantRoute } from '@/lib/auth/guards';
import { ensureStockSetup } from '@/lib/stock/queries';
import {
  MAX_SALES_ROWS,
  parseSalesSheet,
  type SalesColumnMap,
} from '@/lib/stock/import-sales';
import { applySalesImport } from '@/lib/stock/import-sales-apply';
import { stockErrorResponse } from '@/lib/stock/http';

/** 12 МБ: месячная выгрузка WB — сотни килобайт, всё крупнее это не отчёт. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * Потолок ВСЕГО тела запроса. Больше лимита файла, потому что multipart несёт
 * ещё границы частей и остальные поля формы (channel, dryRun, mapping…), а
 * base64-раздувания здесь нет — файл идёт бинарной частью.
 */
const MAX_BODY_BYTES = MAX_FILE_BYTES + 1024 * 1024;

const TOO_LARGE_MESSAGE = `Файл больше ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ — разделите выгрузку по месяцам`;

const MappingSchema = z
  .object({
    date: z.number().int().min(0).optional(),
    externalId: z.number().int().min(0).optional(),
    qty: z.number().int().min(0).optional(),
    revenue: z.number().int().min(0).optional(),
    docType: z.number().int().min(0).optional(),
    name: z.number().int().min(0).optional(),
  })
  .optional();

/**
 * Лист книги → матрица строк. `raw: false` заставляет SheetJS отдавать
 * ФОРМАТИРОВАННЫЕ значения: дата приходит «01.08.2026», а не серийным числом,
 * и разбор не зависит от локали книги. Серийный номер парсер всё равно умеет —
 * на случай csv без форматов.
 */
function sheetToMatrix(ws: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  return rows
    .slice(0, MAX_SALES_ROWS + 20)
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []));
}

/**
 * Читает книгу. Для CSV в windows-1251 (типовая выгрузка из 1С и старых
 * кабинетов) UTF-8-разбор даёт кракозябры, поэтому при отсутствии кириллицы
 * в заголовке пробуем ещё раз с кодовой страницей 1251.
 */
function readWorkbook(buffer: Buffer, fileName: string): XLSX.WorkBook {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  const isCsv = /\.csv$/i.test(fileName);
  if (!isCsv) return wb;
  const first = wb.SheetNames[0];
  const probe = first ? sheetToMatrix(wb.Sheets[first]).slice(0, 3).flat().join('') : '';
  if (/[А-Яа-яЁё]/.test(probe) || probe === '') return wb;
  try {
    return XLSX.read(buffer, { type: 'buffer', raw: false, codepage: 1251 });
  } catch {
    return wb;
  }
}

export async function POST(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };

    // Отсечка ДО req.formData(): формдата буферизует тело целиком, поэтому
    // проверка размера после неё уже бессмысленна — книга на 200 МБ к этому
    // моменту лежит в памяти процесса, и «слишком большой файл» приходит уже
    // после того, как ущерб нанесён. Content-Length подделывается, поэтому он
    // не единственный рубеж: ниже остаётся проверка реального file.size.
    const declaredLength = Number(req.headers.get('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: TOO_LARGE_MESSAGE },
        { status: 413 },
      );
    }

    const form = await req.formData();
    const channelRaw = String(form.get('channel') ?? '');
    if (channelRaw !== 'wb' && channelRaw !== 'yandex') {
      return NextResponse.json(
        { ok: false, error: 'Укажите канал: wb или yandex' },
        { status: 400 },
      );
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'Файл не приложен' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, error: TOO_LARGE_MESSAGE }, { status: 413 });
    }

    let mapping: SalesColumnMap | undefined;
    const mappingRaw = form.get('mapping');
    if (typeof mappingRaw === 'string' && mappingRaw.trim() !== '') {
      const parsedMapping = MappingSchema.safeParse(JSON.parse(mappingRaw));
      if (!parsedMapping.success) {
        return NextResponse.json(
          { ok: false, error: 'Некорректная раскладка колонок' },
          { status: 400 },
        );
      }
      mapping = parsedMapping.data;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let wb: XLSX.WorkBook;
    try {
      wb = readWorkbook(buffer, file.name);
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: `Не удалось прочитать файл: ${e instanceof Error ? e.message : String(e)}`,
        },
        { status: 400 },
      );
    }
    if (wb.SheetNames.length === 0) {
      return NextResponse.json({ ok: false, error: 'В файле нет листов' }, { status: 400 });
    }
    const wanted = String(form.get('sheet') ?? '');
    const sheetName = wb.SheetNames.includes(wanted) ? wanted : wb.SheetNames[0];

    const parsed = parseSalesSheet(sheetToMatrix(wb.Sheets[sheetName]), {
      channel: channelRaw,
      mapping,
    });
    if (!parsed.ok) {
      return NextResponse.json(
        { ok: false, error: parsed.error, headers: parsed.headers, sheetNames: wb.SheetNames },
        { status: 400 },
      );
    }

    // Места нужны и превью (оно резолвит место списания), и проводке.
    await ensureStockSetup(ctx);

    const dryRun = String(form.get('dryRun') ?? '1') !== '0';
    const result = await applySalesImport(ctx, parsed.rows, {
      channel: channelRaw,
      fromPlaceCode: String(form.get('fromPlace') ?? '') || undefined,
      dryRun,
    });

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      sheetName,
      sheetNames: wb.SheetNames,
      headers: parsed.headers,
      headerRowNo: parsed.headerRowNo,
      mapping: parsed.mapping,
      skipped: parsed.skipped.slice(0, 50),
      skippedCount: parsed.skipped.length,
      warnings: parsed.warnings,
      ...result,
    });
  } catch (error) {
    return stockErrorResponse('import/sales', error);
  }
}
