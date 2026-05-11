// PURPOSE: Типы для AI Micro-Agent — контекст блока, запрос/ответ, quick actions

/** Контекст блока, в котором вызван микроагент */
export type BlockContext = {
  blockId?: string;
  blockType?: string;
  blockTitle?: string;
  /** Текущий config блока (данные таблицы, строки custom-data и т.д.) */
  blockData?: Record<string, unknown>;
  /** Ключ страницы */
  pageKey?: string;
};

/** Быстрые действия (табы) */
export type QuickAction =
  | 'summarize'
  | 'fill_cells'
  | 'calculate'
  | 'extract'
  | 'categorize'
  | 'custom';

export const QUICK_ACTIONS: Array<{ id: QuickAction; label: string; prompt: string }> = [
  {
    id: 'summarize',
    label: 'Суммировать',
    prompt: 'Суммируй и структурируй предоставленные данные в компактный список.',
  },
  {
    id: 'fill_cells',
    label: 'По ячейкам',
    prompt: 'Разбери входные данные и запиши по отдельным ячейкам (label + value). Верни массив строк.',
  },
  {
    id: 'calculate',
    label: 'Рассчитать',
    prompt: 'Проанализируй числа и выполни расчёт. Покажи формулу и итог.',
  },
  {
    id: 'extract',
    label: 'Извлечь данные',
    prompt: 'Извлеки структурированные данные (даты, суммы, названия, категории) из входного текста/изображения.',
  },
  {
    id: 'categorize',
    label: 'Категоризировать',
    prompt: 'Разбей данные по категориям. Предложи названия категорий и распредели записи.',
  },
];

/** Одно сообщение в чате с микроагентом */
export type MicroAgentMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Base64-encoded images (для vision-моделей) */
  images?: string[];
};

/** Запрос к /api/ai/chat */
export type MicroAgentRequest = {
  messages: MicroAgentMessage[];
  blockContext?: BlockContext;
  /** Какая quick action выбрана (добавляет пре-промпт) */
  quickAction?: QuickAction;
  /** ID модели (ollama tag или 'openai:gpt-4o' и т.д.) */
  model?: string;
  /** Кастомный блок-промпт (задаёт пользователь) */
  blockPrompt?: string;
};

/** Предложенное действие от AI */
export type SuggestedAction =
  | { type: 'update_block'; payload: Record<string, unknown> }
  | { type: 'create_block'; payload: { blockType: string; config: Record<string, unknown> } }
  | { type: 'text_only'; payload: { text: string } };

/** Ответ от /api/ai/chat */
export type MicroAgentResponse = {
  content: string;
  suggestedAction?: SuggestedAction;
  model: string;
  tokensUsed?: number;
};
