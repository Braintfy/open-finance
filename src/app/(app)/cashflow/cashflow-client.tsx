// PURPOSE: Клиентская часть Cashflow — список, добавление/редактирование/удаление, импорт CSV/XLSX
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, ArrowDown, ArrowUp, Pencil, Trash2, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRubles, formatDate } from '@/lib/utils';

type Tx = {
  id: string;
  amount: number;
  type: 'income' | 'expense';
  description: string | null;
  counterparty: string | null;
  occurredAt: string;
  source: string | null;
};

type Summary = { incomeTotal: number; expenseTotal: number; balance: number };
type CategoryRow = { categoryName: string; total: number; count: number };

export function CashflowClient({
  summary,
  topIncome,
  topExpense,
  initialTransactions,
}: {
  summary: Summary;
  topIncome: CategoryRow[];
  topExpense: CategoryRow[];
  initialTransactions: Tx[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialTransactions);
  const [editingTx, setEditingTx] = useState<Tx | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  async function deleteOne(id: string) {
    const res = await fetch(`/api/cashflow/transactions/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      setItems((prev) => prev.filter((t) => t.id !== id));
      router.refresh();
    } else {
      alert(data.error ?? 'Не удалось удалить');
    }
  }

  async function clearAll() {
    const res = await fetch('/api/cashflow/transactions?confirm=true', { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      setItems([]);
      router.refresh();
    } else {
      alert(data.error ?? 'Не удалось очистить');
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Денежный поток</h1>
          <p className="text-sm text-muted-foreground">Сводка за текущий месяц</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload /> Импорт CSV/XLSX
          </Button>
          <Button onClick={() => setEditingTx('new')}>
            <Plus /> Добавить
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Доходы"
          value={summary.incomeTotal}
          icon={<ArrowDown className="text-green-600" />}
          tone="positive"
        />
        <SummaryCard
          label="Расходы"
          value={summary.expenseTotal}
          icon={<ArrowUp className="text-red-600" />}
          tone="negative"
        />
        <SummaryCard
          label="Баланс"
          value={summary.balance}
          tone={summary.balance >= 0 ? 'positive' : 'negative'}
          big
        />
      </div>

      {/* Top categories */}
      <div className="grid gap-4 md:grid-cols-2">
        <TopCategoriesCard title="Топ доходов" rows={topIncome} />
        <TopCategoriesCard title="Топ расходов" rows={topExpense} />
      </div>

      {/* Transactions list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>История операций</CardTitle>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setConfirmClearAll(true)}
            >
              <Trash /> Очистить всё
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Нет операций. Добавьте первую вручную или импортируйте выписку.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Контрагент / описание</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t.id} className="group">
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{t.counterparty ?? '—'}</div>
                      {t.description && (
                        <div className="line-clamp-1 text-xs text-muted-foreground">
                          {t.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.source ?? '—'}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        t.type === 'income' ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {t.type === 'income' ? '+' : '−'}
                      {formatRubles(t.amount)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingTx(t)}
                          aria-label="Редактировать"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setConfirmDeleteId(t.id)}
                          aria-label="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit modal */}
      <TransactionDialog
        open={editingTx !== null}
        initial={editingTx === 'new' ? null : editingTx}
        onClose={() => setEditingTx(null)}
        onSaved={(tx, isNew) => {
          if (isNew) {
            setItems((prev) => [tx, ...prev]);
          } else {
            setItems((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
          }
          setEditingTx(null);
          router.refresh();
        }}
      />

      {/* Import modal */}
      <ImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onDone={() => {
          setShowImport(false);
          router.refresh();
        }}
      />

      {/* Confirm delete one */}
      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить операцию?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Запись будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (confirmDeleteId) deleteOne(confirmDeleteId);
                setConfirmDeleteId(null);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm clear all */}
      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить всю историю?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут удалены <strong>все {items.length}</strong> транзакций. Категории и настройки
              сохранятся. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                clearAll();
                setConfirmClearAll(false);
              }}
            >
              Удалить все
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
  big,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone: 'positive' | 'negative';
  big?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`${big ? 'text-3xl' : 'text-2xl'} font-semibold`}>
          {tone === 'negative' && value > 0 ? '−' : ''}
          {formatRubles(Math.abs(value))}
        </div>
      </CardContent>
    </Card>
  );
}

function TopCategoriesCard({ title, rows }: { title: string; rows: CategoryRow[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.total));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <div key={r.categoryName} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{r.categoryName}</span>
              <span className="tabular-nums text-muted-foreground">{formatRubles(r.total)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round((r.total / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Универсальная модалка добавить/редактировать */
function TransactionDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Tx | null;
  onClose: () => void;
  onSaved: (tx: Tx, isNew: boolean) => void;
}) {
  const isNew = initial === null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Новая операция' : 'Редактировать операцию'}</DialogTitle>
          <DialogDescription>
            {isNew
              ? 'Введите данные операции вручную'
              : 'Измените поля и сохраните'}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <TransactionForm
            initial={initial}
            onSaved={(tx) => onSaved(tx, isNew)}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Tx | null;
  onSaved: (tx: Tx) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'income' | 'expense'>(initial?.type ?? 'expense');
  const [amountStr, setAmountStr] = useState(
    initial ? (initial.amount / 100).toString().replace('.', ',') : ''
  );
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(
    initial ? initial.occurredAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const rubles = Number(amountStr.replace(',', '.'));
    if (!Number.isFinite(rubles) || rubles <= 0) {
      setError('Введите корректную сумму');
      setLoading(false);
      return;
    }
    const body = {
      amount: Math.round(rubles * 100),
      type,
      counterparty: counterparty || undefined,
      description: description || undefined,
      occurredAt: date,
    };
    const res = initial
      ? await fetch(`/api/cashflow/transactions/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      : await fetch('/api/cashflow/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || 'Ошибка');
      setLoading(false);
      return;
    }
    onSaved({
      id: data.transaction.id,
      amount: data.transaction.amount,
      type: data.transaction.type,
      description: data.transaction.description,
      counterparty: data.transaction.counterparty,
      occurredAt: data.transaction.occurredAt,
      source: data.transaction.source,
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Тип</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={type === 'income' ? 'default' : 'outline'}
            onClick={() => setType('income')}
            className="flex-1"
          >
            Доход
          </Button>
          <Button
            type="button"
            variant={type === 'expense' ? 'default' : 'outline'}
            onClick={() => setType('expense')}
            className="flex-1"
          >
            Расход
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="amount">Сумма, ₽</Label>
          <Input
            id="amount"
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="1000"
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Дата</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="counterparty">Контрагент</Label>
        <Input
          id="counterparty"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder="ООО «Ромашка»"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="desc">Описание</Label>
        <Input
          id="desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Назначение / комментарий"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Сохраняем…' : initial ? 'Сохранить' : 'Создать'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    totalRows: number;
    sample: Array<{ date: string; amount: number; type: string; counterparty?: string }>;
    detectedFormat?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    setLoading(false);
  }

  async function doUpload(commit: boolean) {
    if (!file) return;
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('commit', commit ? 'true' : 'false');
    const res = await fetch('/api/cashflow/import', { method: 'POST', body: fd });
    const data = await res.json();
    setLoading(false);
    if (!data.ok) {
      setError(data.error || 'Не удалось разобрать файл');
      return;
    }
    if (commit) {
      reset();
      onDone();
    } else {
      setPreview(data);
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
          <DialogTitle>Импорт банковской выписки</DialogTitle>
          <DialogDescription>
            CSV или XLSX. Поддержка форматов Тинькофф, Сбер, generic. Авто-определение колонок Дата
            / Сумма / Контрагент / Описание.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setError(null);
            }}
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="space-y-2">
              <p className="text-sm">
                Найдено <strong>{preview.totalRows}</strong> операций. Формат:{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {preview.detectedFormat}
                </code>
              </p>
              <div className="max-h-64 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Сумма</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Контрагент</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.slice(0, 10).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{formatDate(r.date)}</TableCell>
                        <TableCell
                          className={
                            r.type === 'income'
                              ? 'text-green-600'
                              : 'text-red-600'
                          }
                        >
                          {r.type === 'income' ? '+' : '−'}
                          {formatRubles(r.amount)}
                        </TableCell>
                        <TableCell className="text-xs">{r.type}</TableCell>
                        <TableCell className="line-clamp-1 max-w-xs text-xs">
                          {r.counterparty ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
            Отмена
          </Button>
          {!preview ? (
            <Button onClick={() => doUpload(false)} disabled={!file || loading}>
              {loading ? 'Анализируем…' : 'Превью'}
            </Button>
          ) : (
            <Button onClick={() => doUpload(true)} disabled={loading}>
              {loading ? 'Импортируем…' : `Импортировать ${preview.totalRows} операций`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
