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

/** Один блок на странице — позиция в гриде + произвольный config + appearance */
export type BlockInstance = {
  id: string; // uuid
  type: string; // ключ из registry, e.g. 'stat.income' | 'sheet'
  x: number; // grid column 0..N
  y: number;
  w: number; // ширина в колонках
  h: number; // высота в строках
  config?: Record<string, unknown>;
  appearance?: BlockAppearance;
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
   * Минимальный размер в пикселях, при котором контент ещё читаем.
   * Если реальный размер меньше — BlockGrid покажет warning overlay.
   * По умолчанию: 120x80 (работает для большинства блоков с числом + подписью).
   */
  minContentSize?: { w: number; h: number };
  /** Где этот блок имеет смысл (cashflow, dashboard, *) */
  pages: string[]; // '*' = везде
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

/** Иконки lucide доступные для пикера (минимальный набор популярных) */
export const ICON_NAMES = [
  'ArrowDown',
  'ArrowUp',
  'Wallet',
  'BarChart3',
  'PieChart',
  'TrendingUp',
  'TrendingDown',
  'DollarSign',
  'Banknote',
  'CreditCard',
  'Target',
  'ListOrdered',
  'Table2',
  'Activity',
  'Calendar',
  'Briefcase',
  'Building2',
  'ShoppingCart',
  'Receipt',
  'Coins',
] as const;
export type IconName = (typeof ICON_NAMES)[number];
