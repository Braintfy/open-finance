// PURPOSE: Cmd+K Command Palette — глобальный поиск + быстрые действия (Linear/Notion-style).
// Используется на всех authenticated страницах. Вызывается Cmd+K или кнопкой в header.
'use client';

import { Command } from 'cmdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calculator,
  Calendar,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Wallet,
} from 'lucide-react';
import { useTheme } from 'next-themes';

type CommandAction = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  keywords?: string;
  onSelect: () => void;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  // Toggle: Cmd+K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Reset search on close
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const actions: CommandAction[] = [
    // Navigation
    {
      id: 'nav-dashboard',
      label: 'Дашборд',
      icon: LayoutDashboard,
      group: 'Навигация',
      keywords: 'dashboard главная home',
      onSelect: () => go('/dashboard'),
    },
    {
      id: 'nav-cashflow',
      label: 'Денежный поток',
      icon: Wallet,
      group: 'Навигация',
      keywords: 'cashflow деньги доход расход',
      onSelect: () => go('/cashflow'),
    },
    {
      id: 'nav-inbox',
      label: 'Входящие',
      icon: Inbox,
      group: 'Навигация',
      keywords: 'inbox входящие почта телеграм чеки документы',
      onSelect: () => go('/inbox'),
    },
    {
      id: 'nav-boards',
      label: 'Мои доски',
      icon: LayoutGrid,
      group: 'Навигация',
      keywords: 'boards доски проекты workspace',
      onSelect: () => go('/boards'),
    },
    {
      id: 'nav-deadlines',
      label: 'Дедлайны',
      icon: Calendar,
      group: 'Навигация',
      keywords: 'deadlines дедлайны календарь напоминания',
      onSelect: () => go('/deadlines'),
    },
    {
      id: 'nav-settings',
      label: 'Настройки',
      icon: Settings,
      group: 'Навигация',
      keywords: 'settings настройки',
      onSelect: () => go('/settings'),
    },
    // Actions
    {
      id: 'action-add-transaction',
      label: 'Добавить транзакцию',
      icon: Plus,
      group: 'Действия',
      keywords: 'add transaction создать new транзакция',
      onSelect: () => go('/cashflow?action=add'),
    },
    {
      id: 'action-calculator',
      label: 'Калькулятор',
      icon: Calculator,
      group: 'Действия',
      keywords: 'calculator калькулятор посчитать',
      onSelect: () => {
        setOpen(false);
        // TODO: open calculator modal
      },
    },
    // Theme
    {
      id: 'theme-light',
      label: 'Светлая тема',
      icon: Sun,
      group: 'Тема',
      keywords: 'theme light светлая',
      onSelect: () => {
        setTheme('light');
        setOpen(false);
      },
    },
    {
      id: 'theme-dark',
      label: 'Тёмная тема',
      icon: Moon,
      group: 'Тема',
      keywords: 'theme dark тёмная',
      onSelect: () => {
        setTheme('dark');
        setOpen(false);
      },
    },
  ];

  // Group actions
  const groups = Array.from(new Set(actions.map((a) => a.group)));

  return (
    <>
      {/* Trigger button in header */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-muted/50 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Search className="h-3 w-3" />
        <span className="hidden sm:inline">Поиск…</span>
        <kbd className="pointer-events-none ml-1 hidden select-none rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Command Dialog */}
      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="fixed inset-0 bg-black/50" />
          <div className="fixed inset-x-0 top-[20%] mx-auto w-full max-w-lg px-4">
            <div
              className="overflow-hidden rounded-lg border border-border/60 bg-background shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <Command
                label="Command Palette"
                shouldFilter={true}
              >
                <div className="flex items-center border-b border-border/60 px-3">
                  <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Command.Input
                    ref={inputRef}
                    autoFocus
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Команда или поиск…"
                    className="flex h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Очистить
                    </button>
                  )}
                </div>
                <Command.List className="max-h-80 overflow-y-auto p-1">
                  <Command.Empty className="py-6 text-center text-xs text-muted-foreground">
                    Ничего не найдено
                  </Command.Empty>
                  {groups.map((group) => {
                    const items = actions.filter((a) => a.group === group);
                    return (
                      <Command.Group
                        key={group}
                        heading={group}
                        className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                      >
                        {items.map((action) => (
                          <Command.Item
                            key={action.id}
                            value={`${action.label} ${action.keywords ?? ''}`}
                            onSelect={action.onSelect}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                          >
                            <action.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span>{action.label}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    );
                  })}
                </Command.List>
                <div className="border-t border-border/60 px-3 py-1.5">
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>
                      <kbd className="rounded border border-border/60 px-1 py-0.5 font-mono">↑↓</kbd> навигация
                    </span>
                    <span>
                      <kbd className="rounded border border-border/60 px-1 py-0.5 font-mono">↵</kbd> выбрать
                    </span>
                    <span>
                      <kbd className="rounded border border-border/60 px-1 py-0.5 font-mono">Esc</kbd> закрыть
                    </span>
                  </div>
                </div>
              </Command>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
