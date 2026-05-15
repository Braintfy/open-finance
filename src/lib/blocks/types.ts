// PURPOSE: Типы для Configurable Block-Grid Architecture (см. PLAN.md и memory)
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { z } from 'zod';

/** Универсальные косметические настройки, применимые к любому блоку */
export type BlockAppearance = {
  /** Override displayName из BlockDef */
  title?: string;
  /** CSS color value (hex/rgb/var) — рамка блока */
  borderColor?: string;
  /** CSS color value — акцент (полоски прогресса, иконки внутри) */
  accentColor?: string;
  /** Имя иконки lucide (если блок поддерживает override иконки) */
  icon?: string;
};

/**
 * Связь блока с другими блоками (Excel-style references).
 * Позволяет одному блоку использовать значения из других блоков как источники.
 *
 * Пример: блок «Сумма поступлений от ИП» зависит от 4 KPI-блоков
 * с поступлениями от разных контрагентов и суммирует их.
 *
 * Ссылка: pageKey + blockId (можно ссылаться между страницами).
 * Если pageKey не указан — ссылка локальная (на текущую страницу).
 */
export type BlockRef = {
  /** ID блока-источника */
  blockId: string;
  /** Ключ страницы блока-источника (опционально для cross-page ссылок) */
  pageKey?: string;
  /**
   * Имя поля в выходных данных блока-источника.
   * По умолчанию 'value' (для KPI-блоков). Для table-блоков может быть column name.
   */
  field?: string;
  /** Человекочитаемая подпись для UI (необязательно — кэш для скорости) */
  label?: string;
};

/**
 * Зависимости блока. Используется computed-блоками (sum / formula / aggregation).
 * Реактивный пересчёт: при изменении любого источника блок пересчитывается.
 */
export type BlockDependencies = {
  /** Список блоков-источников (Excel: «эта ячейка зависит от A1, B2, C5») */
  sources: BlockRef[];
  /**
   * Тип агрегации/вычисления:
   * - 'sum' — сумма значений всех источников
   * - 'avg' — среднее
   * - 'min' / 'max'
   * - 'count' — количество не-null источников
   * - 'formula' — произвольная формула (см. config.formula, синтаксис @block.field)
   * - 'ai' — AI-агент собирает/вычисляет данные (см. config.aiPrompt)
   */
  aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'formula' | 'ai';
};

/** Один блок на странице — позиция в гриде + произвольный config + appearance + зависимости */
export type BlockInstance = {
  id: string; // uuid
  type: string; // ключ из registry, e.g. 'stat.income' | 'sheet' | 'computed.sum'
  x: number; // grid column 0..N
  y: number;
  w: number; // ширина в колонках
  h: number; // высота в строках
  config?: Record<string, unknown>;
  appearance?: BlockAppearance;
  /** Зависимости от других блоков (Excel-style cell references). Только у computed-блоков. */
  dependencies?: BlockDependencies;
};

export type BlockCategory = 'stats' | 'tables' | 'charts' | 'custom';

/** Описание типа блока (статическое) */
export type BlockDef = {
  type: string;
  displayName: string;
  description: string;
  category: BlockCategory;
  icon: LucideIcon;
  defaultSize: { w: number; h: number };
  /** Минимум в ячейках grid (1x1 разрешено по умолчанию) */
  minSize: { w: number; h: number };
  /**
   * Блок поддерживает зависимости от других блоков (computed.sum, formula, AI и т.п.).
   * Если true — в Settings dialog появляется таб «Связи» с BlockReferencePicker.
   */
  supportsDependencies?: boolean;
  /**
   * Минимальный размер в пикселях, при котором контент ещё читаем.
   * Если реальный размер меньше — BlockGrid покажет warning overlay.
   * По умолчанию: 120x80 (работает для большинства блоков с числом + подписью).
   */
  minContentSize?: { w: number; h: number };
  /** Где этот блок имеет смысл (cashflow, dashboard, *) */
  pages: string[]; // '*' = везде
  /**
   * Страницы, на которых блок попадает в зону «Рекомендуемые» в модалке
   * добавления и в маркетплейсе блоков. Если не задано — рекомендуемые
   * выводятся по правилу `pages.includes(pageKey) || pages.includes('*')`.
   */
  recommendedFor?: string[];
  /**
   * Свободные теги для маркетплейса блоков (фильтры, поиск).
   * Например: ['marketplace', 'unit-economics'], ['analytics'], ['ai'].
   */
  tags?: string[];
  /**
   * Источник блока — для будущих пользовательских/купленных блоков.
   * 'builtin' (default) — встроенный, 'user' — созданный юзером, 'paid' — куплен.
   */
  source?: 'builtin' | 'user' | 'paid';
  configSchema?: z.ZodSchema;
  /** Дефолтный config для нового инстанса */
  defaultConfig?: () => Record<string, unknown>;
  /** Опциональная форма блок-специфичных настроек (рендерится в табе «Параметры» Settings dialog) */
  SettingsForm?: (props: BlockSettingsFormProps) => ReactNode;
  Render: BlockRender;
};

export type BlockSettingsFormProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  instance?: BlockInstance;
};

export type BlockRenderProps = {
  instance: BlockInstance;
  tenantId: string;
  /** Колбек для сохранения config (применяется в режиме редактирования внутри блока) */
  onConfigChange?: (config: Record<string, unknown>) => void;
};

export type BlockRender = (props: BlockRenderProps) => ReactNode;

/** Полный layout страницы (одна запись в block_layouts) */
export type PageLayout = {
  pageKey: string;
  blocks: BlockInstance[];
  hiddenSections?: string[]; // ['inbox', 'deadlines'] — скрытые элементы навигации
};

/** Цветовые пресеты для UI пикера */
export const ACCENT_COLORS: Array<{ name: string; value: string; bg: string }> = [
  { name: 'По умолчанию', value: '', bg: 'transparent' },
  { name: 'Синий', value: '#3b82f6', bg: '#3b82f6' },
  { name: 'Зелёный', value: '#10b981', bg: '#10b981' },
  { name: 'Красный', value: '#ef4444', bg: '#ef4444' },
  { name: 'Янтарный', value: '#f59e0b', bg: '#f59e0b' },
  { name: 'Фиолетовый', value: '#8b5cf6', bg: '#8b5cf6' },
  { name: 'Розовый', value: '#ec4899', bg: '#ec4899' },
  { name: 'Серый', value: '#64748b', bg: '#64748b' },
];

/** Иконки lucide для быстрого пикера (палитра по умолчанию). Полный каталог — в icon-library.ts */
export const ICON_NAMES = [
  'Wallet',
  'DollarSign',
  'CreditCard',
  'Banknote',
  'Coins',
  'TrendingUp',
  'TrendingDown',
  'BarChart3',
  'PieChart',
  'Activity',
  'Target',
  'Calendar',
  'Briefcase',
  'ShoppingCart',
  'Receipt',
  'Building2',
  'Users',
  'Heart',
  'Star',
  'Zap',
  'ArrowDown',
  'ArrowUp',
  'Database',
  'Sparkles',
] as const;
export type IconName = (typeof ICON_NAMES)[number];
