// PURPOSE: Модалка настройки привязки одной ячейки калькулятора к блоку/полю
// другого блока. Позволяет переключать manual<->block_ref, выбирать источник,
// сохранять fallback и сбрасывать привязку.
'use client';

import { useMemo, useState } from 'react';
import { Link2, Unlink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useAllBlockValuesFlat,
  useRemoteBlockSources,
  type SourceBlock,
  type SourceField,
  type SourcePage,
} from '@/lib/unit-economics/use-live-block-values';
import { useAvailableBlockSources } from '@/lib/blocks/values';
import type { UnitCellBinding } from '@/lib/unit-economics/types';
import { resolveBindingValue } from '@/lib/unit-economics/bindings';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Текущий блок (нельзя ссылаться сам на себя) */
  selfBlockId: string;
  /** Заголовок ячейки (например «Цена», «Остаток») */
  fieldLabel: string;
  /** Текущая привязка (или undefined если ещё нет) */
  binding: UnitCellBinding | undefined;
  /** Если поле денежное — true (определяет money flag по умолчанию) */
  money?: boolean;
  /** Текущее ручное значение, чтобы предложить как fallback */
  currentManualValue?: number | null;
  onSave: (binding: UnitCellBinding | undefined) => void;
};

function fieldIsMoney(_block: SourceBlock, field: SourceField): boolean {
  if (field.format) return field.format === 'money';
  return false;
}

function previewSourceValue(field: SourceField): string {
  if (field.value === null || field.value === undefined) return '—';
  if (field.format === 'money' && typeof field.value === 'number') {
    const rubles = field.value / 100;
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rubles) + ' ₽';
  }
  if (typeof field.value === 'number') {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(field.value);
  }
  return String(field.value).slice(0, 24);
}

function sourceFieldLabel(field: string): string {
  if (field === 'value') return 'Значение';
  if (field === 'count') return 'Количество';
  if (field === 'sum') return 'Сумма';
  return field;
}

export function UnitCellBindingDialog({
  open,
  onOpenChange,
  selfBlockId,
  fieldLabel,
  binding,
  money = false,
  currentManualValue,
  onSave,
}: Props) {
  const liveValues = useAllBlockValuesFlat();
  const availableLive = useAvailableBlockSources();
  const { pages: remotePages, loading } = useRemoteBlockSources(open);
  const [search, setSearch] = useState('');
  const [pageFilter, setPageFilter] = useState<string>('all');

  const allPages = useMemo<SourcePage[]>(() => {
    const liveBlocks: SourceBlock[] = availableLive
      .filter((b) => b.blockId !== selfBlockId)
      .map((b) => ({
        blockId: b.blockId,
        pageKey: 'current',
        pageLabel: 'Текущая страница',
        typeLabel: 'Live',
        category: 'Текущая',
        label: String(liveValues[`${b.blockId}.label`] ?? `Блок ${b.blockId.slice(0, 8)}`),
        fields: b.fields.map((field) => ({
          name: field,
          label: sourceFieldLabel(field),
          value:
            liveValues[field === 'value' ? b.blockId : `${b.blockId}.${field}`] ?? null,
          format: undefined,
        })),
      }));
    const remote = remotePages.map((page) => ({
      ...page,
      blocks: page.blocks.filter((b) => b.blockId !== selfBlockId),
    }));
    return liveBlocks.length > 0
      ? [
          { pageKey: 'current', pageLabel: 'Текущая страница', blocks: liveBlocks },
          ...remote,
        ]
      : remote;
  }, [availableLive, liveValues, remotePages, selfBlockId]);

  const filteredPages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPages
      .map((page) => ({
        ...page,
        blocks: page.blocks.filter((block) => {
          if (pageFilter !== 'all' && pageFilter !== page.pageKey) return false;
          if (!q) return true;
          return [page.pageLabel, block.category, block.typeLabel, block.label, block.blockId]
            .join(' ')
            .toLowerCase()
            .includes(q);
        }),
      }))
      .filter((page) => page.blocks.length > 0);
  }, [allPages, pageFilter, search]);

  const groups = useMemo(() => {
    const total = allPages.reduce((acc, page) => acc + page.blocks.length, 0);
    return [
      { id: 'all', label: 'Все страницы', count: total },
      ...allPages
        .filter((page) => page.blocks.length > 0)
        .map((page) => ({ id: page.pageKey, label: page.pageLabel, count: page.blocks.length })),
    ];
  }, [allPages]);

  const currentPreview =
    binding && binding.mode === 'block_ref'
      ? resolveBindingValue(binding, liveValues)
      : null;

  function pickField(block: SourceBlock, field: SourceField) {
    const next: UnitCellBinding = {
      mode: 'block_ref',
      ref: {
        pageKey: block.pageKey === 'current' ? undefined : block.pageKey,
        blockId: block.blockId,
        field: field.name === 'value' ? undefined : field.name,
        label: `${block.label} · ${field.label}`,
      },
      money: money || fieldIsMoney(block, field),
      fallbackValue:
        typeof currentManualValue === 'number' ? currentManualValue : binding?.fallbackValue,
    };
    onSave(next);
    onOpenChange(false);
  }

  function unlink() {
    const fallback = currentPreview ?? binding?.fallbackValue ?? currentManualValue ?? 0;
    onSave({ mode: 'manual', fallbackValue: typeof fallback === 'number' ? fallback : 0, money });
    onOpenChange(false);
  }

  function clear() {
    onSave(undefined);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,720px)] max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-sm">Привязка ячейки «{fieldLabel}»</DialogTitle>
          <DialogDescription className="text-[11px]">
            Свяжите значение с блоком на этой или другой странице. Если источник станет недоступен —
            будет использовано fallback-значение.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2 text-[11px]">
          <div className="text-muted-foreground">
            Сейчас:{' '}
            <span className="font-medium text-foreground">
              {binding?.mode === 'block_ref'
                ? binding.ref?.label ?? 'Привязано к блоку'
                : 'Ручное значение'}
            </span>
            {binding?.mode === 'block_ref' && currentPreview !== null && (
              <span className="ml-2 text-muted-foreground">
                =&nbsp;{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(currentPreview)}
              </span>
            )}
          </div>
          <div className="flex gap-1.5">
            {binding?.mode === 'block_ref' && (
              <Button variant="outline" size="sm" onClick={unlink}>
                <Unlink /> Сделать ручным
              </Button>
            )}
            {binding && (
              <Button variant="ghost" size="sm" onClick={clear}>
                <X /> Сбросить
              </Button>
            )}
          </div>
        </div>

        <div className="grid min-h-[320px] grid-cols-[200px_minmax(0,1fr)]">
          <aside className="border-r border-border/60 bg-muted/10">
            <div className="border-b border-border/40 px-3 py-2">
              <Input
                placeholder="Поиск..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-0.5 p-2">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setPageFilter(g.id)}
                  className={
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition ' +
                    (pageFilter === g.id
                      ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border/70'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground')
                  }
                >
                  <span className="truncate">{g.label}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {g.count}
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <div className="max-h-[460px] overflow-y-auto">
            {loading ? (
              <p className="py-12 text-center text-xs text-muted-foreground">Загружаю блоки…</p>
            ) : filteredPages.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                Нет доступных источников. Добавьте KPI-блок, Excel-ячейку или таблицу с числами на
                любой странице — она появится здесь.
              </div>
            ) : (
              filteredPages.map((page) => (
                <section key={page.pageKey}>
                  <div className="sticky top-0 z-10 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {page.pageLabel}
                    </span>
                  </div>
                  {page.blocks.map((block) => (
                    <div
                      key={`${page.pageKey}:${block.blockId}`}
                      className="border-b border-border/30 px-3 py-2 transition last:border-b-0 hover:bg-accent/20"
                    >
                      <div className="space-y-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-foreground">
                            {block.label}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {block.category} · {block.typeLabel}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {block.fields
                            .filter((f) => f.name !== 'label' && f.name !== 'raw')
                            .map((field) => {
                              const preview = previewSourceValue(field);
                              return (
                                <button
                                  key={field.name}
                                  type="button"
                                  onClick={() => pickField(block, field)}
                                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition hover:bg-primary/10 hover:ring-primary/40"
                                  title={`${field.label} = ${preview}`}
                                >
                                  <Link2 className="h-3 w-3 text-primary" />
                                  <span className="font-medium text-primary">{field.label}</span>
                                  <span className="text-muted-foreground">{preview}</span>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
