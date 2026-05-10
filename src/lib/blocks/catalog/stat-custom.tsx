// PURPOSE: Кастомный KPI-блок с фильтрами (metric / period / counterparty / source)
'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatRubles } from '@/lib/utils';
import { resolveIcon } from '../icon-resolver';

const StatCustomConfig = z.object({
  metric: z.enum(['income', 'expense', 'balance', 'count']).default('income'),
  period: z.enum(['month', 'quarter', 'year', 'all_time']).default('month'),
  counterparty: z.string().optional(),
  source: z.string().optional(),
});

type Cfg = z.infer<typeof StatCustomConfig>;

const PERIOD_LABELS: Record<Cfg['period'], string> = {
  month: 'за месяц',
  quarter: 'за квартал',
  year: 'за год',
  all_time: 'за всё время',
};

const METRIC_LABELS: Record<Cfg['metric'], string> = {
  income: 'Поступления',
  expense: 'Списания',
  balance: 'Чистый баланс',
  count: 'Количество операций',
};

function RenderStatCustom({ instance }: BlockRenderProps) {
  const cfg = StatCustomConfig.parse(instance.config ?? {});
  const [value, setValue] = useState<number | null>(null);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // ключ зависит от всех фильтров — пересчёт при изменении
  const key = `${cfg.metric}|${cfg.period}|${cfg.counterparty ?? ''}|${cfg.source ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ metric: cfg.metric, period: cfg.period });
    if (cfg.counterparty) params.set('counterparty', cfg.counterparty);
    if (cfg.source) params.set('source', cfg.source);
    fetch(`/api/cashflow/aggregate?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok) {
          setValue(data.value);
          setCount(data.count);
        } else {
          setValue(0);
          setCount(0);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setValue(0);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const accentColor = instance.appearance?.accentColor;
  const iconName = instance.appearance?.icon;
  const Icon = resolveIcon(iconName, Sparkles);

  const title =
    instance.appearance?.title ??
    `${METRIC_LABELS[cfg.metric]} ${PERIOD_LABELS[cfg.period]}` +
      (cfg.counterparty ? ` · ${cfg.counterparty}` : '') +
      (cfg.source ? ` · ${cfg.source}` : '');

  const display =
    cfg.metric === 'count' ? `${value ?? 0}` : formatRubles(Math.abs(value ?? 0));
  const sign =
    cfg.metric === 'balance' && (value ?? 0) < 0
      ? '−'
      : cfg.metric === 'income'
      ? '+'
      : cfg.metric === 'expense'
      ? '−'
      : '';

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-1.5">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon
            className="h-3.5 w-3.5"
            style={accentColor ? { color: accentColor } : undefined}
          />
          <span className="line-clamp-1">{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center">
        <div
          className="text-xl font-semibold tabular-nums tracking-tight"
          style={accentColor ? { color: accentColor } : undefined}
        >
          {loading ? '—' : `${sign}${display}`}
        </div>
        {!loading && cfg.metric !== 'count' && count > 0 && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {count} {pluralRu(count, ['операция', 'операции', 'операций'])}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

// ============================================================================
// Settings form
// ============================================================================

function StatCustomSettings({ config, onChange }: BlockSettingsFormProps) {
  const cfg = StatCustomConfig.parse(config ?? {});
  const [meta, setMeta] = useState<{
    sources: string[];
    counterparties: { name: string | null; count: number }[];
  }>({ sources: [], counterparties: [] });

  useEffect(() => {
    fetch('/api/cashflow/meta')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMeta({ sources: d.sources, counterparties: d.counterparties });
      })
      .catch(() => {});
  }, []);

  function set<K extends keyof Cfg>(key: K, value: Cfg[K]) {
    onChange({ ...cfg, [key]: value });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Что считаем</Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(METRIC_LABELS) as Cfg['metric'][]).map((m) => (
            <Button
              key={m}
              type="button"
              variant={cfg.metric === m ? 'default' : 'outline'}
              size="sm"
              onClick={() => set('metric', m)}
            >
              {METRIC_LABELS[m]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Период</Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(PERIOD_LABELS) as Cfg['period'][]).map((p) => (
            <Button
              key={p}
              type="button"
              variant={cfg.period === p ? 'default' : 'outline'}
              size="sm"
              onClick={() => set('period', p)}
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="counterparty-filter">Контрагент содержит</Label>
        <Input
          id="counterparty-filter"
          placeholder="например: ТБанк, Яндекс, ВБ"
          value={cfg.counterparty ?? ''}
          onChange={(e) => set('counterparty', e.target.value || undefined)}
          list="counterparties-suggest"
        />
        <datalist id="counterparties-suggest">
          {meta.counterparties.slice(0, 30).map((c, i) => (
            <option key={i} value={c.name ?? ''} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Поиск по подстроке (case-insensitive). Например {`"`}ТБанк{`"`} найдёт «АО Т-БАНК»,
          «ТБанк», «T-Bank».
        </p>
      </div>

      <div className="space-y-2">
        <Label>Источник данных</Label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={!cfg.source ? 'default' : 'outline'}
            size="sm"
            onClick={() => set('source', undefined)}
          >
            Все
          </Button>
          {meta.sources.map((s) => (
            <Button
              key={s}
              type="button"
              variant={cfg.source === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => set('source', s)}
            >
              {s}
            </Button>
          ))}
        </div>
        {meta.sources.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Источники появятся после первого импорта (например <code>tinkoff_csv</code>).
          </p>
        )}
      </div>
    </div>
  );
}

export const StatCustomBlock: BlockDef = {
  type: 'stat.custom',
  displayName: 'KPI с фильтрами',
  description:
    'Сумма по фильтрам — например «поступления от ТБанк за всё время» или «расходы на рекламу за месяц»',
  category: 'stats',
  icon: Sparkles,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 3, h: 2 },
  pages: ['cashflow', 'dashboard'],
  configSchema: StatCustomConfig,
  defaultConfig: () => ({ metric: 'income', period: 'all_time' }),
  SettingsForm: StatCustomSettings,
  Render: RenderStatCustom,
};
