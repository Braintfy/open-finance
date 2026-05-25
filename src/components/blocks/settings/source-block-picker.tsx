// PURPOSE: Shared source-block picker panel used in:
//   • BlockReferencePicker (inline inside "Связи" tab)
//   • ExcelCellSettings / RenderExcelCell / SheetSettings / SheetPicker (@связать dialog body)
// Renders sidebar (page/group filter) + main area (block cards with field chips, cells, period badges).
'use client';

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAvailableBlockSources, BlockValuesContext } from '@/lib/blocks/values';
import { useFormatSettings } from '@/lib/format-settings';
import {
  sourceFieldLabel,
  previewSourceValue,
  cellFieldSet,
  moneyFieldSet,
  mergeLiveFields,
} from './source-field-label';
import type { SourceField, SourceBlock, SourcePage } from './types';

export type { SourceField, SourceBlock, SourcePage };

/** Module-level cache for /api/blocks/sources responses — shared across all picker instances. */
export const _sourceBlockPickerCache: { data: SourcePage[] | null } = { data: null };

/**
 * Returns a flat map of all currently published block values from the reactive store.
 * Keys: field === 'value' → blockId, otherwise → `blockId.field`.
 */
export function useAllBlockValues(): Record<string, number | string | null> {
  const api = useContext(BlockValuesContext);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setTick((t) => t + 1));
  }, [api]);
  return useMemo(() => {
    if (!api) return {};
    const result: Record<string, number | string | null> = {};
    for (const [blockId, output] of api.get().values.entries()) {
      for (const [field, value] of Object.entries(output)) {
        const key = field === 'value' ? blockId : `${blockId}.${field}`;
        result[key] = value;
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, tick]);
}

type Props = {
  /** Block IDs to exclude from list (e.g. the block that owns this picker). */
  excludeBlockIds?: Set<string>;
  /**
   * { blockId, field } pairs already added — field chip rendered as disabled/checked.
   * Useful for BlockReferencePicker to prevent duplicates.
   */
  alreadyAdded?: Array<{ blockId: string; field: string }>;
  /**
   * Block IDs that would create dependency cycles — shown with warning badge,
   * their field chips are disabled.
   */
  cycleBlockIds?: Set<string>;
  /** For value preview formatting. Defaults to global setting. */
  showKopecks?: boolean;
  /** Called when user clicks a field chip. */
  onPick: (block: SourceBlock, field: SourceField) => void;
  /**
   * Controls when the API fetch is triggered (analogous to Dialog open state).
   * Set to false when the picker is hidden to avoid unnecessary fetches.
   * Default: true.
   */
  open?: boolean;
  /**
   * Whether to fetch cross-page sources from /api/blocks/sources.
   * Set to false to show only live (current-page) blocks.
   * Default: true.
   */
  fetchCrossPage?: boolean;
};

export function SourceBlockPicker({
  excludeBlockIds,
  alreadyAdded,
  cycleBlockIds,
  showKopecks,
  onPick,
  open = true,
  fetchCrossPage = true,
}: Props) {
  const availableBlocks = useAvailableBlockSources();
  const liveValues = useAllBlockValues();
  const { settings: globalSettings } = useFormatSettings();
  const effectiveShowKopecks = showKopecks ?? globalSettings.showKopecks;

  const [sourcePages, setSourcePages] = useState<SourcePage[]>(
    () => _sourceBlockPickerCache.data ?? [],
  );
  const [sourceLoading, setSourceLoading] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((blockId: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      next.has(blockId) ? next.delete(blockId) : next.add(blockId);
      return next;
    });
  }, []);

  // Fetch cross-page sources when picker opens (lazy, with shared cache)
  useEffect(() => {
    if (!open || !fetchCrossPage) return;
    if (_sourceBlockPickerCache.data) {
      setSourcePages(_sourceBlockPickerCache.data);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    fetch('/api/blocks/sources')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.pages)) {
          _sourceBlockPickerCache.data = data.pages as SourcePage[];
          setSourcePages(data.pages as SourcePage[]);
        }
      })
      .catch(() => {
        if (!cancelled) setSourcePages([]);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchCrossPage]);

  // Merge live blocks (current page) with API-fetched pages (cross-page)
  const blockSourcePages = useMemo<SourcePage[]>(() => {
    const liveById = new Map(availableBlocks.map((b) => [b.blockId, b.fields]));
    const labelsById = new Map(availableBlocks.map((b) => [b.blockId, b.labels]));
    const liveBlocks: SourceBlock[] = availableBlocks
      .filter((b) => !excludeBlockIds?.has(b.blockId))
      .map((b) => {
        const cellFields = cellFieldSet(b.blockId, liveValues);
        const moneyFields = moneyFieldSet(b.blockId, liveValues);
        return {
          blockId: b.blockId,
          pageKey: 'current',
          pageLabel: 'Текущая страница',
          typeLabel: 'Live block',
          category: 'Текущая страница',
          label: String(
            liveValues[`${b.blockId}.label`] ?? `Блок ${b.blockId.slice(0, 8)}`,
          ),
          fields: b.fields.map((field) => ({
            name: field,
            label: b.labels[field] ?? sourceFieldLabel(field),
            value:
              liveValues[field === 'value' ? b.blockId : `${b.blockId}.${field}`] ??
              null,
            format: moneyFields.has(field) ? ('money' as const) : undefined,
            group: cellFields.has(field) ? 'Ячейки' : undefined,
          })),
        };
      });
    const pages = sourcePages
      .map((page) => ({
        ...page,
        blocks: page.blocks
          .filter((block) => !excludeBlockIds?.has(block.blockId))
          .map((block) =>
            mergeLiveFields(
              block,
              liveById.get(block.blockId),
              liveValues,
              labelsById.get(block.blockId),
            ),
          ),
      }))
      .filter((page) => page.blocks.length > 0);
    return liveBlocks.length > 0
      ? [{ pageKey: 'current', pageLabel: 'Текущая страница', blocks: liveBlocks }, ...pages]
      : pages;
  }, [availableBlocks, excludeBlockIds, liveValues, sourcePages]);

  const sourceGroups = useMemo(() => {
    const total = blockSourcePages.reduce((acc, p) => acc + p.blocks.length, 0);
    return [
      { id: 'all', label: 'Все блоки', count: total },
      ...blockSourcePages
        .filter((p) => p.blocks.length > 0)
        .map((p) => ({
          id: `page:${p.pageKey}`,
          label: p.pageLabel,
          count: p.blocks.length,
        })),
    ];
  }, [blockSourcePages]);

  const filteredPages = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    return blockSourcePages
      .map((page) => ({
        ...page,
        blocks: page.blocks.filter((block) => {
          if (
            selectedGroup.startsWith('page:') &&
            selectedGroup.slice(5) !== page.pageKey
          )
            return false;
          if (!q) return true;
          const blockText = [
            page.pageLabel,
            block.category,
            block.typeLabel,
            block.label,
          ]
            .join(' ')
            .toLowerCase();
          if (blockText.includes(q)) return true;
          return block.fields.some((f) => f.label.toLowerCase().includes(q));
        }),
      }))
      .filter((p) => p.blocks.length > 0);
  }, [blockSearch, blockSourcePages, selectedGroup]);

  return (
    <div className="grid min-h-[280px] grid-cols-[168px_minmax(0,1fr)]">
      {/* Sidebar — page/group filter */}
      <aside className="border-r border-border/60 bg-muted/20">
        <div className="border-b border-border/40 px-3 py-2">
          <Input
            placeholder="Поиск..."
            value={blockSearch}
            onChange={(e) => setBlockSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-0.5 p-2">
          {sourceGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelectedGroup(group.id)}
              className={
                'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition ' +
                (selectedGroup === group.id
                  ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border/70'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground')
              }
            >
              <span className="truncate">{group.label}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {group.count}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main area — block cards */}
      <div className="max-h-[420px] overflow-y-auto">
        {filteredPages.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">
            {sourceLoading ? 'Загружаю источники…' : 'Нет доступных блоков.'}
          </p>
        ) : (
          filteredPages.map((page) => (
            <section key={page.pageKey}>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {page.pageLabel}
                </span>
                {sourceLoading && page.pageKey !== 'current' && (
                  <span className="text-[10px] text-muted-foreground/60">загрузка…</span>
                )}
              </div>
              {page.blocks.map((block) => {
                const periodKey =
                  typeof liveValues[`${block.blockId}.__periodKey`] === 'string'
                    ? (liveValues[`${block.blockId}.__periodKey`] as string)
                    : null;
                const mainFields = block.fields.filter(
                  (f) =>
                    f.name !== 'label' && f.name !== 'raw' && f.group !== 'Ячейки',
                );
                const cellFieldsList = block.fields.filter((f) => f.group === 'Ячейки');
                const hasCells = cellFieldsList.length > 0;
                const isExpanded = expandedBlocks.has(block.blockId);
                const createsCycle = cycleBlockIds?.has(block.blockId) ?? false;

                return (
                  <div
                    key={`${block.pageKey}:${block.blockId}`}
                    className="border-b border-border/30 px-3 py-2 last:border-b-0"
                  >
                    {/* Block header */}
                    <div className="mb-1.5 flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-foreground">
                          {block.label}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="truncate">{block.typeLabel}</span>
                          {periodKey && (
                            <span className="shrink-0 rounded bg-sky-50 px-1 py-0.5 font-medium text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                              {periodKey}
                            </span>
                          )}
                          {createsCycle && (
                            <span className="shrink-0 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                              цикл
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Main fields */}
                    {mainFields.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {mainFields.map((field) => {
                          const preview = previewSourceValue(field, effectiveShowKopecks);
                          const added = alreadyAdded?.some(
                            (a) =>
                              a.blockId === block.blockId && a.field === field.name,
                          );
                          return (
                            <button
                              key={field.name}
                              type="button"
                              disabled={createsCycle || added}
                              onClick={() => onPick(block, field)}
                              title={`${field.label} = ${preview}`}
                              className={
                                'inline-flex max-w-[190px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition ' +
                                (createsCycle || added
                                  ? 'cursor-not-allowed bg-muted/40 text-muted-foreground opacity-60'
                                  : 'bg-background hover:bg-primary/10 hover:ring-primary/40')
                              }
                            >
                              <span className="shrink-0 font-medium text-primary">
                                {field.label}
                              </span>
                              <span className="min-w-0 truncate text-muted-foreground">
                                {preview}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Cells section (collapsible) */}
                    {hasCells && (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={() => toggleExpand(block.blockId)}
                          className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                          <span>Ячейки ({cellFieldsList.length})</span>
                        </button>
                        {isExpanded && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {cellFieldsList.map((field) => {
                              const preview = previewSourceValue(
                                field,
                                effectiveShowKopecks,
                              );
                              const added = alreadyAdded?.some(
                                (a) =>
                                  a.blockId === block.blockId &&
                                  a.field === field.name,
                              );
                              return (
                                <button
                                  key={field.name}
                                  type="button"
                                  disabled={createsCycle || added}
                                  onClick={() => onPick(block, field)}
                                  title={`${field.label} = ${preview}`}
                                  className={
                                    'inline-flex max-w-[200px] items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[11px] ring-1 ring-border/50 transition ' +
                                    (createsCycle || added
                                      ? 'cursor-not-allowed opacity-60'
                                      : 'hover:bg-primary/10 hover:ring-primary/40')
                                  }
                                >
                                  <span className="shrink-0 font-medium text-primary/80">
                                    {field.label}
                                  </span>
                                  <span className="min-w-0 truncate text-muted-foreground">
                                    {preview}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
