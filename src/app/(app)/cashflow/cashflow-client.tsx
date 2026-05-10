// PURPOSE: Клиентская часть Cashflow — список, добавление, импорт CSV/XLSX
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Денежный поток</h1>
          <p className="text-sm text-muted-foreground">Сводка за текущий месяц</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport((v) => !v)}>
            <Upload /> Импорт CSV/XLSX
          </Button>
          <Button onClick={() => setShowAdd((v) => !v)}>
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

      {showAdd && (
        <AddForm
          onCreated={(tx) => {
            setItems((prev) => [tx, ...prev]);
            setShowAdd(false);
            router.refresh();
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {showImport && (
        <ImportForm
          onDone={() => {
            setShowImport(false);
            router.refresh();
          }}
          onCancel={() => setShowImport(false)}
        />
      )}

      {/* Top categories */}
      <div className="grid gap-4 md:grid-cols-2">
        <TopCategoriesCard title="Топ доходов" rows={topIncome} />
        <TopCategoriesCard title="Топ расходов" rows={topExpense} />
      </div>

      {/* Transactions list */}
      <Card>
        <CardHeader>
          <CardTitle>Последние операции</CardTitle>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{t.counterparty ?? '—'}</div>
                      {t.description && (
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.source ?? '—'}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        t.type === 'income' ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {t.type === 'income' ? '+' : '−'}
                      {formatRubles(t.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
        <div
          className={`${big ? 'text-3xl' : 'text-2xl'} font-semibold ${
            tone === 'positive' ? 'text-foreground' : 'text-foreground'
          }`}
        >
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

function AddForm({ onCreated, onCancel }: { onCreated: (tx: Tx) => void; onCancel: () => void }) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
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
    const res = await fetch('/api/cashflow/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(rubles * 100),
        type,
        counterparty: counterparty || undefined,
        description: description || undefined,
        occurredAt: date,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || 'Ошибка');
      setLoading(false);
      return;
    }
    onCreated({
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
    <Card>
      <CardHeader>
        <CardTitle>Новая операция</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
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
            <Label htmlFor="counterparty">Контрагент</Label>
            <Input
              id="counterparty"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder="ООО «Ромашка»"
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
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="desc">Описание</Label>
            <Input
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Назначение / комментарий"
            />
          </div>
          {error && (
            <Alert variant="destructive" className="md:col-span-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2 md:col-span-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Отмена
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ImportForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    totalRows: number;
    sample: Array<{ date: string; amount: number; type: string; counterparty?: string }>;
    detectedFormat?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onDone();
    } else {
      setPreview(data);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Импорт банковской выписки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Поддержка CSV и XLSX. Авто-определение колонок «Дата», «Сумма», «Контрагент»,
            «Назначение». Положительные суммы → доход, отрицательные → расход.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {preview && (
          <div className="space-y-2">
            <p className="text-sm">
              Найдено <strong>{preview.totalRows}</strong> операций. Формат:{' '}
              <code>{preview.detectedFormat}</code>
            </p>
            <div className="max-h-48 overflow-auto rounded border">
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
                      <TableCell>{formatRubles(r.amount)}</TableCell>
                      <TableCell>{r.type}</TableCell>
                      <TableCell>{r.counterparty ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
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
        </div>
      </CardContent>
    </Card>
  );
}
