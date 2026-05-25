// PURPOSE: Сопоставление pageKey → группа раздела для AI иерархии промптов.
// Группы позволяют задать один section-prompt для всех досок / вкладок UE,
// с возможностью per-pageKey override в admin AI Settings.

export const SECTION_GROUP_IDS = [
  'dashboard',
  'finance',
  'marketplaces',
  'unit-economics',
  'inbox',
  'boards',
] as const;

export type SectionGroupId = (typeof SECTION_GROUP_IDS)[number];

export type SectionGroup = {
  id: SectionGroupId;
  label: string;
  /** Список literal pageKey или regex-паттернов для dynamic pageKeys */
  pageKeys: Array<string | RegExp>;
  description: string;
};

export const SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'dashboard',
    label: 'Главная',
    pageKeys: ['dashboard'],
    description: 'Главный дашборд с KPI и навигационными карточками',
  },
  {
    id: 'finance',
    label: 'Финансы',
    pageKeys: ['cashflow'],
    description: 'Денежный поток — доходы, расходы, баланс, транзакции',
  },
  {
    id: 'marketplaces',
    label: 'Маркетплейсы',
    pageKeys: ['marketplaces-ozon-dashboard'],
    description: 'Аналитика маркетплейсов: Ozon, WB, Яндекс Маркет',
  },
  {
    id: 'unit-economics',
    label: 'Юнит-экономика',
    pageKeys: [/^unit-economics-/],
    description: 'Юнит-экономика: калькуляторы маржи, ROAS, ABC-анализ',
  },
  {
    id: 'inbox',
    label: 'Входящие',
    pageKeys: ['inbox'],
    description: 'Входящие письма и документы — IMAP, распознавание вложений',
  },
  {
    id: 'boards',
    label: 'Доски',
    pageKeys: [/^board-/],
    description: 'Пользовательские доски — произвольный набор блоков',
  },
];

/** Определить группу раздела по pageKey. Возвращает null если не совпадает ни одна группа. */
export function resolveSectionGroup(pageKey: string): SectionGroupId | null {
  for (const group of SECTION_GROUPS) {
    for (const pattern of group.pageKeys) {
      if (typeof pattern === 'string') {
        if (pattern === pageKey) return group.id;
      } else {
        if (pattern.test(pageKey)) return group.id;
      }
    }
  }
  return null;
}

/** Получить объект группы по id */
export function getSectionGroup(id: SectionGroupId): SectionGroup | undefined {
  return SECTION_GROUPS.find((g) => g.id === id);
}
