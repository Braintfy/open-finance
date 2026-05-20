// PURPOSE: Модалка настройки привязки одной ячейки калькулятора к блоку/полю
// другого блока. Позволяет переключать manual<->block_ref, выбирать источник,
// сохранять fallback и сбрасывать привязку.
'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Unlink, X } from 'lucide-react';
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

function moneyFieldSet(
  blockId: string,
  values: Record<string, number | string | null>,
): Set<string> {
  const raw = values[`${blockId}.__money`];
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean),
  );
}

/**
 * Портировано из excel-cell.tsx: для удалённых блоков (из /api/blocks/sources)
 * накладываем актуальные live-значения и money-флаги поверх,
 * чтобы модалка не показывала «—» когда блок на этой же странице
 * уже опубликовал свежие числа.
 */
function mergeLiveFields(
  block: SourceBlock,
  liveFields: string[] | undefined,
  liveValues: Record<string, number | string | null>,
): SourceBlock {
  if (!liveFields) return block;
  const moneyFields = moneyFieldSet(block.blockId, liveValues);
  const byName = new Map(block.fields.map((field) => [field.name, field]));
  liveFields.forEach((name) => {
    const key = name === 'value' ? block.blockId : `${block.blockId}.${name}`;
    const current = byName.get(name);
    byName.set(name, {
      name,
      label: current?.label ?? sourceFieldLabel(name),
      value: liveValues[key] ?? current?.value ?? null,
      format: moneyFields.has(name) ? 'money' : current?.format,
      // Сохраняем `group` из исходного определения поля (он назначается
      // на сервере в sources/route.ts). Live-блоки без `group` останутся
      // плоскими — и это OK, для них в UI нет L2 подзаголовков.
      group: current?.group,
    });
  });
  return { ...block, fields: Array.from(byName.values()) };
}

/**
 * Порядок L2-подкатегорий внутри секции Ozon-блока в модалке связей.
 * Иные группы (если появятся новые префиксы полей) попадают в конец.
 */
const OZON_FIELD_GROUP_ORDER: readonly string[] = [
  'Текущий период',
  'Прошлый период',
  'Δ изменения',
  'Top-SKU',
  'Остатки',
  'Итоги по магазину',
  'Метаданные',
];

function fieldGroupRank(group: string | undefined): number {
  if (!group) return OZON_FIELD_GROUP_ORDER.length + 1;
  const i = OZON_FIELD_GROUP_ORDER.indexOf(group);
  return i === -1 ? OZON_FIELD_GROUP_ORDER.length : i;
}

/** Сгруппировать `fields` по `field.group` в порядке OZON_FIELD_GROUP_ORDER. */
function groupOzonFields(
  fields: SourceField[],
): Array<{ group: string | undefined; items: SourceField[] }> {
  const map = new Map<string | undefined, SourceField[]>();
  for (const f of fields) {
    const key = f.group;
    const arr = map.get(key) ?? [];
    arr.push(f);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([group, items]) => ({ group, items }))
    .sort((a, b) => fieldGroupRank(a.group) - fieldGroupRank(b.group));
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
  // ID Ozon-блоков, у которых L2-секции временно свёрнуты. По умолчанию
  // ВСЕ раскрыты — чтобы пользователь видел все доступные привязки сразу.
  // Клик по заголовку экземпляра тоглит состояние.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapsed(blockId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }

  const allPages = useMemo<SourcePage[]>(() => {
    const liveById = new Map(availableLive.map((b) => [b.blockId, b.fields]));
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
          label: b.labels[field] ?? sourceFieldLabel(field),
          value:
            liveValues[field === 'value' ? b.blockId : `${b.blockId}.${field}`] ?? null,
          format: b.moneyFields.has(field) ? 'money' as const : undefined,
        })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    // Для удалённых блоков: оверлеим live-значения поверх (если блок
    // публикуется на этой же странице — берём актуальные числа из store).
    // Также дедуплицируем: блоки, которые уже видны в `liveBlocks`,
    // не показываем повторно из удалённого списка.
    const liveIdSet = new Set(liveBlocks.map((b) => b.blockId));
    const remote = remotePages.map((page) => ({
      ...page,
      blocks: page.blocks
        .filter((b) => b.blockId !== selfBlockId && !liveIdSet.has(b.blockId))
        .map((block) => mergeLiveFields(block, liveById.get(block.blockId), liveValues)),
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
                  {page.blocks.map((block) => {
                    // Главное поле блока = `value` (всегда сверху крупной кнопкой).
                    // Остальные — компактными чипами под ним. Служебные label/raw
                    // не показываем как привязываемые источники.
                    const primaryField = block.fields.find((f) => f.name === 'value');
                    const secondaryFields = block.fields.filter(
                      (f) => f.name !== 'value' && f.name !== 'label' && f.name !== 'raw',
                    );

                    // Для категории «Аналитика Ozon» собираем поля по
                    // L2-подкатегориям (Текущий период / Прошлый / Δ /
                    // Top-SKU / Остатки / Метаданные), для остальных
                    // оставляем плоский список.
                    const isOzon = block.category === 'Аналитика Ozon';
                    const grouped = isOzon ? groupOzonFields(secondaryFields) : null;
                    const isCollapsed = collapsed.has(block.blockId);

                    return (
                      <div
                        key={`${page.pageKey}:${block.blockId}`}
                        className="border-b border-border/30 px-3 py-2 transition last:border-b-0 hover:bg-accent/20"
                      >
                        <div className="space-y-2">
                          {/* Заголовок экземпляра. Для Ozon — кликабельный
                              с chevron, разворачивает/сворачивает L2-секции. */}
                          {isOzon ? (
                            <button
                              type="button"
                              onClick={() => toggleCollapsed(block.blockId)}
                              className="flex w-full items-start gap-1.5 text-left"
                              title="Развернуть / свернуть подкатегории полей"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-foreground">
                                  {block.instanceLabel ?? block.label}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {block.category} · {block.typeLabel}
                                </div>
                              </div>
                            </button>
                          ) : (
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-foreground">
                                {block.label}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {block.category} · {block.typeLabel}
                              </div>
                            </div>
                          )}
                          {(!isOzon || !isCollapsed) && primaryField && (
                            <button
                              type="button"
                              onClick={() => pickField(block, primaryField)}
                              className="flex w-full items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-left text-[12px] transition hover:border-primary hover:bg-primary/10"
                              title={`${primaryField.label} = ${previewSourceValue(primaryField)}`}
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                                <span className="truncate font-medium text-primary">
                                  {primaryField.label}
                                </span>
                              </div>
                              <span className="shrink-0 font-mono tabular-nums text-foreground/80">
                                {previewSourceValue(primaryField)}
                              </span>
                            </button>
                          )}
                          {!isCollapsed && grouped && grouped.length > 0 && (
                            <div className="space-y-2">
                              {grouped.map(({ group, items }) =>
                                items.length === 0 ? null : (
                                  <div key={group ?? '__none__'} className="space-y-1">
                                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                                      {group ?? 'Другое'}
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {items.map((field) => {
                                        const preview = previewSourceValue(field);
                                        return (
                                          <button
                                            key={field.name}
                                            type="button"
                                            onClick={() => pickField(block, field)}
                                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-border/50 transition hover:bg-primary/5 hover:ring-primary/40"
                                            title={`${field.label} = ${preview}`}
                                          >
                                            <span className="font-medium text-foreground/80">
                                              {field.label}
                                            </span>
                                            <span className="text-muted-foreground">{preview}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                          {!isOzon && secondaryFields.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {secondaryFields.map((field) => {
                                const preview = previewSourceValue(field);
                                return (
                                  <button
                                    key={field.name}
                                    type="button"
                                    onClick={() => pickField(block, field)}
                                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-border/50 transition hover:bg-primary/5 hover:ring-primary/40"
                                    title={`${field.label} = ${preview}`}
                                  >
                                    <span className="font-medium text-foreground/80">
                                      {field.label}
                                    </span>
                                    <span className="text-muted-foreground">{preview}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
