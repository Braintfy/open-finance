// PURPOSE: Построитель промптов для AI Micro-Agent — собирает system prompt + block context + quick action
import type { BlockContext, QuickAction } from './types';
import { QUICK_ACTIONS } from './types';

/** Базовый system prompt микроагента (поверх глобального AI system prompt) */
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
data = объект config блока. Для custom.data:
{ "rows": [{ "id": "uuid", "label": "Название", "value": 12300 }], "publishMode": "sum", "format": "rubles" }

### Для action: "create_block"
data = { "blockType": "custom.data" | "sheet", "config": { ... } }

### Для action: "text_only"
data = { "text": "Просто текстовый ответ без мутаций" }

## Правила
- Суммы всегда в копейках (целые числа). 1500₽ = 150000
- Не выдумывай данные — только то что есть во входе
- Если не можешь разобрать — спроси уточнение (action: text_only)
- Русский язык`;

/**
 * Собрать контекст блока в текст для промпта
 */
function formatBlockContext(ctx?: BlockContext): string {
  if (!ctx) return '';
  const parts: string[] = ['## Контекст блока'];
  if (ctx.blockType) parts.push(`Тип: ${ctx.blockType}`);
  if (ctx.blockTitle) parts.push(`Название: ${ctx.blockTitle}`);
  if (ctx.pageKey) parts.push(`Страница: ${ctx.pageKey}`);
  if (ctx.blockData && Object.keys(ctx.blockData).length > 0) {
    const dataStr = JSON.stringify(ctx.blockData, null, 2);
    // Ограничим размер данных чтобы не забить контекст
    const truncated = dataStr.length > 2000 ? dataStr.slice(0, 2000) + '\n... (обрезано)' : dataStr;
    parts.push(`Текущие данные блока:\n\`\`\`json\n${truncated}\n\`\`\``);
  }
  return parts.join('\n');
}

/**
 * Получить промпт для quick action
 */
function getQuickActionPrompt(action?: QuickAction): string {
  if (!action || action === 'custom') return '';
  const found = QUICK_ACTIONS.find((a) => a.id === action);
  return found ? `\n## Задача\n${found.prompt}` : '';
}

/**
 * Собрать полный system prompt для микроагента
 */
export function buildMicroAgentSystemPrompt(opts: {
  globalSystemPrompt: string;
  blockContext?: BlockContext;
  quickAction?: QuickAction;
  blockPrompt?: string;
}): string {
  const parts: string[] = [
    opts.globalSystemPrompt,
    '\n---\n',
    MICRO_AGENT_SYSTEM,
  ];

  if (opts.blockPrompt?.trim()) {
    parts.push(`\n## Пользовательская инструкция для блока\n${opts.blockPrompt.trim()}`);
  }

  const blockCtx = formatBlockContext(opts.blockContext);
  if (blockCtx) parts.push(`\n${blockCtx}`);

  const actionPrompt = getQuickActionPrompt(opts.quickAction);
  if (actionPrompt) parts.push(actionPrompt);

  return parts.join('\n');
}
