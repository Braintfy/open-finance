// PURPOSE: Универсальная модалка добавить/редактировать транзакцию (используется в блоках и в обёртке страницы)
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { CashflowTx } from './cashflow-data';

export function TransactionDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = создание; объект = редактирование */
  initial: CashflowTx | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = initial === null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Новая операция' : 'Редактировать операцию'}</DialogTitle>
          <DialogDescription>
            {isNew ? 'Введите данные операции вручную' : 'Измените поля и сохраните'}
          </DialogDescription>
        </DialogHeader>
        {open && <Form initial={initial} onSaved={onSaved} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  initial,
  onSaved,
  onCancel,
}: {
  initial: CashflowTx | null;
  onSaved: () => void;
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
    onSaved();
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
