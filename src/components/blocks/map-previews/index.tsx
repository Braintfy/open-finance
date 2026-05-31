// PURPOSE: Реестр мини-превью блоков для режима «Карта». Каждый тип блока
// получает свой минималистичный read-only превью (через примитивы) + свой
// дефолтный размер. Каталог-файлы не трогаем — вся карта централизована здесь.
'use client';

import type { ReactNode } from 'react';
import { Box } from 'lucide-react';
import type { BlockInstance, BlockDef } from '@/lib/blocks/types';
import type { BlockOutput } from '@/lib/blocks/values';
import { useBlockOutput } from '@/lib/blocks/values';
import { getBlockDef } from '@/lib/blocks/registry';
import { resolveIcon } from '@/lib/blocks/icon-resolver';
import type { StatCardFormat, StatCardDelta } from '@/components/blocks/stat-card';
import {
  MetricPreview,
  MultiMetricPreview,
  MiniTablePreview,
  ListSummaryPreview,
  StatusPreview,
  IconTitlePreview,
  TextExcerptPreview,
  type PreviewAccent,
} from './primitives';

type Size = { w: number; h: number };

export type MapPreviewProps = { block: BlockInstance };

export type MapPreviewEntry = {
  previewSize: Size;
  /** Размер развёрнутого живого блока (px). Если нет — выводится из defaultSize. */
  expandedSize?: Size;
  /** Нужен ли скрытый live-mount для публикации метрики в превью. */
  needsLiveData?: boolean;
  Preview: (props: MapPreviewProps) => ReactNode;
};

/* ── helpers для чтения published output ── */

function num(output: BlockOutput | undefined, field: string): number | null {
  const v = output?.[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(output: BlockOutput | undefined, field: string): string | null {
  const v = output?.[field];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function configArrayLength(config: BlockInstance['config'], ...keys: string[]): number {
  for (const k of keys) {
    const v = config?.[k];
    if (Array.isArray(v)) return v.length;
  }
  return 0;
}
function configStringList(config: BlockInstance['config'], key: string, prop: string): string[] {
  const v = config?.[key];
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const s = rec[prop] ?? rec.label ?? rec.name ?? rec.title;
        return typeof s === 'string' ? s : '';
      }
      return '';
    })
    .filter(Boolean);
}

const DEFAULT_PREVIEW_SIZE: Size = { w: 240, h: 116 };

/* ── builders ── */

function buildMetric(cfg: {
  format?: StatCardFormat;
  scale?: number;
  accent?: PreviewAccent;
  labelFallback: string;
  goodDirection?: 'up' | 'down';
  previewSize?: Size;
  expandedSize?: Size;
  needsLiveData?: boolean;
}): MapPreviewEntry {
  return {
    previewSize: cfg.previewSize ?? DEFAULT_PREVIEW_SIZE,
    expandedSize: cfg.expandedSize,
    needsLiveData: cfg.needsLiveData ?? true,
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const def = getBlockDef(block.type);
      const raw = num(output, 'value');
      const value = raw === null ? null : raw * (cfg.scale ?? 1);
      const label =
        str(output, 'label') ?? block.appearance?.title ?? def?.displayName ?? cfg.labelFallback;
      const deltaPct = num(output, 'deltaPct');
      const delta: StatCardDelta | null =
        deltaPct !== null && deltaPct !== 0
          ? { value: deltaPct, label: 'vs прошлый период', goodDirection: cfg.goodDirection }
          : null;
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      return (
        <MetricPreview
          label={label}
          value={value === null ? '—' : value}
          format={value === null ? undefined : cfg.format}
          delta={delta}
          accent={cfg.accent}
          icon={Icon}
          iconColor={block.appearance?.accentColor}
        />
      );
    },
  };
}

function buildMulti(
  specs: Array<{ field: string; label: string; format?: StatCardFormat; scale?: number }>,
  opts?: { previewSize?: Size; expandedSize?: Size; needsLiveData?: boolean },
): MapPreviewEntry {
  return {
    previewSize: opts?.previewSize ?? { w: 300, h: 130 },
    expandedSize: opts?.expandedSize,
    needsLiveData: opts?.needsLiveData ?? true,
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const items = specs.map((s) => {
        const raw = num(output, s.field);
        return {
          label: s.label,
          value: raw === null ? '—' : raw * (s.scale ?? 1),
          format: raw === null ? undefined : s.format,
        };
      });
      return <MultiMetricPreview items={items} />;
    },
  };
}

function buildGeneric(opts?: {
  previewSize?: Size;
  expandedSize?: Size;
  needsLiveData?: boolean;
}): MapPreviewEntry {
  return {
    previewSize: opts?.previewSize ?? DEFAULT_PREVIEW_SIZE,
    expandedSize: opts?.expandedSize,
    needsLiveData: opts?.needsLiveData ?? true,
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      const title = block.appearance?.title ?? def?.displayName ?? block.type;
      const raw = num(output, 'value');
      if (raw !== null) {
        const isMoney = typeof output?.__money === 'string' && output.__money.includes('value');
        return (
          <MetricPreview
            label={str(output, 'label') ?? title}
            value={raw}
            format={isMoney ? 'rub' : 'int'}
            icon={Icon}
            iconColor={block.appearance?.accentColor}
          />
        );
      }
      return (
        <IconTitlePreview
          icon={Icon}
          title={title}
          subtitle={def?.description}
          accentColor={block.appearance?.accentColor}
        />
      );
    },
  };
}

/* ── реестр ── */

const TABLE_SIZE: Size = { w: 300, h: 160 };

export const MAP_PREVIEWS: Record<string, MapPreviewEntry> = {
  // --- cashflow KPI (value в КОПЕЙКАХ → scale 0.01) ---
  'stat.income': buildMetric({ format: 'rub', scale: 0.01, accent: 'emerald', goodDirection: 'up', labelFallback: 'Доходы' }),
  'stat.expense': buildMetric({ format: 'rub', scale: 0.01, accent: 'rose', goodDirection: 'down', labelFallback: 'Расходы' }),
  'stat.balance': buildMetric({ format: 'rub', scale: 0.01, accent: 'sky', labelFallback: 'Баланс' }),
  'stat.custom': buildMetric({ format: 'rub', scale: 0.01, accent: 'violet', labelFallback: 'KPI' }),

  'cashflow.top-categories': {
    previewSize: { w: 260, h: 150 },
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      const cats = str(output, 'categories');
      const items = cats ? cats.split(',').filter(Boolean) : [];
      return (
        <ListSummaryPreview
          icon={Icon}
          count={num(output, 'count')}
          countLabel="категорий"
          items={items}
          accentColor={block.appearance?.accentColor}
        />
      );
    },
  },

  'cashflow.transactions': buildMulti(
    [
      { field: 'count', label: 'Операций', format: 'int' },
      { field: 'totalIncome', label: 'Доход', format: 'rub', scale: 0.01 },
      { field: 'totalExpense', label: 'Расход', format: 'rub', scale: 0.01 },
    ],
    { previewSize: { w: 300, h: 130 } },
  ),

  // --- generic / cashflow ---
  'kpi.grid': {
    previewSize: { w: 300, h: 130 },
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const labels = parseLabels(output?.__labels);
      const money = parseMoneySet(output?.__money);
      const items = Object.entries(output ?? {})
        .filter(([k, v]) => !k.startsWith('__') && k !== 'label' && typeof v === 'number')
        .slice(0, 4)
        .map(([k, v]) => ({
          label: labels[k] ?? k,
          value: v as number,
          format: (money.has(k) ? 'rub' : 'int') as StatCardFormat,
        }));
      if (items.length === 0) {
        const def = getBlockDef(block.type);
        const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
        return <IconTitlePreview icon={Icon} title={block.appearance?.title ?? def?.displayName ?? 'KPI'} />;
      }
      return <MultiMetricPreview items={items} />;
    },
  },

  'chart.cashflow': buildGeneric({ previewSize: { w: 280, h: 140 }, needsLiveData: false }),
  'computed.sum': buildMetric({ format: 'int', accent: 'violet', labelFallback: 'Результат' }),

  // --- static (config-derived, no live mount) ---
  sheet: {
    previewSize: TABLE_SIZE,
    needsLiveData: false,
    Preview: ({ block }) => {
      const cols = configStringList(block.config, 'columns', 'label');
      const rowCount = configArrayLength(block.config, 'rows');
      const colCount = cols.length || configArrayLength(block.config, 'columns');
      return (
        <MiniTablePreview
          columns={cols.length ? cols : ['Колонка']}
          rows={[]}
          footer={`${rowCount} строк × ${colCount} колонок`}
        />
      );
    },
  },
  'custom.data': {
    previewSize: TABLE_SIZE,
    needsLiveData: false,
    Preview: ({ block }) => {
      const cols = configStringList(block.config, 'columns', 'label');
      const rowCount = configArrayLength(block.config, 'rows');
      return (
        <MiniTablePreview
          columns={cols.length ? cols : ['Данные']}
          rows={[]}
          footer={`${rowCount} строк`}
        />
      );
    },
  },
  'navigate.card': {
    previewSize: { w: 220, h: 96 },
    needsLiveData: false,
    Preview: ({ block }) => {
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      const cfg = (block.config ?? {}) as Record<string, unknown>;
      const title = block.appearance?.title || (typeof cfg.title === 'string' ? cfg.title : '') || 'Навигация';
      const subtitle = typeof cfg.description === 'string' ? cfg.description : undefined;
      return <IconTitlePreview icon={Icon} title={title} subtitle={subtitle} accentColor={block.appearance?.accentColor} />;
    },
  },
  'note.markdown': {
    previewSize: { w: 240, h: 116 },
    needsLiveData: false,
    Preview: ({ block }) => {
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      const cfg = (block.config ?? {}) as Record<string, unknown>;
      const content = typeof cfg.content === 'string' ? cfg.content : '';
      const title = block.appearance?.title || (typeof cfg.title === 'string' ? cfg.title : '') || 'Заметка';
      const chars = content.length;
      const words = content.trim() ? content.trim().split(/\s+/).length : 0;
      const excerpt = content.replace(/[#*_`>\-]/g, '').trim().slice(0, 140);
      return (
        <TextExcerptPreview
          icon={Icon}
          title={title}
          excerpt={excerpt || undefined}
          stats={[
            { value: chars, label: 'симв.' },
            { value: words, label: 'слов' },
          ]}
          accentColor={block.appearance?.accentColor}
        />
      );
    },
  },
  'excel.cell': {
    previewSize: { w: 220, h: 108 },
    needsLiveData: true,
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      const cfg = (block.config ?? {}) as Record<string, unknown>;
      const title = block.appearance?.title || (typeof cfg.title === 'string' ? cfg.title : '') || 'Ячейка';
      const raw = num(output, 'value');
      const rawStr = str(output, 'value');
      const isMoney = typeof output?.__money === 'string' && output.__money.includes('value');
      const value: number | string = raw ?? rawStr ?? (typeof cfg.value === 'string' ? cfg.value : '—');
      return (
        <MetricPreview
          label={title}
          value={value}
          format={typeof value === 'number' ? (isMoney ? 'rub' : 'int') : undefined}
          icon={Icon}
          iconColor={block.appearance?.accentColor}
        />
      );
    },
  },

  // --- inbox ---
  'inbox.channel-feed': buildInboxList('Сообщений'),
  'inbox.dashboard': buildInboxList('Сообщений'),

  // --- ai / status ---
  'ai.micro-agent': {
    previewSize: { w: 220, h: 96 },
    needsLiveData: false,
    Preview: ({ block }) => {
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      return (
        <StatusPreview
          icon={Icon}
          title={block.appearance?.title ?? def?.displayName ?? 'AI агент'}
          ok={null}
          statusText="Микроагент"
          accentColor={block.appearance?.accentColor}
        />
      );
    },
  },
  'unit.ozon-data-health': {
    previewSize: { w: 220, h: 100 },
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      const v = num(output, 'value');
      const ok = v === null ? null : v === 1;
      return (
        <StatusPreview
          icon={Icon}
          title={block.appearance?.title ?? def?.displayName ?? 'Состояние данных'}
          ok={ok}
          statusText={ok === null ? 'Нет данных' : ok ? 'Всё ок' : 'Есть проблемы'}
          accentColor={block.appearance?.accentColor}
        />
      );
    },
  },

  // --- unit ozon analytics ---
  'unit.ozon-kpi': buildMetric({ format: 'rub', scale: 0.01, accent: 'sky', labelFallback: 'Выручка', previewSize: { w: 260, h: 120 } }),
  'unit.ozon-multi-table': buildMulti(
    [
      { field: 'rowsCount', label: 'Товаров', format: 'int' },
      { field: 'avgMargin', label: 'Маржа', format: 'pct' },
      { field: 'avgRoi', label: 'ROI', format: 'pct' },
    ],
    { previewSize: { w: 300, h: 130 } },
  ),
  'unit.ozon-top-ads': buildMetric({ format: 'rub', accent: 'amber', labelFallback: 'Расход на рекламу', previewSize: { w: 260, h: 120 } }),
  'unit.ozon-search-phrases': buildMetric({ format: 'rub', accent: 'amber', labelFallback: 'Расход', previewSize: { w: 260, h: 120 } }),
  'unit.ozon-ai-insights': buildMetric({ format: 'int', accent: 'violet', labelFallback: 'Инсайтов' }),
  'unit.ozon-abc': buildMetric({ format: 'int', accent: 'sky', labelFallback: 'Товаров A' }),
  'unit.ozon-analytics': buildGeneric({ previewSize: TABLE_SIZE }),
  'unit.ozon-chart': buildGeneric({ previewSize: { w: 280, h: 140 }, needsLiveData: false }),
  'unit.ozon-campaigns': buildGeneric({ previewSize: TABLE_SIZE }),
  'unit.ozon-stock-clusters': buildGeneric({ previewSize: TABLE_SIZE }),
  'unit.ozon-warehouse-clusters': buildGeneric({ previewSize: TABLE_SIZE }),

  // --- calculators / tables / misc ---
  'unit.ozon-calculator': buildGeneric({ previewSize: { w: 260, h: 120 } }),
  'unit.yandex-calculator': buildGeneric({ previewSize: { w: 260, h: 120 } }),
  'unit.my-store-table': {
    previewSize: TABLE_SIZE,
    needsLiveData: false,
    Preview: ({ block }) => {
      const cols = configStringList(block.config, 'columns', 'label');
      const rowCount = configArrayLength(block.config, 'rows', 'products');
      return (
        <MiniTablePreview
          columns={cols.length ? cols : ['Товар']}
          rows={[]}
          footer={`${rowCount} товаров`}
        />
      );
    },
  },
  'currency.rates': buildGeneric({ previewSize: { w: 260, h: 120 }, needsLiveData: false }),
};

function buildInboxList(countLabel: string): MapPreviewEntry {
  return {
    previewSize: { w: 260, h: 140 },
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      const subject = str(output, 'latestSubject');
      const sender = str(output, 'latestSender');
      const items = [subject, sender].filter((x): x is string => !!x);
      return (
        <ListSummaryPreview
          icon={Icon}
          count={num(output, 'count')}
          countLabel={countLabel}
          items={items}
          accentColor={block.appearance?.accentColor}
        />
      );
    },
  };
}

function parseLabels(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [k, ...rest] = pair.split('=');
    if (k && rest.length) out[k.trim()] = rest.join('=').trim();
  }
  return out;
}
function parseMoneySet(raw: unknown): Set<string> {
  if (typeof raw !== 'string') return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/* ── accessors ── */

const GENERIC_FALLBACK = buildGeneric();

export function getMapPreview(type: string): MapPreviewEntry {
  return MAP_PREVIEWS[type] ?? GENERIC_FALLBACK;
}

/** Размер компактного превью-узла. */
export function getMapPreviewSize(type: string): Size {
  return getMapPreview(type).previewSize;
}

/** Размер развёрнутого живого блока: из реестра или выведен из defaultSize. */
export function getMapExpandedSize(def: BlockDef | undefined, type: string): Size {
  const entry = MAP_PREVIEWS[type];
  if (entry?.expandedSize) return entry.expandedSize;
  const w = def?.defaultSize?.w ?? 4;
  const h = def?.defaultSize?.h ?? 3;
  return {
    w: Math.min(640, Math.max(300, w * 64)),
    h: Math.min(520, Math.max(200, h * 46)),
  };
}

export function mapPreviewNeedsLiveData(type: string): boolean {
  return getMapPreview(type).needsLiveData ?? true;
}
