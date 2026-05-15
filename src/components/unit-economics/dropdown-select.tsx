// PURPOSE: Маленький стилизованный select на базе Radix DropdownMenu.
// Заменяет нативный <select>, у которого на macOS/iOS закрытое состояние
// иногда показывает пустую метку при заполненном value. Здесь label
// рендерим сами через `<button>` — гарантированно видимый текст в любом
// браузере, единый стиль с остальной шапкой.
'use client';

import { useMemo } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type DropdownSelectOption = { value: string; label: string };

type Props = {
  /** Лейбл слева от триггера (опционально). */
  label?: string;
  value: string;
  options: DropdownSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Минимальная ширина триггера, по умолчанию 10rem. */
  triggerClassName?: string;
  contentClassName?: string;
  /** Плейсхолдер если value не совпадает ни с одной опцией. */
  placeholder?: string;
};

export function DropdownSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  triggerClassName,
  contentClassName,
  placeholder = '—',
}: Props) {
  const current = useMemo(
    () => options.find((o) => o.value === value)?.label ?? placeholder,
    [options, value, placeholder],
  );

  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-muted-foreground">{label}:</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              'inline-flex h-6 min-w-[10rem] max-w-[14rem] items-center justify-between gap-1 rounded border border-border/60 bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40',
              triggerClassName,
            )}
            title={current}
          >
            <span className="min-w-0 flex-1 truncate text-left">{current}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={cn('min-w-[12rem]', contentClassName)}
          align="start"
          sideOffset={4}
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <DropdownMenuItem
                key={o.value}
                onSelect={() => onChange(o.value)}
                className={cn(
                  'flex items-center justify-between gap-2',
                  selected && 'font-semibold text-primary',
                )}
              >
                <span className="truncate">{o.label}</span>
                {selected && <Check className="h-3 w-3 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
