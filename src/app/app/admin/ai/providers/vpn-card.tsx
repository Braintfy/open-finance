// PURPOSE: Карточка «VLESS / Xray» в /app/admin/ai/providers — суперадмин вставляет
// vless://-ссылку ИЛИ URL подписки, выбирает сервер и применяет конфиг на хосте.
// Web пишет только spool-конфиг; применяет root-овый systemd path-юнит.
// Ссылку/URL после сохранения сервер отдаёт ТОЛЬКО замаскированными.
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Globe2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

type PublicServer = { id: string; label: string; host: string; port: number; fingerprint8: string };

type VpnState = {
  enabled: boolean;
  mode: 'link' | 'subscription';
  hasLink: boolean;
  linkMasked: string | null;
  hasSubscription: boolean;
  subscriptionMasked: string | null;
  servers: PublicServer[];
  selectedServerId: string | null;
  lastFetchedAt: string | null;
  appliedFingerprint8: string | null;
  appliedAt: string | null;
  appliedServer: { label: string; host: string; port: number; fingerprint8: string } | null;
  lastError: string | null;
  secretUnreadable: boolean;
};

type HostStatus = {
  ok?: boolean;
  phase?: string;
  fingerprint?: string;
  server?: string;
  appliedAt?: string;
  error?: string;
  xrayActive?: boolean;
  externalIp?: string;
};

type StatusPayload = {
  ok: boolean;
  error?: string;
  vpn: VpnState;
  spool: { path: string; writable: boolean };
  hostStatus: HostStatus | null;
  drift?: boolean;
  externalIp?: { ip: string; country?: string; city?: string; via: string } | null;
  externalIpError?: string | null;
};

type Feedback = { kind: 'ok' | 'error' | 'info'; text: string; details?: string[] } | null;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU');
}

export function VpnCard() {
  const [state, setState] = useState<VpnState | null>(null);
  const [spool, setSpool] = useState<{ path: string; writable: boolean } | null>(null);
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(null);
  const [drift, setDrift] = useState(false);
  const [externalIp, setExternalIp] = useState<StatusPayload['externalIp']>(null);
  const [externalIpError, setExternalIpError] = useState<string | null>(null);

  const [mode, setMode] = useState<'link' | 'subscription'>('link');
  const [linkInput, setLinkInput] = useState('');
  const [subUrlInput, setSubUrlInput] = useState('');
  const [selectedServerId, setSelectedServerId] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'apply' | 'refresh' | 'status' | 'toggle'>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const applyPayload = useCallback((data: StatusPayload) => {
    setState(data.vpn);
    setSpool(data.spool);
    setHostStatus(data.hostStatus);
    setDrift(!!data.drift);
    setMode(data.vpn.mode);
    setSelectedServerId(data.vpn.selectedServerId ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/ai/vpn');
      const data = (await res.json()) as StatusPayload;
      if (data.ok) applyPayload(data);
      else setFeedback({ kind: 'error', text: data.error ?? 'Не удалось загрузить настройки VPN' });
    } catch (e) {
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Ошибка загрузки' });
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshSubscription() {
    setBusy('refresh');
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/ai/vpn/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: subUrlInput.trim() || undefined }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        details?: string[];
        warnings?: string[];
        servers?: PublicServer[];
        skipped?: number;
        vpn?: VpnState;
      };
      if (data.ok && data.vpn) {
        setState(data.vpn);
        setSelectedServerId(data.vpn.selectedServerId ?? data.servers?.[0]?.id ?? '');
        setSubUrlInput('');
        setFeedback({
          kind: 'ok',
          text: `Список обновлён: ${data.servers?.length ?? 0} серверов${
            data.skipped ? `, пропущено строк: ${data.skipped}` : ''
          }`,
          details: data.warnings?.length ? data.warnings : undefined,
        });
      } else {
        setFeedback({
          kind: 'error',
          text: data.error ?? 'Не удалось обновить список',
          details: data.details,
        });
      }
    } catch (e) {
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Ошибка запроса' });
    } finally {
      setBusy(null);
    }
  }

  async function doApply() {
    setBusy('apply');
    setFeedback(null);
    try {
      const body =
        mode === 'link'
          ? { mode: 'link' as const, link: linkInput.trim() || undefined }
          : { mode: 'subscription' as const, serverId: selectedServerId };
      const res = await fetch('/api/admin/ai/vpn/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        server?: PublicServer;
        vpn?: VpnState;
        wiring?: { tenantProviderUpdated: boolean; userCredentialsUpdated: number };
      };
      if (data.ok && data.vpn) {
        setState(data.vpn);
        setLinkInput('');
        const wiring = data.wiring;
        setFeedback({
          kind: 'ok',
          text:
            `Конфиг записан в spool: ${data.server?.host}:${data.server?.port} (${data.server?.fingerprint8}). ` +
            'Применение на хосте занимает ~5 секунд — обновите статус.',
          details: wiring
            ? [
                'Прокси AI переключён на http://127.0.0.1:10809',
                wiring.tenantProviderUpdated
                  ? 'Провайдеру тенанта включён useProxy'
                  : 'Провайдер тенанта не менялся',
                `Ключей пользователей обновлено: ${wiring.userCredentialsUpdated}`,
              ]
            : undefined,
        });
      } else {
        setFeedback({ kind: 'error', text: data.error ?? 'Не удалось применить конфиг' });
      }
    } catch (e) {
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Ошибка запроса' });
    } finally {
      setBusy(null);
      void refreshStatus(false);
    }
  }

  async function refreshStatus(checkIp: boolean) {
    if (checkIp) setBusy('status');
    try {
      const res = await fetch(`/api/admin/ai/vpn/status${checkIp ? '?checkIp=1' : ''}`);
      const data = (await res.json()) as StatusPayload;
      if (data.ok) {
        applyPayload(data);
        setExternalIp(data.externalIp ?? null);
        setExternalIpError(data.externalIpError ?? null);
      } else if (checkIp) {
        setFeedback({ kind: 'error', text: data.error ?? 'Не удалось получить статус' });
      }
    } catch (e) {
      if (checkIp) setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      if (checkIp) setBusy(null);
    }
  }

  async function toggleEnabled(next: boolean) {
    setBusy('toggle');
    try {
      const res = await fetch('/api/admin/ai/vpn', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; vpn?: VpnState };
      if (data.ok && data.vpn) setState(data.vpn);
      else setFeedback({ kind: 'error', text: data.error ?? 'Не удалось изменить состояние' });
    } catch (e) {
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setBusy(null);
    }
  }

  async function switchMode(next: 'link' | 'subscription') {
    setMode(next);
    setFeedback(null);
    try {
      await fetch('/api/admin/ai/vpn', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      });
    } catch {
      /* переключатель локальный — молчим, режим всё равно передаётся при apply */
    }
  }

  const canApply =
    mode === 'link'
      ? !!linkInput.trim() || !!state?.hasLink
      : !!selectedServerId && (state?.servers.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              VLESS / Xray (VPN на сервере)
            </CardTitle>
            <CardDescription className="text-xs">
              Конфиг Xray на хосте: вставьте vless://-ссылку или URL подписки и примените.
              Приложение только записывает spool-файл — устанавливает конфиг root-овый
              systemd path-юнит (deploy/xray).
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshStatus(true)}
            disabled={busy !== null || loading}
          >
            {busy === 'status' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Статус
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-xs text-muted-foreground">Загрузка…</div>
        ) : !state ? (
          <Alert variant="warning">
            <AlertCircle />
            <AlertDescription className="text-[11px]">
              {feedback?.text ?? 'Настройки VPN недоступны (нужна роль super_admin).'}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* ── Переключатель режима ── */}
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border p-0.5">
                {(['link', 'subscription'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    className={`rounded px-3 py-1 text-xs transition ${
                      mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'
                    }`}
                  >
                    {m === 'link' ? 'Ссылка' : 'Подписка'}
                  </button>
                ))}
              </div>
              <label className="ml-auto flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={state?.enabled ?? false}
                  disabled={busy !== null}
                  onChange={(e) => toggleEnabled(e.target.checked)}
                />
                Использовать VPN для AI
              </label>
            </div>

            {/* ── Режим: ссылка ── */}
            {mode === 'link' && (
              <div className="space-y-2">
                <label className="block text-xs font-medium">vless://-ссылка</label>
                <Textarea
                  rows={3}
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  placeholder="vless://uuid@server.example.com:443?type=tcp&security=reality&pbk=…&sni=…&fp=chrome#Метка"
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                {state?.hasLink && (
                  <p className="text-[11px] text-muted-foreground">
                    Сохранено: <code className="rounded bg-muted px-1">{state.linkMasked}</code>{' '}
                    — оставьте поле пустым, чтобы переприменить её.
                  </p>
                )}
              </div>
            )}

            {/* ── Режим: подписка ── */}
            {mode === 'subscription' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">URL подписки (https)</label>
                  <div className="flex gap-2">
                    <Input
                      value={subUrlInput}
                      onChange={(e) => setSubUrlInput(e.target.value)}
                      placeholder="https://panel.example.com/sub/…"
                      className="font-mono text-xs"
                      spellCheck={false}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshSubscription}
                      disabled={busy !== null || (!subUrlInput.trim() && !state?.hasSubscription)}
                    >
                      {busy === 'refresh' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                      Обновить список
                    </Button>
                  </div>
                  {state?.hasSubscription && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Сохранено:{' '}
                      <code className="rounded bg-muted px-1">{state.subscriptionMasked}</code>
                      {state.lastFetchedAt
                        ? ` · обновлено ${formatDateTime(state.lastFetchedAt)}`
                        : ''}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Сервер ({state?.servers.length ?? 0})
                  </label>
                  <Select
                    value={selectedServerId || undefined}
                    onValueChange={setSelectedServerId}
                    disabled={(state?.servers.length ?? 0) === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="— выберите сервер —" />
                    </SelectTrigger>
                    <SelectContent>
                      {state?.servers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label} — {s.host}:{s.port} ({s.fingerprint8})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={busy !== null || !canApply}
              >
                {busy === 'apply' ? <Loader2 className="animate-spin" /> : <Zap />}
                {mode === 'link' ? 'Проверить и применить' : 'Применить'}
              </Button>
              {spool && !spool.writable && (
                <span className="text-[11px] text-amber-600">
                  Spool-директория недоступна для записи — см. deploy/xray/README.md
                </span>
              )}
            </div>

            {/* ── Фидбек ── */}
            {feedback && (
              <Alert variant={feedback.kind === 'error' ? 'destructive' : 'success'}>
                {feedback.kind === 'error' ? <XCircle /> : <CheckCircle2 />}
                <AlertDescription className="text-[11px]">
                  <div>{feedback.text}</div>
                  {feedback.details && feedback.details.length > 0 && (
                    <ul className="mt-1 list-inside list-disc opacity-80">
                      {feedback.details.slice(0, 5).map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {state?.secretUnreadable && (
              <Alert variant="warning">
                <AlertCircle />
                <AlertDescription className="text-[11px]">
                  Сохранённый секрет не расшифровывается текущим ключом (меняли
                  MARKETPLACE_SECRET_KEY / INBOX_SECRET_KEY). Введите ссылку/URL заново или
                  выполните <code className="rounded bg-muted px-1">pnpm admin:reencrypt-secrets</code>.
                </AlertDescription>
              </Alert>
            )}

            {/* ── Статус ── */}
            <div className="rounded-md border bg-muted/20 p-3 text-[11px]">
              <div className="mb-2 flex items-center gap-1.5 font-medium">
                <Globe2 className="h-3.5 w-3.5" />
                Состояние
              </div>
              <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Применённый сервер:</dt>
                  <dd>
                    {state?.appliedServer
                      ? `${state.appliedServer.host}:${state.appliedServer.port} (${state.appliedServer.fingerprint8})`
                      : '—'}
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Записан в spool:</dt>
                  <dd>{formatDateTime(state?.appliedAt)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Хост подтвердил:</dt>
                  <dd>
                    {hostStatus
                      ? `${hostStatus.ok ? 'да' : 'нет'} · ${hostStatus.phase ?? '—'} · ${formatDateTime(
                          hostStatus.appliedAt,
                        )}`
                      : 'нет отчёта (юниты не установлены?)'}
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Xray активен:</dt>
                  <dd>{hostStatus?.xrayActive === undefined ? '—' : hostStatus.xrayActive ? 'да' : 'нет'}</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Внешний IP:</dt>
                  <dd>
                    {externalIp
                      ? `${externalIp.ip}${externalIp.country ? ` (${externalIp.country}${externalIp.city ? `, ${externalIp.city}` : ''})` : ''}`
                      : externalIpError
                        ? `ошибка: ${externalIpError}`
                        : (hostStatus?.externalIp ?? 'нажмите «Статус»')}
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Spool:</dt>
                  <dd className="font-mono">{spool?.path ?? '—'}</dd>
                </div>
              </dl>

              {drift && (
                <p className="mt-2 text-amber-600">
                  На хосте применён другой конфиг, чем последний записанный — нажмите «Применить»
                  повторно.
                </p>
              )}
              {state?.lastError && (
                <p className="mt-2 text-red-600">Последняя ошибка: {state.lastError}</p>
              )}
              {hostStatus?.error && (
                <p className="mt-1 text-red-600">Ошибка хоста: {hostStatus.error}</p>
              )}
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Применить конфиг Xray?</AlertDialogTitle>
            <AlertDialogDescription>
              Конфиг будет записан в spool, проверен на хосте (xray run -test) и установлен —
              сервис Xray перезапустится. На несколько секунд AI-запросы через прокси
              127.0.0.1:10809 прервутся. При провале проверки хост откатится на предыдущий конфиг.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doApply()}>Применить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
