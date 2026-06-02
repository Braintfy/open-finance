// PURPOSE: Общие типы и pure-логика для «AI Анализ раздела» (section-scope).
// НЕ 'use client' — используется и сервером (route, zod-валидация), и клиентом
// (модалка: счётчик токенов, парсинг ответа, рендер карточек).
// Зеркалит контракт блока «Ozon · AI инсайты», но нейтрально к типу раздела.
import { z } from 'zod';

export type SectionInsightType = 'positive' | 'warning' | 'danger' | 'info';
export type SectionInsightKind = 'action' | 'observation' | 'opportunity' | 'info';

export type SectionInsightRecommendation = {
  action: string;
  basis: string;
  expectedEffect: string;
};

export type SectionInsight = {
  type: SectionInsightType;
  /** Класс для tabs-фильтра. */
  kind?: SectionInsightKind;
  /** Свободная категория (revenue/ads/general/…). Не рендерится карточкой. */
  category?: string;
  title: string;
  description: string;
  /** Короткий бейдж-метрика, напр. «ДРР 34%». */
  metric?: string;
  tags?: string[];
  recommendation?: SectionInsightRecommendation;
  /** К какому блоку относится инсайт (заголовок блока). */
  blockTitle?: string;
};

export type SectionReport = {
  summary: string;
  insights: SectionInsight[];
};

/** Один сохранённый отчёт раздела (из БД, для истории/контекста). */
export type SectionAiReportDto = {
  id: string;
  createdAt: string;
  pageKey: string;
  pageLabel: string | null;
  model: string | null;
  summary: string;
  insights: SectionInsight[];
  meta: SectionReportMeta | null;
};

export type SectionReportMeta = {
  tokens?: number;
  chars?: number;
  blocks?: number;
};

export const SECTION_AI_MAX_REPORTS = 10;

// ───────────────────────────────────────────────────────────────
// Кросс-раздельный контекст (выбор источников из других разделов)
// ───────────────────────────────────────────────────────────────

/** Один раздел-источник в мини-модалке выбора контекста. */
export type SectionContextSourceDto = {
  pageKey: string;
  label: string;
  /** true — это текущий раздел (база уже = live-блоки, подмешивается только отчёт). */
  isCurrent: boolean;
  /** Блоки раздела (config-only, из layout; без live-значений). */
  blocks: SectionBlockSnapshot[];
  /** Последний сохранённый ИИ-отчёт раздела (или null). */
  lastReport: {
    id: string;
    createdAt: string;
    model: string | null;
    summary: string;
    insights: SectionInsight[];
  } | null;
};

/** Выбор одного раздела-источника для подмешивания в контекст. */
export type ExternalSourceSelection = {
  pageKey: string;
  /** report — последний ИИ-отчёт; blocks — config блоков раздела. */
  mode: 'report' | 'blocks';
};

// ─────────────────────────────────────────────────────────────────────────
// Снапшот блоков страницы (собирается клиентом, отправляется в route)
// ─────────────────────────────────────────────────────────────────────────

export type SectionBlockSnapshot = {
  blockId: string;
  type: string;
  title: string;
  config?: Record<string, unknown>;
  output?: Record<string, number | string | null>;
  /** Богатый текстовый контекст блока для ИИ (конвенция __aiContext). */
  aiContext?: string | null;
  /** blockId источников-зависимостей (для scope «только связанные»). */
  sources?: string[];
};

export const SectionBlockSnapshotSchema = z.object({
  blockId: z.string().max(64),
  type: z.string().max(80),
  title: z.string().max(200),
  config: z.record(z.unknown()).optional(),
  output: z.record(z.union([z.number(), z.string(), z.null()])).optional(),
  aiContext: z.string().max(6000).nullable().optional(),
  sources: z.array(z.string().max(64)).max(50).optional(),
});

/** Выбор кросс-раздельного источника (только ref — тело резолвится сервером из БД). */
export const ExternalSourceSelectionSchema = z.object({
  pageKey: z.string().min(1).max(64),
  mode: z.enum(['report', 'blocks']),
});

// ───────────────────────────────────────────────────────────────
// Контекст по блокам (для «AI Анализ блока» — пикер блоков всего проекта)
// ───────────────────────────────────────────────────────────────

/** Один блок-источник в пикере контекста анализа блока. */
export type BlockContextBlockDto = {
  blockId: string;
  type: string;
  title: string;
  /** Config блока (для режима «данные»; у текущего раздела клиент берёт live). */
  config?: Record<string, unknown>;
  /** Последний сохранённый отчёт блока (или null). */
  lastReport: {
    id: string;
    createdAt: string;
    summary: string;
    insights: SectionInsight[];
  } | null;
};

/** Раздел с блоками для пикера контекста анализа блока. */
export type BlockContextSourceDto = {
  pageKey: string;
  label: string;
  isCurrent: boolean;
  blocks: BlockContextBlockDto[];
};

/** Выбор одного блока-источника для подмешивания (ref — тело резолвится сервером). */
export type BlockContextSelection = {
  pageKey: string;
  blockId: string;
  /** report — последний отчёт блока; data — config/данные блока. */
  mode: 'report' | 'data';
};

export const BlockContextSelectionSchema = z.object({
  pageKey: z.string().min(1).max(64),
  blockId: z.string().min(1).max(64),
  mode: z.enum(['report', 'data']),
});

/** Отфильтровать снапшот до «связанных» блоков (есть зависимости или сами источники). */
export function filterSubgraph(blocks: SectionBlockSnapshot[]): SectionBlockSnapshot[] {
  const sourceIds = new Set<string>();
  for (const b of blocks) for (const s of b.sources ?? []) sourceIds.add(s);
  const related = blocks.filter(
    (b) => (b.sources && b.sources.length > 0) || sourceIds.has(b.blockId),
  );
  return related.length > 0 ? related : blocks;
}

// ─────────────────────────────────────────────────────────────────────────
// Шаблоны быстрого старта (Task 4) — табы над полем ввода
// ─────────────────────────────────────────────────────────────────────────

export type SectionTemplate = { id: string; label: string; prompt: string };

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: 'overview',
    label: 'Общий обзор',
    prompt:
      'Проанализируй раздел: ключевые наблюдения, общая динамика и на чём стоит сфокусироваться в первую очередь.',
  },
  {
    id: 'anomalies',
    label: 'Аномалии',
    prompt:
      'Найди аномалии и резкие отклонения в метриках раздела. Что выбивается из нормы и почему это важно.',
  },
  {
    id: 'risks',
    label: 'Проблемы и риски',
    prompt:
      'Выяви проблемы, риски и узкие места по блокам раздела. Для каждого — степень критичности и что предпринять.',
  },
  {
    id: 'growth',
    label: 'Точки роста',
    prompt:
      'Где точки роста и недозагруженный потенциал? Предложи конкретные действия с ожидаемым эффектом.',
  },
  {
    id: 'changes',
    label: 'Что изменилось',
    prompt:
      'Сравни текущее состояние с прошлыми сохранёнными отчётами (если добавлены в контекст): что изменилось, стало лучше или хуже.',
  },
];

/** Шаблоны быстрого старта для анализа отдельного блока. */
export const BLOCK_ANALYSIS_TEMPLATES: SectionTemplate[] = [
  {
    id: 'overview',
    label: 'Разбор блока',
    prompt:
      'Разбери данные этого блока: ключевые наблюдения, что важно и на что обратить внимание.',
  },
  {
    id: 'anomalies',
    label: 'Аномалии',
    prompt: 'Найди аномалии и отклонения в данных блока. Что выбивается из нормы и почему.',
  },
  {
    id: 'risks',
    label: 'Проблемы',
    prompt: 'Выяви проблемы и риски по данным блока. Для каждого — критичность и что предпринять.',
  },
  {
    id: 'growth',
    label: 'Точки роста',
    prompt: 'Где точки роста по данным блока? Предложи конкретные действия с ожидаемым эффектом.',
  },
  {
    id: 'explain',
    label: 'Объяснить',
    prompt: 'Объясни простыми словами что показывают данные блока и какой из них вывод.',
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Сборка контекста (единая для клиента-счётчика и сервера-промпта)
// ─────────────────────────────────────────────────────────────────────────

function trimText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatOutputFields(
  output: Record<string, number | string | null> | undefined,
): string[] {
  if (!output) return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(output)) {
    if (key.startsWith('__')) continue; // служебные поля (__money/__labels/…)
    if (value === null || value === '') continue;
    lines.push(`${key}: ${value}`);
  }
  return lines;
}

/** Контекст по блокам раздела (markdown). */
export function buildBlocksContext(
  blocks: SectionBlockSnapshot[],
  opts: { maxBlocks?: number; maxAiContext?: number; maxConfig?: number } = {},
): string {
  const maxBlocks = opts.maxBlocks ?? 24;
  const maxAiContext = opts.maxAiContext ?? 2200;
  const maxConfig = opts.maxConfig ?? 400;
  const limited = blocks.slice(0, maxBlocks);
  const parts: string[] = [`## Блоки раздела (${limited.length} из ${blocks.length})`];

  for (const b of limited) {
    const lines: string[] = [`### ${b.title} (${b.type})`];
    if (b.aiContext && b.aiContext.trim()) {
      lines.push(trimText(b.aiContext.trim(), maxAiContext));
    } else {
      const fields = formatOutputFields(b.output);
      if (fields.length) lines.push('Значения: ' + fields.join('; '));
      if (b.config && Object.keys(b.config).length > 0) {
        lines.push('Настройки: ' + trimText(JSON.stringify(b.config), maxConfig));
      }
      if (fields.length === 0 && (!b.config || Object.keys(b.config).length === 0)) {
        lines.push('(нет опубликованных данных)');
      }
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

function fmtReportDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU');
}

/** Один источник кросс-разделного контекста (resolved). */
export type ExternalSourceContext = {
  label: string;
  mode: 'report' | 'blocks';
  report?: { createdAt: string; summary: string; insights: SectionInsight[] };
  blocks?: SectionBlockSnapshot[];
};

/** Контекст из выбранных других разделов (последний отчёт или config блоков). */
export function buildExternalSourcesContext(sources: ExternalSourceContext[]): string {
  if (!sources.length) return '';
  const parts: string[] = ['## Контекст из других разделов'];
  for (const s of sources) {
    if (s.mode === 'report' && s.report) {
      const block: string[] = [`### ${s.label} — ИИ-отчёт ${fmtReportDate(s.report.createdAt)}`.trim()];
      if (s.report.summary) block.push(`Резюме: ${trimText(s.report.summary, 600)}`);
      for (const ins of s.report.insights.slice(0, 6)) {
        block.push(`- [${ins.type}] ${ins.title}: ${trimText(ins.description, 200)}`);
      }
      parts.push(block.join('\n'));
    } else if (s.blocks && s.blocks.length) {
      const limited = s.blocks.slice(0, 12);
      const block: string[] = [`### ${s.label} — блоки (${limited.length} из ${s.blocks.length})`];
      for (const b of limited) {
        const lines: string[] = [`- ${b.title} (${b.type})`];
        if (b.aiContext && b.aiContext.trim()) {
          lines.push('  ' + trimText(b.aiContext.trim(), 800));
        } else {
          const fields = formatOutputFields(b.output);
          if (fields.length) lines.push('  Значения: ' + fields.join('; '));
          else if (b.config && Object.keys(b.config).length > 0) {
            lines.push('  Настройки: ' + trimText(JSON.stringify(b.config), 300));
          }
        }
        block.push(lines.join('\n'));
      }
      parts.push(block.join('\n'));
    }
  }
  return parts.join('\n\n');
}

/** Контекст из выбранных прошлых отчётов (история). */
export function buildReportsContext(
  reports: Array<{ createdAt: string; summary: string; insights: SectionInsight[] }>,
): string {
  if (!reports.length) return '';
  const parts: string[] = ['## Прошлые отчёты (для сравнения)'];
  for (const r of reports) {
    const date = (() => {
      const d = new Date(r.createdAt);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
    })();
    const block: string[] = [`### Отчёт ${date}`.trim()];
    if (r.summary) block.push(`Резюме: ${trimText(r.summary, 600)}`);
    const tops = r.insights.slice(0, 6);
    for (const ins of tops) {
      block.push(`- [${ins.type}] ${ins.title}: ${trimText(ins.description, 200)}`);
    }
    parts.push(block.join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * Полный пользовательский контекст (блоки + история + фокус-вопрос).
 * Используется и клиентом (для счётчика токенов), и сервером (для промпта) —
 * чтобы счётчик совпадал с тем, что реально отправляется.
 */
export function assembleSectionContext(args: {
  pageLabel?: string;
  blocks: SectionBlockSnapshot[];
  reports?: Array<{ createdAt: string; summary: string; insights: SectionInsight[] }>;
  /** Подмешанный контекст из других разделов (последний отчёт или config блоков). */
  extraSections?: ExternalSourceContext[];
  userQuery?: string;
  maxChars?: number;
}): string {
  const { pageLabel, blocks, reports = [], extraSections = [], userQuery, maxChars = 28000 } = args;
  const parts: string[] = [];
  if (pageLabel) parts.push(`# Раздел: ${pageLabel}`);
  parts.push(buildBlocksContext(blocks));
  const reportsCtx = buildReportsContext(reports);
  if (reportsCtx) parts.push(reportsCtx);
  const extraCtx = buildExternalSourcesContext(extraSections);
  if (extraCtx) parts.push(extraCtx);
  if (userQuery && userQuery.trim()) {
    parts.push(`## Фокус-вопрос пользователя\n${userQuery.trim()}`);
  } else {
    parts.push(
      '## Задача\nПроанализируй раздел: дай краткое резюме и набор инсайтов (на что сфокусироваться, аномалии, проблемы, точки роста).',
    );
  }
  const full = parts.join('\n\n');
  return full.length > maxChars ? full.slice(0, maxChars) + '\n…(контекст обрезан)' : full;
}

/** Данные целевого блока (markdown) — для анализа одного блока. */
export function buildTargetBlockContext(
  snapshot: SectionBlockSnapshot,
  opts: { maxAiContext?: number; maxConfig?: number } = {},
): string {
  const maxAiContext = opts.maxAiContext ?? 3500;
  const maxConfig = opts.maxConfig ?? 1200;
  const parts: string[] = [`## Данные блока «${snapshot.title}» (${snapshot.type})`];
  if (snapshot.aiContext && snapshot.aiContext.trim()) {
    parts.push(trimText(snapshot.aiContext.trim(), maxAiContext));
  } else {
    const fields = formatOutputFields(snapshot.output);
    if (fields.length) parts.push('Значения: ' + fields.join('; '));
    if (snapshot.config && Object.keys(snapshot.config).length > 0) {
      parts.push('Настройки: ' + trimText(JSON.stringify(snapshot.config), maxConfig));
    }
    if (fields.length === 0 && (!snapshot.config || Object.keys(snapshot.config).length === 0)) {
      parts.push('(нет опубликованных данных)');
    }
  }
  return parts.join('\n');
}

/**
 * Полный контекст для анализа ОДНОГО блока (целевой блок + опц. прошлый отчёт
 * блока + выбранный контекст других блоков + фокус-вопрос).
 * Единая сборка для клиент-счётчика и сервер-промпта.
 */
export function assembleBlockContext(args: {
  snapshot: SectionBlockSnapshot;
  /** Последний отчёт самого блока (подмешивается по умолчанию). */
  lastReport?: { createdAt: string; summary: string; insights: SectionInsight[] } | null;
  /** Подмешанный контекст из других блоков (резолв из БД / live). */
  extraBlocks?: ExternalSourceContext[];
  userQuery?: string;
  maxChars?: number;
}): string {
  const { snapshot, lastReport, extraBlocks = [], userQuery, maxChars = 24000 } = args;
  const parts: string[] = [`# Блок: ${snapshot.title}`];
  parts.push(buildTargetBlockContext(snapshot));
  if (lastReport) {
    const ctx = buildReportsContext([lastReport]);
    if (ctx) parts.push(ctx.replace('## Прошлые отчёты (для сравнения)', '## Прошлый отчёт этого блока'));
  }
  const extraCtx = buildExternalSourcesContext(extraBlocks);
  if (extraCtx) parts.push(extraCtx.replace('## Контекст из других разделов', '## Контекст из других блоков'));
  if (userQuery && userQuery.trim()) {
    parts.push(`## Фокус-вопрос пользователя\n${userQuery.trim()}`);
  } else {
    parts.push(
      '## Задача\nПроанализируй данные блока: дай краткое резюме и набор инсайтов (наблюдения, аномалии, проблемы, точки роста).',
    );
  }
  const full = parts.join('\n\n');
  return full.length > maxChars ? full.slice(0, maxChars) + '\n…(контекст обрезан)' : full;
}

// ─────────────────────────────────────────────────────────────────────────
// Источник по блокам для анализа раздела: отчёты блоков vs сырые данные
// ─────────────────────────────────────────────────────────────────────────

export type SectionBlockSource = 'reports' | 'raw';

export type BlockReportLite = { summary: string; insights: SectionInsight[] };

/** Компактный текст ИИ-отчёта блока (для подмешивания вместо сырых данных). */
function buildBlockReportText(r: BlockReportLite): string {
  const lines: string[] = [];
  if (r.summary) lines.push(`ИИ-отчёт блока: ${trimText(r.summary, 600)}`);
  for (const ins of r.insights.slice(0, 6)) {
    lines.push(`- [${ins.type}] ${ins.title}: ${trimText(ins.description, 200)}`);
  }
  return lines.join('\n');
}

/**
 * Для mode='reports' заменяет у блоков, по которым есть сохранённый ИИ-отчёт,
 * сырой контент (aiContext/output) на текст отчёта. Единая логика для
 * клиент-счётчика и сервер-промпта — держит паритет токенов.
 */
export function applyBlockReports(
  blocks: SectionBlockSnapshot[],
  reportMap: Record<string, BlockReportLite>,
  mode: SectionBlockSource,
): SectionBlockSnapshot[] {
  if (mode === 'raw') return blocks;
  return blocks.map((b) => {
    const r = reportMap[b.blockId];
    if (!r || (!r.summary && r.insights.length === 0)) return b;
    return { ...b, aiContext: buildBlockReportText(r), output: undefined };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Парсинг строгого JSON-ответа модели → SectionReport
// ─────────────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set<SectionInsightType>(['positive', 'warning', 'danger', 'info']);
const VALID_KINDS = new Set<SectionInsightKind>([
  'action',
  'observation',
  'opportunity',
  'info',
]);

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined;
}

function parseRecommendation(v: unknown): SectionInsightRecommendation | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const action = str(r.action, 300);
  const basis = str(r.basis, 500);
  const expectedEffect = str(r.expectedEffect, 500);
  if (!action && !basis && !expectedEffect) return undefined;
  return { action: action ?? '', basis: basis ?? '', expectedEffect: expectedEffect ?? '' };
}

/** Достать первый JSON-объект (модель иногда оборачивает в ```json). */
export function extractSectionReport(raw: string): SectionReport | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? o.summary.slice(0, 4000) : '';
  const rawInsights = Array.isArray(o.insights) ? o.insights : [];
  const insights: SectionInsight[] = [];
  for (const it of rawInsights) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title : '';
    if (!title) continue;
    const type = String(r.type ?? 'info') as SectionInsightType;
    const kind =
      typeof r.kind === 'string' && VALID_KINDS.has(r.kind as SectionInsightKind)
        ? (r.kind as SectionInsightKind)
        : undefined;
    const tags = Array.isArray(r.tags)
      ? r.tags
          .filter((t): t is string => typeof t === 'string' && !!t.trim())
          .map((t) => t.slice(0, 60))
          .slice(0, 4)
      : undefined;
    insights.push({
      type: VALID_TYPES.has(type) ? type : 'info',
      kind,
      category: str(r.category, 40),
      title: title.slice(0, 300),
      description: typeof r.description === 'string' ? r.description.slice(0, 2000) : '',
      metric: str(r.metric, 120),
      tags: tags && tags.length ? tags : undefined,
      recommendation: parseRecommendation(r.recommendation),
      blockTitle: str(r.blockTitle, 200),
    });
  }
  if (!summary && insights.length === 0) return null;
  return { summary, insights };
}

// ─────────────────────────────────────────────────────────────────────────
// Zod-схема для сохранения отчёта (POST /api/ai/section-reports)
// ─────────────────────────────────────────────────────────────────────────

export const SectionInsightSchema = z.object({
  type: z.enum(['positive', 'warning', 'danger', 'info']),
  kind: z.enum(['action', 'observation', 'opportunity', 'info']).optional(),
  category: z.string().max(40).optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000),
  metric: z.string().max(120).optional(),
  tags: z.array(z.string().max(60)).max(6).optional(),
  recommendation: z
    .object({
      action: z.string().max(300),
      basis: z.string().max(500),
      expectedEffect: z.string().max(500),
    })
    .optional(),
  blockTitle: z.string().max(200).optional(),
});
