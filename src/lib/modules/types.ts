// PURPOSE: Типы для модульного конструктора (Module Registry)
import type { ComponentType } from 'react';
import type { Tool } from '@/lib/ai/types';

export type ModuleCategory = 'finance' | 'analytics' | 'automation' | 'ai' | 'communications';

export type ModulePlan = 'free' | 'trial_pro' | 'pro' | 'business' | 'enterprise';

export type WidgetSize = 'sm' | 'md' | 'lg' | 'full';

export type Widget = {
  slug: string;
  name: string;
  description?: string;
  component: ComponentType<{ tenantId: string }>;
  defaultSize?: WidgetSize;
};

export type Module = {
  slug: string;
  name: string;
  icon: string; // Lucide icon name
  description: string;
  category: ModuleCategory;
  widgets: Widget[];
  tools?: Tool[];
  minPlan?: ModulePlan;
  // Опциональный seed: дефолтные блоки/настройки при активации модуля
  onActivate?: (tenantId: string) => Promise<void>;
};
