// PURPOSE: Single-product калькулятор Ozon юнит-экономики.
// Слева панель ввода, справа метрики и P&L. Multi-cluster выбор складов FBS
// с долями (%) — соответствует референсу синий-рассвет.рф.
'use client';

import { useCallback, useMemo, useState } from 'react';
import { Calculator, Search } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps } from '../types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LinkableNumberCell } from '@/components/unit-economics/linkable-number-cell';
import { DropdownSelect } from '@/components/unit-economics/dropdown-select';
import { ClusterSelector } from '@/components/unit-economics/cluster-selector';
import { OzonSyncButton } from '@/components/unit-economics/ozon-sync-button';
import { OzonProductPickerDialog } from '@/components/unit-economics/ozon-product-picker-dialog';
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { resolveBindingValue } from '@/lib/unit-economics/bindings';
import type {
  OzonInputs,
  UnitCellBinding,
  OzonFbsDropoffPoint,
  OzonFbsShipmentSpeed,
  OzonFbsClusterShare,
  TaxMode,
} from '@/lib/unit-economics/types';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { calculateOzon, OZON_DEFAULT_INPUTS } from '@/lib/unit-economics/ozon/calculate';
import {
  OZON_TARIFF_VERSION,
  FBS_DROPOFF_LABELS,
  FBS_SHIPMENT_SPEED_LABELS,
  FBS_CLUSTER_BY_KEY,
} from '@/lib/unit-economics/ozon/tariffs-2026-08-30';
import {
  FBS_DROPOFF_OPTIONS,
  FBO_ACCEPTANCE_HINT,
  LOCAL_CLUSTER_HINT,
  LOCALITY_DISCOUNT_HINT,
  LOCALITY_DISCOUNT_LABEL,
  fbsSpeedOptions,
  normalizeFbsSpeed,
  paymentDeferralOptions,
  remapFbsSpeed,
} from '@/lib/unit-economics/ozon/fbs-ui-options';
import { migrateOzonRaw } from '@/lib/unit-economics/ozon/migrate';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';

const ConfigSchema = z.object({
  title: z.string().default('Ozon · юнит-калькулятор'),
  inputs: z.record(z.string(), z.unknown()).default({}),
  bindings: z.record(z.string(), z.unknown()).default({}),
});
type Config = z.infer<typeof ConfigSchema>;

function parseConfig(raw: unknown): Config {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  const cfg = parsed.success ? parsed.data : ConfigSchema.parse({});
  // Backward-compat миграция «сырых» inputs (fbsWarehouse, nds, taxDeductExpenses).
  return { ...cfg, inputs: migrateOzonRaw(cfg.inputs as Record<string, unknown>) };
}

const SECTIONS: Array<{
  title: string;
  fields: Array<{
    key: keyof OzonInputs;
    label: string;
    unit?: string;
    money?: boolean;
    min?: number;
    max?: number;
  }>;
}> = [
  {
    title: 'Товар и цена',
    fields: [
      { key: 'price', label: 'Цена до скидки', unit: '₽', money: true },
      { key: 'discountPct', label: 'Скидка', unit: '%', max: 100 },
      { key: 'cost', label: 'Себестоимость', unit: '₽', money: true },
      { key: 'crossDockingCost', label: 'Кросс-докинг', unit: '₽', money: true },
      { key: 'volumeL', label: 'Объём', unit: 'л' },
    ],
  },
  {
    title: 'Комиссия и оплата',
    fields: [
      { key: 'commissionPct', label: 'Комиссия категории', unit: '%' },
      { key: 'extraCommissionPct', label: 'Доп. комиссия', unit: '%' },
      { key: 'acquiringPct', label: 'Эквайринг', unit: '%' },
    ],
  },
  {
    title: 'Логистика (FBO)',
    fields: [
      { key: 'deliveryPvzPct', label: 'Доставка ПВЗ', unit: '%' },
      { key: 'deliveryPvzCap', label: 'Лимит ПВЗ', unit: '₽' },
    ],
  },
  {
    title: 'Возвраты и отмены',
    fields: [
      { key: 'returnsPct', label: '% возвратов', unit: '%', max: 100 },
      { key: 'cancelPct', label: '% отмен', unit: '%', max: 100 },
      { key: 'returnProcessing', label: 'Обработка возврата', unit: '₽' },
    ],
  },
  {
    title: 'Реклама и соинвест',
    fields: [
      { key: 'drrPct', label: 'ДРР', unit: '%' },
      // Соинвест/СПП — скидка ЗА СЧЁТ Ozon: снижает только цену для покупателя
      // и налоговую базу, прибыль продавца не увеличивает.
      { key: 'coInvestPct', label: 'Соинвест Ozon (СПП)', unit: '%', max: 100 },
      { key: 'overheadPerUnit', label: 'Прочие расходы', unit: '₽', money: true },
    ],
  },
  {
    title: 'Налоги',
    fields: [
      { key: 'taxRatePct', label: 'Ставка налога', unit: '%', max: 100 },
      { key: 'vatPct', label: 'НДС', unit: '%', max: 100 },
    ],
  },
  {
    title: 'Оборачиваемость и расходы',
    fields: [
      { key: 'salesPerMonth', label: 'Продаж/мес', unit: 'шт' },
      { key: 'batchSize', label: 'Партия', unit: 'шт' },
      { key: 'stock', label: 'Остаток', unit: 'шт' },
      { key: 'supplyLeadWeeks', label: 'Лог. плечо', unit: 'нед' },
      { key: 'indirectExpensesMonth', label: 'Косвенные', unit: '₽/мес', money: true },
    ],
  },
];

// Соинвеста/СПП здесь НЕТ намеренно: скидка идёт за счёт Ozon, в прибыль
// продавца не входит (до тарифов ozon_2026_08_30 строка «Соинвест Ozon»
// показывалась со знаком «+» и завышала итог). Справочные «цена с СПП» и
// «экономия покупателя» выводятся отдельным блоком под P&L.
const PNL_LINES: Array<{ key: keyof ReturnType<typeof calculateOzon>; label: string; sign?: '+' | '-' }> = [
  { key: 'buyerPrice', label: 'Выручка продавца', sign: '+' },
  { key: 'commission', label: 'Комиссия Ozon', sign: '-' },
  { key: 'acquiring', label: 'Эквайринг', sign: '-' },
  { key: 'logistics', label: 'Логистика', sign: '-' },
  { key: 'deliveryPvz', label: 'Доставка ПВЗ', sign: '-' },
  { key: 'returns', label: 'Возвраты/отмены', sign: '-' },
  { key: 'ads', label: 'Реклама', sign: '-' },
  { key: 'vat', label: 'НДС', sign: '-' },
  { key: 'tax', label: 'Налог', sign: '-' },
  { key: 'cogs', label: 'Себестоимость', sign: '-' },
  { key: 'overhead', label: 'Прочие расходы', sign: '-' },
];

const TAX_MODE_LABELS: Record<TaxMode, string> = {
  usn_income: 'УСН Доходы',
  usn_income_minus: 'УСН Д-Р',
  osno: 'ОСНО (НДС)',
  none: 'Без налога',
};

function summarizeClusters(clusters: OzonFbsClusterShare[] | undefined): string {
  if (!clusters || clusters.length === 0) return '—';
  const sorted = [...clusters].sort((a, b) => b.sharePct - a.sharePct);
  const top = sorted.slice(0, 2).map((c) => {
    const label = FBS_CLUSTER_BY_KEY[c.key]?.label ?? c.key;
    return `${label} ${c.sharePct}%`;
  });
  if (sorted.length > 2) top.push(`+${sorted.length - 2}`);
  return top.join(', ');
}

function RenderOzonCalculator({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const liveValues = useAllBlockValuesFlat();
  const { settings } = useFormatSettings();
  const fmt = useCallback(
    (rubles: number) => formatRublesWithSettings(rublesToKopecks(rubles), settings.showKopecks),
    [settings.showKopecks],
  );

  const persist = useCallback(
    (patch: Partial<Config>) => {
      onConfigChange?.({ ...config, ...patch } as unknown as Record<string, unknown>);
    },
    [config, onConfigChange],
  );

  const setInput = useCallback(
    (key: keyof OzonInputs | string, value: number | string | boolean | OzonFbsClusterShare[]) => {
      persist({ inputs: { ...config.inputs, [key]: value } });
    },
    [config.inputs, persist],
  );

  /**
   * Атомарный апдейт нескольких полей за один persist.
   * НЕ использовать `setInput` дважды подряд в одном handler'е — оба вызова
   * замыкают `config.inputs` и второй перезатрёт первый (closure-trap).
   */
  const setInputs = useCallback(
    (patch: Record<string, unknown>) => {
      persist({ inputs: { ...config.inputs, ...patch } });
    },
    [config.inputs, persist],
  );

  const setBinding = useCallback(
    (key: keyof OzonInputs, binding: UnitCellBinding | undefined) => {
      const next = { ...config.bindings };
      if (binding) next[key] = binding;
      else delete next[key as string];
      persist({ bindings: next });
    },
    [config.bindings, persist],
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  const inputs = useMemo<OzonInputs>(() => {
    const merged = { ...OZON_DEFAULT_INPUTS } as OzonInputs;
    for (const [key, value] of Object.entries(config.inputs)) {
      (merged as Record<string, unknown>)[key] = value as unknown;
    }
    for (const [key, raw] of Object.entries(config.bindings)) {
      const binding = raw as UnitCellBinding | undefined;
      if (!binding || binding.mode !== 'block_ref') continue;
      const v = resolveBindingValue(binding, liveValues);
      if (v !== null) (merged as Record<string, unknown>)[key] = v;
    }
    if (typeof config.inputs.commissionMode !== 'string') merged.commissionMode = 'manual';
    return merged;
  }, [config.bindings, config.inputs, liveValues]);

  const results = useMemo(() => calculateOzon(inputs), [inputs]);

  useBlockValuePublisher(instance.id, {
    profitPerUnit: rublesToKopecks(results.profitPerUnit),
    profitPerMonth: rublesToKopecks(results.profitPerMonth),
    priceWithSpp: rublesToKopecks(results.priceWithSpp),
    margin: results.marginPct,
    roi: results.roiPct,
    label: instance.appearance?.title ?? config.title,
    __money: 'profitPerUnit,profitPerMonth,priceWithSpp',
    __labels:
      'profitPerUnit=Прибыль / ед,profitPerMonth=Прибыль / мес,priceWithSpp=Цена с СПП,' +
      'margin=Маржа,roi=ROI',
  });

  const positive = results.profitPerUnit > 0;
  const isFbs = inputs.mode === 'fbs';
  const taxMode = inputs.taxMode ?? 'usn_income';
  const dropoffPoint = inputs.fbsDropoffPoint ?? 'sorting_center';
  // Сохранённые legacy-скорости ('fast'/'standard'/'slow') приводим к ключу
  // актуальной сетки с ТЕМ ЖЕ эффектом в п.п. — иначе дроп-даун показал бы «—».
  const shipmentSpeed = normalizeFbsSpeed(inputs.fbsShipmentSpeed, dropoffPoint);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Calculator className="h-4 w-4 text-muted-foreground" />
          <Input
            value={config.title}
            onChange={(e) => persist({ title: e.target.value })}
            className="h-7 w-72 border-0 bg-transparent px-0 text-sm font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          <span
            className={
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ' +
              (inputs.mode === 'fbo'
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300')
            }
          >
            {inputs.mode}
          </span>
          {isFbs && (
            <span
              className="inline-flex max-w-[420px] items-center truncate rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
              title={`Точка сдачи · ${FBS_DROPOFF_LABELS[dropoffPoint]}, скорость · ${FBS_SHIPMENT_SPEED_LABELS[shipmentSpeed]}, кластеры · ${summarizeClusters(inputs.fbsClusters)}`}
            >
              <span className="truncate">
                {FBS_DROPOFF_LABELS[dropoffPoint]} ·{' '}
                {FBS_SHIPMENT_SPEED_LABELS[shipmentSpeed]} ·{' '}
                {summarizeClusters(inputs.fbsClusters)}
              </span>
            </span>
          )}
          {Number(inputs.vatPct ?? 0) > 0 && (
            <span className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              НДС {Number(inputs.vatPct)}%
            </span>
          )}
          <span className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Налог: {TAX_MODE_LABELS[taxMode]} {Number(inputs.taxRatePct ?? 0)}%
          </span>
          <span
            className="text-[10px] text-muted-foreground"
            title={`Тарифный пакет ${OZON_TARIFF_VERSION}`}
          >
            Тарифы {OZON_TARIFF_VERSION.replace(/^ozon_/, '').replace(/_/g, '-')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <OzonSyncButton
            onCompleted={() => {
              setPickerOpen(true);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPickerOpen(true)}
            title="Выбрать товар из ранее синхронизированных"
          >
            <Search /> Подобрать товар
          </Button>
          <span>Схема:</span>
          <div className="flex overflow-hidden rounded border border-border/60">
            {(['fbo', 'fbs'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setInput('mode', mode)}
                className={
                  'px-2 py-0.5 text-[11px] uppercase transition-colors ' +
                  (inputs.mode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-accent')
                }
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/20 px-3 py-2 text-[11px]">
        {isFbs && (
          <>
            <DropdownSelect
              label="Точка сдачи"
              value={dropoffPoint}
              options={FBS_DROPOFF_OPTIONS}
              onChange={(v) => {
                const next = v as OzonFbsDropoffPoint;
                // Сетки скоростей у «СЦ/курьер» и «ПВЗ/ППЗ» разные — переносим
                // выбор в ближайший по эффекту пункт новой сетки одним persist'ом.
                setInputs({
                  fbsDropoffPoint: next,
                  fbsShipmentSpeed: remapFbsSpeed(shipmentSpeed, dropoffPoint, next),
                });
              }}
            />
            <DropdownSelect
              label="Скорость отгрузки"
              value={shipmentSpeed}
              options={fbsSpeedOptions(dropoffPoint)}
              onChange={(v) => setInput('fbsShipmentSpeed', v as OzonFbsShipmentSpeed)}
            />
            <ClusterSelector
              label="Кластеры FBS"
              value={inputs.fbsClusters}
              onChange={(next) => setInput('fbsClusters', next)}
              localityDiscount={Boolean(inputs.localityDiscount)}
            />
          </>
        )}
        {inputs.mode === 'fbo' && (
          <button
            type="button"
            onClick={() => setInput('freeAcceptance', !inputs.freeAcceptance)}
            className={
              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors ' +
              (inputs.freeAcceptance
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/60 bg-background text-muted-foreground hover:text-foreground')
            }
            title={FBO_ACCEPTANCE_HINT}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: inputs.freeAcceptance ? 'currentColor' : '#d1d5db' }} />
            <span>Бесплатная приёмка FBO</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setInput('localityDiscount', !inputs.localityDiscount)}
          className={
            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors ' +
            (inputs.localityDiscount
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-border/60 bg-background text-muted-foreground hover:text-foreground')
          }
          title={LOCALITY_DISCOUNT_HINT}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: inputs.localityDiscount ? 'currentColor' : '#d1d5db' }} />
          <span>{LOCALITY_DISCOUNT_LABEL}</span>
        </button>
        <DropdownSelect
          label="Отсрочка выплат"
          value={String(Number(inputs.paymentDeferralDays ?? 0))}
          options={paymentDeferralOptions(Number(inputs.paymentDeferralDays ?? 0))}
          onChange={(v) => setInput('paymentDeferralDays', Number(v))}
        />
        <button
          type="button"
          onClick={() => setInput('isLocalCluster', !inputs.isLocalCluster)}
          className={
            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors ' +
            (inputs.isLocalCluster
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border/60 bg-background text-muted-foreground hover:text-foreground')
          }
          title={LOCAL_CLUSTER_HINT}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: inputs.isLocalCluster ? 'currentColor' : '#d1d5db' }} />
          <span>Локальный склад (×1)</span>
        </button>
        <DropdownSelect
          label="Налог"
          value={taxMode}
          options={Object.entries(TAX_MODE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          onChange={(v) => setInputs({ taxMode: v as TaxMode })}
        />
        {taxMode === 'usn_income_minus' && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Док. расходы:</span>
            <input
              type="number"
              value={Number(inputs.documentedExpensesMonth ?? 0)}
              step={1000}
              onChange={(e) => setInput('documentedExpensesMonth', Number(e.target.value))}
              className="h-6 w-24 rounded border border-border/60 bg-background px-1 text-right text-[11px] tabular-nums focus:border-primary focus:outline-none"
              title="Документально подтверждённые расходы, ₽/мес — для УСН Д-Р вычета"
            />
            <span className="text-muted-foreground">₽/мес</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Выкуп: {results.effectiveBuyoutPct}% (derived)</span>
        </div>
      </div>

      <div className="grid flex-1 overflow-auto" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Inputs */}
        <div className="space-y-3 border-r border-border/60 p-3">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {section.fields.map((f) => {
                  const value = Number(
                    config.inputs[f.key] ?? OZON_DEFAULT_INPUTS[f.key as keyof OzonInputs] ?? 0,
                  );
                  const binding = config.bindings[f.key] as UnitCellBinding | undefined;
                  return (
                    <div key={String(f.key)} className="flex items-center justify-between gap-1.5 text-[11px]">
                      <label className="truncate text-muted-foreground" title={f.label}>
                        {f.label}
                        {f.unit && <span className="ml-1 text-muted-foreground/60">({f.unit})</span>}
                      </label>
                      <div className="h-7 w-28 shrink-0">
                        <LinkableNumberCell
                          selfBlockId={instance.id}
                          fieldLabel={f.label}
                          value={Number.isFinite(value) ? value : 0}
                          onValueChange={(v) => setInput(f.key, v)}
                          binding={binding}
                          onBindingChange={(b) => setBinding(f.key, b)}
                          unit={f.unit}
                          money={f.money}
                          min={f.min}
                          max={f.max}
                          className="h-full border border-border/60"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Results */}
        <div className="flex flex-col gap-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Прибыль с единицы"
              value={fmt(results.profitPerUnit)}
              tone={positive ? 'positive' : 'negative'}
              big
            />
            <Metric
              label="Маржа"
              value={`${results.marginPct.toFixed(1)}%`}
              tone={results.marginPct >= 0 ? 'positive' : 'negative'}
            />
            <Metric label="ROI" value={`${results.roiPct.toFixed(1)}%`} />
            <Metric label="Прибыль за мес." value={fmt(results.profitPerMonth)} />
            <Metric
              label="Цена с СПП"
              value={fmt(results.priceWithSpp)}
              hint="Платит покупатель (скидка за счёт Ozon)"
            />
            <Metric label="Прибыль с партии" value={fmt(results.profitPerBatch)} />
            <Metric
              label="Деньги в товаре"
              value={fmt(results.moneyInStock)}
              hint={`Оборачиваемость: ${results.turnoverWeeks.toFixed(1)} нед.`}
            />
            <Metric
              label="ROI годовой"
              value={`${results.annualRoiPct.toFixed(1)}%`}
            />
          </div>

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              P&amp;L на одну продажу
            </div>
            <div className="overflow-hidden rounded border border-border/50 text-[11px]">
              {PNL_LINES.map((line) => {
                const v = (results[line.key] as number) ?? 0;
                const isPositive = line.sign === '+';
                return (
                  <div key={line.key} className="flex items-center justify-between gap-2 border-b border-border/30 px-2 py-1 last:border-0 odd:bg-muted/20">
                    <span className="truncate text-foreground/80">
                      {line.sign && (
                        <span
                          className={
                            isPositive
                              ? 'mr-1 inline-block w-2 text-emerald-600 dark:text-emerald-400'
                              : 'mr-1 inline-block w-2 text-muted-foreground'
                          }
                        >
                          {line.sign}
                        </span>
                      )}
                      {line.label}
                    </span>
                    <span
                      className={
                        'shrink-0 tabular-nums ' +
                        (isPositive
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-foreground')
                      }
                    >
                      {fmt(v)}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-2 bg-muted/40 px-2 py-1.5 font-semibold">
                <span>Прибыль</span>
                <span
                  className={
                    'tabular-nums ' +
                    (positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')
                  }
                >
                  {fmt(results.profitPerUnit)}
                </span>
              </div>
            </div>
            {results.coInvestSavings > 0 && (
              <div className="mt-1 rounded border border-dashed border-border/60 px-2 py-1 text-[10px] leading-snug text-muted-foreground">
                Справочно: цена с СПП <span className="tabular-nums text-foreground/80">{fmt(results.priceWithSpp)}</span>
                {' · '}экономия покупателя за счёт Ozon{' '}
                <span className="tabular-nums text-foreground/80">{fmt(results.coInvestSavings)}</span>. В прибыль
                продавца не входит — уменьшает только цену для покупателя и налоговую базу.
              </div>
            )}
          </div>
        </div>
      </div>

      <OzonProductPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(p) => {
          const patch: Record<string, unknown> = {
            price: p.priceRub,
            volumeL: p.volumeL > 0 ? p.volumeL : inputs.volumeL,
          };
          if (p.costRub > 0) patch.cost = p.costRub;
          // Заполняем комиссию из Ozon в зависимости от текущего режима.
          if (inputs.mode === 'fbo' && p.commissionFboPct !== null) {
            patch.commissionPct = p.commissionFboPct;
          } else if (inputs.mode === 'fbs' && p.commissionFbsPct !== null) {
            patch.commissionPct = p.commissionFbsPct;
          }
          setInputs(patch);
          // Обновляем заголовок блока подтянутым именем товара.
          if (p.name) {
            persist({ title: p.name });
          }
          setPickerOpen(false);
        }}
      />
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
  big,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
  big?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded border border-border/50 bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={
          (big ? 'text-lg' : 'text-sm') +
          ' mt-0.5 truncate font-semibold tabular-nums tracking-tight ' +
          (tone === 'positive'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'negative'
              ? 'text-red-600 dark:text-red-400'
              : 'text-foreground')
        }
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export const UnitOzonCalculatorBlock: BlockDef = {
  type: 'unit.ozon-calculator',
  displayName: 'Ozon · одиночный калькулятор',
  description: 'Калькулятор юнит-экономики Ozon (FBO/FBS) для одного товара с P&L и multi-cluster.',
  category: 'tables',
  icon: Calculator,
  defaultSize: { w: 12, h: 9 },
  minSize: { w: 4, h: 5 },
  minContentSize: { w: 360, h: 240 },
  pages: ['unit-economics-ozon'],
  configSchema: ConfigSchema,
  defaultConfig: () => ConfigSchema.parse({}),
  Render: RenderOzonCalculator,
};
