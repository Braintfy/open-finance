// PURPOSE: Inbox channel feed block — unified read-only intake view for email/Telegram messages.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import {
  Inbox,
  Mail,
  Send,
  RefreshCcw,
  PlugZap,
  Save,
  Trash2,
  BookOpen,
  Sparkles,
  FileText,
  Receipt,
  CheckCircle,
  XCircle,
  Upload as UploadIcon,
  Image as ImageIcon,
  Eye,
} from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatDate } from '@/lib/utils';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { sanitizeEmailHtml, buildEmailSrcDoc } from '@/lib/inbox/sanitize-html';
import { cleanPreview, cleanPlainTextBody } from '@/lib/inbox/clean-text';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import type { InboxChannelDto, InboxMessageDto } from '@/lib/inbox/types';

const Config = z.object({
  title: z.string().default('Входящие'),
});

/** Инициалы отправителя для аватара (по имени или email). */
function initialsOf(value: string): string {
  const parts = value.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
/** Стабильный цвет аватара из строки-сида (имя/email отправителя). */
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function RenderInboxChannelFeed({ instance }: BlockRenderProps) {
  const density = useBlockDensity();
  const [channels, setChannels] = useState<InboxChannelDto[]>([]);
  const [messages, setMessages] = useState<InboxMessageDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useReportBlockLoading(loading);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const cfg = Config.parse(instance.config ?? {});
  const title = instance.appearance?.title ?? cfg.title;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ blockId: instance.id });
    setLoading(true);
    try {
      const [channelsRes, messagesRes] = await Promise.all([
        fetch(`/api/inbox/channels?${params.toString()}`),
        fetch(`/api/inbox/messages?${new URLSearchParams({ blockId: instance.id, limit: '50' }).toString()}`),
      ]);
      const channelsJson = await channelsRes.json();
      const messagesJson = await messagesRes.json();
      const nextChannels = channelsJson.ok ? channelsJson.channels : [];
      const nextMessages = messagesJson.ok ? messagesJson.messages : [];
      setChannels(nextChannels);
      setMessages(nextMessages);
      setSelectedId((current) => current ?? nextMessages[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, [instance.id]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = messages.find((message) => message.id === selectedId) ?? messages[0] ?? null;
  const latest = messages[0] ?? null;

  useBlockValuePublisher(instance.id, {
    count: messages.length,
    latestSubject: latest?.subject ?? null,
    latestSender: latest?.senderName ?? latest?.senderAddress ?? null,
    latestPreview: cleanPreview(latest?.preview) || null,
  });

  const counts = useMemo(() => {
    const email = channels.filter((c) => c.type === 'email').reduce((sum, c) => sum + c.totalCount, 0);
    const telegram = channels.filter((c) => c.type === 'telegram').reduce((sum, c) => sum + c.totalCount, 0);
    return { email, telegram, total: email + telegram };
  }, [channels]);

  async function sync(channelId: string) {
    setSyncingId(channelId);
    try {
      await fetch(`/api/inbox/channels/${channelId}/sync`, { method: 'POST' });
      await load();
    } finally {
      setSyncingId(null);
    }
  }

  if (density === 'xs' || density === 'sm') {
    return (
      <Card className="flex h-full items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-muted-foreground">{counts.total} сообщений</div>
        </div>
        <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{title}</div>
          <div className="text-[11px] text-muted-foreground">
            {loading ? 'Загрузка каналов…' : `${counts.total} сообщений из подключенных каналов`}
          </div>
        </div>
      </div>

      {channels.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 bg-muted/20 px-3 py-2">
          {channels.some((c) => c.type === 'email') && (
            <ChannelChip icon={Mail} label="Почта" count={counts.email} active />
          )}
          {channels.some((c) => c.type === 'telegram') && (
            <ChannelChip icon={Send} label="Telegram" count={counts.telegram} active />
          )}
          {channels
            .filter((channel) => channel.type === 'email')
            .map((channel) => (
              <Button
                key={channel.id}
                size="sm"
                variant="ghost"
                className="ml-auto h-6 px-2 text-[11px]"
                disabled={syncingId === channel.id}
                onClick={() => sync(channel.id)}
              >
                <RefreshCcw className={cn('h-3 w-3', syncingId === channel.id && 'animate-spin')} />
                {syncingId === channel.id ? 'Синхронизация' : 'Обновить'}
              </Button>
            ))}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <Inbox className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium">Сообщений пока нет</div>
          <p className="max-w-sm text-xs text-muted-foreground">
            Откройте настройки этого блока, подключите почту и синхронизируйте последние письма.
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,34%)_1fr]">
          <div className="min-h-0 overflow-y-auto border-r border-border/60">
            {messages.map((message) => (
              <button
                key={message.id}
                type="button"
                onClick={() => setSelectedId(message.id)}
                className={cn(
                  'block w-full border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-muted/40',
                  selected?.id === message.id && 'bg-primary/10 hover:bg-primary/10',
                )}
              >
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <div className="truncate text-sm font-semibold">
                    {message.senderName || message.senderAddress || 'Без отправителя'}
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-foreground">
                    {formatDate(message.receivedAt)}
                  </div>
                </div>
                <div className="mt-0.5 truncate text-xs font-medium">
                  {message.subject || 'Без темы'}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {cleanPreview(message.preview) || 'Нет превью'}
                </div>
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-col bg-background">
            {selected && (
              <>
                {/* Шапка письма в стиле почтовых сервисов */}
                <div className="flex shrink-0 items-start gap-3 border-b border-border/60 px-4 py-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: avatarColor(selected.senderName || selected.senderAddress || '?') }}
                  >
                    {initialsOf(selected.senderName || selected.senderAddress || '?')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-base font-semibold leading-tight tracking-tight">
                      {selected.subject || 'Без темы'}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                      <span className="font-medium text-foreground/90">
                        {selected.senderName || selected.senderAddress || 'Без отправителя'}
                      </span>
                      {selected.senderName && selected.senderAddress && (
                        <span className="truncate text-muted-foreground">&lt;{selected.senderAddress}&gt;</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Кому: Open Finance · {formatDate(selected.receivedAt, true)}
                    </div>
                  </div>
                </div>

                {/* Тело письма */}
                <div className="min-h-0 flex-1">
                  {selected.bodyHtml ? (
                    <EmailHtmlBody html={selected.bodyHtml} />
                  ) : (
                    <div className="h-full overflow-y-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-foreground/85">
                      {cleanPlainTextBody(selected.body) || cleanPreview(selected.preview) || 'Тело сообщения пустое.'}
                    </div>
                  )}
                </div>

                {/* AI-распознавание (внизу, ограничено по высоте) */}
                <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-border/60 p-3">
                  <AiRecognizePanel messageId={selected.id} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// EmailHtmlBody — рендер HTML письма в sandboxed iframe (картинки on-demand)
// ============================================================================

/**
 * Рендерит HTML-тело письма в sandboxed `<iframe srcdoc>` (как почтовые
 * сервисы): CSS письма изолирован, `<style>`/preheader работают корректно,
 * скрипты письма не исполняются (sandbox без allow-scripts/allow-same-origin).
 * Картинки по умолчанию заблокированы (privacy/трафик) — баннер «Загрузить»
 * пересобирает srcdoc с реальными `<img src>`. Картинки в DB не хранятся.
 */
function EmailHtmlBody({ html }: { html: string }) {
  const { html: safeHtml, hasImages } = useMemo(() => sanitizeEmailHtml(html), [html]);
  const [showImages, setShowImages] = useState(false);
  const srcDoc = useMemo(() => buildEmailSrcDoc(safeHtml, { showImages }), [safeHtml, showImages]);

  return (
    <div className="flex h-full flex-col">
      {hasImages && !showImages && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50/60 px-4 py-1.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="inline-flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5" />
            Картинки заблокированы для приватности и экономии трафика.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowImages(true)}
            className="h-6 gap-1 px-2 text-[11px]"
          >
            <Eye className="h-3 w-3" />
            Загрузить
          </Button>
        </div>
      )}
      <iframe
        title="Содержимое письма"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}

// ============================================================================
// AI Vision recognize panel — кнопка «Распознать с AI» + ExtractedData panel
// ============================================================================

type ExtractedSnap = {
  vendor?: string;
  vendorInn?: string;
  date?: string;
  amount?: number;
  currency?: string;
  type?: string;
  items?: Array<{ name: string; qty?: number; price?: number; total?: number }>;
  rawText?: string;
  provider?: string;
  durationMs?: number;
};

function AiRecognizePanel({ messageId }: { messageId: string }) {
  const [hint, setHint] = useState<'auto' | 'receipt' | 'invoice' | 'contract'>('auto');
  const [provider, setProvider] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedSnap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  async function recognize(file?: File) {
    setLoading(true);
    setError(null);
    setExtracted(null);
    try {
      const params = new URLSearchParams({ hint });
      if (provider) params.set('provider', provider);
      let resp: Response;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        resp = await fetch(`/api/inbox/messages/${messageId}/recognize?${params.toString()}`, {
          method: 'POST',
          body: fd,
        });
      } else {
        resp = await fetch(`/api/inbox/messages/${messageId}/recognize?${params.toString()}`, {
          method: 'POST',
        });
      }
      const json = await resp.json();
      if (!json.ok) {
        setError(json.error || 'Не удалось распознать');
      } else {
        setExtracted(json.extracted as ExtractedSnap);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function createTransaction() {
    if (!extracted) return;
    setCreating(true);
    setCreated(null);
    try {
      const resp = await fetch('/api/cashflow/transactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          occurredAt: extracted.date
            ? new Date(extracted.date).toISOString()
            : new Date().toISOString(),
          amount: extracted.amount ? -Math.abs(extracted.amount) : 0,
          counterparty: extracted.vendor ?? null,
          description: `Из AI-распознавания (${extracted.provider})`,
          currency: extracted.currency ?? 'RUB',
          source: 'ai_vision',
        }),
      });
      const json = await resp.json();
      if (json.ok) {
        setCreated(json.id ?? 'created');
      } else {
        setError(`Не удалось создать транзакцию: ${json.error}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/15 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium">Распознать с AI</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Тип:</span>
        {(['auto', 'receipt', 'invoice', 'contract'] as const).map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setHint(h)}
            className={
              'inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] ' +
              (hint === h
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70')
            }
          >
            {h === 'receipt' ? <Receipt className="h-2.5 w-2.5" /> : h === 'invoice' ? <FileText className="h-2.5 w-2.5" /> : null}
            {h === 'auto' ? 'Авто' : h === 'receipt' ? 'Чек' : h === 'invoice' ? 'Счёт' : 'Договор'}
          </button>
        ))}
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="ml-auto h-5 rounded border border-border/60 bg-background px-1 text-[10px]"
        >
          <option value="">Провайдер по умолчанию</option>
          <option value="claude">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="yandex">Yandex Vision</option>
          <option value="tesseract">Tesseract</option>
          <option value="mock">Mock</option>
        </select>
      </div>

      <div className="flex gap-1.5">
        <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => recognize()} disabled={loading}>
          <Sparkles className="mr-1 h-3 w-3" />
          {loading ? 'Распознаю…' : 'Распознать из письма'}
        </Button>
        <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-border/60 bg-background px-2 text-xs hover:bg-accent">
          <UploadIcon className="h-3 w-3" />
          Из файла
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            disabled={loading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void recognize(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">
          <XCircle className="h-3 w-3 shrink-0 translate-y-0.5" />
          <span>{error}</span>
        </div>
      )}

      {extracted && (
        <div className="mt-2 space-y-1.5 rounded border border-border/60 bg-background p-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground">
              Извлечено · {extracted.provider} · {extracted.durationMs}мс
            </span>
            <CheckCircle className="h-3 w-3 text-green-500" />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {extracted.vendor && (
              <div>
                <span className="text-muted-foreground">Поставщик:</span>{' '}
                <span className="font-medium">{extracted.vendor}</span>
              </div>
            )}
            {extracted.vendorInn && (
              <div>
                <span className="text-muted-foreground">ИНН:</span>{' '}
                <span className="font-mono">{extracted.vendorInn}</span>
              </div>
            )}
            {extracted.date && (
              <div>
                <span className="text-muted-foreground">Дата:</span>{' '}
                <span>{extracted.date}</span>
              </div>
            )}
            {extracted.amount !== undefined && (
              <div>
                <span className="text-muted-foreground">Сумма:</span>{' '}
                <span className="font-semibold tabular-nums">
                  {(extracted.amount / 100).toLocaleString('ru-RU', {
                    minimumFractionDigits: 2,
                  })}{' '}
                  {extracted.currency}
                </span>
              </div>
            )}
            {extracted.type && (
              <div>
                <span className="text-muted-foreground">Тип:</span>{' '}
                <span>{extracted.type}</span>
              </div>
            )}
          </div>
          {extracted.items && extracted.items.length > 0 && (
            <details className="text-[10px]">
              <summary className="cursor-pointer text-muted-foreground">
                Позиций: {extracted.items.length}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {extracted.items.slice(0, 10).map((it, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="truncate">{it.name}</span>
                    {it.total !== undefined && (
                      <span className="ml-2 shrink-0 tabular-nums">
                        {(it.total / 100).toLocaleString('ru-RU')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-1.5 pt-1">
            <Button
              size="sm"
              variant="default"
              className="h-6 text-[11px]"
              onClick={createTransaction}
              disabled={creating || !!created || !extracted.amount}
            >
              {created ? '✓ Создана' : creating ? 'Создаю…' : 'Создать транзакцию'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelChip({
  icon: Icon,
  label,
  count,
  active,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium ring-1 ring-inset',
        active
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-800'
          : 'bg-muted text-muted-foreground ring-border',
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
      <span className="font-mono">{count}</span>
    </span>
  );
}

type EmailForm = {
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  mailbox: string;
  password: string;
};

const DEFAULT_EMAIL_FORM: EmailForm = {
  label: 'Рабочая почта',
  host: '',
  port: 993,
  secure: true,
  username: '',
  mailbox: 'INBOX',
  password: '',
};

function InboxChannelSettings({ config, onChange, instance }: BlockSettingsFormProps) {
  const blockId = instance?.id ?? '';
  const [channels, setChannels] = useState<InboxChannelDto[]>([]);
  const [form, setForm] = useState<EmailForm>(DEFAULT_EMAIL_FORM);
  const [loading, setLoading] = useState(Boolean(blockId));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    if (!blockId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox/channels?${new URLSearchParams({ blockId }).toString()}`);
      const data = await res.json();
      if (data.ok) {
        const nextChannels = data.channels as InboxChannelDto[];
        setChannels(nextChannels);
        const email = nextChannels.find((channel) => channel.type === 'email');
        if (email) {
          setForm({
            label: email.label,
            host: email.config.host ?? '',
            port: email.config.port ?? 993,
            secure: email.config.secure ?? true,
            username: email.config.username ?? '',
            mailbox: email.config.mailbox ?? 'INBOX',
            password: '',
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [blockId]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  function patchForm(patch: Partial<EmailForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setMessage(null);
    setError(null);
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/inbox/channels/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email', ...form, blockId, pageKey: 'inbox' }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Не удалось подключиться');
        return;
      }
      setMessage('Подключение к почте успешно проверено.');
    } finally {
      setTesting(false);
    }
  }

  async function saveEmailChannel() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/inbox/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email', ...form, blockId, pageKey: 'inbox' }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Не удалось сохранить канал');
        return;
      }
      setMessage('Почтовый канал сохранён для этого блока.');
      onChange({ ...config, title: config.title ?? 'Входящие' });
      await loadChannels();
    } finally {
      setSaving(false);
    }
  }

  async function syncChannel(channelId: string) {
    setSyncingId(channelId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/inbox/channels/${channelId}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Не удалось синхронизировать почту');
        return;
      }
      setMessage(`Синхронизация завершена: новых сообщений ${data.inserted}.`);
      await loadChannels();
    } finally {
      setSyncingId(null);
    }
  }

  async function deleteChannel(channelId: string) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/inbox/channels/${channelId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || 'Не удалось удалить канал');
      return;
    }
    setMessage('Канал удалён из этого блока.');
    setForm(DEFAULT_EMAIL_FORM);
    await loadChannels();
  }

  const emailChannel = channels.find((channel) => channel.type === 'email');

  return (
    <div className="space-y-4">
      {!blockId && (
        <Alert variant="warning" className="text-xs">
          <AlertDescription>Сначала создайте блок, затем откройте его настройки для подключения каналов.</AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b border-border/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Почта</div>
                <div className="text-[11px] text-muted-foreground">
                  IMAP-подключение только для этого блока
                </div>
              </div>
            </div>
            {emailChannel && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-50 px-2 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-800">
                <PlugZap className="h-3 w-3" />
                {emailChannel.totalCount} сообщений
              </span>
            )}
            <Button size="sm" variant="outline" onClick={() => setInstructionsOpen(true)}>
              <BookOpen /> Инструкция
            </Button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Название канала">
              <Input value={form.label} onChange={(e) => patchForm({ label: e.target.value })} />
            </Field>
            <Field label="Mailbox">
              <Input value={form.mailbox} onChange={(e) => patchForm({ mailbox: e.target.value })} />
            </Field>
            <Field label="IMAP host">
              <Input
                placeholder="imap.example.ru"
                value={form.host}
                onChange={(e) => patchForm({ host: e.target.value })}
              />
            </Field>
            <Field label="Port">
              <Input
                type="number"
                value={form.port}
                onChange={(e) => patchForm({ port: Number(e.target.value) || 993 })}
              />
            </Field>
            <Field label="Логин">
              <Input value={form.username} onChange={(e) => patchForm({ username: e.target.value })} />
            </Field>
            <Field label={emailChannel?.hasSecret ? 'App password (оставьте пустым, чтобы не менять)' : 'App password'}>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => patchForm({ password: e.target.value })}
                placeholder={emailChannel?.hasSecret ? '••••••••' : ''}
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={() => patchForm({ secure: !form.secure, port: form.secure ? 143 : 993 })}
            className="mt-3 flex w-full items-center justify-between rounded-md border p-2.5 text-left transition-colors hover:bg-muted/40"
          >
            <div>
              <div className="text-sm font-medium">SSL/TLS</div>
              <div className="text-[11px] text-muted-foreground">
                Включено: SSL 993. Выключено: STARTTLS 143, если сервер поддерживает.
              </div>
            </div>
            <div className={(form.secure ? 'bg-primary' : 'bg-muted') + ' relative inline-flex h-5 w-9 items-center rounded-full transition-colors'}>
              <span className={(form.secure ? 'translate-x-[18px]' : 'translate-x-0.5') + ' inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform'} />
            </div>
          </button>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={testConnection} disabled={!blockId || testing || !form.host || !form.username || !form.password}>
              <PlugZap /> {testing ? 'Проверяем…' : 'Проверить'}
            </Button>
            <Button size="sm" onClick={saveEmailChannel} disabled={!blockId || saving || !form.host || !form.username || (!emailChannel && !form.password)}>
              <Save /> {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            {emailChannel && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncChannel(emailChannel.id)}
                  disabled={syncingId === emailChannel.id}
                  title="Подтянет до 200 последних писем. Уже сохранённые обновятся через upsert по external_id — после фикса парсера v0.24.4 это починит старые письма с кодировкой."
                >
                  <RefreshCcw className={syncingId === emailChannel.id ? 'animate-spin' : ''} />
                  {syncingId === emailChannel.id ? 'Синхронизация…' : 'Синхронизировать (200)'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteChannel(emailChannel.id)}>
                  <Trash2 /> Удалить
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 opacity-70">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <Send className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Telegram</div>
            <div className="text-[11px] text-muted-foreground">
              Канал предусмотрен для AI-секретаря. Подключение через Bot API будет добавлено следующим шагом.
            </div>
          </div>
          <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground">
            скоро
          </span>
        </div>
      </div>

      {loading && <p className="text-[11px] text-muted-foreground">Загружаем каналы…</p>}
      {message && (
        <Alert className="text-xs">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="text-xs">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <EmailInstructionsDialog open={instructionsOpen} onOpenChange={setInstructionsOpen} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function EmailInstructionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Инструкция по подключению почты</DialogTitle>
          <DialogDescription>
            Используйте IMAP-доступ. Логин почти всегда полный email, пароль — пароль ящика или пароль приложения.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1 text-sm">
          <InstructionCard
            title="Beget"
            rows={[
              ['IMAP host', 'imap.beget.com'],
              ['Порт SSL', '993, SSL/TLS включен'],
              ['Порт STARTTLS', '143, SSL/TLS выключен в форме'],
              ['Логин', 'полный email, например admin@domain.ru'],
              ['Пароль', 'пароль почтового ящика Beget'],
            ]}
            note="Если 993 даёт timeout, используйте 143 и выключите переключатель SSL/TLS: приложение выполнит STARTTLS перед логином."
          />
          <InstructionCard
            title="Google Gmail"
            rows={[
              ['IMAP host', 'imap.gmail.com'],
              ['Порт', '993, SSL/TLS включен'],
              ['Логин', 'полный Gmail-адрес'],
              ['Пароль', '16-значный пароль приложения'],
            ]}
            note="В Google Account включите двухэтапную проверку, затем создайте App password для Mail. Обычный пароль аккаунта чаще всего не подойдёт."
          />
          <InstructionCard
            title="Яндекс 360 / Яндекс Почта"
            rows={[
              ['IMAP host', 'imap.yandex.ru'],
              ['Порт', '993, SSL/TLS включен'],
              ['Логин', 'полный email'],
              ['Пароль', 'пароль приложения для почтового клиента'],
            ]}
            note="В настройках Яндекс ID создайте пароль приложения и убедитесь, что IMAP доступ разрешён в настройках почты."
          />
          <InstructionCard
            title="Mail.ru / VK WorkMail"
            rows={[
              ['IMAP host', 'imap.mail.ru'],
              ['Порт', '993, SSL/TLS включен'],
              ['Логин', 'полный email'],
              ['Пароль', 'пароль для внешнего приложения'],
            ]}
            note="Для доменной почты Mail.ru/VK WorkMail обычно используются те же IMAP-настройки; при 2FA нужен отдельный пароль приложения."
          />
          <InstructionCard
            title="VPS / собственный mail-server"
            rows={[
              ['IMAP host', 'mail.your-domain.ru или hostname сервера'],
              ['Порт SSL', '993, SSL/TLS включен'],
              ['Порт STARTTLS', '143, SSL/TLS выключен в форме'],
              ['Логин', 'полный mailbox или системный логин, зависит от Dovecot/PostfixAdmin'],
              ['DNS/TLS', 'A/MX запись и валидный сертификат Let’s Encrypt'],
            ]}
            note="Проверьте firewall/security group: входящие TCP 993 или 143 должны быть открыты с машины, где запущен Open Finance."
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InstructionCard({
  title,
  rows,
  note,
}: {
  title: string;
  rows: Array<[string, string]>;
  note: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="grid gap-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[120px_1fr] gap-3 text-xs">
            <div className="text-muted-foreground">{label}</div>
            <div className="font-medium">{value}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}

export const InboxChannelFeedBlock: BlockDef = {
  type: 'inbox.channel-feed',
  displayName: 'Каналы входящих',
  description: 'Почта и будущие мессенджеры в одном read-only блоке для AI-агентов',
  category: 'tables',
  icon: Inbox,
  defaultSize: { w: 6, h: 12 },
  minSize: { w: 4, h: 6 },
  minContentSize: { w: 360, h: 260 },
  pages: ['inbox'],
  configSchema: Config,
  defaultConfig: () => ({ title: 'Входящие' }),
  SettingsForm: InboxChannelSettings,
  Render: RenderInboxChannelFeed,
};
