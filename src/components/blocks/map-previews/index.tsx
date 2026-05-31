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

/** Парсит CSV чисел (для серии __spark). */
function parseNums(raw: unknown): number[] {
  if (typeof raw !== 'string' || !raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}
/** Помечено ли поле как денежное в `__money` (CSV). */
function isMoneyField(output: BlockOutput | undefined, field: string): boolean {
  return parseMoneySet(output?.__money).has(field);
}

const DEFAULT_PREVIEW_SIZE: Size = { w: 240, h: 116 };

/* ── builders ── */

/** Деньги по умолчанию в КОПЕЙКАХ → рубли; исключения (уже рубли): top-ads/search/ABC. */
const KOPECK_SCALE = 0.01;

function buildMetric(cfg: {
  field?: string;
  format?: StatCardFormat;
  /** Явный множитель. Если money=true и scale не задан → KOPECK_SCALE. */
  scale?: number;
  money?: boolean;
  accent?: PreviewAccent;
  labelFallback: string;
  goodDirection?: 'up' | 'down';
  /** Поле с CSV-серией для мини-спарклайна (например `__spark`). */
  sparkField?: string;
  previewSize?: Size;
  expandedSize?: Size;
  needsLiveData?: boolean;
}): MapPreviewEntry {
  const field = cfg.field ?? 'value';
  const isMoney = cfg.money ?? false;
  const effScale = cfg.scale ?? (isMoney ? KOPECK_SCALE : 1);
  const effFormat: StatCardFormat = cfg.format ?? (isMoney ? 'rub' : 'int');
  return {
    previewSize: cfg.previewSize ?? DEFAULT_PREVIEW_SIZE,
    expandedSize: cfg.expandedSize,
    needsLiveData: cfg.needsLiveData ?? true,
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const def = getBlockDef(block.type);
      const raw = num(output, field);
      const value = raw === null ? null : raw * effScale;
      const label =
        str(output, 'label') ?? block.appearance?.title ?? def?.displayName ?? cfg.labelFallback;
      const deltaPct = num(output, 'deltaPct');
      const delta: StatCardDelta | null =
        deltaPct !== null && deltaPct !== 0
          ? { value: deltaPct, label: 'vs прошлый период', goodDirection: cfg.goodDirection }
          : null;
      const spark = cfg.sparkField ? parseNums(output?.[cfg.sparkField]) : [];
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      return (
        <MetricPreview
          label={label}
          value={value === null ? '—' : value}
          format={value === null ? undefined : effFormat}
          delta={delta}
          sparkline={spark.length > 1 ? spark : null}
          accent={cfg.accent}
          icon={Icon}
          iconColor={block.appearance?.accentColor}
        />
      );
    },
  };
}

/** Чарт-превью: крупная метрика + реальный мини-спарклайн из `__spark`. */
function buildChart(cfg: {
  field?: string;
  money?: boolean;
  sparkField?: string;
  accent?: PreviewAccent;
  labelFallback: string;
  goodDirection?: 'up' | 'down';
  previewSize?: Size;
}): MapPreviewEntry {
  return buildMetric({
    ...cfg,
    sparkField: cfg.sparkField ?? '__spark',
    previewSize: cfg.previewSize ?? { w: 280, h: 150 },
    needsLiveData: true,
  });
}

function buildMulti(
  specs: Array<{
    field: string;
    label: string;
    format?: StatCardFormat;
    scale?: number;
    money?: boolean;
  }>,
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
        const money = s.money ?? false;
        const scale = s.scale ?? (money ? KOPECK_SCALE : 1);
        return {
          label: s.label,
          value: raw === null ? '—' : raw * scale,
          format: raw === null ? undefined : (s.format ?? (money ? 'rub' : undefined)),
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
  /** Множитель для money-полей (по умолчанию копейки → рубли). */
  moneyScale?: number;
}): MapPreviewEntry {
  const moneyScale = opts?.moneyScale ?? KOPECK_SCALE;
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
        const money = isMoneyField(output, 'value');
        return (
          <MetricPreview
            label={str(output, 'label') ?? title}
            value={money ? raw * moneyScale : raw}
            format={money ? 'rub' : 'int'}
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
  // --- cashflow KPI (value в КОПЕЙКАХ → money) ---
  'stat.income': buildMetric({ money: true, accent: 'emerald', goodDirection: 'up', labelFallback: 'Доходы' }),
  'stat.expense': buildMetric({ money: true, accent: 'rose', goodDirection: 'down', labelFallback: 'Расходы' }),
  'stat.balance': buildMetric({ money: true, accent: 'sky', labelFallback: 'Баланс' }),
  'stat.custom': buildMetric({ money: true, accent: 'violet', labelFallback: 'KPI' }),

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
      { field: 'count', label: 'Операций' },
      { field: 'totalIncome', label: 'Доход', money: true },
      { field: 'totalExpense', label: 'Расход', money: true },
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
          value: money.has(k) ? (v as number) * KOPECK_SCALE : (v as number),
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

  'chart.cashflow': buildChart({ money: true, accent: 'sky', labelFallback: 'Чистый поток' }),
  'computed.sum': buildGeneric({ previewSize: DEFAULT_PREVIEW_SIZE }),

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
    previewSize: { w: 300, h: 150 },
    needsLiveData: true,
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const labels = parseLabels(output?.__labels);
      const money = parseMoneySet(output?.__money);
      // Колонко-агрегаты: числовые поля без '.' (per-cell ключи) и без служебных.
      const cols = Object.entries(output ?? {})
        .filter(
          ([k, v]) =>
            typeof v === 'number' &&
            !k.startsWith('__') &&
            !k.includes('.') &&
            !['value', 'count', 'missing'].includes(k),
        )
        .slice(0, 3)
        .map(([k, v]) => ({
          label: labels[k] ?? k,
          value: money.has(k) ? (v as number) * KOPECK_SCALE : (v as number),
          format: (money.has(k) ? 'rub' : 'int') as StatCardFormat,
        }));
      const count = num(output, 'count');
      if (cols.length > 0) {
        const items = [
          { label: 'Строк', value: count ?? 0, format: 'int' as StatCardFormat },
          ...cols,
        ];
        return <MultiMetricPreview items={items} />;
      }
      // Фолбэк до live-mount: таблица из config.
      const cfgCols = configStringList(block.config, 'columns', 'label');
      const rowCount = count ?? configArrayLength(block.config, 'rows');
      const colCount = cfgCols.length || configArrayLength(block.config, 'columns');
      return (
        <MiniTablePreview
          columns={cfgCols.length ? cfgCols : ['Данные']}
          rows={[]}
          footer={`${rowCount} строк × ${colCount} колонок`}
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
      const money = isMoneyField(output, 'value');
      // Никогда не показываем сырую формулу (=@uuid…). Только вычисленный
      // результат: число (с money-scale) или строка-результат (не формула).
      const strResult = rawStr && !rawStr.trim().startsWith('=') ? rawStr : null;
      const value: number | string =
        raw !== null ? (money ? raw * KOPECK_SCALE : raw) : (strResult ?? '—');
      return (
        <MetricPreview
          label={title}
          value={value}
          format={typeof value === 'number' ? (money ? 'rub' : 'int') : undefined}
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
  'unit.ozon-kpi': buildChart({ money: true, accent: 'sky', labelFallback: 'Выручка' }),
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
  'unit.ozon-abc': {
    previewSize: { w: 300, h: 120 },
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      // aRevenue/bRevenue/cRevenue публикуются в РУБЛЯХ; показываем доли A/B/C.
      const a = num(output, 'aRevenue') ?? 0;
      const b = num(output, 'bRevenue') ?? 0;
      const c = num(output, 'cRevenue') ?? 0;
      const total = a + b + c;
      const pct = (x: number) => (total > 0 ? (x / total) * 100 : 0);
      const items =
        total > 0
          ? [
              { label: 'A', value: pct(a), format: 'pct' as StatCardFormat },
              { label: 'B', value: pct(b), format: 'pct' as StatCardFormat },
              { label: 'C', value: pct(c), format: 'pct' as StatCardFormat },
            ]
          : [{ label: 'Товаров A', value: num(output, 'value') ?? '—', format: 'int' as StatCardFormat }];
      return <MultiMetricPreview items={items} />;
    },
  },
  'unit.ozon-analytics': buildMetric({ money: true, accent: 'sky', labelFallback: 'Выручка', previewSize: { w: 260, h: 120 } }),
  'unit.ozon-chart': buildChart({ money: true, accent: 'sky', labelFallback: 'Выручка' }),
  'unit.ozon-campaigns': buildGeneric({ previewSize: TABLE_SIZE }),
  'unit.ozon-stock-clusters': buildGeneric({ previewSize: TABLE_SIZE }),
  'unit.ozon-warehouse-clusters': buildGeneric({ previewSize: TABLE_SIZE }),

  // --- calculators / tables / misc ---
  'unit.ozon-calculator': buildMulti(
    [
      { field: 'profitPerMonth', label: 'Прибыль / мес', money: true },
      { field: 'margin', label: 'Маржа', format: 'pct' },
      { field: 'roi', label: 'ROI', format: 'pct' },
    ],
    { previewSize: { w: 300, h: 120 } },
  ),
  'unit.yandex-calculator': buildMulti(
    [
      { field: 'profitPerMonth', label: 'Прибыль / мес', money: true },
      { field: 'margin', label: 'Маржа', format: 'pct' },
      { field: 'roi', label: 'ROI', format: 'pct' },
    ],
    { previewSize: { w: 300, h: 120 } },
  ),
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
  'currency.rates': {
    previewSize: { w: 240, h: 110 },
    needsLiveData: true,
    Preview: ({ block }) => {
      const output = useBlockOutput(block.id);
      const def = getBlockDef(block.type);
      const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
      const rate = num(output, 'value');
      const label = str(output, 'label') ?? block.appearance?.title ?? def?.displayName ?? 'Курс';
      const formatted =
        rate === null
          ? '—'
          : new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(rate) +
            ' ₽';
      return (
        <MetricPreview label={label} value={formatted} icon={Icon} iconColor={block.appearance?.accentColor} />
      );
    },
  },
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
