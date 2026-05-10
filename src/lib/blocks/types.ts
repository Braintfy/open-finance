// PURPOSE: Типы для Configurable Block-Grid Architecture (см. PLAN.md и memory)
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { z } from 'zod';

/** Один блок на странице — позиция в гриде + произвольный config */
export type BlockInstance = {
  id: string; // uuid
  type: string; // ключ из registry, e.g. 'stat.income' | 'sheet'
  x: number; // grid column 0..N
  y: number;
  w: number; // ширина в колонках
  h: number; // высота в строках
  config?: Record<string, unknown>;
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
  minSize: { w: number; h: number };
  /** Где этот блок имеет смысл (cashflow, dashboard, *) */
  pages: string[]; // '*' = везде
  configSchema?: z.ZodSchema;
  /** Дефолтный config для нового инстанса */
  defaultConfig?: () => Record<string, unknown>;
  Render: BlockRender;
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
