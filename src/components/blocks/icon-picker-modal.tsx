// PURPOSE: Модальное окно полной библиотеки иконок Lucide с поиском и категориями.
// Lazy-loaded — грузится только когда пользователь открывает "Выбрать из каталога".
'use client';

import { useState, useMemo, useCallback } from 'react';
import { icons, type LucideIcon } from 'lucide-react';
import { Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ICON_CATEGORIES, FAVORITE_ICONS, getIconAnimationClass } from '@/lib/blocks/icon-library';

type IconPickerModalProps = {
  open: boolean;
  onClose: () => void;
  value?: string;
  onChange: (iconName: string) => void;
};

export function IconPickerModal({ open, onClose, value, onChange }: IconPickerModalProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('favorites');

  const filteredIcons = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return Object.keys(icons).filter((name) => name.toLowerCase().includes(q));
    }
    if (activeCategory === 'favorites') {
      return FAVORITE_ICONS.filter((name) => name in icons);
    }
    if (activeCategory === 'all') {
      return Object.keys(icons);
    }
    const cat = ICON_CATEGORIES.find((c) => c.key === activeCategory);
    if (cat) {
      return cat.icons.filter((name) => name in icons);
    }
    return FAVORITE_ICONS;
  }, [search, activeCategory]);

  const handleSelect = useCallback(
    (name: string) => {
      onChange(name);
      onClose();
    },
    [onChange, onClose]
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <DialogContent className="flex h-[80vh] max-h-[600px] max-w-2xl flex-col p-0" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader className="border-b px-4 pb-3 pt-4">
          <DialogTitle className="text-sm font-semibold">Библиотека иконок</DialogTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск иконки по названию..."
              className="h-8 pl-8 pr-8 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Categories sidebar */}
          <div className="w-36 shrink-0 overflow-y-auto border-r bg-muted/20 p-2">
            <CategoryButton
              active={activeCategory === 'favorites'}
              onClick={() => { setActiveCategory('favorites'); setSearch(''); }}
              label="Избранные"
            />
            <CategoryButton
              active={activeCategory === 'all'}
              onClick={() => { setActiveCategory('all'); setSearch(''); }}
              label="Все"
            />
            <div className="my-1.5 border-t border-border/50" />
            {ICON_CATEGORIES.map((cat) => (
              <CategoryButton
                key={cat.key}
                active={activeCategory === cat.key}
                onClick={() => { setActiveCategory(cat.key); setSearch(''); }}
                label={cat.label}
              />
            ))}
          </div>

          {/* Icons grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {search.trim() && (
              <div className="mb-2 text-[11px] text-muted-foreground">
                Найдено: {filteredIcons.length}
              </div>
            )}
            {activeCategory === 'animated' && !search.trim() && (
              <div className="mb-2 text-[11px] text-muted-foreground">
                Наведите на иконку чтобы увидеть анимацию
              </div>
            )}
            <div className="grid grid-cols-8 gap-1">
              {filteredIcons.slice(0, 300).map((name, idx) => {
                const IconComp = icons[name as keyof typeof icons] as LucideIcon | undefined;
                if (!IconComp) return null;
                const isActive = value === name;
                const animCls = activeCategory === 'animated' ? getIconAnimationClass(name) : '';
                return (
                  <button
                    key={`${name}-${idx}`}
                    type="button"
                    onClick={() => handleSelect(name)}
                    className={cn(
                      'group flex h-9 w-9 items-center justify-center rounded-md border transition',
                      isActive
                        ? 'border-primary bg-primary/10 ring-2 ring-primary'
                        : 'border-transparent hover:border-border hover:bg-accent'
                    )}
                    title={name}
                  >
                    <IconComp className={cn('h-4 w-4', animCls)} />
                  </button>
                );
              })}
            </div>
            {filteredIcons.length > 300 && (
              <div className="mt-3 text-center text-[11px] text-muted-foreground">
                Показано 300 из {filteredIcons.length}. Уточните поиск.
              </div>
            )}
            {filteredIcons.length === 0 && (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                Ничего не найдено
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2.5">
          <div className="text-[11px] text-muted-foreground">
            {value ? (
              <span>Выбрано: <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{value}</code></span>
            ) : (
              'Нажмите на иконку для выбора'
            )}
          </div>
          <div className="flex gap-1.5">
            {value && (
              <Button variant="ghost" size="sm" onClick={() => { onChange(''); onClose(); }}>
                Сбросить
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}
