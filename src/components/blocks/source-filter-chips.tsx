// PURPOSE: UI чипы для выбора `transactions.source` фильтра.
// Используется в `PagePeriodHeader` (page-level) и в Settings блоков (override).
//
// Лейблы хардкодим (соответствуют values в БД: 'bank' / 'manual' / 'inbox' / 'ozon' / 'wb').
// Если в БД встретится незнакомый source — показываем как есть.

'use client';

import { useEffect, useState } from 'react';
import {
  Landmark,
  PencilLine,
  Mail,
  ShoppingBag,
  Package,
  Layers3,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const SOURCE_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  bank: { label: 'Банк', icon: Landmark },
  manual: { label: 'Вручную', icon: PencilLine },
  inbox: { label: 'Inbox', icon: Mail },
  ai_vision: { label: 'AI vision', icon: Mail },
  ozon: { label: 'Ozon', icon: ShoppingBag },
  wb: { label: 'Wildberries', icon: Package },
};

type SourceMeta = { source: string; count: number };

export function SourceFilterChips({
  value,
  onChange,
  variant = 'inline',
  size = 'sm',
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  /** `inline` — горизонтальные чипы; `compact` — короче padding. */
  variant?: 'inline' | 'compact';
  size?: 'sm' | 'xs';
}) {
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/cashflow/meta')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok && Array.isArray(d.sourcesWithCount)) {
          setSources(d.sourcesWithCount);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || sources.length === 0) {
    // Не показываем фильтр если источников нет — нет смысла занимать место.
    return null;
  }

  const isXs = size === 'xs';
  const padding = isXs ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]';
  const iconSize = isXs ? 'h-2.5 w-2.5' : 'h-3 w-3';

  const totalCount = sources.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className={'flex flex-wrap items-center gap-1 ' + (variant === 'compact' ? '' : '')}>
      <Chip
        icon={Layers3}
        active={value === null}
        onClick={() => onChange(null)}
        padding={padding}
        iconSize={iconSize}
      >
        Все
        <span className="ml-1 opacity-50">{totalCount}</span>
      </Chip>
      {sources.map((s) => {
        const meta = SOURCE_LABELS[s.source] ?? { label: s.source, icon: Layers3 };
        const Icon = meta.icon;
        return (
          <Chip
            key={s.source}
            icon={Icon}
            active={value === s.source}
            onClick={() => onChange(s.source)}
            padding={padding}
            iconSize={iconSize}
          >
            {meta.label}
            <span className="ml-1 opacity-50">{s.count}</span>
          </Chip>
        );
      })}
    </div>
  );
}

function Chip({
  icon: Icon,
  active,
  onClick,
  children,
  padding,
  iconSize,
}: {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  padding: string;
  iconSize: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex shrink-0 items-center gap-1 rounded-full border tabular-nums transition ' +
        padding +
        ' ' +
        (active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border/60 bg-background text-muted-foreground hover:bg-accent/40 hover:text-foreground')
      }
    >
      <Icon className={iconSize} />
      <span className="truncate">{children}</span>
    </button>
  );
}
