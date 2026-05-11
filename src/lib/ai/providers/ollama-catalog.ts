// PURPOSE: Каталог рекомендуемых Ollama-моделей с описаниями для UI.
// Модели подобраны от ультра-лёгких (Raspberry Pi / 4GB RAM) до тяжёлых (Mac Studio).

export type ModelCategory = 'chat-tiny' | 'chat-light' | 'chat-medium' | 'chat-heavy' | 'code' | 'vision' | 'embedding';

export type CatalogModel = {
  id: string; // ollama tag
  displayName: string;
  family: string;
  size: string; // примерный размер на диске
  ramRequired: string;
  category: ModelCategory;
  description: string;
  goodFor: string[];
  recommended?: boolean;
  vision?: boolean;
  toolCalling?: boolean;
};

export const CATEGORY_LABELS: Record<ModelCategory, string> = {
  'chat-tiny': 'Ультра-лёгкие (для слабых машин)',
  'chat-light': 'Лёгкие (быстрые)',
  'chat-medium': 'Средние (баланс)',
  'chat-heavy': 'Тяжёлые (максимум качества)',
  code: 'Для кода',
  vision: 'С распознаванием изображений',
  embedding: 'Embeddings (для RAG)',
};

export const CATEGORY_ORDER: ModelCategory[] = [
  'chat-tiny',
  'chat-light',
  'chat-medium',
  'chat-heavy',
  'vision',
  'code',
  'embedding',
];

export const RECOMMENDED_MODELS: CatalogModel[] = [
  // ─────── Ультра-лёгкие (для слабых машин, ноутбуков, тестов) ───────
  {
    id: 'qwen2.5:0.5b',
    displayName: 'Qwen 2.5 0.5B',
    family: 'Qwen',
    size: '397 MB',
    ramRequired: '1 GB',
    category: 'chat-tiny',
    description: 'Самая маленькая полноценная модель. Очень быстрая, базовое понимание русского.',
    goodFor: ['Быстрая категоризация', 'Тестирование', 'Слабые машины'],
    toolCalling: true,
  },
  {
    id: 'qwen2.5:1.5b',
    displayName: 'Qwen 2.5 1.5B',
    family: 'Qwen',
    size: '986 MB',
    ramRequired: '2 GB',
    category: 'chat-tiny',
    description: 'Оптимум для слабых машин. Быстрая, неплохо понимает русский.',
    goodFor: ['Простые задачи', 'Категоризация', 'Слабый ноут'],
    recommended: true,
    toolCalling: true,
  },
  {
    id: 'llama3.2:1b',
    displayName: 'Llama 3.2 1B',
    family: 'Meta',
    size: '1.3 GB',
    ramRequired: '2 GB',
    category: 'chat-tiny',
    description: 'Самая лёгкая от Meta. Очень быстрая, английский лучше русского.',
    goodFor: ['Простые операции', 'Быстрые ответы на английском'],
  },

  // ─────── Лёгкие (3-4 GB RAM) ───────
  {
    id: 'qwen2.5:3b',
    displayName: 'Qwen 2.5 3B',
    family: 'Qwen',
    size: '1.9 GB',
    ramRequired: '4 GB',
    category: 'chat-light',
    description: 'Хороший баланс качества и скорости. Уверенно понимает русский.',
    goodFor: ['Универсальный чат', 'Извлечение данных', 'Заметки'],
    recommended: true,
    toolCalling: true,
  },
  {
    id: 'llama3.2:3b',
    displayName: 'Llama 3.2 3B',
    family: 'Meta',
    size: '2.0 GB',
    ramRequired: '4 GB',
    category: 'chat-light',
    description: 'Лёгкая Llama. Хорошее общее качество, средний русский.',
    goodFor: ['Простые задачи', 'Быстрые ответы'],
  },
  {
    id: 'phi3.5:3.8b',
    displayName: 'Phi 3.5 Mini (3.8B)',
    family: 'Microsoft',
    size: '2.2 GB',
    ramRequired: '4 GB',
    category: 'chat-light',
    description: 'Microsoft Phi — обучена на качественных данных. Сильна в рассуждениях.',
    goodFor: ['Анализ', 'Структурированный вывод'],
  },
  {
    id: 'gemma2:2b',
    displayName: 'Gemma 2 2B',
    family: 'Google',
    size: '1.6 GB',
    ramRequired: '3 GB',
    category: 'chat-light',
    description: 'Лёгкая Gemma от Google. Хороша для коротких ответов.',
    goodFor: ['Краткие ответы', 'Резюме'],
  },

  // ─────── Средние (6-8 GB RAM) ───────
  {
    id: 'qwen2.5:7b',
    displayName: 'Qwen 2.5 7B',
    family: 'Qwen',
    size: '4.7 GB',
    ramRequired: '8 GB',
    category: 'chat-medium',
    description: 'Универсальная модель Alibaba. Отличный русский, function calling.',
    goodFor: ['Категоризация транзакций', 'Извлечение сущностей', 'Чат-секретарь'],
    recommended: true,
    toolCalling: true,
  },
  {
    id: 'llama3.1:8b',
    displayName: 'Llama 3.1 8B',
    family: 'Meta',
    size: '4.7 GB',
    ramRequired: '8 GB',
    category: 'chat-medium',
    description: 'Альтернатива Qwen. Хорошо понимает контекст.',
    goodFor: ['Код-ассистент', 'Анализ текстов'],
    toolCalling: true,
  },
  {
    id: 'mistral:7b',
    displayName: 'Mistral 7B',
    family: 'Mistral AI',
    size: '4.1 GB',
    ramRequired: '8 GB',
    category: 'chat-medium',
    description: 'Французская Mistral. Быстрая, хорошо следует инструкциям.',
    goodFor: ['Инструкции', 'Code'],
  },
  {
    id: 'gemma2:9b',
    displayName: 'Gemma 2 9B',
    family: 'Google',
    size: '5.4 GB',
    ramRequired: '10 GB',
    category: 'chat-medium',
    description: 'От Google. Хороша для логических рассуждений.',
    goodFor: ['Логика', 'Структурированный вывод'],
  },

  // ─────── Тяжёлые (16+ GB RAM) ───────
  {
    id: 'qwen2.5:14b',
    displayName: 'Qwen 2.5 14B',
    family: 'Qwen',
    size: '9.0 GB',
    ramRequired: '16 GB',
    category: 'chat-heavy',
    description: 'Большая Qwen — заметно умнее 7B. Для M3 18GB+ или больших серверов.',
    goodFor: ['Сложные расчёты', 'Анализ договоров', 'Качественные ответы'],
    toolCalling: true,
  },
  {
    id: 'qwen2.5:32b',
    displayName: 'Qwen 2.5 32B',
    family: 'Qwen',
    size: '20 GB',
    ramRequired: '32 GB',
    category: 'chat-heavy',
    description: 'Топовая Qwen. Требует серьёзное железо. Конкурирует с GPT-4o-mini.',
    goodFor: ['Эксперт-задачи', 'Длинные документы'],
    toolCalling: true,
  },

  // ─────── Vision (изображения) ───────
  {
    id: 'llama3.2-vision:11b',
    displayName: 'Llama 3.2 Vision 11B',
    family: 'Meta',
    size: '7.9 GB',
    ramRequired: '12 GB',
    category: 'vision',
    description: 'Распознаёт изображения. Чеки, документы, скриншоты.',
    goodFor: ['OCR чеков', 'Анализ скриншотов', 'Описание изображений'],
    vision: true,
  },
  {
    id: 'qwen2.5vl:7b',
    displayName: 'Qwen 2.5 VL 7B',
    family: 'Qwen',
    size: '6 GB',
    ramRequired: '10 GB',
    category: 'vision',
    description: 'Vision-версия Qwen. Хорошо работает с русскими документами.',
    goodFor: ['Сканы документов', 'Извлечение из чеков'],
    vision: true,
    recommended: true,
  },

  // ─────── Code (программирование) ───────
  {
    id: 'qwen2.5-coder:1.5b',
    displayName: 'Qwen Coder 1.5B',
    family: 'Qwen',
    size: '1.0 GB',
    ramRequired: '2 GB',
    category: 'code',
    description: 'Лёгкая code-модель. Автодополнение, простой рефакторинг.',
    goodFor: ['Автокомплит', 'SQL запросы'],
  },
  {
    id: 'qwen2.5-coder:7b',
    displayName: 'Qwen Coder 7B',
    family: 'Qwen',
    size: '4.7 GB',
    ramRequired: '8 GB',
    category: 'code',
    description: 'Топовая open-source code модель. Анализ, написание, рефакторинг.',
    goodFor: ['Написание кода', 'Code review', 'SQL'],
  },

  // ─────── Embeddings (для RAG) ───────
  {
    id: 'nomic-embed-text',
    displayName: 'Nomic Embed Text',
    family: 'Nomic',
    size: '274 MB',
    ramRequired: '1 GB',
    category: 'embedding',
    description: 'НЕ для чата. Генерирует embeddings для RAG-поиска по истории.',
    goodFor: ['RAG поиск', 'Семантический поиск'],
    recommended: true,
  },
  {
    id: 'mxbai-embed-large',
    displayName: 'MixedBread Embed Large',
    family: 'MixedBread AI',
    size: '670 MB',
    ramRequired: '1 GB',
    category: 'embedding',
    description: 'Качественные embeddings. Используется в SOTA RAG-системах.',
    goodFor: ['RAG поиск', 'Multilingual semantic search'],
  },
];

export function findCatalogModel(id: string): CatalogModel | undefined {
  return RECOMMENDED_MODELS.find((m) => m.id === id);
}

/**
 * Парсит HuggingFace URL или slug в Ollama tag.
 *
 * Поддерживает форматы:
 *  - https://huggingface.co/user/repo
 *  - https://huggingface.co/user/repo/blob/main/file.gguf
 *  - huggingface.co/user/repo
 *  - hf.co/user/repo
 *  - user/repo
 *  - user/repo:Q4_K_M
 *
 * Возвращает строку для Ollama pull: hf.co/user/repo:Q4_K_M
 */
export function parseHuggingFaceUrl(input: string): {
  ok: true;
  ollamaTag: string;
  user: string;
  repo: string;
  quantization?: string;
} | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Пустая ссылка' };

  // Извлекаем user/repo и опц. quantization
  const huggingFaceRegex =
    /(?:https?:\/\/)?(?:huggingface\.co|hf\.co)\/([^/\s]+)\/([^/\s:]+)(?::([^/\s]+))?(?:\/[^\s]*)?$/i;
  const slugRegex = /^([^/\s]+)\/([^/\s:]+)(?::([^/\s]+))?$/;

  let user: string | undefined;
  let repo: string | undefined;
  let quantization: string | undefined;

  const m1 = trimmed.match(huggingFaceRegex);
  if (m1) {
    [, user, repo, quantization] = m1;
  } else {
    const m2 = trimmed.match(slugRegex);
    if (m2) {
      [, user, repo, quantization] = m2;
    }
  }

  if (!user || !repo) {
    return {
      ok: false,
      error:
        'Не похоже на HuggingFace ссылку. Примеры: huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF или user/repo:Q4_K_M',
    };
  }

  const isGgufRepo = /gguf/i.test(repo) || /\.gguf(?:$|[?#:])/i.test(trimmed);
  if (!isGgufRepo) {
    return {
      ok: false,
      error:
        `Репозиторий ${user}/${repo} не похож на GGUF-модель. Ollama не скачивает обычные HuggingFace safetensors-репозитории напрямую. Найдите GGUF-версию модели, например repo с "-GGUF" и квантизацией ":Q4_K_M", или используйте модель из каталога Ollama.`,
    };
  }

  const tag = quantization ? `hf.co/${user}/${repo}:${quantization}` : `hf.co/${user}/${repo}`;
  return { ok: true, ollamaTag: tag, user, repo, quantization };
}
