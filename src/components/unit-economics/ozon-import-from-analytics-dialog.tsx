// PURPOSE: Dialog «Импорт данных из Ozon Аналитика» в блок «Мой магазин · таблица».
// (v0.22.0)
//
// Steps:
//   1. Source picker: выбор блока unit.ozon-analytics из списка доступных
//      (через /api/blocks/sources — все страницы текущего пользователя).
//   2. Column multi-select: какие колонки импортировать (DEFAULT_IMPORT_COLUMNS).
//   3. Match key (article/sku) + mode (replace/merge).
//   4. Optional checkbox «Синхронизировать автоматически» (live-binding).
//   5. «Импортировать» → fetch + merge → callback.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Database, ChevronRight, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COLUMN_DEFS, type TableColumnKey } from './ozon-analytics-table';
import {
  DEFAULT_IMPORT_COLUMNS,
  type ImportMode,
  type MatchBy,
  type OzonAnalyticsSourceConfig,
} from '@/lib/unit-economics/ozon-to-my-store';
import { cn } from '@/lib/utils';

type SourceBlockDescriptor = {
  blockId: string;
  pageKey: string;
  pageLabel: string;
  label: string;
  config: OzonAnalyticsSourceConfig;
};

export type OzonImportSettings = {
  blockId: string;
  pageKey: string;
  columns: TableColumnKey[];
  matchBy: MatchBy;
  mode: ImportMode;
  syncOnMount: boolean;
};

export function OzonImportFromAnalyticsDialog({
  open,
  onClose,
  onImport,
  initialSettings,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (settings: OzonImportSettings, source: SourceBlockDescriptor) => Promise<void>;
  initialSettings?: Partial<OzonImportSettings>;
}) {
  const [sources, setSources] = useState<SourceBlockDescriptor[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedSource, setSelectedSource] = useState<SourceBlockDescriptor | null>(null);
  const [columns, setColumns] = useState<TableColumnKey[]>(
    (initialSettings?.columns as TableColumnKey[] | undefined) ?? DEFAULT_IMPORT_COLUMNS,
  );
  const [matchBy, setMatchBy] = useState<MatchBy>(initialSettings?.matchBy ?? 'article');
  const [mode, setMode] = useState<ImportMode>(initialSettings?.mode ?? 'merge');
  const [syncOnMount, setSyncOnMount] = useState<boolean>(
    initialSettings?.syncOnMount ?? false,
  );
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available sources при открытии.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingSources(true);
    setError(null);
    fetch('/api/blocks/sources')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) {
          setError('Не удалось загрузить список блоков');
          return;
        }
        const list: SourceBlockDescriptor[] = [];
        for (const page of data.pages ?? []) {
          for (const block of page.blocks ?? []) {
            if (block.type !== 'unit.ozon-analytics') continue;
            // Конфиг блока тут не возвращается напрямую (sources route даёт
            // только fields-aggregates). Period/accountId извлечём из
            // pageKey + blockId через отдельный fetch при импорте, либо
            // дополним server-side. Сейчас — простейший stub: account из
            // первого fields-токена пока недоступен. Так что мы используем
            // /api/blocks/sources только для discovery, а реальный config
            // загружаем из block_layouts когда пользователь нажмёт «далее».
            list.push({
              blockId: block.blockId,
              pageKey: block.pageKey,
              pageLabel: block.pageLabel,
              label: block.label,
              config: {
                accountId: null,
                periodPreset: '30d',
                customFrom: null,
                customTo: null,
              },
            });
          }
        }
        setSources(list);
        // Если в initialSettings указан blockId — выбираем его автоматически.
        if (initialSettings?.blockId) {
          const match = list.find((s) => s.blockId === initialSettings.blockId);
          if (match) {
            setSelectedSource(match);
            setStep(2);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('Ошибка сети');
      })
      .finally(() => {
        if (!cancelled) setLoadingSources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialSettings?.blockId]);

  const filteredSources = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) =>
        s.label.toLowerCase().includes(q) || s.pageLabel.toLowerCase().includes(q),
    );
  }, [sources, search]);

  function toggleColumn(key: TableColumnKey) {
    setColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function reset() {
    setStep(1);
    setSelectedSource(null);
    setColumns(DEFAULT_IMPORT_COLUMNS);
    setMatchBy('article');
    setMode('merge');
    setSyncOnMount(false);
    setSearch('');
    setError(null);
  }

  async function runImport() {
    if (!selectedSource || columns.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(
        {
          blockId: selectedSource.blockId,
          pageKey: selectedSource.pageKey,
          columns,
          matchBy,
          mode,
          syncOnMount,
        },
        selectedSource,
      );
      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message ?? 'Импорт не удался');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Импорт из Ozon Аналитика</DialogTitle>
          <DialogDescription>
            Подтянуть данные товаров из блока «Ozon · Аналитика» в таблицу «Мой магазин».
            {step === 1 && ' Шаг 1 из 3: выбор блока-источника.'}
            {step === 2 && ' Шаг 2 из 3: какие колонки импортировать.'}
            {step === 3 && ' Шаг 3 из 3: параметры объединения.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: source picker */}
        {step === 1 && (
          <div className="space-y-3">
            <Input
              placeholder="Поиск по странице / названию блока..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="max-h-[360px] overflow-y-auto rounded-md border border-border/60">
              {loadingSources ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загружаю блоки…
                </div>
              ) : filteredSources.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Не найдено блоков unit.ozon-analytics. Добавьте блок «Ozon · Аналитика»
                  в любой раздел Юнит-экономики, чтобы импорт стал доступен.
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {filteredSources.map((s) => (
                    <button
                      key={s.blockId}
                      type="button"
                      onClick={() => {
                        setSelectedSource(s);
                        setStep(2);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-accent/40',
                        selectedSource?.blockId === s.blockId && 'bg-accent/60',
                      )}
                    >
                      <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.pageLabel}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: column selector */}
        {step === 2 && selectedSource && (
          <div className="space-y-3">
            <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Источник:</span>{' '}
              <span className="font-medium">{selectedSource.label}</span>{' '}
              <span className="text-muted-foreground">({selectedSource.pageLabel})</span>
            </div>
            <div className="space-y-1.5">
              <Label>Колонки для импорта</Label>
              <p className="text-[11px] text-muted-foreground">
                Выбрано: {columns.length} из {COLUMN_DEFS.length}.
                Article и Name используются как ключи, добавляются автоматически.
              </p>
              <div className="max-h-[280px] overflow-y-auto rounded-md border border-border/60 p-2">
                <div className="grid grid-cols-2 gap-1">
                  {COLUMN_DEFS.map((c) => {
                    const isAlwaysImported = c.key === 'article' || c.key === 'name';
                    const checked = isAlwaysImported || columns.includes(c.key);
                    return (
                      <label
                        key={c.key}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] transition hover:bg-accent/40',
                          isAlwaysImported && 'cursor-not-allowed opacity-70',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isAlwaysImported}
                          onChange={() => !isAlwaysImported && toggleColumn(c.key)}
                          className="h-3 w-3 rounded border-border accent-primary"
                        />
                        <span className="truncate">{c.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: match key + mode + sync */}
        {step === 3 && selectedSource && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Ключ объединения</Label>
              <div className="flex gap-2">
                {(['article', 'sku'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMatchBy(m)}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-2 text-xs transition',
                      matchBy === m
                        ? 'border-primary bg-primary/10 font-medium text-foreground'
                        : 'border-border/60 text-muted-foreground hover:border-border',
                    )}
                  >
                    {m === 'article' ? 'По артикулу' : 'По SKU'}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Режим импорта</Label>
              <div className="flex flex-col gap-2">
                {(
                  [
                    { id: 'merge', label: 'Обновить совпадающие + добавить новые' },
                    { id: 'replace', label: 'Перезаписать всю таблицу' },
                  ] as Array<{ id: ImportMode; label: string }>
                ).map((opt) => (
                  <label
                    key={opt.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs transition',
                      mode === opt.id
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border/60 text-muted-foreground hover:border-border',
                    )}
                  >
                    <input
                      type="radio"
                      checked={mode === opt.id}
                      onChange={() => setMode(opt.id)}
                      className="h-3 w-3 accent-primary"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={syncOnMount}
                onChange={(e) => setSyncOnMount(e.target.checked)}
                className="mt-0.5 h-3 w-3 accent-primary"
              />
              <div className="min-w-0">
                <div className="font-medium">Синхронизировать автоматически</div>
                <div className="text-[11px] text-muted-foreground">
                  Live-binding: блок будет переподтягивать данные с Ozon при открытии
                  страницы (не чаще раза в 30 сек).
                </div>
              </div>
            </label>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <div className="text-[10px] text-muted-foreground">Шаг {step} из 3</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { reset(); onClose(); }} disabled={importing}>
              <X /> Отмена
            </Button>
            {step > 1 && (
              <Button
                variant="outline"
                onClick={() => setStep((step - 1) as 1 | 2)}
                disabled={importing}
              >
                Назад
              </Button>
            )}
            {step < 3 && (
              <Button
                onClick={() => setStep((step + 1) as 2 | 3)}
                disabled={(step === 1 && !selectedSource) || (step === 2 && columns.length === 0)}
              >
                Далее <ChevronRight />
              </Button>
            )}
            {step === 3 && (
              <Button onClick={runImport} disabled={importing}>
                {importing ? <Loader2 className="animate-spin" /> : <Check />}
                Импортировать
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
