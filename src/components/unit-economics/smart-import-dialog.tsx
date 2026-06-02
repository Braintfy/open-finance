// PURPOSE: Модалка «Умный импорт» в блок «Мой магазин · таблица» (v0.37.0).
// Источники: XLSX-файл и другие блоки-таблицы. Шаги:
//   1. source  — выбор источника (XLSX / другая таблица / Ozon Аналитика).
//   2. map     — сопоставление колонок (matched → существующая / новая),
//                переключатель «формула / значение» для формульных колонок.
//   3. options — ключ объединения, merge/replace, перезапись matched, пропуск категорий.
// Применение считается на клиенте через applyImportPlan и отдаётся наверх.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  FileSpreadsheet,
  Database,
  BarChart3,
  ChevronRight,
  Check,
  X,
  ArrowRight,
  FunctionSquare,
  Plus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { parseXlsxToImportTable } from '@/lib/unit-economics/import/xlsx-to-table';
import {
  applyImportPlan,
  buildDefaultMappings,
  type ApplyResult,
  type ColumnMapping,
  type ImportOptions,
  type ImportTable,
  type TargetColumn,
  type TargetRow,
} from '@/lib/unit-economics/table-import';

type Step = 'source' | 'map' | 'options';

type BlockSource = {
  blockId: string;
  pageKey: string;
  pageLabel: string;
  type: string;
  typeLabel: string;
  label: string;
  columnCount: number;
  rowCount: number;
};

const TYPE_BADGE: Record<string, string> = {
  number: 'Число',
  percent: 'Процент',
  money: 'Деньги',
  text: 'Текст',
  formula: 'Формула',
};

export function SmartImportDialog({
  open,
  onClose,
  existingColumns,
  existingRows,
  makeId,
  onApply,
  onOpenOzon,
}: {
  open: boolean;
  onClose: () => void;
  existingColumns: TargetColumn[];
  existingRows: TargetRow[];
  makeId: (prefix: string) => string;
  onApply: (result: ApplyResult, meta: { sourceLabel: string; sourceKind: 'xlsx' | 'block' }) => void;
  onOpenOzon: () => void;
}) {
  const [step, setStep] = useState<Step>('source');
  const [picker, setPicker] = useState<'none' | 'block'>('none');
  const [table, setTable] = useState<ImportTable | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [options, setOptions] = useState<ImportOptions>({
    matchBy: 'name',
    mode: 'merge',
    overwriteMatched: 'values',
    skipCategoryRows: false,
  });
  const [blockSources, setBlockSources] = useState<BlockSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep('source');
    setPicker('none');
    setTable(null);
    setMappings([]);
    setOptions({ matchBy: 'name', mode: 'merge', overwriteMatched: 'values', skipCategoryRows: false });
    setError(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  /** После загрузки таблицы — строим дефолтные сопоставления и идём в map. */
  const acceptTable = useCallback(
    (t: ImportTable) => {
      setTable(t);
      setMappings(buildDefaultMappings(t, existingColumns));
      // Если есть колонка-артикул — матч по артикулу, иначе по названию.
      const hasArticle = t.columns.some((c) => c.role === 'article');
      setOptions((o) => ({ ...o, matchBy: hasArticle ? 'article' : 'name' }));
      setStep('map');
      setError(null);
    },
    [existingColumns],
  );

  // --- XLSX upload ---
  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const buf = await file.arrayBuffer();
        const res = parseXlsxToImportTable(buf, { fileLabel: file.name });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        acceptTable(res.table);
      } catch (e) {
        setError((e as Error).message ?? 'Ошибка чтения файла');
      } finally {
        setBusy(false);
      }
    },
    [acceptTable],
  );

  // --- Block sources discovery ---
  const openBlockPicker = useCallback(() => {
    setPicker('block');
    setLoadingSources(true);
    setError(null);
    fetch('/api/unit-economics/import/table-source')
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setError('Не удалось загрузить источники');
          return;
        }
        setBlockSources(data.sources ?? []);
      })
      .catch(() => setError('Ошибка сети'))
      .finally(() => setLoadingSources(false));
  }, []);

  const selectBlockSource = useCallback(
    async (src: BlockSource) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/unit-economics/import/table-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceBlockId: src.blockId, sourcePageKey: src.pageKey }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error ?? 'Не удалось прочитать блок');
          return;
        }
        acceptTable(data.table as ImportTable);
      } catch (e) {
        setError((e as Error).message ?? 'Ошибка сети');
      } finally {
        setBusy(false);
      }
    },
    [acceptTable],
  );

  // --- Mapping helpers ---
  const toggleInclude = useCallback((key: string) => {
    setMappings((prev) => prev.map((m) => (m.column.key === key ? { ...m, include: !m.include } : m)));
  }, []);
  const toggleAsFormula = useCallback((key: string) => {
    setMappings((prev) => prev.map((m) => (m.column.key === key ? { ...m, asFormula: !m.asFormula } : m)));
  }, []);

  // --- Live preview of plan (for stats in options step) ---
  const preview = useMemo<ApplyResult | null>(() => {
    if (!table) return null;
    try {
      return applyImportPlan({ table, mappings, options, existingColumns, existingRows, makeId });
    } catch {
      return null;
    }
  }, [table, mappings, options, existingColumns, existingRows, makeId]);

  const identityInfo = useMemo(() => {
    if (!table) return { name: null as string | null, article: null as string | null };
    return {
      name: table.columns.find((c) => c.role === 'name')?.label ?? null,
      article: table.columns.find((c) => c.role === 'article')?.label ?? null,
    };
  }, [table]);

  const categoryCount = useMemo(
    () => (table ? table.rows.filter((r) => r.isCategory).length : 0),
    [table],
  );

  const includedCount = mappings.filter((m) => m.include).length;

  const doApply = useCallback(() => {
    if (!table || !preview) return;
    onApply(preview, { sourceLabel: table.source.label, sourceKind: table.source.kind });
    onClose();
  }, [table, preview, onApply, onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Умный импорт данных</DialogTitle>
          <DialogDescription>
            {step === 'source' && 'Шаг 1 из 3: выберите источник данных.'}
            {step === 'map' && 'Шаг 2 из 3: какие колонки импортировать и как (формула / значение).'}
            {step === 'options' && 'Шаг 3 из 3: параметры объединения.'}
          </DialogDescription>
        </DialogHeader>

        {/* ---------- STEP: SOURCE ---------- */}
        {step === 'source' && picker === 'none' && (
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
            <SourceCard
              icon={FileSpreadsheet}
              title="Загрузить XLSX"
              desc="Excel-файл: заголовки, формулы и данные с авто-конвертацией."
              onClick={() => fileRef.current?.click()}
              busy={busy}
            />
            <SourceCard
              icon={Database}
              title="Из другой таблицы"
              desc="Другой «Мой магазин», Таблица, Данные или Ozon-таблица."
              onClick={openBlockPicker}
            />
            <SourceCard
              icon={BarChart3}
              title="Из Ozon Аналитики"
              desc="Подтянуть товары и метрики из блока «Ozon · Аналитика»."
              onClick={() => {
                onClose();
                onOpenOzon();
              }}
            />
          </div>
        )}

        {/* ---------- STEP: SOURCE → BLOCK PICKER ---------- */}
        {step === 'source' && picker === 'block' && (
          <div className="min-w-0 space-y-2">
            <div className="max-h-[360px] overflow-y-auto rounded-md border border-border/60">
              {loadingSources ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загружаю источники…
                </div>
              ) : blockSources.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Не найдено блоков-таблиц с данными. Подойдут «Мой магазин», «Таблица»,
                  «Данные», «Ozon · юнит-таблица».
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {blockSources.map((s) => (
                    <button
                      key={`${s.pageKey}:${s.blockId}`}
                      type="button"
                      disabled={busy}
                      onClick={() => selectBlockSource(s)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-accent/40 disabled:opacity-50"
                    >
                      <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.typeLabel} · {s.pageLabel} · {s.rowCount} строк · {s.columnCount} колонок
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

        {/* ---------- STEP: MAP ---------- */}
        {step === 'map' && table && (
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Источник:</span>
              <span className="font-medium">{table.source.label}</span>
              <span className="text-muted-foreground">· {table.rows.length} строк</span>
              {identityInfo.name && (
                <span className="ml-auto text-[11px] text-muted-foreground">
                  Название → <span className="font-medium text-foreground">{identityInfo.name}</span>
                  {identityInfo.article && (
                    <>
                      {' · '}Артикул →{' '}
                      <span className="font-medium text-foreground">{identityInfo.article}</span>
                    </>
                  )}
                </span>
              )}
            </div>

            <div className="max-h-[360px] overflow-y-auto rounded-md border border-border/60">
              <div className="divide-y divide-border/40">
                {mappings.map((m) => (
                  <div
                    key={m.column.key}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-xs transition',
                      !m.include && 'opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={m.include}
                      onChange={() => toggleInclude(m.column.key)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-border accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{m.column.label}</div>
                      {m.column.formula && (
                        <div className="truncate text-[10px] text-muted-foreground">
                          <code>{m.column.formula}</code>
                        </div>
                      )}
                    </div>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="flex w-40 shrink-0 items-center gap-1">
                      {m.isNew ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <Plus className="h-2.5 w-2.5" /> новая
                        </span>
                      ) : (
                        <span className="min-w-0 truncate rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                          {m.matchedLabel}
                        </span>
                      )}
                    </div>
                    <div className="w-28 shrink-0 text-right">
                      {m.column.formula ? (
                        <button
                          type="button"
                          onClick={() => toggleAsFormula(m.column.key)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition',
                            m.asFormula
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border/60 text-muted-foreground hover:border-border',
                          )}
                          title="Переключить: формула / значение"
                        >
                          <FunctionSquare className="h-2.5 w-2.5" />
                          {m.asFormula ? 'формула' : 'значение'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {TYPE_BADGE[m.column.type] ?? m.column.type}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Выбрано {includedCount} из {mappings.length}. Колонки, на которые ссылаются формулы,
              добавляются автоматически.
            </p>
          </div>
        )}

        {/* ---------- STEP: OPTIONS ---------- */}
        {step === 'options' && table && (
          <div className="min-w-0 space-y-3">
            <div className="space-y-1.5">
              <Label>Ключ объединения строк</Label>
              <div className="flex gap-2">
                {(['name', 'article'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOptions((o) => ({ ...o, matchBy: m }))}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-2 text-xs transition',
                      options.matchBy === m
                        ? 'border-primary bg-primary/10 font-medium text-foreground'
                        : 'border-border/60 text-muted-foreground hover:border-border',
                    )}
                  >
                    {m === 'name' ? 'По названию' : 'По артикулу'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Режим</Label>
              <div className="flex flex-col gap-2">
                {(
                  [
                    { id: 'merge', label: 'Обновить совпадающие + добавить новые' },
                    { id: 'replace', label: 'Перезаписать все строки таблицы' },
                  ] as Array<{ id: ImportOptions['mode']; label: string }>
                ).map((opt) => (
                  <label
                    key={opt.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs transition',
                      options.mode === opt.id
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border/60 text-muted-foreground hover:border-border',
                    )}
                  >
                    <input
                      type="radio"
                      checked={options.mode === opt.id}
                      onChange={() => setOptions((o) => ({ ...o, mode: opt.id }))}
                      className="h-3 w-3 accent-primary"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Совпавшие колонки</Label>
              <select
                value={options.overwriteMatched}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, overwriteMatched: e.target.value as ImportOptions['overwriteMatched'] }))
                }
                className="h-9 w-full rounded border border-border/60 bg-background px-2 text-sm"
              >
                <option value="values">Обновлять значения</option>
                <option value="values_and_formulas">Обновлять значения и формулы</option>
                <option value="skip">Не трогать (только новые колонки)</option>
              </select>
            </div>

            {categoryCount > 0 && (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={options.skipCategoryRows}
                  onChange={(e) => setOptions((o) => ({ ...o, skipCategoryRows: e.target.checked }))}
                  className="mt-0.5 h-3 w-3 accent-primary"
                />
                <div>
                  <div className="font-medium">Пропускать строки-категории</div>
                  <div className="text-[11px] text-muted-foreground">
                    Найдено {categoryCount} строк без цены (вероятно заголовки разделов).
                  </div>
                </div>
              </label>
            )}

            {preview && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                Будет добавлено {preview.stats.columnsAdded} колонок
                {preview.stats.columnsMatched > 0 && `, обновлено ${preview.stats.columnsMatched} существующих`}
                {' · '}+{preview.stats.rowsAdded} строк, обновлено {preview.stats.rowsUpdated}
                {preview.stats.rowsSkipped > 0 && `, пропущено ${preview.stats.rowsSkipped}`}.
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X /> Отмена
          </Button>
          <div className="flex gap-2">
            {step === 'source' && picker === 'block' && (
              <Button variant="outline" onClick={() => setPicker('none')} disabled={busy}>
                Назад
              </Button>
            )}
            {step === 'map' && (
              <>
                <Button variant="outline" onClick={() => { setStep('source'); setTable(null); }} disabled={busy}>
                  Назад
                </Button>
                <Button onClick={() => setStep('options')} disabled={includedCount === 0}>
                  Далее <ChevronRight />
                </Button>
              </>
            )}
            {step === 'options' && (
              <>
                <Button variant="outline" onClick={() => setStep('map')} disabled={busy}>
                  Назад
                </Button>
                <Button onClick={doApply} disabled={busy || !preview}>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} Импортировать
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceCard({
  icon: Icon,
  title,
  desc,
  onClick,
  busy,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex flex-col items-start gap-2 rounded-lg border border-border/60 bg-card p-3 text-left transition hover:border-primary/50 hover:bg-accent/30 disabled:opacity-50"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-[11px] leading-snug text-muted-foreground">{desc}</div>
    </button>
  );
}
