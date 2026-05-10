// PURPOSE: Мини-табы внутри блока (Linear-style тонкие подчёркивания)
// Для блоков которые имеют несколько представлений (Сводка / Список / График и т.п.)
'use client';

import { useState, type ReactNode } from 'react';
import { useBlockDensity } from './block-size';

export type BlockTab = {
  key: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
};

export function BlockTabs({
  tabs,
  defaultKey,
  variant = 'underline',
}: {
  tabs: BlockTab[];
  defaultKey?: string;
  /** `underline` — Linear-style тонкий бордер, `pills` — маленькие pill-кнопки */
  variant?: 'underline' | 'pills';
}) {
  const [active, setActive] = useState(defaultKey ?? tabs[0]?.key ?? '');
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  const density = useBlockDensity();

  if (!current) return null;

  // При xs/sm показываем только 2 таба максимум (остальные через select) — для компактности
  const showAll = density !== 'xs';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={
          variant === 'underline'
            ? 'flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60'
            : 'flex shrink-0 items-center gap-0.5 overflow-x-auto'
        }
      >
        {tabs.slice(0, showAll ? tabs.length : 2).map((t) => {
          const isActive = t.key === active;
          if (variant === 'pills') {
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={
                  isActive
                    ? 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-primary px-2 text-[10px] font-medium text-primary-foreground'
                    : 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-medium text-muted-foreground hover:bg-muted'
                }
              >
                {t.icon}
                {t.label}
              </button>
            );
          }
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                isActive
                  ? '-mb-px inline-flex h-7 shrink-0 items-center gap-1 border-b-2 border-foreground px-2 text-[11px] font-medium text-foreground'
                  : '-mb-px inline-flex h-7 shrink-0 items-center gap-1 border-b-2 border-transparent px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
        {!showAll && tabs.length > 2 && (
          <select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            className="h-5 rounded border-none bg-transparent text-[10px] text-muted-foreground focus:outline-none"
          >
            {tabs.slice(2).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto pt-2">{current.content}</div>
    </div>
  );
}
