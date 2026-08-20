// PURPOSE: Блок «Склад · Сроки годности» (stock.expiry) — партии с истекающим
// сроком со светофором и списанием в один клик
// (docs/STOCK_MODULE_DESIGN.md §7 блок 5). Для БАДов это главная окупаемость
// модуля: просрочка видна ДО того, как превратится в убыток.
//
// ЧТО ЗДЕСЬ ПРИНЦИПИАЛЬНО (а не «так получилось»):
//   • Строка = ПАРТИЯ, а не товар: срок годности живёт в stock_batches, и в
//     режиме avg только партия знает, что именно протухает.
//   • Списание идёт обычным документом /api/stock/docs
//     ({kind:'writeoff', reason:'expired', post:true}) — отдельной «проводки
//     партии» нет специально, иначе появился бы второй путь списания со своей
//     арифметикой. Списывается КОЛИЧЕСТВО товара, а партию выбирает движок по
//     lot_policy (§2.8). Поэтому AlertDialog показывает ИМЕННО ТУ партию,
//     которую заберёт политика, а не ту, на строке которой нажали: при FEFO это
//     самый ранний срок, при FIFO — самый ранний приход, и это разные партии.
//   • Оценка партии — по ТЕКУЩЕЙ себестоимости товара (override, иначе средняя):
//     именно она уйдёт в потери при списании (§4.4), и ровно так же считает
//     «Деньги в товаре» блок остатков. `stock_batches.unit_cost_kopecks` —
//     витринная цена прихода, схема помечает её «для оценки не используется».
//   • Подтверждение — только AlertDialog: нативный confirm() в проекте запрещён.
//   • docDate — moscowDateString(new Date()), а не локальные геттеры Date:
//     иначе документ уезжает в чужой календарный день (грабля Релиза 1).
//   • Горизонт персистится в config через onConfigChange — голый useState
//     тихо сбрасывается на дефолт при ре-рендере грида (грабля compareMode).
//   • Блок БЕЗ периода страницы: срок годности — свойство партии, а не окна
//     дат, поэтому usesPeriod не ставится.
//   • Деньги — копейки, публикуются с маркером __money (blocks.mdc).

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { CalendarClock, Loader2, PackageMinus, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { moscowDateString } from '@/lib/marketplaces/ozon/sync/perf-period';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import {
  KopecksRow,
  SettingsSection,
  SettingsSegmented,
  SettingsSliderRow,
} from '@/components/blocks/settings';
import { useFormatSettings } from '@/lib/format-settings';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { emitStockChanged, useStockChangedListener } from '@/lib/blocks/use-stock-changed';
import { formatMoney, stockFetch } from '@/components/stock/stock-api';
import type { StockExpiryResponse } from '@/app/api/stock/expiry/route';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';

/** Горизонты витрины. Больше 180 дней смысла нет: это уже не «скоро протухнет». */
const HORIZONS = [30, 60, 90, 180] as const;

export const StockExpiryConfigSchema = z.object({
  /** Сколько дней вперёд смотреть. Просроченное показывается всегда. */
  horizonDays: z
    .union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)])
    .default(90),
  /** Порог «красной зоны» в днях — до него партия критическая, после «скоро». */
  criticalDays: z.number().int().min(0).max(90).default(14),
  /** tri-state: true/false — настройка блока, null — глобальная (blocks.mdc). */
  showKopecks: z.boolean().nullable().default(null),
});

export type StockExpiryConfig = z.infer<typeof StockExpiryConfigSchema>;

function parseConfig(raw: unknown): StockExpiryConfig {
  return StockExpiryConfigSchema.parse(raw ?? {});
}

// Форма ответа берётся ИЗ РОУТА через `import type`: он стирается компилятором
// и серверный модуль в клиентский бандл не тянет (так же сделаны все
// unit-ozon-* блоки). Локальная копия типов молча расходилась бы с API при
// первой же правке — а расхождение здесь означает «поле есть, но undefined».
type ExpiryResponse = Omit<StockExpiryResponse, 'ok'>;
type ExpiryRow = ExpiryResponse['rows'][number];

/** Как назвать политику партий человеку: «FEFO» само по себе ничего не значит. */
const LOT_POLICY_LABEL: Record<string, string> = {
  fefo: 'FEFO (сначала самый ранний срок)',
  fifo: 'FIFO (сначала самый ранний приход)',
};

/** Светофор: rose — уже просрочено, amber — горит, muted — просто на радаре. */
const STATUS_STYLE: Record<string, string> = {
  expired: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  critical: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  soon: 'bg-muted text-muted-foreground',
  ok: 'bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<string, string> = {
  expired: 'просрочено',
  critical: 'горит',
  soon: 'скоро',
  ok: 'в норме',
};

/** Подсветка строки: просрочка должна быть видна периферийным зрением. */
const ROW_STYLE: Record<string, string> = {
  expired: 'bg-rose-50/50 dark:bg-rose-950/20',
  critical: 'bg-amber-50/50 dark:bg-amber-950/20',
  soon: '',
  ok: '',
};

function formatDate(iso: string): string {
  return iso.split('-').reverse().join('.');
}

/** «-3» читается хуже, чем «просрочено 3 дн.» — светофор должен объяснять себя. */
function formatDaysLeft(daysLeft: number): string {
  if (daysLeft < 0) return `просрочено ${Math.abs(daysLeft)} дн.`;
  if (daysLeft === 0) return 'сегодня';
  return `${daysLeft} дн.`;
}

function RenderStockExpiry({ instance, onConfigChange }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const { settings: globalSettings } = useFormatSettings();

  const configRef = useRef(config);
  configRef.current = config;
  const onConfigChangeRef = useRef(onConfigChange);
  onConfigChangeRef.current = onConfigChange;
  const patchConfig = useCallback((patch: Partial<StockExpiryConfig>) => {
    onConfigChangeRef.current?.({
      ...configRef.current,
      ...patch,
    } as unknown as Record<string, unknown>);
  }, []);

  const [data, setData] = useState<ExpiryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  useReportBlockLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ExpiryRow | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Персист выбора горизонта в config: голый useState сбросился бы на дефолт
  // при первом же ре-рендере грида (грабля compareMode в Ozon KPI). Когда
  // onConfigChange нет (превью в маркете блоков, карта связей), включается
  // локальная тень: фильтр работает, но не сохраняется. Тень НЕ используется
  // при наличии persist'а — иначе она навсегда замаскировала бы внешние правки
  // конфига (форма настроек, AI-tool update_block_config).
  const canPersist = Boolean(onConfigChange);
  const [uiHorizon, setUiHorizon] = useState<StockExpiryConfig['horizonDays'] | null>(
    null,
  );
  const horizonDays = canPersist ? config.horizonDays : (uiHorizon ?? config.horizonDays);

  const setHorizonDays = useCallback(
    (next: StockExpiryConfig['horizonDays']) => {
      if (canPersist) patchConfig({ horizonDays: next });
      else setUiHorizon(next);
    },
    [canPersist, patchConfig],
  );

  const criticalDays = config.criticalDays;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    // limit — потолок ВИТРИНЫ, а не расчёта: суммы и счётчики роут считает
    // агрегатом по всем партиям под фильтр и отдельно сообщает totalCount, так
    // что «Деньги под риском» от этой цифры больше не зависят.
    const params = new URLSearchParams({
      horizon: String(horizonDays),
      critical: String(criticalDays),
      limit: '300',
    });
    const res = await stockFetch<ExpiryResponse>(`/api/stock/expiry?${params}`);
    if (!mountedRef.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setData(res.data);
  }, [horizonDays, criticalDays]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Соседние блоки страницы «Склад» пишут в тот же журнал — после их документа
  // сроки годности обязаны перечитаться, иначе список партий врёт достоверно.
  useStockChangedListener(fetchData, instance.id);

  // Списание партии: обычный документ writeoff/expired, проводится сразу.
  // Дата — календарный день Москвы: локальные геттеры Date у пользователя
  // западнее UTC отправили бы документ во вчера, то есть в чужой период.
  const writeOff = useCallback(
    async (row: ExpiryRow) => {
      setBusyId(row.batchId);
      setError(null);
      const res = await stockFetch(`/api/stock/docs`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'writeoff',
          reason: 'expired',
          docDate: moscowDateString(new Date()),
          lines: [{ itemId: row.itemId, qty: row.qtyLeft }],
          post: true,
        }),
      });
      if (!mountedRef.current) return;
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      fetchData();
      // Списание меняет остаток, себестоимость и потери периода — соседние
      // блоки (остатки, документы, пробелы) обязаны это увидеть.
      emitStockChanged(instance.id);
    },
    [fetchData, instance.id],
  );

  // useMemo, а не `data?.rows ?? []`: голое выражение даёт новый массив каждый
  // рендер и пересобирает __aiContext (JSON.stringify) на каждый тик.
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const totals = data?.totals;

  /**
   * Партия, которую РЕАЛЬНО заберёт списание, — тот же порядок, что в
   * allocateLots (costing.ts): FEFO сортирует по сроку, затем по дате прихода и
   * id; FIFO — сразу по приходу. Раньше диалог утверждал, что спишется строка,
   * на которой нажали, — при клике по второй партии того же товара это была
   * прямая неправда, а при lot_policy='fifo' неправдой было и само «FEFO».
   *
   * Оговорка честная: партии без срока в блок не попадают, а движок их видит,
   * поэтому реальным получателем может оказаться и та, которой здесь нет, — об
   * этом сказано словами в самом диалоге.
   */
  const targetBatch = useMemo(() => {
    if (!confirm) return null;
    const policy = data?.lotPolicy ?? 'fefo';
    const sameItem = rows.filter((r) => r.itemId === confirm.itemId);
    if (sameItem.length === 0) return confirm;
    return sameItem.reduce((best, r) => {
      if (policy === 'fefo' && r.expiresAt !== best.expiresAt) {
        return r.expiresAt < best.expiresAt ? r : best;
      }
      if (r.receivedAt !== best.receivedAt) {
        return r.receivedAt < best.receivedAt ? r : best;
      }
      return r.batchId < best.batchId ? r : best;
    }, sameItem[0]);
  }, [confirm, rows, data?.lotPolicy]);

  // Снимок для ИИ: ровно то, что блок реально знает. Skill-промпт обещает
  // анализ только по этим полям — обещание без данных превращает ассистента
  // в генератор догадок.
  const aiContext = useMemo(
    () =>
      JSON.stringify({
        module: 'stock',
        block: 'stock.expiry',
        today: data?.today ?? null,
        horizonDays,
        criticalDays,
        // Суммы и счётчики — по ВСЕМ партиям под фильтр (агрегат в SQL),
        // независимо от того, сколько строк влезло в витрину.
        valueKopecks: totals?.valueKopecks ?? 0,
        valueIncludesExpired: true,
        expiredValueKopecks: totals?.expiredValueKopecks ?? 0,
        expiredCount: totals?.expiredCount ?? 0,
        criticalCount: totals?.criticalCount ?? 0,
        soonCount: totals?.soonCount ?? 0,
        qtyAtRisk: totals?.qtyLeft ?? 0,
        batchesTotal: data?.totalCount ?? 0,
        batchesShown: rows.length,
        rowsTruncated: data?.truncated ?? false,
        lotPolicy: data?.lotPolicy ?? 'fefo',
        // Партии товаров без известной себестоимости: их вклад в деньги — ноль,
        // и без этой цифры сумма выглядит полной, хотя занижена.
        noCostBatches: totals?.noCostCount ?? 0,
        // Топ-5 по деньгам под риском: с этого списка начинается любая акция
        // распродажи остатков, и именно его ИИ должен уметь назвать.
        topBatches: rows
          .slice()
          .sort((a, b) => b.valueKopecks - a.valueKopecks)
          .slice(0, 5)
          .map((r) => ({
            sku: r.sku,
            name: r.name,
            lot: r.lotNo ?? r.batchNumber,
            expiresAt: r.expiresAt,
            daysLeft: r.daysLeft,
            qtyLeft: r.qtyLeft,
            valueKopecks: r.valueKopecks,
            status: r.status,
          })),
      }),
    [rows, totals, data, horizonDays, criticalDays],
  );

  // Publisher ВЫШЕ early-returns (rules-of-hooks): при загрузке/ошибке
  // публикуем нули, а не пропускаем хук.
  useBlockValuePublisher(instance.id, {
    value: totals?.valueKopecks ?? 0,
    expiringValueKopecks: totals?.valueKopecks ?? 0,
    expiredValueKopecks: totals?.expiredValueKopecks ?? 0,
    expiredCount: totals?.expiredCount ?? 0,
    criticalCount: totals?.criticalCount ?? 0,
    soonCount: totals?.soonCount ?? 0,
    noCostCount: totals?.noCostCount ?? 0,
    label: instance.appearance?.title ?? 'Склад · Сроки годности',
    __money: 'value,expiringValueKopecks,expiredValueKopecks',
    __labels:
      // «Деньги под риском» ВКЛЮЧАЮТ просрочку — подпись обязана это сказать,
      // иначе в kpi.grid рядом встанут две суммы, которые пользователь сложит.
      'value=Деньги под риском (с просрочкой),' +
      'expiringValueKopecks=Деньги под риском (с просрочкой),' +
      'expiredValueKopecks=в том числе в просрочке,expiredCount=Просроченных партий,' +
      'criticalCount=Партий горит,soonCount=Партий на радаре,' +
      'noCostCount=Партий без себестоимости',
    __aiContext: aiContext,
  });

  // tri-state: настройка блока перекрывает глобальную (blocks.mdc / KopecksRow).
  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden p-0">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-2">
        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Select
          value={String(horizonDays)}
          onValueChange={(v) =>
            setHorizonDays(Number(v) as StockExpiryConfig['horizonDays'])
          }
        >
          <SelectTrigger className="h-6 w-[110px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HORIZONS.map((h) => (
              <SelectItem key={h} value={String(h)}>
                {h} дней
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {totals && totals.expiredCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900">
            просрочено: {totals.expiredCount} ·{' '}
            {formatMoney(totals.expiredValueKopecks, showKopecks)} ₽
          </span>
        )}
        {totals && totals.criticalCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900">
            горит: {totals.criticalCount}
          </span>
        )}
        {totals && totals.noCostCount > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            title="У этих партий не известна себестоимость товара — в «деньгах под риском» они считаются нулём. Это не «бесплатно»: заполните цену закупки в блоке «Склад · Пробелы»."
          >
            без цены: {totals.noCostCount}
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="mr-1 text-[11px] tabular-nums text-muted-foreground">
            Деньги под риском: {formatMoney(totals?.valueKopecks ?? 0, showKopecks)} ₽
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5"
            onClick={fetchData}
            title="Обновить"
          >
            <RefreshCw className={'h-3 w-3' + (loading ? ' animate-spin' : '')} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-border/40 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {!data ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            {loading ? 'Загрузка…' : 'Нет данных'}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-[12px] text-muted-foreground">
              Партий с близким сроком нет: ближайшие {horizonDays} дней ничего не
              истекает.
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              Срок берётся из партий поставки — если он не заполнялся при приёмке,
              товар сюда не попадёт.
            </p>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            {/* Sticky-заголовок: bg-card (не /50, не blur), isolate, z-45 —
                blocks.mdc §Sticky cells. На полупрозрачном фоне строки
                просвечивают сквозь шапку при скролле. */}
            <thead className="sticky top-0 z-[45] isolate bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-2 py-1.5 text-left font-medium">Товар</th>
                <th className="px-2 py-1.5 text-left font-medium">Партия</th>
                <th className="px-2 py-1.5 text-left font-medium">Годен до</th>
                <th className="px-2 py-1.5 text-right font-medium">Осталось</th>
                <th className="px-2 py-1.5 text-right font-medium">Штук</th>
                <th className="px-2 py-1.5 text-right font-medium">Стоимость</th>
                <th className="w-24 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row) => (
                <tr key={row.batchId} className={ROW_STYLE[row.status] ?? ''}>
                  <td className="min-w-0 px-2 py-1.5">
                    {/* flex + min-w-0 внутри ячейки, а не на самой <td>:
                        display:flex на ячейке ломает раскладку таблицы. */}
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{row.name || row.sku}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {row.sku}
                      </span>
                    </div>
                  </td>
                  <td className="min-w-0 px-2 py-1.5 text-muted-foreground">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-[11px]">
                        {row.batchNumber ?? row.lotNo ?? '—'}
                      </span>
                      {row.supplier && (
                        <span className="truncate text-[10px]">{row.supplier}</span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                    {formatDate(row.expiresAt)}
                    {row.isEstimated && (
                      <span
                        className="ml-1 text-[9px] text-muted-foreground"
                        title="Срок проставлен оценкой, а не из документа поставки"
                      >
                        ≈
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <span
                      className={
                        'rounded px-1.5 py-0.5 text-[10px] tabular-nums ' +
                        (STATUS_STYLE[row.status] ?? '')
                      }
                      title={STATUS_LABEL[row.status] ?? row.status}
                    >
                      {formatDaysLeft(row.daysLeft)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {row.qtyLeft.toLocaleString('ru-RU')}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    title={
                      `Оценка по текущей себестоимости: ${formatMoney(row.unitCostKopecks, true)} ₽/шт. ` +
                      `Цена прихода этой партии: ${formatMoney(row.batchUnitCostKopecks, true)} ₽/шт`
                    }
                  >
                    {formatMoney(row.valueKopecks, showKopecks)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {busyId === row.batchId ? (
                      <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-destructive"
                        title="Списать: создаст проведённый документ списания по причине «просрочка»"
                        onClick={() => setConfirm(row)}
                      >
                        <PackageMinus className="h-3.5 w-3.5" /> Списать
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* Усечение витрины — словами. Суммы в шапке при этом ПОЛНЫЕ: они
            считаются агрегатом по всем партиям, а не по показанным строкам. */}
        {data?.truncated && (
          <div className="border-t border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            Показаны первые {rows.length} партий из{' '}
            {data.totalCount.toLocaleString('ru-RU')} — сортировка по сроку, поэтому
            вверху самое срочное. Суммы и счётчики в шапке посчитаны по всем партиям.
          </div>
        )}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Списать партию по просрочке?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && (
                <>
                  Будет создан документ списания на {confirm.qtyLeft.toLocaleString('ru-RU')}{' '}
                  шт. товара «{confirm.name || confirm.sku}» с причиной «просрочка» на{' '}
                  {formatMoney(confirm.valueKopecks, showKopecks)} ₽ (по текущей
                  себестоимости — именно она уйдёт в потери).{' '}
                  {targetBatch && targetBatch.batchId !== confirm.batchId ? (
                    <>
                      <b>Списывается КОЛИЧЕСТВО, а не эта строка.</b> При политике партий{' '}
                      {LOT_POLICY_LABEL[data?.lotPolicy ?? 'fefo']} движок заберёт штуки из
                      партии «{targetBatch.batchNumber ?? targetBatch.lotNo ?? 'без номера'}»
                      (годен до {formatDate(targetBatch.expiresAt)}, приход{' '}
                      {formatDate(targetBatch.receivedAt)}) — это ДРУГАЯ партия, не та, на
                      строке которой вы нажали.
                    </>
                  ) : (
                    <>
                      Списывается КОЛИЧЕСТВО, а не конкретная строка: при политике партий{' '}
                      {LOT_POLICY_LABEL[data?.lotPolicy ?? 'fefo']} движок заберёт штуки
                      именно из этой партии (годен до {formatDate(confirm.expiresAt)}).
                    </>
                  )}{' '}
                  Если у товара есть партии без указанного срока — в этот список они не
                  попадают, но движок их видит и при FIFO может взять их первыми.
                  Документ проводится сразу, остатки и себестоимость пересчитываются. Если
                  списали ошибочно — документ можно сторнировать в блоке «Склад ·
                  Документы», удалить проведённое нельзя.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                writeOff(confirm);
                setConfirm(null);
              }}
            >
              Списать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  const set = <K extends keyof StockExpiryConfig>(key: K, value: StockExpiryConfig[K]) =>
    onChange({ ...parsed, [key]: value } as unknown as Record<string, unknown>);

  return (
    <div className="space-y-4">
      <SettingsSection label="Горизонт">
        <SettingsSegmented
          value={String(parsed.horizonDays)}
          onChange={(v) =>
            set('horizonDays', Number(v) as StockExpiryConfig['horizonDays'])
          }
          options={HORIZONS.map((h) => ({ value: String(h), label: `${h} дн.` }))}
          cols={4}
        />
      </SettingsSection>

      <SettingsSection label="Светофор">
        <SettingsSliderRow
          label="Красная зона, дней"
          value={parsed.criticalDays}
          min={0}
          max={90}
          onChange={(v) => set('criticalDays', v)}
        />
        <KopecksRow value={parsed.showKopecks} onChange={(v) => set('showKopecks', v)} />
      </SettingsSection>
    </div>
  );
}

export const StockExpiryBlock: BlockDef = {
  type: 'stock.expiry',
  displayName: 'Склад · Сроки годности',
  description:
    'Партии с истекающим сроком годности: светофор «просрочено / горит / скоро», деньги под риском и списание в один клик документом с причиной «просрочка». Горизонт 30–180 дней, порог красной зоны настраивается. Публикует «Деньги под риском».',
  category: 'tables',
  icon: CalendarClock,
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 4, h: 4 },
  minContentSize: { w: 380, h: 180 },
  pages: ['warehouse', '*'],
  configSchema: StockExpiryConfigSchema,
  defaultConfig: () => StockExpiryConfigSchema.parse({}),
  SettingsForm,
  Render: RenderStockExpiry,
};
