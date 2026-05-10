// PURPOSE: Каталог рекомендуемых Ollama-моделей с описаниями для UI.
// Модели подобраны под Mac M3 18GB и более слабое железо.

export type CatalogModel = {
  id: string; // ollama tag
  displayName: string;
  family: string;
  size: string; // примерный размер
  ramRequired: string;
  description: string;
  goodFor: string[];
  recommended?: boolean;
};

export const RECOMMENDED_MODELS: CatalogModel[] = [
  {
    id: 'qwen2.5:7b',
    displayName: 'Qwen 2.5 7B',
    family: 'Qwen',
    size: '4.7 GB',
    ramRequired: '8 GB',
    description: 'Универсальная модель Alibaba. Хороший русский, поддерживает вызов функций.',
    goodFor: ['Категоризация транзакций', 'Извлечение сущностей из чеков', 'Чат-секретарь'],
    recommended: true,
  },
  {
    id: 'llama3.2:3b',
    displayName: 'Llama 3.2 3B',
    family: 'Meta',
    size: '2.0 GB',
    ramRequired: '4 GB',
    description: 'Самая лёгкая. Подойдёт для совсем слабых машин или быстрых задач.',
    goodFor: ['Простые операции', 'Тестирование', 'Быстрые ответы'],
  },
  {
    id: 'qwen2.5:14b',
    displayName: 'Qwen 2.5 14B',
    family: 'Qwen',
    size: '9.0 GB',
    ramRequired: '16 GB',
    description: 'Большая Qwen — заметно умнее 7B, но тяжелее. На M3 18GB работает с задержками.',
    goodFor: ['Сложные финансовые расчёты', 'Анализ договоров', 'Качественные ответы'],
  },
  {
    id: 'llama3.1:8b',
    displayName: 'Llama 3.1 8B',
    family: 'Meta',
    size: '4.7 GB',
    ramRequired: '8 GB',
    description: 'Альтернатива Qwen. Хорошо понимает контекст. Чуть слабее на русском.',
    goodFor: ['Код-ассистент', 'Анализ текстов'],
  },
  {
    id: 'gemma2:9b',
    displayName: 'Gemma 2 9B',
    family: 'Google',
    size: '5.4 GB',
    ramRequired: '10 GB',
    description: 'От Google. Хороша для рассуждений.',
    goodFor: ['Логические задачи', 'Структурированный вывод'],
  },
  {
    id: 'nomic-embed-text',
    displayName: 'Nomic Embed (embeddings)',
    family: 'Nomic',
    size: '274 MB',
    ramRequired: '1 GB',
    description: 'Не для чата — генерирует embeddings для RAG-поиска. Нужна обязательно если используете локальный AI.',
    goodFor: ['RAG поиск', 'Семантический поиск по истории'],
    recommended: true,
  },
];

export function findCatalogModel(id: string): CatalogModel | undefined {
  return RECOMMENDED_MODELS.find((m) => m.id === id);
}
