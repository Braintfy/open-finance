// PURPOSE: Блок «Склад · Остатки» (stock.balances) — главный экран модуля
// (docs/STOCK_MODULE_DESIGN.md §7 блок 1). Строка = товар; колонки = места:
// свой склад · в пути · Ozon FBO · Ozon FBS · WB · Яндекс · сайты · ИТОГО ·
// себестоимость · стоимость остатка · дней запаса.
//
// ЧТО ЗДЕСЬ ПРИНЦИПИАЛЬНО (а не «так получилось»):
//   • Таблица — UNION двух источников (§6.2): ledger-места считает наш журнал,
//     Ozon FBO/FBS отдаёт ozon_warehouse_stocks. Собственный расчётный остаток
//     на складах Ozon мы не ведём — расходиться нечему (§3).
//   • Группа «Не сопоставлено» — не украшение: пока позиция канала не сшита,
//     её продажи попадают в карантин, а не в «COGS = 0» (§1.10).
//   • Деньги — копейки, публикуются с маркером __money (blocks.mdc).
//   • Все хуки и useMemo — ВЫШЕ любых early-return (rules-of-hooks).

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  AlertTriangle,
  ClipboardList,
  Download,
  Link2,
  RefreshCw,
  Scale,
  Warehouse,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import {
  KopecksRow,
  SettingsSection,
  SettingsToggleRow,
} from '@/components/blocks/settings';
import { useFormatSettings } from '@/lib/format-settings';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { CostSourceDialog } from '@/components/stock/cost-source-dialog';
import { MatchingDialog } from '@/components/stock/matching-dialog';
import { OpeningDialog } from '@/components/stock/opening-dialog';
import { OzonImportDialog } from '@/components/stock/ozon-import-dialog';
import { formatMoney, stockFetch } from '@/components/stock/stock-api';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';

export const StockBalancesConfigSchema = z.object({
  /** Скрыть позиции с нулевым остатком везде. */
  hideZero: z.boolean().default(false),
  /** Показывать только «заканчивается» (ИТОГО <= min_qty). */
  onlyLow: z.boolean().default(false),
  /** Показывать колонки складов Ozon (FBO/FBS). */
  showExternal: z.boolean().default(true),
  /** Показывать «Дней запаса» (считается по заказам Ozon за 30 дней). */
  showDaysOfSupply: z.boolean().default(true),
  /** tri-state: true/false — настройка блока, null — глобальная (blocks.mdc). */
  showKopecks: z.boolean().nullable().default(null),
});

export type StockBalancesConfig = z.infer<typeof StockBalancesConfigSchema>;

function parseConfig(raw: unknown): StockBalancesConfig {
  return StockBalancesConfigSchema.parse(raw ?? {});
}

type PlaceRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  authority: string;
  externalSource: string | null;
  sortOrder: number;
};

type BalanceRow = {
  itemId: string;
  sku: string;
  name: string;
  brand: string | null;
  minQty: number;
  byPlace: Record<string, number>;
  byExternal: Record<string, number>;
  ledgerQty: number;
  totalQty: number;
  unitCostKopecks: number;
  isOverride: boolean;
  totalValueKopecks: number;
  ledgerValueKopecks: number;
  costBasis: string;
  salesPerDay: number;
  daysOfSupply: number | null;
  isLow: boolean;
  noCost: boolean;
};

type BalancesResponse = {
  places: PlaceRow[];
  rows: BalanceRow[];
  unmatched: Array<{ externalId: string; externalSku: string | null; qty: number }>;
  totals: {
    itemsCount: number;
    ledgerQty: number;
    totalQty: number;
    totalValueKopecks: number;
    ledgerValueKopecks: number;
    lowCount: number;
    noCostCount: number;
    unmatchedCount: number;
  };
};

/** Sticky-колонка «Товар»: bg-card (не /95, не blur), isolate, тень справа. */
const STICKY_BODY: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 30,
  boxShadow: '1px 0 0 0 var(--border)',
};
const STICKY_HEAD: React.CSSProperties = { ...STICKY_BODY, zIndex: 45 };
const STICKY_TOTALS: React.CSSProperties = { ...STICKY_BODY, zIndex: 36 };

function RenderStockBalances({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const { settings: globalSettings } = useFormatSettings();

  const [data, setData] = useState<BalancesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  useReportBlockLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'import' | 'match' | 'opening' | 'cost' | null>(
    null,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (config.onlyLow) params.set('onlyLow', '1');
    if (config.hideZero) params.set('hideZero', '1');
    const res = await stockFetch<BalancesResponse>(`/api/stock/balances?${params}`);
    if (!mountedRef.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setData(res.data);
  }, [config.onlyLow, config.hideZero]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Колонки ledger-мест: только те, где реально что-то лежит (или это свой склад),
  // иначе девять встроенных мест распирают таблицу пустотой.
  const ledgerPlaces = useMemo(() => {
    const places = (data?.places ?? []).filter((p) => p.authority === 'ledger');
    const used = new Set<string>();
    for (const row of data?.rows ?? []) {
      for (const [placeId, qty] of Object.entries(row.byPlace)) {
        if (qty !== 0) used.add(placeId);
      }
    }
    return places.filter((p) => p.code === 'own' || used.has(p.id));
  }, [data]);

  const externalSources = useMemo(() => {
    if (!config.showExternal) return [] as string[];
    const found = new Set<string>();
    for (const row of data?.rows ?? []) {
      for (const [source, qty] of Object.entries(row.byExternal)) {
        if (qty !== 0) found.add(source);
      }
    }
    return Array.from(found).sort();
  }, [data, config.showExternal]);

  const totals = data?.totals;

  // Publisher ВЫШЕ early-returns (rules-of-hooks): при загрузке/ошибке
  // публикуем нули, а не пропускаем хук.
  useBlockValuePublisher(instance.id, {
    value: totals?.totalValueKopecks ?? 0,
    stockValueKopecks: totals?.totalValueKopecks ?? 0,
    ledgerValueKopecks: totals?.ledgerValueKopecks ?? 0,
    itemsCount: totals?.itemsCount ?? 0,
    totalQty: totals?.totalQty ?? 0,
    lowCount: totals?.lowCount ?? 0,
    noCostCount: totals?.noCostCount ?? 0,
    unmatchedCount: totals?.unmatchedCount ?? 0,
    label: instance.appearance?.title ?? 'Склад · Остатки',
    __money: 'value,stockValueKopecks,ledgerValueKopecks',
    __labels:
      'value=Деньги в товаре (всего),stockValueKopecks=Деньги в товаре (всего),' +
      'ledgerValueKopecks=Деньги на своём складе,itemsCount=Позиций,' +
      'totalQty=Штук всего,lowCount=Заканчивается,noCostCount=Без себестоимости,' +
      'unmatchedCount=Не сопоставлено',
    __aiContext: JSON.stringify({
      module: 'stock',
      block: 'stock.balances',
      itemsCount: totals?.itemsCount ?? 0,
      lowCount: totals?.lowCount ?? 0,
      noCostCount: totals?.noCostCount ?? 0,
      unmatchedCount: totals?.unmatchedCount ?? 0,
      // Топ-5 «горит» — этого хватает ИИ, чтобы дать осмысленный совет по закупке.
      lowItems: (data?.rows ?? [])
        .filter((r) => r.isLow)
        .slice(0, 5)
        .map((r) => ({ sku: r.sku, name: r.name, qty: r.totalQty, days: r.daysOfSupply })),
      // Неликвид: остаток есть, продаж нет. Без этих строк skill-промпт обещал
      // анализ, которого ИИ физически не мог сделать (см. block-skills/stock.ts).
      deadStock: (data?.rows ?? [])
        .filter((r) => r.totalQty > 0 && r.salesPerDay === 0)
        .sort((a, b) => b.totalValueKopecks - a.totalValueKopecks)
        .slice(0, 5)
        .map((r) => ({ sku: r.sku, name: r.name, qty: r.totalQty, valueKopecks: r.totalValueKopecks })),
      // Что сопоставить первым — по остатку канала, который висит в карантине.
      unmatchedTop: (data?.unmatched ?? [])
        .slice()
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5)
        .map((u) => ({ externalId: u.externalId, qty: u.qty })),
      noCostItems: (data?.rows ?? [])
        .filter((r) => r.noCost)
        .slice(0, 5)
        .map((r) => ({ sku: r.sku, name: r.name, qty: r.totalQty })),
    }),
  });

  // tri-state: настройка блока перекрывает глобальную (blocks.mdc / KopecksRow).
  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden p-0">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Warehouse className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {totals
              ? `${totals.itemsCount} позиций · ${formatMoney(totals.totalValueKopecks, showKopecks)} ₽ в товаре`
              : 'Остатки склада'}
          </span>
          {totals && totals.lowCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900">
              <AlertTriangle className="h-2.5 w-2.5" />
              заканчивается: {totals.lowCount}
            </span>
          )}
          {totals && totals.unmatchedCount > 0 && (
            <button
              type="button"
              onClick={() => setDialog('match')}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900"
              title="Позиции канала без сшивки: их продажи не получают себестоимость"
            >
              <Link2 className="h-2.5 w-2.5" />
              не сопоставлено: {totals.unmatchedCount}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={fetchData} title="Обновить">
            <RefreshCw className={'h-3 w-3' + (loading ? ' animate-spin' : '')} />
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setDialog('import')}>
            <Download className="h-3 w-3" /> Из Ozon
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setDialog('match')}>
            <Link2 className="h-3 w-3" /> Сопоставить
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setDialog('opening')}>
            <ClipboardList className="h-3 w-3" /> Остатки
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setDialog('cost')}>
            <Scale className="h-3 w-3" /> Себестоимость
          </Button>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {error ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
            {error}
          </div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            {loading ? 'Загрузка…' : 'Нет данных'}
          </div>
        ) : data.rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[12px] text-muted-foreground">
              Номенклатуры пока нет. Начните с импорта товаров из Ozon — артикулы и
              сшивка с каналом заведутся автоматически.
            </p>
            <Button size="sm" onClick={() => setDialog('import')}>
              <Download className="h-3.5 w-3.5" /> Импортировать из Ozon
            </Button>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th
                  className="isolate overflow-hidden bg-card px-2 py-1.5 text-left font-medium"
                  style={STICKY_HEAD}
                >
                  Товар
                </th>
                {ledgerPlaces.map((p) => (
                  <th key={p.id} className="whitespace-nowrap bg-card px-2 py-1.5 text-right font-medium">
                    {p.name}
                  </th>
                ))}
                {externalSources.map((s) => (
                  <th key={s} className="whitespace-nowrap bg-card px-2 py-1.5 text-right font-medium">
                    Ozon {s}
                  </th>
                ))}
                <th className="bg-card px-2 py-1.5 text-right font-medium">Итого</th>
                <th className="bg-card px-2 py-1.5 text-right font-medium">Себест.</th>
                <th className="bg-card px-2 py-1.5 text-right font-medium">Стоимость</th>
                {config.showDaysOfSupply && (
                  <th className="bg-card px-2 py-1.5 text-right font-medium">Дней</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.itemId} className={row.isLow ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}>
                  <td
                    className="isolate overflow-hidden border-t border-border/40 bg-card px-2 py-1.5"
                    style={STICKY_BODY}
                  >
                    {/* flex + min-w-0 внутри ячейки, а не на самой <td>:
                        display:flex на ячейке ломает раскладку таблицы. */}
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{row.name || row.sku}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {row.sku}
                        {row.noCost && ' · нет себестоимости'}
                        {row.costBasis === 'mixed' && ' · смешанный НДС'}
                      </span>
                    </div>
                  </td>
                  {ledgerPlaces.map((p) => (
                    <td
                      key={p.id}
                      className="border-t border-border/40 px-2 py-1.5 text-right tabular-nums"
                    >
                      {(row.byPlace[p.id] ?? 0).toLocaleString('ru-RU')}
                    </td>
                  ))}
                  {externalSources.map((s) => (
                    <td
                      key={s}
                      className="border-t border-border/40 px-2 py-1.5 text-right tabular-nums text-muted-foreground"
                    >
                      {(row.byExternal[s] ?? 0).toLocaleString('ru-RU')}
                    </td>
                  ))}
                  <td className="border-t border-border/40 px-2 py-1.5 text-right font-medium tabular-nums">
                    {row.totalQty.toLocaleString('ru-RU')}
                  </td>
                  <td className="border-t border-border/40 px-2 py-1.5 text-right tabular-nums">
                    {row.unitCostKopecks > 0 ? formatMoney(row.unitCostKopecks, showKopecks) : '—'}
                    {row.isOverride && (
                      <span className="ml-1 text-[9px] text-muted-foreground" title="Ручной override себестоимости">
                        ✎
                      </span>
                    )}
                  </td>
                  <td className="border-t border-border/40 px-2 py-1.5 text-right tabular-nums">
                    {formatMoney(row.totalValueKopecks, showKopecks)}
                  </td>
                  {config.showDaysOfSupply && (
                    <td
                      className={
                        'border-t border-border/40 px-2 py-1.5 text-right tabular-nums ' +
                        (row.daysOfSupply != null && row.daysOfSupply <= 14
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-muted-foreground')
                      }
                    >
                      {row.daysOfSupply ?? '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="text-[11px] font-medium">
              <tr>
                <td
                  className="isolate overflow-hidden border-t border-border bg-card px-2 py-1.5"
                  style={STICKY_TOTALS}
                >
                  Итого
                </td>
                {ledgerPlaces.map((p) => (
                  <td key={p.id} className="border-t border-border bg-card px-2 py-1.5 text-right tabular-nums">
                    {data.rows
                      .reduce((s, r) => s + (r.byPlace[p.id] ?? 0), 0)
                      .toLocaleString('ru-RU')}
                  </td>
                ))}
                {externalSources.map((s) => (
                  <td key={s} className="border-t border-border bg-card px-2 py-1.5 text-right tabular-nums">
                    {data.rows
                      .reduce((sum, r) => sum + (r.byExternal[s] ?? 0), 0)
                      .toLocaleString('ru-RU')}
                  </td>
                ))}
                <td className="border-t border-border bg-card px-2 py-1.5 text-right tabular-nums">
                  {data.totals.totalQty.toLocaleString('ru-RU')}
                </td>
                <td className="border-t border-border bg-card px-2 py-1.5" />
                <td className="border-t border-border bg-card px-2 py-1.5 text-right tabular-nums">
                  {formatMoney(data.totals.totalValueKopecks, showKopecks)}
                </td>
                {config.showDaysOfSupply && (
                  <td className="border-t border-border bg-card px-2 py-1.5" />
                )}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <OzonImportDialog
        open={dialog === 'import'}
        onClose={() => setDialog(null)}
        onDone={fetchData}
      />
      <MatchingDialog
        open={dialog === 'match'}
        onClose={() => setDialog(null)}
        onDone={fetchData}
      />
      <OpeningDialog
        open={dialog === 'opening'}
        onClose={() => setDialog(null)}
        onSaved={fetchData}
      />
      <CostSourceDialog
        open={dialog === 'cost'}
        onClose={() => setDialog(null)}
        onDone={fetchData}
      />
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  const set = <K extends keyof StockBalancesConfig>(
    key: K,
    value: StockBalancesConfig[K],
  ) => onChange({ ...parsed, [key]: value } as unknown as Record<string, unknown>);

  return (
    <div className="space-y-4">
      <SettingsSection label="Фильтры">
        <SettingsToggleRow
          label="Только «заканчивается»"
          description="Показывать позиции, где остаток опустился до минимального"
          checked={parsed.onlyLow}
          onCheckedChange={(v) => set('onlyLow', v)}
        />
        <SettingsToggleRow
          label="Скрыть нулевые"
          description="Не показывать товары, которых нет нигде"
          checked={parsed.hideZero}
          onCheckedChange={(v) => set('hideZero', v)}
        />
      </SettingsSection>

      <SettingsSection label="Колонки">
        <SettingsToggleRow
          label="Склады Ozon"
          description="FBO и FBS — остаток отдаёт Ozon, журнал его не ведёт"
          checked={parsed.showExternal}
          onCheckedChange={(v) => set('showExternal', v)}
        />
        <SettingsToggleRow
          label="Дней запаса"
          description="Считается по заказам Ozon за последние 30 дней"
          checked={parsed.showDaysOfSupply}
          onCheckedChange={(v) => set('showDaysOfSupply', v)}
        />
        <KopecksRow value={parsed.showKopecks} onChange={(v) => set('showKopecks', v)} />
      </SettingsSection>
    </div>
  );
}

export const StockBalancesBlock: BlockDef = {
  type: 'stock.balances',
  displayName: 'Склад · Остатки',
  description:
    'Остатки по всем местам: свой склад, в пути, Ozon FBO/FBS, сайты. Себестоимость, стоимость остатка, дни запаса и подсветка «пора закупать». Отсюда же импорт номенклатуры, сопоставление с каналом и перевод себестоимости на склад.',
  category: 'tables',
  icon: Warehouse,
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 6, h: 5 },
  minContentSize: { w: 420, h: 200 },
  pages: ['warehouse', '*'],
  configSchema: StockBalancesConfigSchema,
  defaultConfig: () => StockBalancesConfigSchema.parse({}),
  SettingsForm,
  Render: RenderStockBalances,
};
