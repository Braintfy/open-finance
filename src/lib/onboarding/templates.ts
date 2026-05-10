// PURPOSE: Шаблоны модулей которые применяются после ответов в onboarding-визарде.
// При завершении визарда мы берём ответы и применяем соответствующий шаблон:
// создаём модули, AI-агентов, демо-данные, напоминания.
// Реальное применение — в src/lib/onboarding/apply.ts (Этап 1).

import type { SetupAnswers } from '@/lib/db/schema/tenants';

export type Template = {
  id: string;
  name: string;
  description: string;
  modules: string[]; // module ids из registry
  aiAgents: Array<{ name: string; skills: string[] }>;
  demoData?: 'minimal' | 'sample' | 'none';
};

export const TEMPLATES: Record<string, Template> = {
  marketplace_seller: {
    id: 'marketplace_seller',
    name: 'Селлер маркетплейсов',
    description: 'Cashflow + аналитика по WB/Ozon, поставки, налоги.',
    modules: ['cashflow', 'marketplaces', 'supply', 'taxes', 'inbox', 'deadlines'],
    aiAgents: [
      { name: 'Аналитик селлера', skills: ['marketplace_analytics', 'sales_forecast'] },
      { name: 'Бухгалтер УСН', skills: ['tax_calc', 'deadline_alert'] },
    ],
    demoData: 'sample',
  },
  freelancer: {
    id: 'freelancer',
    name: 'ИП на услугах / фрилансер',
    description: 'Счета, поступления, налоги УСН/НПД, дедлайны.',
    modules: ['cashflow', 'invoices', 'taxes', 'inbox', 'deadlines'],
    aiAgents: [{ name: 'Бухгалтер УСН', skills: ['tax_calc', 'invoice_helper'] }],
    demoData: 'minimal',
  },
  small_business: {
    id: 'small_business',
    name: 'Малый бизнес',
    description: 'Денежный поток, налоги, дедлайны, сотрудники (заглушка).',
    modules: ['cashflow', 'taxes', 'deadlines', 'inbox', 'employees'],
    aiAgents: [{ name: 'Финдиректор', skills: ['cashflow_forecast', 'tax_calc'] }],
    demoData: 'minimal',
  },
  self_employed: {
    id: 'self_employed',
    name: 'Самозанятый (НПД)',
    description: 'Простой учёт чеков, налог 4/6%, годовой лимит.',
    modules: ['cashflow', 'invoices', 'taxes_npd'],
    aiAgents: [{ name: 'Помощник самозанятого', skills: ['npd_helper'] }],
    demoData: 'minimal',
  },
  personal: {
    id: 'personal',
    name: 'Личные финансы',
    description: 'Бюджет, цели, накопления.',
    modules: ['cashflow_personal', 'budget', 'goals'],
    aiAgents: [{ name: 'Личный финансист', skills: ['budget_advisor'] }],
    demoData: 'minimal',
  },
  other: {
    id: 'other',
    name: 'Универсальный',
    description: 'Минимум: денежный поток + Inbox.',
    modules: ['cashflow', 'inbox'],
    aiAgents: [],
    demoData: 'none',
  },
};

export function pickTemplate(answers: SetupAnswers): Template {
  const id = answers.occupation && TEMPLATES[answers.occupation] ? answers.occupation : 'other';
  return TEMPLATES[id]!;
}
