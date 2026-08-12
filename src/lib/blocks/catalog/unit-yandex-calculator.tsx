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
import { DropdownSelect } from '@/components/unit-economics/dropdown-select';
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { resolveBindingValue } from '@/lib/unit-economics/bindings';
import type { UnitCellBinding, YandexInputs } from '@/lib/unit-economics/types';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { calculateYandex, YANDEX_DEFAULT_INPUTS } from '@/lib/unit-economics/yandex/calculate';
import {
  YANDEX_TARIFF_VERSION,
  fixedTariffPct,
  shouldUseFixedTariff,
  specialTariffPct,
  RETURN_STORAGE_FREE_DAYS,
  RETURN_STORAGE_PER_DAY_RUB,
} from '@/lib/unit-economics/yandex/tariffs-2026-07-01';
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
    // Вес в расчёте не участвует — тарифы ЯМ считаются от объёма (дм³),
    // поэтому поле «Вес» убрано, чтобы не создавать иллюзию влияния.
    title: 'Габариты',
    fields: [
      { key: 'lengthCm', label: 'Длина', unit: 'см' },
      { key: 'widthCm', label: 'Ширина', unit: 'см' },
      { key: 'heightCm', label: 'Высота', unit: 'см' },
    ],
  },
  {
    title: 'Тарифы',
    fields: [
      { key: 'commissionPct', label: 'Комиссия', unit: '%' },
      { key: 'acquiringPct', label: 'Перевод платежей', unit: '%' },
      { key: 'fbsFastShipDiscountPct', label: 'Скидка экспресс FBS', unit: 'пп' },
      { key: 'storagePerUnit', label: 'Хранение/ед', unit: '₽', money: true },
      { key: 'returnStorageDays', label: 'Хранение невыкупа', unit: 'дн' },
    ],
  },
  {
    title: 'Реклама и оборачиваемость',
    fields: [
      { key: 'drrPct', label: 'ДРР', unit: '%' },
      { key: 'vatPct', label: 'НДС', unit: '%', max: 100 },
      { key: 'overheadPerUnit', label: 'Прочие', unit: '₽', money: true },
      { key: 'salesPerMonth', label: 'Продаж/мес', unit: 'шт' },
      { key: 'stock', label: 'Остаток', unit: 'шт' },
      { key: 'buyoutPct', label: 'Выкуп', unit: '%', min: 1, max: 100 },
    ],
  },
];

/** Тултипы для полей, у которых поведение не очевидно из подписи. */
const FIELD_HINTS: Partial<Record<keyof YandexInputs, string>> = {
  acquiringPct:
    'Перевод платежей, 1.6–3.3% в зависимости от частоты выплат. Сверх него всегда начисляется «приём платежей» 0.12 ₽ за SKU.',
  returnStorageDays:
    `Дней хранения невыкупа до вывоза. Первые ${RETURN_STORAGE_FREE_DAYS} дн. бесплатно, ` +
    `далее ${RETURN_STORAGE_PER_DAY_RUB} ₽/день за каждый невыкуп.`,
  fbsFastShipDiscountPct: 'Скидка к средней миле за экспресс-отгрузку FBS, процентные пункты.',
};

// Выручка продавца = `revenue` (цена в ЛК). Соинвест Маркета снижает только
// цену покупателя и налоговую базу — раньше строка выручки брала
// `customerPrice` и занижала верх P&L при включённом соинвесте.
const PNL_LINES: Array<{ key: keyof ReturnType<typeof calculateYandex>; label: string; sign?: '+' | '-' }> = [
  { key: 'revenue', label: 'Выручка продавца', sign: '+' },
  { key: 'commission', label: 'Комиссия / размещение', sign: '-' },
  { key: 'acquiring', label: 'Платежи (перевод + приём)', sign: '-' },
  { key: 'lastMile', label: 'Последняя миля', sign: '-' },
  { key: 'middleMile', label: 'Средняя миля', sign: '-' },
  // В тарифах ЯМ нет статьи «фулфилмент» — есть «обработка заказа» (25 ₽ FBS).
  { key: 'orderProcessing', label: 'Обработка заказа', sign: '-' },
  { key: 'storage', label: 'Хранение', sign: '-' },
  { key: 'returns', label: 'Возвраты (невыкуп)', sign: '-' },
  { key: 'ads', label: 'Реклама', sign: '-' },
  { key: 'vat', label: 'НДС', sign: '-' },
  { key: 'tax', label: 'Налог', sign: '-' },
  { key: 'cogs', label: 'Себестоимость', sign: '-' },
  { key: 'overhead', label: 'Прочие расходы', sign: '-' },
];

const SPECIAL_TARIFF_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'Базовый (ручная комиссия)' },
  { value: 'subscription_fby', label: 'Подписка FBY — 9%' },
  { value: 'subscription_fbs', label: 'Подписка FBS — 16%' },
  { value: 'subscription_express', label: 'Подписка Express — 9%' },
];

/**
 * Опции спецтарифа. «Витрина 5%» отменена с 01.07.2026 и в списке не
 * показывается, но если она сохранена в конфиге — добавляем пункт с пометкой,
 * чтобы дроп-даун не рисовал «—» и было видно, что тариф не действует.
 */
function specialTariffOptions(current: string): Array<{ value: string; label: string }> {
  if (SPECIAL_TARIFF_OPTIONS.some((o) => o.value === current)) return SPECIAL_TARIFF_OPTIONS;
  const legacyLabel =
    current === 'showcase' ? 'Витрина 5% — отменена с 01.07.2026' : `${current} — не применяется`;
  return [...SPECIAL_TARIFF_OPTIONS, { value: current, label: legacyLabel }];
}

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
    __labels:
      'profitPerUnit=Прибыль / ед,profitPerMonth=Прибыль / мес,margin=Маржа,roi=ROI',
  });

  const positive = results.profitPerUnit > 0;
  const specialTariff = String(inputs.specialTariff ?? 'none');
  // Спецтариф действует только в «своём» режиме и ЗАМЕНЯЕТ ставку комиссии.
  const specialPct = specialTariffPct(specialTariff, inputs.mode);
  const specialInactive = specialTariff !== 'none' && specialPct === null;
  // Фикс-тариф (дешёвые компактные товары) заменяет комиссию + мили + обработку.
  const fixedPct = shouldUseFixedTariff(results.revenue, results.volume, inputs.mode)
    ? fixedTariffPct(inputs.mode)
    : null;

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
          {fixedPct !== null && (
            <span
              className="inline-flex items-center rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-300"
              title={`Товар до 300 ₽ и до 5 дм³: применён фиксированный тариф ${fixedPct}% от цены — он заменяет комиссию, обе мили и обработку заказа.`}
            >
              Фикс. тариф {fixedPct}%
            </span>
          )}
          {specialPct !== null && fixedPct === null && (
            <span
              className="inline-flex items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400"
              title="Спецтариф заменяет ставку комиссии (не суммируется с ней)."
            >
              Спецтариф {specialPct}%
            </span>
          )}
          {specialInactive && (
            <span
              className="inline-flex items-center rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400"
              title={
                specialTariff === 'showcase'
                  ? 'Спецтариф «Витрина 5%» отменён с 01.07.2026 — расчёт идёт по ручной комиссии.'
                  : `Спецтариф не действует для модели ${inputs.mode} — расчёт идёт по ручной комиссии.`
              }
            >
              Спецтариф не применён
            </span>
          )}
          <span
            className="text-[10px] text-muted-foreground"
            title={`Тарифный пакет ${YANDEX_TARIFF_VERSION}`}
          >
            Тарифы {YANDEX_TARIFF_VERSION.replace(/^yandex_/, '').replace(/_/g, '-')}
          </span>
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
          <DropdownSelect
            label="Спецтариф"
            value={specialTariff}
            options={specialTariffOptions(specialTariff)}
            onChange={(v) => setInput('specialTariff', v)}
          />
          <DropdownSelect
            label="Налог"
            value={String(inputs.taxMode ?? 'usn_income')}
            options={[
              { value: 'usn_income', label: 'УСН Доходы' },
              { value: 'usn_income_minus', label: 'УСН Д-Р' },
              { value: 'osno', label: 'ОСНО (НДС)' },
              { value: 'none', label: 'Без налога' },
            ]}
            onChange={(v) => setInput('taxMode', v)}
          />
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
                      <label
                        className="truncate text-muted-foreground"
                        title={FIELD_HINTS[f.key] ?? f.label}
                      >
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
            {results.customerPrice !== results.revenue && (
              <div className="mt-1 rounded border border-dashed border-border/60 px-2 py-1 text-[10px] leading-snug text-muted-foreground">
                Справочно: цена покупателя{' '}
                <span className="tabular-nums text-foreground/80">{fmt(results.customerPrice)}</span> —
                соинвест Маркета{' '}
                <span className="tabular-nums text-foreground/80">
                  {fmt(results.revenue - results.customerPrice)}
                </span>{' '}
                идёт за счёт Маркета: в прибыль продавца не входит, уменьшает только налоговую базу.
              </div>
            )}
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
