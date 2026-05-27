// PURPOSE: UI-вкладка «Импорт / Экспорт» в BlockSettingsDialog.
// Универсальная для всех типов блоков. JSON всегда доступен; XLSX — если
// у адаптера блока есть exportXlsx/importXlsx.
'use client';

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  FileJson,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BlockDef, BlockInstance } from '@/lib/blocks/types';
import { getImportExportAdapter } from '@/lib/blocks/import-export/registry';
import { parseJsonPayload } from '@/lib/blocks/import-export/json-adapter';
import {
  downloadBlob,
  safeFilename,
} from '@/lib/blocks/import-export/xlsx-utils';
import type { ImportPreview } from '@/lib/blocks/import-export/types';

type Props = {
  def: BlockDef;
  instance: BlockInstance;
  onApply: (patch: Partial<BlockInstance>) => void;
};

type LoadedFile = {
  filename: string;
  size: number;
  format: 'json' | 'xlsx';
  preview: ImportPreview;
};

export function ImportExportTab({ def, instance, onApply }: Props) {
  const adapter = getImportExportAdapter(def.type);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [showScrubbed, setShowScrubbed] = useState(false);
  const [applyDone, setApplyDone] = useState<string | null>(null);

  // ───────────────────── Export ─────────────────────

  function handleExportJson() {
    const payload = adapter.exportJson(instance, def);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const title = instance.appearance?.title || def.displayName;
    const filename = `${safeFilename(title, def.type)}.json`;
    downloadBlob(filename, blob);
  }

  function handleExportXlsx() {
    if (!adapter.exportXlsx) return;
    const bytes = adapter.exportXlsx(instance, def);
    const arrCopy = bytes.slice().buffer;
    const blob = new Blob([arrCopy], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const title = instance.appearance?.title || def.displayName;
    const filename = `${safeFilename(title, def.type)}.xlsx`;
    downloadBlob(filename, blob);
  }

  // ───────────────────── Import ─────────────────────

  async function handleFile(file: File) {
    setApplyDone(null);
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (ext === 'json') {
      const text = await file.text();
      const parsed = parseJsonPayload(text);
      if (!parsed.ok) {
        setLoaded({
          filename: file.name,
          size: file.size,
          format: 'json',
          preview: { ok: false, error: parsed.error },
        });
        return;
      }
      const preview = adapter.importJson(parsed.payload, instance);
      setLoaded({ filename: file.name, size: file.size, format: 'json', preview });
      return;
    }
    if (ext === 'xlsx' || ext === 'xls') {
      if (!adapter.importXlsx) {
        setLoaded({
          filename: file.name,
          size: file.size,
          format: 'xlsx',
          preview: {
            ok: false,
            error: `XLSX-импорт недоступен для блока «${def.displayName}». Используйте JSON.`,
          },
        });
        return;
      }
      const buffer = await file.arrayBuffer();
      const preview = adapter.importXlsx(buffer, instance);
      setLoaded({ filename: file.name, size: file.size, format: 'xlsx', preview });
      return;
    }
    setLoaded({
      filename: file.name,
      size: file.size,
      format: 'json',
      preview: { ok: false, error: 'Поддерживаются только .json и .xlsx файлы' },
    });
  }

  function clearLoaded() {
    setLoaded(null);
    setShowScrubbed(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function applyOverwrite() {
    if (!loaded || !loaded.preview.ok) return;
    onApply(loaded.preview.patch);
    setApplyDone('Перезаписано');
    setTimeout(() => clearLoaded(), 1500);
  }

  function applyMerge() {
    if (!loaded || !loaded.preview.ok || !loaded.preview.mergePatch) return;
    onApply(loaded.preview.mergePatch);
    setApplyDone('Объединено');
    setTimeout(() => clearLoaded(), 1500);
  }

  // ───────────────────── Render ─────────────────────

  return (
    <div className="space-y-4">
      {/* Export section */}
      <section className="space-y-2">
        <SectionHeader icon={<Download className="h-3.5 w-3.5" />} title="Экспорт" />
        <div className="grid gap-2 md:grid-cols-2">
          <ExportCard
            icon={<FileJson className="h-5 w-5 text-sky-600" />}
            title="JSON"
            description="Полная копия блока: данные, формулы, настройки, размер, внешний вид. Удобно переносить между проектами и аккаунтами."
            buttonLabel="Скачать .json"
            onClick={handleExportJson}
          />
          <ExportCard
            icon={
              <FileSpreadsheet
                className={cn('h-5 w-5', adapter.supportsXlsx ? 'text-emerald-600' : 'text-muted-foreground/40')}
              />
            }
            title="Excel (XLSX)"
            description={
              adapter.supportsXlsx
                ? 'Данные и формулы в табличном формате. Можно редактировать в Excel/Numbers/Google Sheets и импортировать обратно.'
                : 'Недоступен для этого типа блока (нет редактируемых таблиц или формул).'
            }
            buttonLabel="Скачать .xlsx"
            onClick={handleExportXlsx}
            disabled={!adapter.supportsXlsx}
          />
        </div>
      </section>

      {/* Import section */}
      <section className="space-y-2">
        <SectionHeader icon={<Upload className="h-3.5 w-3.5" />} title="Импорт" />
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Выберите файл <code className="rounded bg-muted px-1 font-mono text-[10px]">.json</code>
              {adapter.supportsXlsx && (
                <>
                  {' '}или{' '}
                  <code className="rounded bg-muted px-1 font-mono text-[10px]">.xlsx</code>
                </>
              )}
              . Перед применением вы увидите превью.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload />
              Выбрать файл
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={adapter.supportsXlsx ? '.json,.xlsx,.xls' : '.json'}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>

        {/* Preview */}
        {loaded && (
          <PreviewPanel
            loaded={loaded}
            blockTypeLabel={def.displayName}
            showScrubbed={showScrubbed}
            onToggleScrubbed={() => setShowScrubbed((v) => !v)}
            onClear={clearLoaded}
            onOverwrite={applyOverwrite}
            onMerge={applyMerge}
            applyDone={applyDone}
          />
        )}
      </section>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="text-foreground/70">{icon}</span>
      {title}
    </div>
  );
}

function ExportCard({
  icon,
  title,
  description,
  buttonLabel,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-card p-3',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="flex-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
        <Download />
        {buttonLabel}
      </Button>
    </div>
  );
}

function PreviewPanel({
  loaded,
  blockTypeLabel,
  showScrubbed,
  onToggleScrubbed,
  onClear,
  onOverwrite,
  onMerge,
  applyDone,
}: {
  loaded: LoadedFile;
  blockTypeLabel: string;
  showScrubbed: boolean;
  onToggleScrubbed: () => void;
  onClear: () => void;
  onOverwrite: () => void;
  onMerge: () => void;
  applyDone: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2.5">
      {/* File header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          {loaded.format === 'json' ? (
            <FileJson className="h-4 w-4 shrink-0 text-sky-600" />
          ) : (
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
          )}
          <span className="truncate text-xs font-semibold">{loaded.filename}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {(loaded.size / 1024).toFixed(1)} KB
          </span>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClear} title="Сбросить">
          <X />
        </Button>
      </div>

      {/* Error */}
      {!loaded.preview.ok && (
        <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{loaded.preview.error}</span>
        </div>
      )}

      {/* OK preview */}
      {loaded.preview.ok && (
        <>
          {/* Stats pills */}
          <div className="flex flex-wrap gap-1.5">
            {loaded.preview.stats.map((stat) => (
              <span
                key={stat.label}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground"
              >
                <span className="text-muted-foreground">{stat.label}:</span>
                <span className="tabular-nums">{stat.value}</span>
              </span>
            ))}
          </div>

          {/* Conflict banner */}
          {loaded.preview.hasExistingData && !applyDone && (
            <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50/60 p-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                В блоке «{blockTypeLabel}» уже есть данные. Они будут{' '}
                <strong>перезаписаны</strong> или объединены с новыми.
              </span>
            </div>
          )}

          {/* Scrubbed refs */}
          {loaded.preview.scrubbedRefs.length > 0 && (
            <div className="rounded border border-border/60 bg-muted/20 text-[11px]">
              <button
                type="button"
                onClick={onToggleScrubbed}
                className="flex w-full items-center justify-between gap-2 p-2 text-left hover:bg-muted/40"
              >
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                  Будет очищено {loaded.preview.scrubbedRefs.length}{' '}
                  ссыло{loaded.preview.scrubbedRefs.length === 1 ? 'к' : 'к'} на другие блоки
                </span>
                {showScrubbed ? (
                  <ChevronUp className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
              {showScrubbed && (
                <ul className="space-y-0.5 border-t border-border/40 px-3 py-2 text-muted-foreground">
                  {loaded.preview.scrubbedRefs.map((ref, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span>
                        <code className="rounded bg-muted px-1 font-mono text-[9px] text-foreground">
                          {ref.kind}
                        </code>{' '}
                        {ref.description}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Apply buttons */}
          {applyDone ? (
            <div className="rounded border border-emerald-200 bg-emerald-50/60 p-2 text-center text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ {applyDone} — диалог закроется автоматически
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant={loaded.preview.hasExistingData ? 'destructive' : 'default'}
                onClick={onOverwrite}
              >
                Перезаписать
              </Button>
              {loaded.preview.canMerge && (
                <Button size="sm" variant="outline" onClick={onMerge}>
                  Объединить
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onClear}>
                Отменить
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
