// PURPOSE: Источники для умного импорта в блок «Мой магазин · таблица».
//   GET  — список блоков-таблиц пользователя (по всем страницам) как источников.
//   POST { sourceBlockId, sourcePageKey } — нормализованная ImportTable источника.

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import { loadLayout } from '@/lib/blocks/queries';
import { getPageWorkspaceScope, getWorkspaceScope } from '@/lib/workspaces/active';
import { isSharedPageKey } from '@/lib/workspaces/scope';
import type { BlockInstance } from '@/lib/blocks/types';
import {
  blockToImportTable,
  isImportableSource,
  summarizeSource,
} from '@/lib/unit-economics/import/block-to-table';

export const runtime = 'nodejs';

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Главная',
  cashflow: 'Кэшфлоу',
  inbox: 'Входящие',
  'marketplaces-ozon-dashboard': 'Аналитика Ozon',
  'unit-economics-ozon': 'Юнит-экономика · Ozon',
  'unit-economics-ozon-multi': 'Юнит-экономика · Ozon мульти',
  'unit-economics-yandex': 'Юнит-экономика · Яндекс',
  'unit-economics-my-store': 'Юнит-экономика · Мой магазин',
  warehouse: 'Склад',
};

const TYPE_LABELS: Record<string, string> = {
  'unit.my-store-table': 'Мой магазин · таблица',
  sheet: 'Таблица',
  'custom.data': 'Данные',
  'unit.ozon-multi-table': 'Ozon · юнит-таблица',
};

function pageLabel(pageKey: string): string {
  if (PAGE_LABELS[pageKey]) return PAGE_LABELS[pageKey];
  if (pageKey.startsWith('board-')) return 'Доска';
  if (pageKey.startsWith('unit-economics-custom-')) {
    return `Юнит-экономика · ${pageKey.slice('unit-economics-custom-'.length)}`;
  }
  return pageKey;
}

function titleOf(block: BlockInstance): string {
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const title = block.appearance?.title ?? cfg.title;
  return typeof title === 'string' && title ? title : TYPE_LABELS[block.type] ?? block.type;
}

export async function GET() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Страницы АКТИВНОГО кабинета (+ общие 'board-*' из default) с сохранённым layout.
  const scope = await getWorkspaceScope(session.tenantId, session.userId);
  const allRows = await db
    .select({
      pageKey: blockLayouts.pageKey,
      blocks: blockLayouts.blocks,
      workspaceId: blockLayouts.workspaceId,
    })
    .from(blockLayouts)
    .where(
      and(
        eq(blockLayouts.tenantId, session.tenantId),
        eq(blockLayouts.userId, session.userId),
        inArray(blockLayouts.workspaceId, [scope.activeId, scope.defaultId]),
      ),
    );
  const rows = allRows.filter(
    (r) => r.workspaceId === scope.activeId || isSharedPageKey(r.pageKey),
  );

  const sources: Array<{
    blockId: string;
    pageKey: string;
    pageLabel: string;
    type: string;
    typeLabel: string;
    label: string;
    columnCount: number;
    rowCount: number;
  }> = [];

  for (const row of rows) {
    const blocks = (row.blocks ?? []) as BlockInstance[];
    for (const block of blocks) {
      if (!isImportableSource(block.type)) continue;
      const { columnCount, rowCount } = summarizeSource(block);
      if (rowCount === 0 && columnCount === 0) continue;
      sources.push({
        blockId: block.id,
        pageKey: row.pageKey,
        pageLabel: pageLabel(row.pageKey),
        type: block.type,
        typeLabel: TYPE_LABELS[block.type] ?? block.type,
        label: titleOf(block),
        columnCount,
        rowCount,
      });
    }
  }

  // Сортировка: больше данных — выше.
  sources.sort((a, b) => b.rowCount - a.rowCount);

  return NextResponse.json({ ok: true, sources });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const { sourceBlockId, sourcePageKey } = (body ?? {}) as {
    sourceBlockId?: string;
    sourcePageKey?: string;
  };
  if (!sourceBlockId || !sourcePageKey) {
    return NextResponse.json(
      { ok: false, error: 'sourceBlockId и sourcePageKey обязательны' },
      { status: 400 },
    );
  }

  // Источник импорта — страница АКТИВНОГО кабинета (cross-workspace запрещён).
  const scope = await getPageWorkspaceScope(
    session.tenantId,
    session.userId,
    sourcePageKey,
  );
  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: sourcePageKey,
    workspaceId: scope.workspaceId,
    workspaceTemplate: scope.template,
  });
  const block = layout.blocks.find((b) => b.id === sourceBlockId);
  if (!block) {
    return NextResponse.json({ ok: false, error: 'Блок-источник не найден' }, { status: 404 });
  }
  if (!isImportableSource(block.type)) {
    return NextResponse.json(
      { ok: false, error: 'Тип блока не поддерживается как источник' },
      { status: 400 },
    );
  }

  const table = blockToImportTable(block);
  if (!table) {
    return NextResponse.json({ ok: false, error: 'Не удалось прочитать данные блока' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, table });
}
