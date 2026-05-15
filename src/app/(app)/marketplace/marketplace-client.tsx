// PURPOSE: Клиентский каталог блоков (Маркет блоков, browse-only).
// Поиск, фильтр по категории и тегам. Кнопки «Создать блок» и «Купить блок»
// видны, но disabled — пока заглушки на будущее.
//
// ВАЖНО: список блоков собирается ЗДЕСЬ (на клиенте) через listAllBlocks().
// Передавать BlockDef[] из RSC через props НЕЛЬЗЯ — catalog-файлы помечены
// `'use client'` и в Server Component их экспорты превращаются в client-reference
// proxy с undefined-полями (b.pages.map → crash). См. MEMORY.md «Грабли».
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { icons, Search, Plus, ShoppingBag, Sparkles, Square, ChevronLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { listAllBlocks } from '@/lib/blocks/registry';

type Source = 'builtin' | 'user' | 'paid';

export type MarketplaceBlock = {
  type: string;
  displayName: string;
  description: string;
  category: 'stats' | 'tables' | 'charts' | 'custom';
  iconName: string;
  pages: string[];
  tags: string[];
  source: Source;
  defaultSize: { w: number; h: number };
  supportsDependencies: boolean;
};

const CATEGORY_LABELS: Record<MarketplaceBlock['category'], string> = {
  stats: 'KPI / Статистика',
  tables: 'Таблицы',
  charts: 'Графики',
  custom: 'Прочее',
};

const SOURCE_LABEL: Record<Source, string> = {
  builtin: 'Встроенный',
  user: 'Пользовательский',
  paid: 'Платный',
};

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Дашборд',
  cashflow: 'Денежный поток',
  inbox: 'Входящие',
  'unit-economics-ozon': 'Юнит · Ozon',
  'unit-economics-ozon-multi': 'Юнит · Ozon мульти',
  'unit-economics-yandex': 'Юнит · Яндекс',
  'unit-economics-my-store': 'Мой магазин',
  '*': 'Любая страница',
};

function pageLabel(key: string): string {
  return PAGE_LABELS[key] ?? key;
}

function getIcon(name: string): LucideIcon {
  const Icon = (icons as Record<string, LucideIcon | undefined>)[name];
  return Icon ?? Square;
}

export function MarketplaceClient() {
  const blocks = useMemo<MarketplaceBlock[]>(
    () =>
      listAllBlocks().map((b) => ({
        type: b.type,
        displayName: b.displayName,
        description: b.description,
        category: b.category,
        iconName: b.iconName ?? b.icon?.displayName ?? 'Square',
        pages: (b.pages ?? []).map(pageLabel),
        tags: b.tags ?? [],
        source: b.source ?? 'builtin',
        defaultSize: b.defaultSize,
        supportsDependencies: !!b.supportsDependencies,
      })),
    [],
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | MarketplaceBlock['category']>('all');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [opened, setOpened] = useState<MarketplaceBlock | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const b of blocks) for (const t of b.tags) set.add(t);
    return Array.from(set).sort();
  }, [blocks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return blocks.filter((b) => {
      if (category !== 'all' && b.category !== category) return false;
      if (activeTag && !b.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        b.displayName.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.type.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [blocks, query, category, activeTag]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="На дашборд"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">Маркет блоков</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Полный каталог: добавляйте в любой раздел через «+» внутри страницы. Создание и покупка
            пользовательских блоков — в разработке.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled title="Скоро">
            <Plus className="h-4 w-4" /> Создать блок
          </Button>
          <Button variant="outline" size="sm" disabled title="Скоро">
            <ShoppingBag className="h-4 w-4" /> Купить блок
          </Button>
        </div>
      </header>

      <Card className="p-3">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию, описанию или тегу..."
              className="h-9 pl-7"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {(['all', 'stats', 'tables', 'charts', 'custom'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={
                  'rounded-full border px-2.5 py-1 transition-colors ' +
                  (category === c
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/60 bg-background hover:bg-accent')
                }
              >
                {c === 'all' ? 'Все' : CATEGORY_LABELS[c]}
              </button>
            ))}
            <span className="mx-2 h-4 w-px bg-border" aria-hidden />
            {allTags.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTag(null)}
                className={
                  'rounded-full border px-2.5 py-1 transition-colors ' +
                  (activeTag === null
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-background hover:bg-accent')
                }
              >
                Все теги
              </button>
            )}
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTag(t === activeTag ? null : t)}
                className={
                  'rounded-full border px-2.5 py-1 transition-colors ' +
                  (activeTag === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-background hover:bg-accent')
                }
              >
                #{t}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((b) => {
          const Icon = getIcon(b.iconName);
          return (
            <button
              key={b.type}
              type="button"
              onClick={() => setOpened(b)}
              className="group flex h-full flex-col rounded-lg border border-border/60 bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold tracking-tight">{b.displayName}</h3>
                    <SourceBadge source={b.source} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABELS[b.category]}
                  </div>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 text-xs text-muted-foreground">{b.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                {b.tags.slice(0, 4).map((t) => (
                  <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    #{t}
                  </span>
                ))}
              </div>
              <div className="mt-3 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
                Доступно: {b.pages.length === 0 ? '—' : b.pages.join(' · ')}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <Card className="col-span-full flex flex-col items-center justify-center gap-2 p-12 text-center text-sm text-muted-foreground">
            <Sparkles className="h-8 w-8 text-muted-foreground/40" />
            <p>Ничего не нашлось. Попробуйте изменить фильтр или сбросить поиск.</p>
          </Card>
        )}
      </div>

      {opened && <BlockDetailsDialog block={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}

function SourceBadge({ source }: { source: Source }) {
  return (
    <span
      className={
        'rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ' +
        (source === 'builtin'
          ? 'border-border/60 bg-background text-muted-foreground'
          : source === 'user'
            ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-300'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300')
      }
      title={SOURCE_LABEL[source]}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

function BlockDetailsDialog({ block, onClose }: { block: MarketplaceBlock; onClose: () => void }) {
  const Icon = getIcon(block.iconName);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>{block.displayName}</DialogTitle>
              <DialogDescription>{CATEGORY_LABELS[block.category]} · {SOURCE_LABEL[block.source]}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{block.description}</p>
          <Field label="Размер по умолчанию">
            <span className="tabular-nums">{block.defaultSize.w} × {block.defaultSize.h}</span>
          </Field>
          <Field label="Поддержка зависимостей">
            <span>{block.supportsDependencies ? 'Да' : 'Нет'}</span>
          </Field>
          <Field label="Доступно на страницах">
            <span>{block.pages.length === 0 ? '—' : block.pages.join(' · ')}</span>
          </Field>
          {block.tags.length > 0 && (
            <Field label="Теги">
              <div className="flex flex-wrap gap-1">
                {block.tags.map((t) => (
                  <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    #{t}
                  </span>
                ))}
              </div>
            </Field>
          )}
          <p className="rounded border border-dashed border-border/60 bg-muted/30 p-2 text-[11px] text-muted-foreground">
            Добавление прямо отсюда — в разработке. Откройте нужный раздел и нажмите «+ Добавить блок».
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/30 pb-2 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="text-right text-sm">{children}</div>
    </div>
  );
}
