// PURPOSE: Mini-pin для cross-page связей блока.
// Когда блок зависит от блока на ДРУГОЙ странице — рядом с ним рендерится
// маленькая иконка-нить. При hover — popover с описанием куда ведёт связь.
'use client';

import { ExternalLink, Link2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { BlockInstance } from '@/lib/blocks/types';

const PAGE_LABELS: Record<string, { label: string; href: string }> = {
  cashflow: { label: 'Денежный поток', href: '/app/cashflow' },
  dashboard: { label: 'Дашборд', href: '/app/dashboard' },
  taxes: { label: 'Налоги', href: '/app/taxes' },
  inbox: { label: 'Входящие', href: '/app/inbox' },
  deadlines: { label: 'Дедлайны', href: '/app/deadlines' },
};

type Props = {
  block: BlockInstance;
  /** pageKey текущей страницы — все ссылки с другим pageKey считаются cross-page */
  currentPageKey: string;
  /** Опциональный map: pageKey+blockId → label для отображения в popover'е */
  remoteLabels?: Record<string, string>;
};

export function CrossPagePin({ block, currentPageKey, remoteLabels }: Props) {
  const [open, setOpen] = useState(false);

  if (!block.dependencies) return null;
  const crossLinks = block.dependencies.sources.filter(
    (src) => src.pageKey && src.pageKey !== currentPageKey
  );
  if (crossLinks.length === 0) return null;

  return (
    <div
      className="absolute -right-1 -top-1 z-20"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold text-white shadow-md ring-2 ring-background">
        <Link2 className="h-2.5 w-2.5" />
        {crossLinks.length > 1 && <span className="ml-0.5">{crossLinks.length}</span>}
      </div>

      {open && (
        <div className="absolute right-0 top-6 w-64 rounded-lg border border-border bg-popover p-2 text-xs shadow-lg">
          <div className="mb-1.5 font-medium text-muted-foreground">
            Связи на другие страницы
          </div>
          <div className="space-y-1">
            {crossLinks.map((src, i) => {
              const pageInfo = PAGE_LABELS[src.pageKey ?? ''];
              const remoteKey = `${src.pageKey}:${src.blockId}`;
              const blockLabel =
                src.label ?? remoteLabels?.[remoteKey] ?? `Блок ${src.blockId.slice(0, 8)}`;
              return (
                <Link
                  key={`${src.blockId}-${i}`}
                  href={pageInfo?.href ?? '#'}
                  className="flex items-start justify-between gap-2 rounded-md p-1.5 hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{blockLabel}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      → {pageInfo?.label ?? src.pageKey}
                    </div>
                  </div>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
