// PURPOSE: Человекочитаемые названия разделов (pageKey → label). Зеркалит логику
// из api/blocks/sources/route.ts, вынесено для переиспользования в кросс-раздельном
// контексте «AI Анализ раздела» (context-sources). Чистый модуль (сервер + клиент).

export const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Главная',
  cashflow: 'Кэшфлоу',
  inbox: 'Входящие',
  deadlines: 'Дедлайны',
  taxes: 'Налоги',
  settings: 'Настройки',
  'marketplaces-ozon-dashboard': 'Аналитика Ozon',
  'unit-economics-ozon': 'Юнит-экономика · Ozon',
  'unit-economics-ozon-multi': 'Юнит-экономика · Ozon мульти',
  'unit-economics-yandex': 'Юнит-экономика · Яндекс',
  'unit-economics-my-store': 'Юнит-экономика · Мой магазин',
};

/**
 * Разрешить label по pageKey.
 * @param customLabels - словарь динамических меток (UE custom-вкладки, доски).
 */
export function resolvePageLabel(
  pageKey: string,
  customLabels?: Record<string, string>,
): string {
  if (customLabels?.[pageKey]) return customLabels[pageKey];
  if (PAGE_LABELS[pageKey]) return PAGE_LABELS[pageKey];
  if (pageKey.startsWith('board-')) return 'Доска';
  if (pageKey.startsWith('unit-economics-custom-')) {
    return `Юнит-экономика · ${pageKey.slice('unit-economics-custom-'.length)}`;
  }
  return pageKey;
}
