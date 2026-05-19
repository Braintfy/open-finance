// PURPOSE: SettingsForm для блока unit.ozon-analytics. Магазин, период,
// видимые колонки, дефолтный фильтр + секция «Внешний вид» (миниатюры
// товаров, цветовая индикация) + секция «Синхронизация» (shared компонент).

'use client';

import { useEffect } from 'react';
import {
  AlertTriangle,
  Eye,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Paintbrush,
  ShoppingBag,
} from 'lucide-react';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import type {
  OzonAnalyticsBlockConfig,
  OzonAnalyticsPeriodPreset,
} from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import { OZON_ANALYTICS_PERIOD_PRESETS } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import { COLUMN_DEFS, type TableColumnKey } from './ozon-analytics-table';
import {
  ANALYTICS_FILTERS,
  type AnalyticsFilterId,
} from './ozon-analytics-filters';
import { OzonSyncSection } from './ozon-sync-section';

const COLUMN_GROUPS: Array<{
  title: string;
  keys: TableColumnKey[];
}> = [
  {
    title: 'Идентификаторы',
    keys: ['article', 'name', 'sku'],
  },
  {
    title: 'Цена и маржа',
    keys: ['priceRub', 'costRub', 'marginRub'],
  },
  {
    title: 'Продажи',
    keys: ['delivered', 'deliveredFbo', 'deliveredFbs', 'qtyDelivered', 'cancelled', 'returned', 'returnPct', 'revenueRub', 'buyoutPct', 'salesPerDay', 'salesShare'],
  },
  {
    title: 'Реклама',
    keys: ['adsRub', 'drrPct', 'views', 'clicks', 'ctr', 'cartAdds', 'cpc', 'cpm'],
  },
  {
    title: 'Склад',
    keys: ['stock', 'daysOfStock'],
  },
];

export function OzonAnalyticsSettingsForm({
  value,
  onChange,
}: {
  value: OzonAnalyticsBlockConfig;
  onChange: (next: OzonAnalyticsBlockConfig) => void;
}) {
  const { accounts, loading } = useMarketplaceAccounts({ marketplace: 'ozon' });

  // Авто-выбор первого аккаунта если сохранённый исчез / отсутствует.
  useEffect(() => {
    if (loading || accounts.length === 0) return;
    const stillExists = value.accountId && accounts.some((a) => a.id === value.accountId);
    if (!stillExists && accounts[0]) {
      onChange({ ...value, accountId: accounts[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accounts.length]);

  function toggleColumn(key: TableColumnKey, on: boolean) {
    const next = on
      ? Array.from(new Set([...value.visibleColumns, key]))
      : value.visibleColumns.filter((k) => k !== key);
    onChange({ ...value, visibleColumns: next });
  }

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShoppingBag className="h-3 w-3" />
            Магазин
          </span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 p-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка магазинов…
          </div>
        ) : accounts.length === 0 ? (
          <div className="space-y-2 rounded border border-amber-400/50 bg-amber-50 p-2 text-[12px] dark:bg-amber-950/40">
            <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Ни один Ozon-магазин не подключён.
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
            >
              <LinkIcon className="h-3 w-3" />
              Подключить в Настройках → Интеграции
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => {
              const active = value.accountId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onChange({ ...value, accountId: a.id })}
                  className={
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors ' +
                    (active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 bg-background hover:bg-accent')
                  }
                >
                  <span
                    className={
                      'h-2 w-2 rounded-full ' +
                      (a.status === 'active'
                        ? 'bg-emerald-500'
                        : a.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-muted')
                    }
                  />
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground">· {a.clientId}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Дефолтный период
        </div>
        <div className="flex flex-wrap gap-1.5">
          {OZON_ANALYTICS_PERIOD_PRESETS.map((preset) => {
            const active = value.periodPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  onChange({ ...value, periodPreset: preset.id as OzonAnalyticsPeriodPreset })
                }
                className={
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-background hover:bg-accent')
                }
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Пользователь сможет переключать период прямо в блоке.
        </p>
      </section>

      <section className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Дефолтный фильтр
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ANALYTICS_FILTERS.map((f) => {
            const active = value.defaultFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onChange({ ...value, defaultFilter: f.id as AnalyticsFilterId })}
                className={
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-background hover:bg-accent')
                }
                title={f.hint}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Секция «Внешний вид» — миниатюры товаров и цветовая индикация. */}
      <section className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Paintbrush className="h-3 w-3" />
            Внешний вид
          </span>
        </div>
        <div className="space-y-1 rounded border border-border/60 bg-card">
          <ToggleRow
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            label="Миниатюры товаров"
            hint="Иконка 28×28 слева от названия. Источник — primary_image из Ozon. По умолчанию выключено для компактности."
            checked={value.showProductImage}
            onChange={(on) => onChange({ ...value, showProductImage: on })}
          />
          <ToggleRow
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Цветовая подсветка ДРР"
            hint="Зелёный <10% / нейтральный <20% / оранжевый <50% / красный ≥50%."
            checked={value.showDrrColor}
            onChange={(on) => onChange({ ...value, showDrrColor: on })}
          />
          <ToggleRow
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Цветовая подсветка остатков"
            hint="Красный <7 дней / оранжевый <14 / нейтральный <30 / зелёный ≥30."
            checked={value.showStockColor}
            onChange={(on) => onChange({ ...value, showStockColor: on })}
          />
        </div>
      </section>

      <OzonSyncSection
        accountId={value.accountId}
        showPreflightWarning={false}
        title="Синхронизация данных"
      />

      <section className="space-y-1.5" id="visible-columns-section">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Видимые колонки
        </div>
        <div className="space-y-2">
          {COLUMN_GROUPS.map((g) => (
            <div key={g.title} className="rounded-md border border-border/60 bg-card">
              <div className="border-b border-border/40 px-2 py-1">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.title}
                </Label>
              </div>
              <div className="divide-y divide-border/40">
                {g.keys.map((key) => {
                  const col = COLUMN_DEFS.find((c) => c.key === key);
                  if (!col) return null;
                  const enabled = value.visibleColumns.includes(key);
                  return (
                    <div key={key} className="flex items-center gap-2 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium">{col.label}</div>
                        {col.hint && (
                          <div className="text-[11px] text-muted-foreground">{col.hint}</div>
                        )}
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(on) => toggleColumn(key, on)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <div className="text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
