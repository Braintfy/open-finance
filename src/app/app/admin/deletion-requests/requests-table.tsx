// PURPOSE: Клиентская таблица заявок на удаление аккаунтов (админка, 152-ФЗ).
// Выполнение/отклонение — через AlertDialog. Выполнение физически удаляет
// tenant+user (super_admin only, гейт на сервере). После действия — router.refresh.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export type AdminDeletionRequest = {
  id: string;
  email: string;
  reason: string | null;
  status: string;
  requestedAt: string;
  processedAt: string | null;
  note: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Ожидает',
  completed: 'Выполнена',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
};

function statusClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-800';
    case 'completed':
      return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-400 dark:ring-red-800';
    default:
      return 'bg-muted text-muted-foreground ring-border';
  }
}

export function RequestsTable({
  initial,
  canProcess,
}: {
  initial: AdminDeletionRequest[];
  canProcess: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    action: 'complete' | 'reject';
  } | null>(null);
  const [note, setNote] = useState('');

  async function process() {
    if (!confirm) return;
    setBusyId(confirm.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/deletion-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: confirm.id,
          action: confirm.action,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setConfirm(null);
        setNote('');
        router.refresh();
      } else {
        setError(data.error || 'Не удалось обработать заявку');
      }
    } catch {
      setError('Ошибка сети');
    } finally {
      setBusyId(null);
    }
  }

  if (initial.length === 0) {
    return (
      <Alert className="text-sm">
        <AlertDescription>Заявок на удаление нет.</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Запрошена</th>
              <th className="px-3 py-2 font-medium">Причина</th>
              <th className="px-3 py-2 font-medium text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {initial.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2 font-medium">{r.email}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusClass(r.status)}`}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(r.requestedAt).toLocaleString('ru-RU')}
                </td>
                <td className="max-w-[220px] px-3 py-2 text-muted-foreground">
                  {r.reason || <span className="opacity-50">—</span>}
                  {r.note && (
                    <div className="mt-1 text-[11px] italic opacity-70">Заметка: {r.note}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {canProcess && r.status === 'pending' ? (
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busyId === r.id}
                        onClick={() => {
                          setNote('');
                          setConfirm({ id: r.id, action: 'reject' });
                        }}
                      >
                        Отклонить
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={busyId === r.id}
                        onClick={() => {
                          setNote('');
                          setConfirm({ id: r.id, action: 'complete' });
                        }}
                      >
                        {busyId === r.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        Удалить
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {r.status !== 'pending' ? '—' : 'нет прав'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === 'complete' ? 'Выполнить удаление аккаунта?' : 'Отклонить заявку?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === 'complete'
                ? 'Аккаунт пользователя и ВСЕ связанные данные (организация, финансы, интеграции, AI-отчёты) будут удалены без возможности восстановления.'
                : 'Заявка будет помечена как отклонённая. Укажите причину для аудита.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder={confirm?.action === 'reject' ? 'Причина отклонения' : 'Заметка (необязательно)'}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Отмена</AlertDialogCancel>
            <Button
              variant={confirm?.action === 'complete' ? 'destructive' : 'default'}
              disabled={busyId !== null}
              onClick={process}
            >
              {busyId !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {confirm?.action === 'complete' ? 'Удалить навсегда' : 'Отклонить'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
