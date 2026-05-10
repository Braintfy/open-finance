// PURPOSE: Диалог выбора блока из каталога для добавления на страницу
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { listBlocksForPage } from '@/lib/blocks/registry';
import type { BlockCategory } from '@/lib/blocks/types';

const CATEGORY_LABELS: Record<BlockCategory, string> = {
  stats: 'KPI / Статистика',
  tables: 'Таблицы',
  charts: 'Графики',
  custom: 'Прочее',
};

export function AddBlockDialog({
  open,
  pageKey,
  existingTypes,
  onAdd,
  onClose,
}: {
  open: boolean;
  pageKey: string;
  existingTypes: string[];
  onAdd: (type: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const all = listBlocksForPage(pageKey);
  const filtered = all.filter((b) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      b.displayName.toLowerCase().includes(q) ||
      b.description.toLowerCase().includes(q) ||
      b.type.toLowerCase().includes(q)
    );
  });

  const grouped = filtered.reduce<Record<BlockCategory, typeof filtered>>(
    (acc, b) => {
      (acc[b.category] ??= []).push(b);
      return acc;
    },
    { stats: [], tables: [], charts: [], custom: [] }
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Добавить блок</DialogTitle>
          <DialogDescription>
            Выберите блок из каталога. Можно добавлять одинаковые блоки несколько раз — у каждого
            будут свои настройки.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Поиск…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {(Object.keys(grouped) as BlockCategory[]).map((cat) => {
            const items = grouped[cat];
            if (items.length === 0) return null;
            return (
              <div key={cat} className="mb-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {items.map((def) => {
                    const Icon = def.icon;
                    const used = existingTypes.includes(def.type);
                    return (
                      <button
                        key={def.type}
                        type="button"
                        onClick={() => onAdd(def.type)}
                        className="flex items-start gap-3 rounded-md border p-3 text-left transition hover:bg-accent"
                      >
                        <div className="rounded-md bg-muted p-2">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{def.displayName}</div>
                            {used && (
                              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                уже на странице
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{def.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Нет блоков, подходящих под запрос
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
