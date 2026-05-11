// PURPOSE: Excel Cell block — минимальный single-cell Excel-like блок с формулами и @refs.
'use client';

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, FunctionSquare } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BlockValuesContext, useAvailableBlockSources, useBlockValuePublisher } from '../values';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import FormulaParser from 'fast-formula-parser';

type SourceField = {
  name: string;
  label: string;
  value: number | string | null;
};

type SourceBlock = {
  blockId: string;
  pageKey: string;
  pageLabel: string;
  typeLabel: string;
  category: string;
  label: string;
  fields: SourceField[];
};

type SourcePage = {
  pageKey: string;
  pageLabel: string;
  blocks: SourceBlock[];
};

const ConfigSchema = z.object({
  title: z.string().default('Доходы'),
  value: z.string().default(''),
  showFormulaBar: z.boolean().default(true),
  showKopecks: z.boolean().nullable().default(null),
  blockRefs: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});

type Config = z.infer<typeof ConfigSchema>;

function parseConfig(raw: unknown): Config {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return { title: 'Доходы', value: '', showFormulaBar: true, showKopecks: null };
}

function parseCellNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPlainNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatKopecksValue(value: number, showKopecks: boolean): string {
  return formatRublesWithSettings(value, showKopecks).replace(/\s?₽$/, '');
}

function useAllBlockValues(): Record<string, number | string | null> {
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
  }, [api, tick]);
}

function simpleMathEval(expr: string): number | null {
  if (!/^[\d\s+\-*/().,%]+$/.test(expr)) return null;
  try {
    const fn = new Function('return (' + expr + ')');
    const result = fn();
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function evaluateValue(
  raw: string,
  blockValues: Record<string, number | string | null>,
  showKopecks: boolean,
): { display: string; value: number | string } {
  if (!raw.startsWith('=')) {
    const parsed = parseCellNumber(raw);
    return { display: raw, value: parsed ?? raw };
  }

  let expr = raw.slice(1);
  const blockRefPattern = /@([A-Za-z0-9_.:-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRefPattern.exec(raw)) !== null) {
    const refName = m[1];
    const val = blockValues[refName];
    expr = expr.replace(m[0], val !== null && val !== undefined ? String(val) : '0');
  }

  const result = simpleMathEval(expr);
  if (result !== null) {
    return {
      display: raw.includes('@') ? formatKopecksValue(result, showKopecks) : formatPlainNumber(result),
      value: result,
    };
  }

  try {
    const parser = new FormulaParser();
    const parsed = parser.parse(expr, { row: 1, col: 1, sheet: 'Sheet1' });
    if (typeof parsed === 'number') {
      return {
        display: raw.includes('@') ? formatKopecksValue(parsed, showKopecks) : formatPlainNumber(parsed),
        value: parsed,
      };
    }
    if (typeof parsed === 'string') return { display: parsed, value: parsed };
    if (typeof parsed === 'boolean') return { display: parsed ? 'TRUE' : 'FALSE', value: parsed ? 1 : 0 };
  } catch {
    return { display: '#ERR', value: '#ERR' };
  }

  return {
    display: '#ERR',
    value: '#ERR',
  };
}

function RenderExcelCell({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const density = useBlockDensity();
  const { settings: globalSettings } = useFormatSettings();
  const showKopecks = config.showKopecks ?? globalSettings.showKopecks;
  const availableBlocks = useAvailableBlockSources();
  const liveValues = useAllBlockValues();
  const [draft, setDraft] = useState(config.value);
  const [editing, setEditing] = useState(false);
  const [caretPos, setCaretPos] = useState<number | null>(null);
  const [blockPickerOpen, setBlockPickerOpen] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [selectedSourceGroup, setSelectedSourceGroup] = useState('all');
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openingBlockPickerRef = useRef(false);
  const accent = instance.appearance?.accentColor;
  const title = config.title;

  const blockValues = useMemo(() => {
    const result: Record<string, number | string | null> = { ...liveValues };
    sourcePages.forEach((page) => {
      page.blocks.forEach((block) => {
        block.fields.forEach((field) => {
          const scopedKey = `${block.pageKey}:${block.blockId}.${field.name}`;
          const localKey = field.name === 'value' ? block.blockId : `${block.blockId}.${field.name}`;
          result[scopedKey] = liveValues[scopedKey] ?? field.value;
          if (result[localKey] === undefined) result[localKey] = liveValues[localKey] ?? field.value;
        });
      });
    });
    Object.entries(config.blockRefs ?? {}).forEach(([name, val]) => {
      result[name] = val ?? liveValues[name] ?? null;
    });
    return result;
  }, [config.blockRefs, liveValues, sourcePages]);

  const computed = useMemo(() => evaluateValue(config.value, blockValues, showKopecks), [config.value, blockValues, showKopecks]);

  useBlockValuePublisher(instance.id, {
    value: typeof computed.value === 'number' ? computed.value : null,
    raw: config.value,
    label: title,
  });

  useEffect(() => {
    if (!editing) setDraft(config.value);
  }, [config.value, editing]);

  useEffect(() => {
    if (!blockPickerOpen) return;
    let cancelled = false;
    setSourceLoading(true);
    fetch('/api/blocks/sources')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.pages)) setSourcePages(data.pages);
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
  }, [blockPickerOpen]);

  const blockSourcePages = useMemo<SourcePage[]>(() => {
    const liveBlocks: SourceBlock[] = availableBlocks
      .filter((b) => b.blockId !== instance.id)
      .map((b) => ({
        blockId: b.blockId,
        pageKey: 'current',
        pageLabel: 'Текущая страница',
        typeLabel: 'Live block',
        category: 'Текущая страница',
        label: String(liveValues[`${b.blockId}.label`] ?? `Блок ${b.blockId.slice(0, 8)}`),
        fields: b.fields.map((field) => ({
          name: field,
          label: field === 'value' ? 'Значение' : field === 'count' ? 'Количество' : field,
          value: liveValues[field === 'value' ? b.blockId : `${b.blockId}.${field}`] ?? null,
        })),
      }));
    const pages = sourcePages.map((page) => ({
      ...page,
      blocks: page.blocks.filter((block) => block.blockId !== instance.id),
    }));
    return liveBlocks.length > 0
      ? [{ pageKey: 'current', pageLabel: 'Текущая страница', blocks: liveBlocks }, ...pages]
      : pages;
  }, [availableBlocks, instance.id, liveValues, sourcePages]);

  const sourceGroups = useMemo(() => {
    const total = blockSourcePages.reduce((acc, page) => acc + page.blocks.length, 0);
    return [
      { id: 'all', label: 'Все блоки', count: total },
      ...blockSourcePages.filter((page) => page.blocks.length > 0).map((page) => ({
        id: `page:${page.pageKey}`,
        label: page.pageLabel,
        count: page.blocks.length,
      })),
    ];
  }, [blockSourcePages]);

  const filteredSourcePages = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    return blockSourcePages
      .map((page) => ({
        ...page,
        blocks: page.blocks.filter((block) => {
          if (selectedSourceGroup.startsWith('page:') && selectedSourceGroup.slice(5) !== page.pageKey) return false;
          if (!q) return true;
          return [page.pageLabel, block.category, block.typeLabel, block.label, block.blockId].join(' ').toLowerCase().includes(q);
        }),
      }))
      .filter((page) => page.blocks.length > 0);
  }, [blockSearch, blockSourcePages, selectedSourceGroup]);

  function save(patch: Partial<Config>) {
    onConfigChange?.({ ...config, ...patch } as Record<string, unknown>);
  }

  function commit() {
    save({ value: draft });
    setEditing(false);
    setCaretPos(null);
  }

  function cancel() {
    setDraft(config.value);
    setEditing(false);
    setCaretPos(null);
  }

  function insertBlockField(block: SourceBlock, field: SourceField) {
    const ref = block.pageKey === 'current'
      ? field.name === 'value' ? block.blockId : `${block.blockId}.${field.name}`
      : `${block.pageKey}:${block.blockId}.${field.name}`;
    const token = `@${ref}`;
    const input = inputRef.current;
    let base = draft;
    let pos = caretPos ?? input?.selectionStart ?? base.length;
    if (!base.startsWith('=')) {
      base = `=${base}`;
      pos += 1;
    }
    pos = Math.max(1, Math.min(pos, base.length));
    const nextValue = base.slice(0, pos) + token + base.slice(pos);
    const nextRefs = { ...(config.blockRefs ?? {}), [ref]: field.value };
    setDraft(nextValue);
    save({ value: nextValue, blockRefs: nextRefs });
    setBlockPickerOpen(false);
    setBlockSearch('');
    const newPos = pos + token.length;
    setCaretPos(newPos);
    setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(newPos, newPos);
    }, 0);
  }

  if (density === 'xs') {
    return (
      <Card className="flex h-full items-center justify-center p-1">
        <div className="truncate text-sm font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
          {computed.display || '—'}
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col p-3">
      <div className="flex items-center gap-1.5">
        <Calculator className="h-4 w-4 shrink-0 text-muted-foreground" style={accent ? { color: accent } : undefined} />
        <Input
          value={title}
          onChange={(e) => save({ title: e.target.value })}
          className="h-7 min-w-0 border-0 bg-transparent px-0 text-sm font-medium text-muted-foreground shadow-none focus-visible:ring-0"
          placeholder="Название"
        />
      </div>

      <div className="mt-2 flex flex-1 items-center">
        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCaretPos(e.target.selectionStart);
            }}
            onSelect={(e) => setCaretPos((e.target as HTMLInputElement).selectionStart)}
            onBlur={() => {
              if (openingBlockPickerRef.current || blockPickerOpen) return;
              commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
            className="h-10 border-0 bg-muted/30 px-2 text-2xl font-semibold tabular-nums shadow-none focus-visible:bg-background"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setDraft(config.value);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="w-full truncate rounded-md px-1 py-1 text-left text-3xl font-semibold tabular-nums transition hover:bg-accent/30"
            style={accent ? { color: accent } : undefined}
            title={config.value.startsWith('=') ? `Формула: ${config.value}` : undefined}
          >
            {computed.display || '—'}
          </button>
        )}
      </div>

      {config.showFormulaBar && editing && (
        <div className="mt-2 flex items-center gap-1 border-t border-border/40 pt-2">
          <FunctionSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{draft}</span>
          <Dialog
            open={blockPickerOpen}
            onOpenChange={(open) => {
              setBlockPickerOpen(open);
              if (!open) openingBlockPickerRef.current = false;
            }}
          >
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openingBlockPickerRef.current = true;
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openingBlockPickerRef.current = true;
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openingBlockPickerRef.current = true;
                setBlockPickerOpen(true);
              }}
              className="h-6 shrink-0 rounded bg-amber-50 px-2 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400"
            >
              @Блок
            </button>
            <DialogContent
              className="w-[min(94vw,640px)] max-w-none gap-0 overflow-hidden p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                openingBlockPickerRef.current = false;
                inputRef.current?.focus();
              }}
            >
              <DialogHeader className="border-b border-border/60 px-4 py-3">
                <DialogTitle className="text-sm">Вставить значение блока</DialogTitle>
                <DialogDescription className="text-[11px]">Выберите блок или ячейку таблицы</DialogDescription>
              </DialogHeader>
              <div className="grid min-h-[320px] grid-cols-[180px_minmax(0,1fr)]">
                <aside className="border-r border-border/60 bg-muted/20">
                  <div className="border-b border-border/40 px-3 py-2">
                    <Input placeholder="Поиск..." value={blockSearch} onChange={(e) => setBlockSearch(e.target.value)} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-0.5 p-2">
                    {sourceGroups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedSourceGroup(group.id)}
                        className={
                          'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition ' +
                          (selectedSourceGroup === group.id
                            ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border/70'
                            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground')
                        }
                      >
                        <span className="truncate">{group.label}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{group.count}</span>
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="max-h-[420px] overflow-y-auto">
                  {sourceLoading ? (
                    <p className="py-12 text-center text-xs text-muted-foreground">Загружаю блоки…</p>
                  ) : filteredSourcePages.length === 0 ? (
                    <p className="py-12 text-center text-xs text-muted-foreground">Нет доступных блоков.</p>
                  ) : (
                    filteredSourcePages.map((page) => (
                      <section key={page.pageKey}>
                        <div className="sticky top-0 z-10 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground">{page.pageLabel}</span>
                        </div>
                        {page.blocks.map((block) => (
                          <div key={`${block.pageKey}:${block.blockId}`} className="border-b border-border/30 px-3 py-2 transition last:border-b-0 hover:bg-accent/30">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-foreground">{block.label}</div>
                                <div className="text-[10px] text-muted-foreground">{block.category} · {block.typeLabel}</div>
                              </div>
                              <div className="flex max-w-[260px] shrink-0 flex-wrap justify-end gap-1">
                                {block.fields.filter((f) => f.name !== 'label' && f.name !== 'raw').map((field) => {
                                  const preview = field.value !== null && field.value !== undefined ? String(field.value).slice(0, 16) : '—';
                                  return (
                                    <button
                                      key={field.name}
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition hover:bg-primary/10 hover:ring-primary/40"
                                      onClick={() => insertBlockField(block, field)}
                                      title={`${field.label} = ${preview}`}
                                    >
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
        </div>
      )}
    </Card>
  );
}

function ExcelCellSettings({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  const availableBlocks = useAvailableBlockSources();
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [selectedSourceGroup, setSelectedSourceGroup] = useState('all');

  function set<K extends keyof Config>(key: K, value: Config[K]) {
    onChange({ ...parsed, [key]: value } as unknown as Record<string, unknown>);
  }

  useEffect(() => {
    if (!linkPickerOpen) return;
    let cancelled = false;
    setSourceLoading(true);
    fetch('/api/blocks/sources')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.pages)) setSourcePages(data.pages);
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
  }, [linkPickerOpen]);

  const blockSourcePages = useMemo<SourcePage[]>(() => {
    const liveBlocks: SourceBlock[] = availableBlocks.map((b) => ({
      blockId: b.blockId,
      pageKey: 'current',
      pageLabel: 'Текущая страница',
      typeLabel: 'Live block',
      category: 'Текущая страница',
      label: `Блок ${b.blockId.slice(0, 8)}`,
      fields: b.fields.map((field) => ({
        name: field,
        label: field === 'value' ? 'Значение' : field === 'count' ? 'Количество' : field,
        value: null,
      })),
    }));
    return liveBlocks.length > 0
      ? [{ pageKey: 'current', pageLabel: 'Текущая страница', blocks: liveBlocks }, ...sourcePages]
      : sourcePages;
  }, [availableBlocks, sourcePages]);

  const sourceGroups = useMemo(() => {
    const total = blockSourcePages.reduce((acc, page) => acc + page.blocks.length, 0);
    return [
      { id: 'all', label: 'Все блоки', count: total },
      ...blockSourcePages.filter((page) => page.blocks.length > 0).map((page) => ({
        id: `page:${page.pageKey}`,
        label: page.pageLabel,
        count: page.blocks.length,
      })),
    ];
  }, [blockSourcePages]);

  const filteredSourcePages = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    return blockSourcePages
      .map((page) => ({
        ...page,
        blocks: page.blocks.filter((block) => {
          if (selectedSourceGroup.startsWith('page:') && selectedSourceGroup.slice(5) !== page.pageKey) return false;
          if (!q) return true;
          return [page.pageLabel, block.category, block.typeLabel, block.label, block.blockId, ...block.fields.map((f) => f.name)].join(' ').toLowerCase().includes(q);
        }),
      }))
      .filter((page) => page.blocks.length > 0);
  }, [blockSearch, blockSourcePages, selectedSourceGroup]);

  function insertLinkedField(block: SourceBlock, field: SourceField) {
    const ref = block.pageKey === 'current'
      ? field.name === 'value' ? block.blockId : `${block.blockId}.${field.name}`
      : `${block.pageKey}:${block.blockId}.${field.name}`;
    const token = `@${ref}`;
    const base = parsed.value.startsWith('=') ? parsed.value : `=${parsed.value}`;
    const spacer = base.length > 1 && !/[+\-*/(]$/.test(base) ? '+' : '';
    onChange({
      ...parsed,
      value: `${base}${spacer}${token}`,
      blockRefs: { ...(parsed.blockRefs ?? {}), [ref]: field.value },
    } as unknown as Record<string, unknown>);
    setLinkPickerOpen(false);
    setBlockSearch('');
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Название</Label>
        <Input value={parsed.title} onChange={(e) => set('title', e.target.value)} className="h-8 text-xs" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Значение / формула</Label>
          <Dialog open={linkPickerOpen} onOpenChange={setLinkPickerOpen}>
            <button
              type="button"
              onClick={() => setLinkPickerOpen(true)}
              className="h-6 rounded-md bg-amber-50 px-2 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400"
            >
              @связать
            </button>
            <DialogContent className="w-[min(94vw,640px)] max-w-none gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b border-border/60 px-4 py-3">
                <DialogTitle className="text-sm">Связать ячейку с источником</DialogTitle>
                <DialogDescription className="text-[11px]">
                  Выберите блок, поле или ячейку — ссылка будет добавлена в формулу значения.
                </DialogDescription>
              </DialogHeader>
              <div className="grid min-h-[320px] grid-cols-[180px_minmax(0,1fr)]">
                <aside className="border-r border-border/60 bg-muted/20">
                  <div className="border-b border-border/40 px-3 py-2">
                    <Input placeholder="Поиск..." value={blockSearch} onChange={(e) => setBlockSearch(e.target.value)} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-0.5 p-2">
                    {sourceGroups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedSourceGroup(group.id)}
                        className={
                          'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition ' +
                          (selectedSourceGroup === group.id
                            ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border/70'
                            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground')
                        }
                      >
                        <span className="truncate">{group.label}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{group.count}</span>
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="max-h-[420px] overflow-y-auto">
                  {sourceLoading ? (
                    <p className="py-12 text-center text-xs text-muted-foreground">Загружаю блоки…</p>
                  ) : filteredSourcePages.length === 0 ? (
                    <p className="py-12 text-center text-xs text-muted-foreground">Нет доступных источников.</p>
                  ) : (
                    filteredSourcePages.map((page) => (
                      <section key={page.pageKey}>
                        <div className="sticky top-0 z-10 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground">{page.pageLabel}</span>
                        </div>
                        {page.blocks.map((block) => (
                          <div key={`${block.pageKey}:${block.blockId}`} className="border-b border-border/30 px-3 py-2 transition last:border-b-0 hover:bg-accent/30">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-foreground">{block.label}</div>
                                <div className="text-[10px] text-muted-foreground">{block.category} · {block.typeLabel}</div>
                              </div>
                              <div className="flex max-w-[260px] shrink-0 flex-wrap justify-end gap-1">
                                {block.fields.filter((f) => f.name !== 'label' && f.name !== 'raw').map((field) => {
                                  const preview = field.value !== null && field.value !== undefined ? String(field.value).slice(0, 16) : '—';
                                  return (
                                    <button
                                      key={field.name}
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-border/60 transition hover:bg-primary/10 hover:ring-primary/40"
                                      onClick={() => insertLinkedField(block, field)}
                                      title={`${field.label} = ${preview}`}
                                    >
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
        </div>
        <Input value={parsed.value} onChange={(e) => set('value', e.target.value)} className="h-8 font-mono text-xs" placeholder="=1+2 или =@block.value" />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div>
          <div className="text-xs font-medium">Строка формул</div>
          <div className="text-[11px] text-muted-foreground">Показывает @Блок picker при редактировании формулы</div>
        </div>
        <Switch checked={parsed.showFormulaBar} onCheckedChange={(v) => set('showFormulaBar', v)} />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">Показывать копейки</div>
          <div className="text-[11px] text-muted-foreground">
            {parsed.showKopecks === null
              ? 'Используется глобальная настройка'
              : parsed.showKopecks
                ? 'Включено (1 234,56)'
                : 'Выключено (1 235)'}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {parsed.showKopecks !== null && (
            <button type="button" onClick={() => set('showKopecks', null)} className="text-[10px] text-muted-foreground hover:text-foreground">
              Сбросить
            </button>
          )}
          <Switch checked={parsed.showKopecks ?? false} onCheckedChange={(v) => set('showKopecks', v)} />
        </div>
      </div>
    </div>
  );
}

export const ExcelCellBlock: BlockDef = {
  type: 'excel.cell',
  displayName: 'Excel-ячейка',
  description: 'Минимальный блок как одна ячейка Excel: текст, числа, формулы и связи с блоками/ячейками.',
  category: 'tables',
  icon: Calculator,
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 100, h: 60 },
  pages: ['*'],
  supportsDependencies: true,
  configSchema: ConfigSchema,
  defaultConfig: () => ({ title: 'Доходы', value: '', showFormulaBar: true, showKopecks: null }),
  SettingsForm: ExcelCellSettings,
  Render: RenderExcelCell,
};
