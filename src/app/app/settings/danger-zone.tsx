// PURPOSE: Settings → «Опасная зона» (152-ФЗ self-service): удаление AI-данных
// и заявка на удаление аккаунта. Деструктивные действия — через AlertDialog
// (системные confirm запрещены). Заявка обрабатывается super_admin в админке.
'use client';

import { useEffect, useState } from 'react';
import { Trash2, ShieldAlert, Sparkles, Loader2 } from 'lucide-react';
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

type DeletionRequest = {
  id: string;
  status: string;
  requestedAt: string;
  reason: string | null;
};

export function DangerZone() {
  const [request, setRequest] = useState<DeletionRequest | null | undefined>(undefined);
  const [aiOpen, setAiOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/account/deletion-request')
      .then((r) => r.json())
      .then((d) => {
        if (active) setRequest(d.ok ? (d.request ?? null) : null);
      })
      .catch(() => active && setRequest(null));
    return () => {
      active = false;
    };
  }, []);

  async function clearAiData() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/account/ai-data', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        const d = data.deleted;
        const total = d.blockReports + d.sectionReports + d.ozonInsights + d.credentials;
        setNotice(`Удалено AI-данных: ${total} (отчёты блоков ${d.blockReports}, разделов ${d.sectionReports}, Ozon ${d.ozonInsights}, ключи ${d.credentials}).`);
      } else {
        setNotice('Не удалось удалить AI-данные.');
      }
    } catch {
      setNotice('Ошибка сети.');
    } finally {
      setBusy(false);
      setAiOpen(false);
    }
  }

  async function requestDeletion() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/account/deletion-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        setRequest(data.request);
        setNotice('Заявка на удаление аккаунта отправлена. Администратор обработает её в ближайшее время.');
      } else {
        setNotice('Не удалось отправить заявку.');
      }
    } catch {
      setNotice('Ошибка сети.');
    } finally {
      setBusy(false);
      setDelOpen(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/account/deletion-request', { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        setRequest(null);
        setNotice('Заявка на удаление отменена.');
      }
    } catch {
      setNotice('Ошибка сети.');
    } finally {
      setBusy(false);
    }
  }

  const hasPending = request?.status === 'pending';

  return (
    <section>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-destructive">
        Опасная зона
      </div>

      {notice && (
        <Alert className="mb-2 text-xs">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-destructive/30 bg-card">
        {/* Очистка AI-данных */}
        <div className="flex items-center gap-3 px-3 py-3">
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Удалить все AI-данные</div>
            <div className="text-[11px] text-muted-foreground">
              Отчёты по блокам и разделам, Ozon AI-инсайты и подключённые API-ключи (BYOK). Аккаунт сохранится.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={() => setAiOpen(true)}
          >
            <Trash2 className="h-4 w-4" /> Очистить
          </Button>
        </div>

        {/* Удаление аккаунта */}
        <div className="flex items-center gap-3 px-3 py-3">
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Удалить аккаунт</div>
            <div className="text-[11px] text-muted-foreground">
              {hasPending
                ? 'Заявка отправлена и ожидает подтверждения администратором.'
                : 'Заявка на полное удаление аккаунта и всех данных (необратимо после подтверждения).'}
            </div>
          </div>
          {hasPending ? (
            <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={cancelDeletion}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Отменить заявку
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              className="shrink-0"
              disabled={request === undefined}
              onClick={() => setDelOpen(true)}
            >
              Запросить удаление
            </Button>
          )}
        </div>
      </div>

      {/* Диалог: очистка AI-данных */}
      <AlertDialog open={aiOpen} onOpenChange={setAiOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить все AI-данные?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут безвозвратно удалены сохранённые AI-отчёты (блоки, разделы, Ozon-инсайты) и подключённые API-ключи. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={clearAiData}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Удалить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Диалог: заявка на удаление аккаунта */}
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Запросить удаление аккаунта?</AlertDialogTitle>
            <AlertDialogDescription>
              После подтверждения администратором аккаунт и все связанные данные (финансы, интеграции, AI-отчёты) будут удалены без возможности восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Причина (необязательно)"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={requestDeletion}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Отправить заявку
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
