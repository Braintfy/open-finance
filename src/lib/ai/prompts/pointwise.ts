// PURPOSE: Промпт для «точечного» анализа блока в контексте его dependency-tree.
// Используется в /api/ai/analyze-section когда scope='subgraph' или в per-block pointwise analysis.

/**
 * Дефолтный промпт для pointwise (dependency-tree) анализа.
 * Применяется когда AI должен проанализировать связи между блоками.
 * Admin может переопределить через tenants.settings.aiPrompts.pointwise.
 */
export const DEFAULT_POINTWISE_PROMPT = `Ты анализируешь связи между блоками финансовой панели.

## Задача
Проанализируй граф зависимостей: какие блоки являются источниками данных, какие — потребителями.
Выяви потенциальные проблемы: устаревшие данные, разрыв цепочки вычислений, конфликт периодов.

## Формат ответа
1. Краткая карта связей (2-3 предложения): «Блок A получает данные из B и C, используется блоком D»
2. Выявленные проблемы или риски (если есть)
3. Рекомендации по улучшению структуры (если есть)

Отвечай конкретно, ссылайся на конкретные блоки по их названиям.`;

/**
 * Получить pointwise prompt.
 * @param tenantOverride - override из tenants.settings.aiPrompts.pointwise
 */
export function getPointwisePrompt(tenantOverride?: string): string {
  if (tenantOverride?.trim()) return tenantOverride.trim();
  return DEFAULT_POINTWISE_PROMPT;
}
