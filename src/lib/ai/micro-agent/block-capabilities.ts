// PURPOSE: Описание возможностей каждого типа блока для AI system prompt.
// AI получает этот контекст чтобы знать: что блок умеет, как его редактировать,
// какой формат config ожидается. Без этого AI может попытаться сделать таблицу из KPI.

export type BlockCapability = {
  type: string;
  displayName: string;
  description: string;
  /** Можно ли AI обновлять config этого блока */
  canUpdate: boolean;
  /** Формат config с примером (для AI) */
  configFormat?: string;
  /** Что можно делать с этим блоком */
  actions: string[];
  /** Ограничения */
  limitations: string[];
};

/**
 * Реестр возможностей блоков.
 * Добавлять сюда при создании нового типа блока.
 */
export const BLOCK_CAPABILITIES: Record<string, BlockCapability> = {
  'sheet': {
    type: 'sheet',
    displayName: 'Таблица (Excel)',
    description: 'Полноценная таблица с ячейками, формулами, настраиваемыми колонками и строками. Как Excel/Google Sheets.',
    canUpdate: true,
    configFormat: `{
  "title": "Таблица",
  "rows": 10,
  "cols": 5,
  "cells": [
    ["Название", "Значение"],
    ["Строка 1", "100"]
  ],
  "colWidths": [150, 100],
  "headerCells": [{ "id": "h1", "label": "Итого", "value": "=SUM(B2:B10)" }]
}`,
    actions: [
      'Заполнить ячейки данными (cells: [["A1", "B1"], ["A2", "B2"]])',
      'Добавить строки/колонки (увеличить rows/cols)',
      'Записать формулы (=SUM, =AVERAGE, =MAX и т.д.)',
      'Создать header-ячейки с агрегацией',
    ],
    limitations: [
      'cells — двумерный массив строк: cells[row][col]',
      'Значения — всегда строки (числа тоже записываются как строки: "150000")',
      'Суммы в рублях — в копейках (150000 = 1500₽)',
    ],
  },

  'custom.data': {
    type: 'custom.data',
    displayName: 'Данные (универсальный)',
    description: 'Список строк label + value. Подходит для простых данных: перечень товаров, расходов, метрик.',
    canUpdate: true,
    configFormat: `{
  "rows": [
    { "id": "uuid1", "label": "Название позиции", "value": 150000 },
    { "id": "uuid2", "label": "Другая позиция", "value": 50000 }
  ],
  "publishMode": "sum",
  "format": "rubles",
  "showKopecks": null
}`,
    actions: [
      'Добавить строки (rows: массив { id, label, value })',
      'Изменить существующие строки',
      'Изменить формат (rubles/number/percent)',
      'Изменить режим агрегации (sum/avg/count/last)',
    ],
    limitations: [
      'value — всегда число (integer). Для рублей — в копейках (1500₽ = 150000)',
      'id — должен быть уникальный UUID для каждой строки',
      'Нет колонок — только label + value. Для таблиц используй sheet',
    ],
  },

  'stat.income': {
    type: 'stat.income',
    displayName: 'Доходы (KPI)',
    description: 'Автоматический KPI-блок. Показывает сумму доходов из базы транзакций.',
    canUpdate: false,
    actions: [],
    limitations: [
      'Только для чтения — данные берутся из транзакций автоматически',
      'Нельзя вручную изменить значение — нужно добавить транзакции',
    ],
  },

  'stat.expense': {
    type: 'stat.expense',
    displayName: 'Расходы (KPI)',
    description: 'Автоматический KPI-блок. Показывает сумму расходов из базы транзакций.',
    canUpdate: false,
    actions: [],
    limitations: [
      'Только для чтения — данные берутся из транзакций автоматически',
    ],
  },

  'stat.balance': {
    type: 'stat.balance',
    displayName: 'Баланс (KPI)',
    description: 'Автоматический KPI-блок. Баланс = доходы - расходы.',
    canUpdate: false,
    actions: [],
    limitations: [
      'Только для чтения — вычисляется автоматически',
    ],
  },

  'stat.custom': {
    type: 'stat.custom',
    displayName: 'Кастомный KPI',
    description: 'Пользовательская метрика с ручным значением.',
    canUpdate: true,
    configFormat: `{
  "value": 150000,
  "label": "Мой показатель",
  "format": "rubles"
}`,
    actions: [
      'Обновить значение (value: число)',
      'Изменить label',
      'Изменить формат отображения',
    ],
    limitations: [
      'Одно значение, не список и не таблица',
    ],
  },

  'computed.sum': {
    type: 'computed.sum',
    displayName: 'Вычисляемый блок',
    description: 'Агрегирует значения из других блоков (sum/avg/min/max/count).',
    canUpdate: false,
    actions: [],
    limitations: [
      'Значение вычисляется из зависимостей (dependencies). AI не может напрямую изменить.',
      'Для настройки — используй Settings dialog блока',
    ],
  },

  'cashflow.top-categories': {
    type: 'cashflow.top-categories',
    displayName: 'Топ категорий',
    description: 'Показывает топ категорий доходов или расходов из транзакций.',
    canUpdate: false,
    actions: [],
    limitations: [
      'Только для чтения — данные из транзакций',
    ],
  },

  'cashflow.transactions': {
    type: 'cashflow.transactions',
    displayName: 'Список транзакций',
    description: 'Таблица всех транзакций с фильтрацией.',
    canUpdate: false,
    actions: [],
    limitations: [
      'Только для чтения — показывает транзакции из БД',
    ],
  },

  'navigate.card': {
    type: 'navigate.card',
    displayName: 'Навигационная карточка',
    description: 'Ссылка на другую страницу/модуль.',
    canUpdate: true,
    configFormat: `{
  "href": "/cashflow",
  "title": "Денежный поток",
  "description": "Доходы и расходы",
  "comingSoon": false
}`,
    actions: ['Изменить ссылку, title, description'],
    limitations: ['Только навигация — нет данных'],
  },

  'chart.cashflow': {
    type: 'chart.cashflow',
    displayName: 'График денежного потока',
    description: 'Визуализация доходов/расходов по месяцам.',
    canUpdate: false,
    actions: [],
    limitations: ['Только для чтения — данные из транзакций'],
  },

  'ai.micro-agent': {
    type: 'ai.micro-agent',
    displayName: 'AI Микроагент',
    description: 'Встроенный AI-ассистент. Принимает запросы, структурирует данные.',
    canUpdate: true,
    configFormat: `{
  "blockPrompt": "Доп. инструкция",
  "model": "qwen2.5:7b"
}`,
    actions: ['Изменить промпт блока', 'Изменить модель'],
    limitations: ['Это сам AI-блок — обычно не нужно менять его config через AI'],
  },
};

/**
 * Получить описание возможностей блока для system prompt.
 * Если тип неизвестен — возвращает generic описание.
 */
export function getBlockCapabilityPrompt(blockType?: string): string {
  if (!blockType) return '';

  const cap = BLOCK_CAPABILITIES[blockType];
  if (!cap) {
    return `\n## Возможности блока\nТип: ${blockType} (неизвестный тип — будь осторожен, проверь что делаешь)`;
  }

  const parts: string[] = [
    `\n## Возможности блока «${cap.displayName}»`,
    cap.description,
  ];

  if (!cap.canUpdate) {
    parts.push('\n**⚠️ ЭТОТ БЛОК НЕЛЬЗЯ ОБНОВИТЬ ЧЕРЕЗ AI** — данные генерируются автоматически.');
    parts.push('Предложи action: "text_only" и объясни пользователю почему.');
    if (cap.limitations.length > 0) {
      parts.push('Ограничения: ' + cap.limitations.join('; '));
    }
    return parts.join('\n');
  }

  parts.push('\n### Допустимые действия:');
  cap.actions.forEach((a) => parts.push(`- ${a}`));

  if (cap.configFormat) {
    parts.push('\n### Формат config (JSON):');
    parts.push('```json');
    parts.push(cap.configFormat);
    parts.push('```');
  }

  if (cap.limitations.length > 0) {
    parts.push('\n### Ограничения:');
    cap.limitations.forEach((l) => parts.push(`- ${l}`));
  }

  return parts.join('\n');
}
