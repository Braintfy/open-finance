// PURPOSE: Single-product калькулятор Яндекс Маркет.
// FBY / FBS / DBS / Express, спецтарифы, НДС/УСН, P&L.
'use client';

import { useCallback, useMemo } from 'react';
import { Calculator } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps } from '../types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LinkableNumberCell } from '@/components/unit-economics/linkable-number-cell';
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { resolveBindingValue } from '@/lib/unit-economics/bindings';
import type { UnitCellBinding, YandexInputs } from '@/lib/unit-economics/types';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { calculateYandex, YANDEX_DEFAULT_INPUTS } from '@/lib/unit-economics/yandex/calculate';
import { YANDEX_TARIFF_VERSION } from '@/lib/unit-economics/yandex/tariffs-2026-04-01';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';

const ConfigSchema = z.object({
  title: z.string().default('Яндекс Маркет · юнит-калькулятор'),
  inputs: z.record(z.string(), z.unknown()).default({}),
  bindings: z.record(z.string(), z.unknown()).default({}),
});
type Config = z.infer<typeof ConfigSchema>;

function parseConfig(raw: unknown): Config {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : ConfigSchema.parse({});
}

const SECTIONS: Array<{
  title: string;
  fields: Array<{
    key: keyof YandexInputs;
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
      { key: 'sellerPrice', label: 'Цена продавца', unit: '₽', money: true },
      { key: 'coinvestPct', label: 'Соинвест', unit: '%', max: 100 },
      { key: 'cost', label: 'Себестоимость', unit: '₽', money: true },
    ],
  },
  {
    title: 'Габариты',
    fields: [
      { key: 'lengthCm', label: 'Длина', unit: 'см' },
      { key: 'widthCm', label: 'Ширина', unit: 'см' },
      { key: 'heightCm', label: 'Высота', unit: 'см' },
      { key: 'weightKg', label: 'Вес', unit: 'кг' },
    ],
  },
  {
    title: 'Тарифы',
    fields: [
      { key: 'commissionPct', label: 'Комиссия', unit: '%' },
      { key: 'acquiringPct', label: 'Эквайринг', unit: '%' },
      { key: 'fbsFastShipDiscountPct', label: 'Скидка экспресс FBS', unit: 'пп' },
      { key: 'storagePerUnit', label: 'Хранение/ед', unit: '₽', money: true },
    ],
  },
  {
    title: 'Реклама и оборачиваемость',
    fields: [
      { key: 'drrPct', label: 'ДРР', unit: '%' },
      { key: 'vatPct', label: 'НДС', unit: '%', max: 100 },
      { key: 'overheadPerUnit', label: 'Прочие', unit: '₽', money: true },
      { key: 'salesPerMonth', label: 'Продаж/мес', unit: 'шт' },
      { key: 'batchSize', label: 'Партия', unit: 'шт' },
      { key: 'stock', label: 'Остаток', unit: 'шт' },
      { key: 'buyoutPct', label: 'Выкуп', unit: '%', min: 1, max: 100 },
    ],
  },
];

const PNL_LINES: Array<{ key: keyof ReturnType<typeof calculateYandex>; label: string; sign?: '+' | '-' }> = [
  { key: 'customerPrice', label: 'Цена покупателя', sign: '+' },
  { key: 'commission', label: 'Комиссия', sign: '-' },
  { key: 'acquiring', label: 'Эквайринг', sign: '-' },
  { key: 'lastMile', label: 'Последняя миля', sign: '-' },
  { key: 'middleMile', label: 'Средняя миля', sign: '-' },
  { key: 'fulfillment', label: 'Фулфилмент', sign: '-' },
  { key: 'storage', label: 'Хранение', sign: '-' },
  { key: 'ads', label: 'Реклама', sign: '-' },
  { key: 'vat', label: 'НДС', sign: '-' },
  { key: 'tax', label: 'Налог', sign: '-' },
  { key: 'cogs', label: 'Себестоимость', sign: '-' },
  { key: 'overhead', label: 'Прочие расходы', sign: '-' },
];

function RenderYandexCalculator({ instance, onConfigChange }: BlockRenderProps) {
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
    (key: keyof YandexInputs, value: unknown) => {
      persist({ inputs: { ...config.inputs, [key]: value } });
    },
    [config.inputs, persist],
  );

  const setBinding = useCallback(
    (key: keyof YandexInputs, binding: UnitCellBinding | undefined) => {
      const next = { ...config.bindings };
      if (binding) next[key] = binding;
      else delete next[key as string];
      persist({ bindings: next });
    },
    [config.bindings, persist],
  );

  const inputs = useMemo<YandexInputs>(() => {
    const merged = { ...YANDEX_DEFAULT_INPUTS } as YandexInputs;
    for (const [key, value] of Object.entries(config.inputs)) {
      (merged as Record<string, unknown>)[key] = value as unknown;
    }
    for (const [key, raw] of Object.entries(config.bindings)) {
      const binding = raw as UnitCellBinding | undefined;
      if (!binding || binding.mode !== 'block_ref') continue;
      const v = resolveBindingValue(binding, liveValues);
      if (v !== null) (merged as Record<string, unknown>)[key] = v;
    }
    return merged;
  }, [config.bindings, config.inputs, liveValues]);

  const results = useMemo(() => calculateYandex(inputs), [inputs]);

  useBlockValuePublisher(instance.id, {
    profitPerUnit: rublesToKopecks(results.profitPerUnit),
    profitPerMonth: rublesToKopecks(results.profitPerMonth),
    margin: results.marginCustomerPct,
    roi: results.roiPct,
    label: instance.appearance?.title ?? config.title,
    __money: 'profitPerUnit,profitPerMonth',
  });

  const positive = results.profitPerUnit > 0;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-muted-foreground" />
          <Input
            value={config.title}
            onChange={(e) => persist({ title: e.target.value })}
            className="h-7 w-72 border-0 bg-transparent px-0 text-sm font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          <span className="inline-flex items-center rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-300">
            {inputs.mode}
          </span>
          {Number(inputs.vatPct ?? 0) > 0 && (
            <span className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              НДС {Number(inputs.vatPct)}%
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">v{YANDEX_TARIFF_VERSION}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Модель:</span>
          <div className="flex overflow-hidden rounded border border-border/60">
            {(['fby', 'fbs', 'dbs', 'express'] as const).map((mode) => (
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
          <span>Спецтариф:</span>
          <select
            value={inputs.specialTariff}
            onChange={(e) => setInput('specialTariff', e.target.value)}
            className="h-6 rounded border border-border/60 bg-background px-1 text-[11px]"
          >
            <option value="none">Базовый</option>
            <option value="showcase">Витрина (5%)</option>
            <option value="subscription_fby">Подписка FBY (9%)</option>
            <option value="subscription_fbs">Подписка FBS (16%)</option>
          </select>
          <span>Налог:</span>
          <select
            value={inputs.taxMode}
            onChange={(e) => setInput('taxMode', e.target.value)}
            className="h-6 rounded border border-border/60 bg-background px-1 text-[11px]"
          >
            <option value="usn_income">УСН Доходы</option>
            <option value="usn_income_minus">УСН Д-Р</option>
            <option value="osno">ОСНО</option>
            <option value="nds">Только НДС</option>
            <option value="none">Без налога</option>
          </select>
          <input
            type="number"
            value={inputs.taxRatePct}
            onChange={(e) => setInput('taxRatePct', Number(e.target.value))}
            className="h-6 w-12 rounded border border-border/60 bg-background px-1 text-right text-[11px] tabular-nums"
          />
          <span>%</span>
        </div>
      </div>

      <div className="grid flex-1 overflow-auto" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="space-y-3 border-r border-border/60 p-3">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {section.fields.map((f) => {
                  const value = Number(
                    config.inputs[f.key] ?? YANDEX_DEFAULT_INPUTS[f.key as keyof YandexInputs] ?? 0,
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

        <div className="flex flex-col gap-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Прибыль с единицы"
              value={fmt(results.profitPerUnit)}
              tone={positive ? 'positive' : 'negative'}
              big
            />
            <Metric label="Маржа от покупат.цены" value={`${results.marginCustomerPct.toFixed(1)}%`} tone={results.marginCustomerPct >= 0 ? 'positive' : 'negative'} />
            <Metric label="Маржа от цены прод." value={`${results.marginSellerPct.toFixed(1)}%`} />
            <Metric label="ROI" value={`${results.roiPct.toFixed(1)}%`} />
            <Metric label="Прибыль/мес" value={fmt(results.profitPerMonth)} />
            <Metric label="Деньги в товаре" value={fmt(results.moneyInStock)} hint={`Объём: ${results.volume} дм³`} />
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
          </div>
        </div>
      </div>
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

export const UnitYandexCalculatorBlock: BlockDef = {
  type: 'unit.yandex-calculator',
  displayName: 'Яндекс Маркет · калькулятор',
  description: 'Калькулятор юнит-экономики Яндекс Маркет (FBY/FBS/DBS/Express) для одного товара с P&L.',
  category: 'tables',
  icon: Calculator,
  defaultSize: { w: 12, h: 9 },
  minSize: { w: 4, h: 5 },
  minContentSize: { w: 360, h: 240 },
  pages: ['unit-economics-yandex'],
  configSchema: ConfigSchema,
  defaultConfig: () => ConfigSchema.parse({}),
  Render: RenderYandexCalculator,
};
