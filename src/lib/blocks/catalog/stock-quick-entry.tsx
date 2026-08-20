// PURPOSE: Блок «Склад · Быстрый ввод» (stock.quick-entry) — главная цель
// модуля: заменить бумагу (docs/STOCK_MODULE_DESIGN.md §7 блок 3, §5).
// Четыре крупные кнопки на каждый день — Приход · Отгрузка · Списание ·
// Инвентаризация — и вторым рядом редкие операции: приёмка на складе
// маркетплейса, пересортица, возврат, импорт продаж WB / Яндекс.Маркета.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ БЛОК, А НЕ КНОПКИ В ЛЕНТЕ ДОКУМЕНТОВ: поставка вводится в
// момент приезда машины, а не когда человек дошёл до журнала. Блок ставится
// первым экраном раздела и держит одну задачу — «записать за 30 секунд».
//
// Сам ввод живёт в диалогах (они переиспользуются и из других блоков):
//   • stock-doc-dialog     — поступление, списание, возврат;
//   • stock-move-dialog    — отгрузка/перемещение, приёмка, пересортица,
//                            инвентаризация (у всех есть вторая сторона);
//   • sales-import-dialog  — продажи WB / ЯМ из файла (§12.3).
//
// Блок публикует «Закуплено сегодня» в КОПЕЙКАХ (__money) и счётчики дня —
// из них собирается плитка kpi.grid без отдельного KPI-блока (§7).

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ArrowRightLeft,
  ClipboardCheck,
  FileSpreadsheet,
  PackageMinus,
  PackagePlus,
  Repeat2,
  RotateCcw,
  Scale,
  Truck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SettingsSection, SettingsToggleRow, KopecksRow } from '@/components/blocks/settings';
import { useFormatSettings } from '@/lib/format-settings';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import {
  emitStockChanged,
  useStockChangedListener,
} from '@/lib/blocks/use-stock-changed';
import { moscowDateString } from '@/lib/marketplaces/ozon/sync/perf-period';
import {
  StockDocDialog,
  type StockDocKindUi,
} from '@/components/stock/stock-doc-dialog';
import {
  StockMoveDialog,
  type StockMoveKind,
} from '@/components/stock/stock-move-dialog';
import { SalesImportDialog } from '@/components/stock/sales-import-dialog';
import { formatMoney, stockFetch } from '@/components/stock/stock-api';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';

export const StockQuickEntryConfigSchema = z.object({
  /** Второй ряд — редкие операции. Можно спрятать, чтобы остались 4 кнопки. */
  showSecondary: z.boolean().default(true),
  /** Показывать итог дня («Закуплено сегодня», документов за день). */
  showTodayTotals: z.boolean().default(true),
  /** tri-state: true/false — настройка блока, null — глобальная (blocks.mdc). */
  showKopecks: z.boolean().nullable().default(null),
});

export type StockQuickEntryConfig = z.infer<typeof StockQuickEntryConfigSchema>;

function parseConfig(raw: unknown): StockQuickEntryConfig {
  return StockQuickEntryConfigSchema.parse(raw ?? {});
}

type DocsResponse = {
  rows: Array<{ id: string; status: 'draft' | 'posted' | 'void'; kind: string }>;
  totals: { purchasesKopecks: number; docsCount: number };
};

/** Сегодня по календарю Москвы — той же зоне, в которой фильтруется лента. */
function todayIso(): string {
  return moscowDateString(new Date());
}

// onConfigChange блоку не нужен: он ничего не персистит — все настройки живут в
// SettingsForm. Не деструктурируем, чтобы не держать «мёртвый» аргумент.
function RenderStockQuickEntry({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const { settings: globalSettings } = useFormatSettings();

  const [docKind, setDocKind] = useState<StockDocKindUi | null>(null);
  const [moveKind, setMoveKind] = useState<StockMoveKind | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [data, setData] = useState<DocsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  useReportBlockLoading(loading);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    const day = todayIso();
    setLoading(true);
    const res = await stockFetch<DocsResponse>(
      `/api/stock/docs?from=${day}&to=${day}&limit=200`,
    );
    if (!mountedRef.current) return;
    setLoading(false);
    if (res.ok) setData(res.data);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Итог дня меняется и от чужих действий (сторно в ленте документов,
  // списание из сроков годности) — слушаем общее событие журнала.
  useStockChangedListener(fetchData, instance.id);

  /**
   * Документ заведён → обновляем СЕБЯ и сообщаем остальным блокам страницы.
   * Раньше здесь стоял голый fetchData: соседние «Остатки», «Документы»,
   * «Сроки годности» и «Пробелы» продолжали показывать доновые цифры до F5 —
   * то есть выглядели достоверно и врали.
   */
  const onDocSaved = useCallback(() => {
    fetchData();
    emitStockChanged(instance.id);
  }, [fetchData, instance.id]);

  const draftsCount = useMemo(
    () => (data?.rows ?? []).filter((r) => r.status === 'draft').length,
    [data],
  );
  const purchasedTodayKopecks = data?.totals.purchasesKopecks ?? 0;
  const docsToday = data?.rows.length ?? 0;

  // Publisher ВЫШЕ early-returns (rules-of-hooks).
  useBlockValuePublisher(instance.id, {
    value: purchasedTodayKopecks,
    purchasedTodayKopecks,
    docsToday,
    draftsCount,
    label: instance.appearance?.title ?? 'Склад · Быстрый ввод',
    __money: 'value,purchasedTodayKopecks',
    __labels:
      'value=Закуплено сегодня,purchasedTodayKopecks=Закуплено сегодня,' +
      'docsToday=Документов за сегодня,draftsCount=Черновиков',
    __aiContext: JSON.stringify({
      module: 'stock',
      block: 'stock.quick-entry',
      date: todayIso(),
      purchasedTodayKopecks,
      docsToday,
      draftsCount,
    }),
  });

  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;

  const primary: Array<{
    label: string;
    hint: string;
    icon: typeof PackagePlus;
    onClick: () => void;
    accent?: boolean;
  }> = [
    {
      label: 'Приход',
      hint: 'Поставка от поставщика',
      icon: PackagePlus,
      onClick: () => setDocKind('purchase'),
      accent: true,
    },
    {
      label: 'Отгрузка',
      hint: 'Со своего склада в пути на маркетплейс',
      icon: Truck,
      onClick: () => setMoveKind('transfer'),
    },
    {
      label: 'Списание',
      hint: 'Просрочка, брак, образец — отдельной статьёй потерь',
      icon: PackageMinus,
      onClick: () => setDocKind('writeoff'),
    },
    {
      label: 'Инвентаризация',
      hint: 'Факт вводится только там, где разошлось',
      icon: Scale,
      onClick: () => setMoveKind('adjust'),
    },
  ];

  const secondary: Array<{
    label: string;
    hint: string;
    icon: typeof PackagePlus;
    onClick: () => void;
  }> = [
    {
      label: 'Приёмка',
      hint: 'Маркетплейс принял: недостача уйдёт в потери отдельной строкой',
      icon: ClipboardCheck,
      onClick: () => setMoveKind('accept'),
    },
    {
      label: 'Пересорт',
      hint: 'Один товар оказался другим: стоимость переезжает целиком',
      icon: Repeat2,
      onClick: () => setMoveKind('regrade'),
    },
    {
      label: 'Возврат',
      hint: 'Товар вернулся на свой склад',
      icon: RotateCcw,
      onClick: () => setDocKind('return_in'),
    },
    {
      label: 'Продажи WB / ЯМ',
      hint: 'Импорт файла выгрузки: без него остаток своего склада завышен',
      icon: FileSpreadsheet,
      onClick: () => setImportOpen(true),
    },
  ];

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden p-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[12px] font-medium">
          {instance.appearance?.title ?? 'Быстрый ввод'}
        </span>
        {config.showTodayTotals && (
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            сегодня: {formatMoney(purchasedTodayKopecks, showKopecks)} ₽ · {docsToday} док.
            {draftsCount > 0 && ` · ${draftsCount} черн.`}
          </span>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-2">
        <div className="grid min-w-0 grid-cols-2 gap-2">
          {primary.map((action) => (
            <Button
              key={action.label}
              variant={action.accent ? 'default' : 'outline'}
              className="h-auto min-w-0 flex-col items-start gap-0.5 whitespace-normal px-2.5 py-2 text-left"
              onClick={action.onClick}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium">
                <action.icon className="h-3.5 w-3.5 shrink-0" />
                {action.label}
              </span>
              <span
                className={
                  'min-w-0 text-[10px] font-normal leading-tight ' +
                  (action.accent ? 'opacity-80' : 'text-muted-foreground')
                }
              >
                {action.hint}
              </span>
            </Button>
          ))}
        </div>

        {config.showSecondary && (
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 border-t border-border/40 pt-2">
            {secondary.map((action) => (
              <Button
                key={action.label}
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[11px]"
                title={action.hint}
                onClick={action.onClick}
              >
                <action.icon className="h-3 w-3" /> {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <StockDocDialog
        open={docKind !== null}
        kind={docKind ?? 'purchase'}
        onClose={() => setDocKind(null)}
        onSaved={onDocSaved}
      />
      <StockMoveDialog
        open={moveKind !== null}
        kind={moveKind ?? 'transfer'}
        onClose={() => setMoveKind(null)}
        onSaved={onDocSaved}
      />
      <SalesImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={onDocSaved}
      />
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  const set = <K extends keyof StockQuickEntryConfig>(
    key: K,
    value: StockQuickEntryConfig[K],
  ) => onChange({ ...parsed, [key]: value } as unknown as Record<string, unknown>);

  return (
    <div className="space-y-4">
      <SettingsSection label="Кнопки">
        <SettingsToggleRow
          label="Редкие операции"
          description="Приёмка, пересорт, возврат и импорт продаж вторым рядом"
          checked={parsed.showSecondary}
          onCheckedChange={(v) => set('showSecondary', v)}
        />
        <SettingsToggleRow
          label="Итог дня"
          description="«Закуплено сегодня» и число документов в шапке блока"
          checked={parsed.showTodayTotals}
          onCheckedChange={(v) => set('showTodayTotals', v)}
        />
        <KopecksRow value={parsed.showKopecks} onChange={(v) => set('showKopecks', v)} />
      </SettingsSection>
    </div>
  );
}

export const StockQuickEntryBlock: BlockDef = {
  type: 'stock.quick-entry',
  displayName: 'Склад · Быстрый ввод',
  description:
    'Четыре кнопки на каждый день: приход, отгрузка, списание, инвентаризация. Вторым рядом — приёмка на складе маркетплейса, пересортица, возврат и импорт продаж WB / Яндекс.Маркета. Публикует «Закуплено сегодня».',
  category: 'tables',
  icon: PackagePlus,
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 3, h: 3 },
  minContentSize: { w: 260, h: 140 },
  pages: ['warehouse', '*'],
  configSchema: StockQuickEntryConfigSchema,
  defaultConfig: () => StockQuickEntryConfigSchema.parse({}),
  SettingsForm,
  Render: RenderStockQuickEntry,
};
