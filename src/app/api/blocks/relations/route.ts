// PURPOSE: GET /api/blocks/relations — лёгкий эндпоинт со связями между блоками.
// Возвращает карту всех страниц юзера с blockId, типом, label и УЖЕ распарсенными
// исходящими связями каждого блока (dependencies + @-refs из config).
// Используется BlockRelationsOverlay'ем для визуализации cross-page треугольничков
// (incoming/outgoing). НЕ вычисляет агрегаты — в отличие от /api/blocks/sources,
// который для UI-пикера дополнительно резолвит фактические значения полей.
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import { loadLayout } from '@/lib/blocks/queries';
import { getWorkspaceScope } from '@/lib/workspaces/active';
import { isSharedPageKey, pageWorkspaceScope } from '@/lib/workspaces/scope';
import type { BlockInstance } from '@/lib/blocks/types';

/** Парсит ref вида "blockId", "blockId.field", "pageKey:blockId.field". */
type ParsedRef = { pageKey: string | null; blockId: string; field: string };

const FORMULA_REF_RE = /@([A-Za-z0-9_.:-]+)/g;

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Главная',
  cashflow: 'Кэшфлоу',
  inbox: 'Входящие',
  deadlines: 'Дедлайны',
  taxes: 'Налоги',
  settings: 'Настройки',
  'unit-economics-ozon': 'Юнит · Ozon',
  'unit-economics-ozon-multi': 'Юнит · Ozon (мульти)',
  'unit-economics-yandex': 'Юнит · Яндекс',
  'unit-economics-my-store': 'Юнит · Мой магазин',
  warehouse: 'Склад',
};

const TYPE_LABELS: Record<string, string> = {
  'stat.income': 'Доходы',
  'stat.expense': 'Списания',
  'stat.balance': 'Баланс',
  'stat.custom': 'KPI',
  sheet: 'Таблица',
  'excel.cell': 'Ячейка',
  'custom.data': 'Данные',
  'computed.sum': 'Вычисление',
  'inbox.channel-feed': 'Каналы',
  'cashflow.top-categories': 'Топ категорий',
  'cashflow.transactions': 'Операции',
  'cashflow.chart': 'График',
  'navigate.card': 'Навигация',
  'ai.micro-agent': 'AI агент',
  'unit.ozon-calculator': 'Ozon · калькулятор',
  'unit.ozon-multi-table': 'Ozon · юнит-таблица',
  'unit.yandex-calculator': 'Яндекс · калькулятор',
  'unit.my-store-table': 'Мой магазин',
  'stock.balances': 'Склад · Остатки',
  'stock.docs': 'Склад · Документы',
};

const DEFAULT_PAGE_KEYS = [
  'dashboard',
  'cashflow',
  'inbox',
  'unit-economics-ozon',
  'unit-economics-ozon-multi',
  'unit-economics-yandex',
  'unit-economics-my-store',
  'warehouse',
];

function pageLabel(pageKey: string): string {
  if (PAGE_LABELS[pageKey]) return PAGE_LABELS[pageKey];
  if (pageKey.startsWith('board-')) return 'Доска';
  return pageKey;
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function parseRef(ref: string): ParsedRef {
  const colon = ref.lastIndexOf(':');
  const pageKey = colon >= 0 ? ref.slice(0, colon) : null;
  const tail = colon >= 0 ? ref.slice(colon + 1) : ref;
  const dot = tail.lastIndexOf('.');
  const blockId = dot >= 0 ? tail.slice(0, dot) : tail;
  const field = dot >= 0 ? tail.slice(dot + 1) : 'value';
  return { pageKey, blockId, field };
}

/**
 * Вытаскивает все @-refs из произвольного config-а блока.
 * Поддерживает как строковые шаблоны (excel.cell.value = "=A1+@blockX"),
 * так и явный объект `blockRefs` (используется в excel.cell для bindings).
 */
function collectRefsFromConfig(config: Record<string, unknown> | undefined): ParsedRef[] {
  if (!config) return [];
  const refs = new Set<string>();

  function scan(value: unknown, depth: number) {
    if (depth > 5 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      let m: RegExpExecArray | null;
      FORMULA_REF_RE.lastIndex = 0;
      while ((m = FORMULA_REF_RE.exec(value)) !== null) refs.add(m[1]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => scan(item, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.blockRefs === 'object' && obj.blockRefs !== null) {
        Object.keys(obj.blockRefs as Record<string, unknown>).forEach((k) => refs.add(k));
      }
      Object.entries(obj).forEach(([key, item]) => {
        if (key === 'moneyRefs') return;
        scan(item, depth + 1);
      });
    }
  }

  scan(config, 0);
  return Array.from(refs).map(parseRef);
}

/**
 * Собирает исходящие связи блока:
 *  - Из block.dependencies.sources (явные, у computed-блоков)
 *  - Из @-refs внутри config (excel.cell, custom.data, формулы)
 * Возвращает дедуплицированный список (pageKey, blockId, field).
 */
function blockOutgoingRefs(
  block: BlockInstance,
  ownPageKey: string,
): Array<{ pageKey: string; blockId: string; field: string }> {
  const seen = new Set<string>();
  const out: Array<{ pageKey: string; blockId: string; field: string }> = [];

  function add(pageKey: string, blockId: string, field: string) {
    if (blockId === block.id && pageKey === ownPageKey) return; // self
    const key = `${pageKey}:${blockId}.${field}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ pageKey, blockId, field });
  }

  for (const src of block.dependencies?.sources ?? []) {
    add(src.pageKey ?? ownPageKey, src.blockId, src.field ?? 'value');
  }

  for (const ref of collectRefsFromConfig(block.config)) {
    add(ref.pageKey ?? ownPageKey, ref.blockId, ref.field);
  }

  return out;
}

type RelationBlock = {
  blockId: string;
  type: string;
  typeLabel: string;
  label: string;
  /** Исходящие связи: куда этот блок ссылается (после нормализации pageKey) */
  outgoing: Array<{ pageKey: string; blockId: string; field: string }>;
};

type RelationPage = {
  pageKey: string;
  pageLabel: string;
  blocks: RelationBlock[];
};

export async function GET() {
  try {
    const session = await auth();
    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const tenantId = session.tenantId;
    const userId = session.userId;

    // Берём все pageKey из дефолтов + те, что юзер уже сохранил В АКТИВНОМ кабинете
    // (+ ОБЩИЕ 'board-*' из default-кабинета) — cross-workspace связей не бывает.
    const scope = await getWorkspaceScope(tenantId, userId);
    const savedRows = await db
      .select({ pageKey: blockLayouts.pageKey, workspaceId: blockLayouts.workspaceId })
      .from(blockLayouts)
      .where(
        and(
          eq(blockLayouts.tenantId, tenantId),
          eq(blockLayouts.userId, userId),
          inArray(blockLayouts.workspaceId, [scope.activeId, scope.defaultId]),
        ),
      );
    const saved = savedRows.filter(
      (r) => r.workspaceId === scope.activeId || isSharedPageKey(r.pageKey),
    );
    const pageKeys: string[] = Array.from(
      new Set([...DEFAULT_PAGE_KEYS, ...saved.map((r) => r.pageKey)]),
    );

    const pages: RelationPage[] = await Promise.all(
      pageKeys.map(async (pageKey) => {
        const pageScope = pageWorkspaceScope(scope, pageKey);
        const layout = await loadLayout({
          tenantId,
          userId,
          pageKey,
          workspaceId: pageScope.workspaceId,
          workspaceTemplate: pageScope.template,
        });
        const blocks: RelationBlock[] = layout.blocks.map((b) => ({
          blockId: b.id,
          type: b.type,
          typeLabel: typeLabel(b.type),
          label: String(b.appearance?.title ?? b.config?.title ?? typeLabel(b.type)),
          outgoing: blockOutgoingRefs(b, pageKey),
        }));
        return { pageKey, pageLabel: pageLabel(pageKey), blocks };
      }),
    );

    return NextResponse.json({ ok: true, pages });
  } catch (error) {
    console.error('[api/blocks/relations] GET failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
