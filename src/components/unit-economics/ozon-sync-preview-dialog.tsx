// PURPOSE: Превью изменений перед применением синхронизации Ozon к блоку.
// Показывает детальную таблицу всех ячеек: артикул, колонка, было, станет,
// action-badge. Фильтры: все / новые / изменённые / пропущенные.
// Кнопки: Применить / Отмена / Изменить настройки (для возврата в settings dialog).

'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Filter, Plus, Settings, SkipForward, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { CellChange, SyncDiff } from './ozon-sync-diff';

type FilterKind = 'all' | 'create' | 'update' | 'skip';

const PAGE_SIZE = 200;

export function OzonSyncPreviewDialog({
  open,
  diff,
  onApply,
  onCancel,
  onEditSettings,
}: {
  open: boolean;
  diff: SyncDiff | null;
  onApply: () => void;
  onCancel: () => void;
  onEditSettings?: () => void;
}) {
  const [filter, setFilter] = useState<FilterKind>('all');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!diff) return [] as CellChange[];
    if (filter === 'all') return diff.changes;
    return diff.changes.filter((c) => c.action === filter);
  }, [diff, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const noChanges = diff && diff.totals.cellsChanged === 0 && diff.totals.newRows === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Превью применения синхронизации
          </DialogTitle>
          <DialogDescription>
            Ниже — все изменения, которые применятся к ячейкам блока. Ничего ещё
            не сохранено. Нажмите «Применить», чтобы зафиксировать.
          </DialogDescription>
        </DialogHeader>

        {diff && (
          <>
            <SummaryCards diff={diff} />

            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <FilterPills
                filter={filter}
                onChange={(f) => {
                  setFilter(f);
                  setPage(0);
                }}
                diff={diff}
              />
              {pageCount > 1 && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    ←
                  </Button>
                  Стр. {page + 1} / {pageCount}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page === pageCount - 1}
                  >
                    →
                  </Button>
                </div>
              )}
            </div>

            <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border/60 bg-card">
              {filtered.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-[12px] text-muted-foreground">
                  {noChanges ? (
                    <>
                      <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                      Все ячейки уже актуальны — синхронизация ничего не изменит.
                    </>
                  ) : (
                    <>
                      <Filter className="h-6 w-6" />В выбранном фильтре нет изменений.
                    </>
                  )}
                </div>
              ) : (
                <table className="min-w-full text-[11px]">
                  <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Артикул</th>
                      <th className="px-2 py-1.5 font-medium">Название</th>
                      <th className="px-2 py-1.5 font-medium">Колонка</th>
                      <th className="px-2 py-1.5 font-medium">Было</th>
                      <th className="px-2 py-1.5 font-medium" />
                      <th className="px-2 py-1.5 font-medium">Станет</th>
                      <th className="px-2 py-1.5 font-medium text-right">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {pageRows.map((c, i) => (
                      <ChangeRow key={`${c.rowKey}-${c.field}-${i}`} c={c} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        <DialogFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3 sm:justify-between">
          <div className="flex gap-2">
            {onEditSettings && (
              <Button variant="outline" size="sm" onClick={onEditSettings}>
                <Settings className="h-3.5 w-3.5" />
                Изменить настройки
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              Отмена
            </Button>
            <Button
              onClick={onApply}
              disabled={!diff || (diff.totals.cellsChanged === 0 && diff.totals.newRows === 0)}
            >
              Применить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCards({ diff }: { diff: SyncDiff }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Card
        tone="emerald"
        icon={<Plus className="h-3.5 w-3.5" />}
        label="Новые строки"
        value={diff.totals.newRows}
      />
      <Card
        tone="amber"
        icon={<ArrowRight className="h-3.5 w-3.5" />}
        label="Обновлено"
        value={diff.totals.updatedRows}
        secondary={`${diff.totals.cellsChanged} ячеек`}
      />
      <Card
        tone="muted"
        icon={<SkipForward className="h-3.5 w-3.5" />}
        label="Пропущено"
        value={diff.totals.skippedRows}
        secondary={diff.totals.cellsSkipped > 0 ? `${diff.totals.cellsSkipped} ячеек` : undefined}
      />
      <Card
        tone="muted"
        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        label="Без изменений"
        value={diff.totals.unchangedRows}
      />
    </div>
  );
}

function Card({
  tone,
  icon,
  label,
  value,
  secondary,
}: {
  tone: 'emerald' | 'amber' | 'muted';
  icon: React.ReactNode;
  label: string;
  value: number;
  secondary?: string;
}) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-300/50 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100'
      : tone === 'amber'
        ? 'border-amber-300/50 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
        : 'border-border/60 bg-muted/40 text-foreground';
  return (
    <div className={'rounded-md border p-2 ' + cls}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {secondary && (
          <span className="text-[10px] text-muted-foreground">{secondary}</span>
        )}
      </div>
    </div>
  );
}

function FilterPills({
  filter,
  onChange,
  diff,
}: {
  filter: FilterKind;
  onChange: (f: FilterKind) => void;
  diff: SyncDiff;
}) {
  const items: Array<{ key: FilterKind; label: string; count: number }> = [
    { key: 'all', label: 'Все', count: diff.changes.length },
    {
      key: 'create',
      label: 'Новые',
      count: diff.changes.filter((c) => c.action === 'create').length,
    },
    {
      key: 'update',
      label: 'Изменённые',
      count: diff.changes.filter((c) => c.action === 'update').length,
    },
    {
      key: 'skip',
      label: 'Пропущенные',
      count: diff.changes.filter((c) => c.action === 'skip').length,
    },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => {
        const active = filter === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            className={
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ' +
              (active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/60 bg-background text-muted-foreground hover:text-foreground')
            }
          >
            {it.label}
            <span
              className={
                'inline-block min-w-[18px] rounded-full px-1 text-center text-[10px] ' +
                (active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')
              }
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChangeRow({ c }: { c: CellChange }) {
  const badge = (() => {
    if (c.action === 'create')
      return (
        <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <Plus className="h-2.5 w-2.5" />
          новое
        </span>
      );
    if (c.action === 'update')
      return (
        <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <ArrowRight className="h-2.5 w-2.5" />
          изменено
        </span>
      );
    if (c.action === 'skip')
      return (
        <span
          className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          title={c.reason}
        >
          <X className="h-2.5 w-2.5" />
          пропущено
        </span>
      );
    return null;
  })();

  const isNew = c.rowKey.startsWith('NEW:');
  return (
    <tr className="hover:bg-accent/20">
      <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
        {isNew ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            {c.rowKey.slice(4) || '—'}
          </span>
        ) : (
          c.rowKey || '—'
        )}
      </td>
      <td className="max-w-[220px] truncate px-2 py-1.5" title={c.rowName}>
        {c.rowName || <span className="text-muted-foreground/60">—</span>}
      </td>
      <td className="px-2 py-1.5 text-[11px] font-medium">{c.fieldLabel}</td>
      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
        {formatValue(c.before)}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
      </td>
      <td
        className={
          'px-2 py-1.5 tabular-nums ' +
          (c.action === 'skip' ? 'text-muted-foreground line-through' : 'font-medium text-foreground')
        }
      >
        {formatValue(c.after)}
      </td>
      <td className="px-2 py-1.5 text-right">{badge}</td>
    </tr>
  );
}

function formatValue(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v);
  }
  const s = String(v);
  if (s.length === 0) return '—';
  if (s.length > 40) return s.slice(0, 38) + '…';
  return s;
}
