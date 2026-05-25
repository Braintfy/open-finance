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
   * - 'median' — медиана (значение из середины отсортированного массива)
   * - 'variance' — дисперсия (variance)
   * - 'first' / 'last' — первый/последний не-null источник в порядке dependencies.sources
   * - 'formula' — простое арифметическое выражение над `a, b, c, ...` (см. `formulaExpression`)
   * - 'formula' — произвольная формула (см. config.formula, синтаксис @block.field)
   * - 'ai' — AI-агент собирает/вычисляет данные (см. config.aiPrompt)
   */
  aggregation:
    | 'sum'
    | 'avg'
    | 'min'
    | 'max'
    | 'count'
    | 'median'
    | 'variance'
    | 'first'
    | 'last'
    | 'formula'
    | 'ai';
  /**
   * Выражение для `aggregation: 'formula'`. Переменные — латинские буквы (a, b, c, …)
   * соответствуют `sources[0]`, `sources[1]` и т.д. Поддерживает `+ - * / ( ) %`
   * через тот же безопасный парсер что и `custom.data` simpleMathEval.
   * Пример: `(a + b) * 0.13` — НДФЛ от суммы двух источников.
   */
  formulaExpression?: string;
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
  /**
   * @deprecated Используй aiPromptSupplement (max 500 chars). Оставлен для
   * backward-compat: если supplement пуст — читается как fallback.
   */
  aiPrompt?: string;
  /**
   * Пользовательское дополнение к master-промпту блока (max 500 символов).
   * Добавляется к системному skill-промпту типа блока (BLOCK_SKILLS[type]).
   * Имеет приоритет над устаревшим aiPrompt.
   */
  aiPromptSupplement?: string;
};

/**
 * Привязка cashflow-блока (KPI / chart / top-categories / kpi.grid) к
 * источнику данных. Три режима:
 *
 *   - `empty`  — дефолт для новых блоков. Источник не выбран, блок рендерит
 *                плейсхолдер с CTA «Привязать источник».
 *   - `global` — opt-in legacy: блок работает «как раньше» — фильтрует по
 *                tenant-wide данным с учётом page-level period/source.
 *   - `block`  — bound к конкретному `cashflow.transactions` блоку, чтобы
 *                наследовать его «view» (период / source / категорию /
 *                контрагента / тип). `pageKey` нужен для cross-page bindings.
 *
 * См. `docs/CASHFLOW_BLOCKS.md` и тип `BoundBlockType` в `source-binding.ts`.
 */
export type SourceBinding =
  | { mode: 'empty' }
  | { mode: 'global' }
  | { mode: 'block'; blockId: string; pageKey?: string };

export type BlockCategory = 'stats' | 'tables' | 'charts' | 'custom';

/** Описание типа блока (статическое) */
export type BlockDef = {
  type: string;
  displayName: string;
  description: string;
  category: BlockCategory;
  icon: LucideIcon;
  /**
   * Имя иконки строкой (для сериализации через RSC-границу).
   * Server Components не могут читать `icon.displayName` напрямую — `'use client'`
   * catalog-файлы превращают `icon` в client-reference, у которого нет полей.
   * `iconName` обычно подставляется автоматически через `withMeta()` в `registry.ts`.
   */
  iconName?: string;
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
  /**
   * Блок использует period-настройку (через `useBlockPeriod` или
   * `useEffectivePeriod`). Включается в `pageHasGlobalBoundBlocks` →
   * page-period panel auto-show на странице.
   */
  usesPeriod?: boolean;
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
  /** Контекст страницы — нужен для per-cell SourceBindingPicker в kpi.grid. */
  pageKey?: string;
  /** Все блоки на странице — для SourceBindingPicker (кандидаты + labels). */
  allBlocks?: BlockInstance[];
  /** blockId → display label, для красивого UI в picker'ах. */
  blockLabels?: Record<string, string>;
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

/**
 * Цветовые пресеты для UI пикера.
 * Расширенный набор (24 + default): основные цвета по 2 насыщенности (light/regular)
 * для гибкой палитры в стиле Notion/Linear. Используются как `borderColor` и
 * `accentColor` в `BlockAppearance`.
 */
export const ACCENT_COLORS: Array<{ name: string; value: string; bg: string }> = [
  { name: 'По умолчанию', value: '', bg: 'transparent' },
  // Основной ряд — насыщенные
  { name: 'Синий', value: '#3b82f6', bg: '#3b82f6' },
  { name: 'Голубой', value: '#0ea5e9', bg: '#0ea5e9' },
  { name: 'Тиловый', value: '#14b8a6', bg: '#14b8a6' },
  { name: 'Зелёный', value: '#10b981', bg: '#10b981' },
  { name: 'Лайм', value: '#84cc16', bg: '#84cc16' },
  { name: 'Янтарный', value: '#f59e0b', bg: '#f59e0b' },
  { name: 'Оранжевый', value: '#f97316', bg: '#f97316' },
  { name: 'Красный', value: '#ef4444', bg: '#ef4444' },
  { name: 'Розовый', value: '#ec4899', bg: '#ec4899' },
  { name: 'Фуксия', value: '#d946ef', bg: '#d946ef' },
  { name: 'Фиолетовый', value: '#8b5cf6', bg: '#8b5cf6' },
  { name: 'Индиго', value: '#6366f1', bg: '#6366f1' },
  { name: 'Серый', value: '#64748b', bg: '#64748b' },
  // Светлый ряд — приглушённые (для рамок и мягких акцентов)
  { name: 'Синий·л', value: '#93c5fd', bg: '#93c5fd' },
  { name: 'Тиловый·л', value: '#5eead4', bg: '#5eead4' },
  { name: 'Зелёный·л', value: '#86efac', bg: '#86efac' },
  { name: 'Янтарный·л', value: '#fcd34d', bg: '#fcd34d' },
  { name: 'Красный·л', value: '#fca5a5', bg: '#fca5a5' },
  { name: 'Розовый·л', value: '#f9a8d4', bg: '#f9a8d4' },
  { name: 'Фиолетовый·л', value: '#c4b5fd', bg: '#c4b5fd' },
  { name: 'Серый·л', value: '#cbd5e1', bg: '#cbd5e1' },
  // Глубокий ряд — насыщенные dark-shade
  { name: 'Синий·т', value: '#1d4ed8', bg: '#1d4ed8' },
  { name: 'Зелёный·т', value: '#047857', bg: '#047857' },
  { name: 'Чёрный', value: '#0f172a', bg: '#0f172a' },
];

/**
 * Иконки lucide для быстрого пикера (расширенная палитра по умолчанию).
 * Покрывает финансы, графики, действия, объекты — самые ходовые для финансовых
 * блоков. Полный каталог (>1500 иконок) — в `icon-library.ts`, доступен через
 * "Выбрать из каталога".
 */
export const ICON_NAMES = [
  // Финансы и деньги
  'Wallet', 'DollarSign', 'CreditCard', 'Banknote', 'Coins',
  'PiggyBank', 'Landmark', 'Receipt', 'CircleDollarSign', 'HandCoins',
  'RussianRuble', 'Percent', 'BadgeDollarSign', 'BadgePercent',
  // Графики и аналитика
  'BarChart3', 'PieChart', 'LineChart', 'TrendingUp', 'TrendingDown',
  'Activity', 'Sigma', 'Calculator', 'Target', 'Gauge',
  // Время, календарь
  'Calendar', 'Clock', 'Hourglass', 'Timer',
  // Бизнес и работа
  'Briefcase', 'Building2', 'Building', 'Factory', 'Store',
  'ShoppingCart', 'ShoppingBag', 'Package', 'Truck', 'Boxes',
  // Люди и социальное
  'Users', 'User', 'UserCheck', 'Heart', 'Star',
  // Действия и стрелки
  'ArrowUp', 'ArrowDown', 'ArrowUpRight', 'ArrowDownRight', 'Repeat',
  'Plus', 'Minus', 'Check', 'X',
  // Объекты данных
  'Database', 'Server', 'HardDrive', 'FileText', 'File',
  'Folder', 'Inbox', 'Mail', 'Bell', 'Tag',
  // Спецсимволы
  'Sparkles', 'Zap', 'Flame', 'Bookmark', 'Bot',
  'Cpu', 'Globe', 'Lock', 'Key', 'Settings',
] as const;
export type IconName = (typeof ICON_NAMES)[number];
