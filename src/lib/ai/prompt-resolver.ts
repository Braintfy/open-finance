// PURPOSE: Центральный composer иерархии AI промптов (resolvePromptStack).
// Порядок слоёв (снизу вверх = самый специфичный выигрывает):
//   global (tenant/default) → section-group → per-page → block-type-skill → user-supplement → capabilities → snapshot

import type { TenantSettings } from '@/lib/db/schema/tenants';
import type { BlockInstance } from '@/lib/blocks/types';
import type { BlockContext, QuickAction } from '@/lib/ai/micro-agent/types';
import { getSystemPrompt } from '@/lib/ai/system-prompt';
import { resolveSectionGroup } from '@/lib/ai/sections';
import { getSectionPrompt } from '@/lib/ai/prompts/section-defaults';
import { getBlockSkill } from '@/lib/ai/prompts/block-skills/index';
import { getPointwisePrompt } from '@/lib/ai/prompts/pointwise';
import { getBlockCapabilityPrompt } from '@/lib/ai/micro-agent/block-capabilities';
import { QUICK_ACTIONS } from '@/lib/ai/micro-agent/types';

/** Тип вызова AI */
export type PromptScope = 'block' | 'section' | 'pointwise';

/** Метаданные о слоях в собранном промпте (для дебаггинга/аудита) */
export type PromptLayers = Array<
  'global' | 'micro-agent' | 'section' | 'page' | 'block-skill' | 'supplement' | 'legacy' | 'capabilities' | 'snapshot' | 'quick-action' | 'section-context' | 'pointwise'
>;

export type ResolveResult = {
  systemPrompt: string;
  meta: { layers: PromptLayers };
};

export type PromptResolverCtx = {
  tenantSettings: TenantSettings | null | undefined;
  pageKey?: string;
  blockType?: string;
  /** Используется для читаемого имени блока в промпте */
  blockTitle?: string;
  /** Текущий config блока — передаётся как snapshot данных */
  blockData?: Record<string, unknown>;
  /** Supplement из blockInstance.aiPromptSupplement (max 500 char) */
  aiPromptSupplement?: string;
  /** Legacy из blockInstance.aiPrompt (deprecated fallback) */
  aiPromptLegacy?: string;
  /** Published live values блока (из useBlockValuePublisher) */
  publishedValue?: unknown;
  publishedMoney?: string;
  publishedPeriodKey?: string;
  /** Scope определяет какие слои добавляются */
  scope: PromptScope;
  quickAction?: QuickAction;
  /**
   * Список блоков на странице — только для scope='section'.
   * Каждый элемент: тип, название, краткий config-snapshot.
   */
  sectionBlocks?: Array<{
    blockId: string;
    blockType: string;
    blockTitle?: string;
    config?: Record<string, unknown>;
    publishedValue?: unknown;
  }>;
};

/**
 * Базовый system prompt для micro-agent (хранится здесь для переиспользования).
 * Дублируется из micro-agent/prompt.ts — при изменении обновлять в обоих местах.
 */
const MICRO_AGENT_SYSTEM = `Ты — AI-микроагент Open Finance. Твоя задача — помогать пользователю быстро создавать и заполнять блоки данных.

## Что ты делаешь
- Принимаешь разнородные входные данные (текст, списки из чатов, скриншоты таблиц, голосовые заметки после транскрипции)
- Структурируешь их в формат блока: строки с label + value, таблицы, списки
- Отвечаешь СТРОГО по делу — без вступлений, "конечно!", "с удовольствием!" и т.п.

## Формат ответа
Всегда отвечай в формате:
1. Краткий текстовый ответ (что ты сделал, 1-2 предложения)
2. JSON-блок с результатом в формате:

\`\`\`json
{
  "action": "update_block" | "create_block" | "text_only",
  "data": { ... }
}
\`\`\`

### Для action: "update_block"
data = объект config блока (формат зависит от типа блока — см. раздел "Возможности блока" ниже)

### Для action: "create_block"
data = { "blockType": "custom.data" | "sheet", "config": { ... } }
Используй "sheet" для таблиц с несколькими колонками, "custom.data" для простых списков (label + value).

### Для action: "text_only"
data = { "text": "Просто текстовый ответ без мутаций" }
Используй это если блок нельзя обновить или нужно уточнение.

## Правила
- Суммы всегда в копейках (целые числа). 1500₽ = 150000
- Не выдумывай данные — только то что есть во входе
- Если не можешь разобрать — спроси уточнение (action: text_only)
- Если блок нельзя обновить (read-only) — предложи создать новый блок (create_block) или объясни пользователю
- JSON должен быть валидным: двойные кавычки, без комментариев, без trailing comma
- Русский язык`;

/** Форматировать snapshot блока для промпта */
function formatBlockSnapshot(
  blockType?: string,
  blockTitle?: string,
  blockData?: Record<string, unknown>,
  publishedValue?: unknown,
  publishedPeriodKey?: string,
): string {
  const parts: string[] = ['## Контекст блока'];
  if (blockType) parts.push(`Тип: ${blockType}`);
  if (blockTitle) parts.push(`Название: ${blockTitle}`);

  if (blockData && Object.keys(blockData).length > 0) {
    const dataStr = JSON.stringify(blockData, null, 2);
    const truncated = dataStr.length > 2000 ? dataStr.slice(0, 2000) + '\n... (обрезано)' : dataStr;
    parts.push(`Текущие данные блока:\n\`\`\`json\n${truncated}\n\`\`\``);
  }

  if (publishedValue !== undefined && publishedValue !== null) {
    const valStr = typeof publishedValue === 'object'
      ? JSON.stringify(publishedValue)
      : String(publishedValue);
    const truncVal = valStr.length > 500 ? valStr.slice(0, 500) + '...' : valStr;
    parts.push(`Текущее live-значение блока: ${truncVal}`);
  }

  if (publishedPeriodKey) {
    parts.push(`Период блока: ${publishedPeriodKey}`);
  }

  return parts.join('\n');
}

/** Форматировать контекст страницы для section-анализа */
function formatSectionContext(
  pageKey: string | undefined,
  blocks: PromptResolverCtx['sectionBlocks'],
): string {
  if (!blocks || blocks.length === 0) return '';
  const parts: string[] = [`## Контекст страницы${pageKey ? ` (${pageKey})` : ''}`];
  parts.push(`Блоков на странице: ${blocks.length}`);

  const snippets = blocks.slice(0, 15).map((b) => {
    const title = b.blockTitle ?? b.blockType;
    let snippet = `- **${title}** (${b.blockType})`;
    if (b.publishedValue !== undefined && b.publishedValue !== null) {
      const v = typeof b.publishedValue === 'object'
        ? JSON.stringify(b.publishedValue).slice(0, 200)
        : String(b.publishedValue).slice(0, 200);
      snippet += `: ${v}`;
    }
    return snippet;
  });
  parts.push(snippets.join('\n'));

  if (blocks.length > 15) {
    parts.push(`... и ещё ${blocks.length - 15} блоков`);
  }

  return parts.join('\n');
}

/**
 * Собрать полный stack system prompt для AI запроса.
 * Единая точка для всех AI routes в проекте.
 */
export function resolvePromptStack(ctx: PromptResolverCtx): ResolveResult {
  const layers: PromptLayers = [];
  const parts: string[] = [];

  const settings = ctx.tenantSettings;

  // ── Слой 1: Global system prompt (tenant override или DEFAULT_SYSTEM_PROMPT) ──
  const globalPrompt = getSystemPrompt(settings);
  parts.push(globalPrompt);
  layers.push('global');

  // ── Слой 2: Micro-agent system (только для block/pointwise scope) ──
  if (ctx.scope === 'block' || ctx.scope === 'pointwise') {
    parts.push('\n---\n');
    parts.push(MICRO_AGENT_SYSTEM);
    layers.push('micro-agent');
  }

  // ── Слой 3: Section group prompt ──
  const groupId = ctx.pageKey ? resolveSectionGroup(ctx.pageKey) : null;
  const sectionPrompt = getSectionPrompt(
    ctx.pageKey,
    groupId,
    settings?.aiPrompts?.sections,
  );
  if (sectionPrompt) {
    parts.push(`\n## Контекст раздела\n${sectionPrompt}`);
    layers.push(groupId ? 'section' : 'page');
  }

  // ── Слой 4: Block-type skill prompt (только для block/pointwise scope) ──
  if ((ctx.scope === 'block' || ctx.scope === 'pointwise') && ctx.blockType) {
    const blockSkill = getBlockSkill(
      ctx.blockType,
      settings?.aiPrompts?.blocks?.[ctx.blockType],
    );
    if (blockSkill) {
      parts.push(`\n## Специализация блока\n${blockSkill}`);
      layers.push('block-skill');
    }
  }

  // ── Слой 5: Pointwise prompt (только для pointwise scope) ──
  if (ctx.scope === 'pointwise') {
    const pointwisePrompt = getPointwisePrompt(settings?.aiPrompts?.pointwise);
    parts.push(`\n${pointwisePrompt}`);
    layers.push('pointwise');
  }

  // ── Слой 6: User supplement (приоритет над legacy aiPrompt) ──
  const supplement = ctx.aiPromptSupplement?.trim();
  const legacy = ctx.aiPromptLegacy?.trim();

  if (supplement) {
    parts.push(`\n## Пользовательская инструкция для блока\n${supplement}`);
    layers.push('supplement');
  } else if (legacy) {
    parts.push(`\n## Пользовательская инструкция для блока\n${legacy}`);
    layers.push('legacy');
  }

  // ── Слой 7: Block capabilities (технический формат config) ──
  if (ctx.scope === 'block' && ctx.blockType) {
    const capabilityPrompt = getBlockCapabilityPrompt(ctx.blockType);
    if (capabilityPrompt) {
      parts.push(capabilityPrompt);
      layers.push('capabilities');
    }
  }

  // ── Слой 8: Data snapshot (config + live values) ──
  if (ctx.scope === 'block' && (ctx.blockData || ctx.publishedValue !== undefined)) {
    const snapshot = formatBlockSnapshot(
      ctx.blockType,
      ctx.blockTitle,
      ctx.blockData,
      ctx.publishedValue,
      ctx.publishedPeriodKey,
    );
    if (snapshot) {
      parts.push(`\n${snapshot}`);
      layers.push('snapshot');
    }
  }

  // ── Слой 9: Section context (список блоков страницы) — только для section scope ──
  if (ctx.scope === 'section' && ctx.sectionBlocks) {
    const sectionCtx = formatSectionContext(ctx.pageKey, ctx.sectionBlocks);
    if (sectionCtx) {
      parts.push(`\n${sectionCtx}`);
      layers.push('section-context');
    }
  }

  // ── Слой 10: Quick action prompt ──
  if (ctx.quickAction && ctx.quickAction !== 'custom') {
    const qa = QUICK_ACTIONS.find((a) => a.id === ctx.quickAction);
    if (qa) {
      parts.push(`\n## Задача\n${qa.prompt}`);
      layers.push('quick-action');
    }
  }

  return {
    systemPrompt: parts.join('\n'),
    meta: { layers },
  };
}
