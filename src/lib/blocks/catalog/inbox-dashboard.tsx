// PURPOSE: Inbox dashboard block — компактный обзор входящих для главного дашборда
// с density-aware рендером и drill-down на /inbox.
'use client';

import { useEffect, useState } from 'react';
import { Inbox, ArrowRight, Mail } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useBlockValuePublisher } from '../values';
import Link from 'next/link';

const InboxDashboardConfig = z.object({
  title: z.string().default('Входящие'),
  limit: z.number().int().min(1).max(20).default(5),
  channelId: z.string().nullable().default(null),
});

type Cfg = z.infer<typeof InboxDashboardConfig>;

type InboxMsg = {
  id: string;
  senderName: string | null;
  senderAddress: string | null;
  subject: string | null;
  preview: string | null;
  receivedAt: string;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'сейчас';
  if (min < 60) return `${min} мин`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} д`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function RenderInboxDashboard({ instance }: BlockRenderProps) {
  const cfg = InboxDashboardConfig.parse(instance.config ?? {});
  const density = useBlockDensity();
  const [messages, setMessages] = useState<InboxMsg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: String(cfg.limit) });
    if (cfg.channelId) params.set('channelId', cfg.channelId);
    fetch(`/api/inbox/messages?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) setMessages(d.messages ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cfg.limit, cfg.channelId]);

  const title = instance.appearance?.title ?? cfg.title;
  const accent = instance.appearance?.accentColor;
  const latest = messages[0];

  useBlockValuePublisher(instance.id, {
    count: messages.length,
    latestSubject: latest?.subject ?? null,
    latestSender: latest?.senderName ?? latest?.senderAddress ?? null,
    label: title,
    __labels:
      'count=Кол-во писем,latestSubject=Тема последнего,latestSender=Отправитель последнего',
  });

  const inboxHref = cfg.channelId ? `/app/inbox?channel=${cfg.channelId}` : '/app/inbox';

  // xs: бейдж с числом
  if (density === 'xs') {
    return (
      <Link href={inboxHref}>
        <Card className="flex h-full cursor-pointer items-center justify-center p-1 transition hover:ring-1 hover:ring-primary/30">
          <div className="flex items-center gap-1">
            <Mail className="h-3 w-3" style={accent ? { color: accent } : undefined} />
            <span className="text-sm font-semibold tabular-nums">{loading ? '—' : messages.length}</span>
          </div>
        </Card>
      </Link>
    );
  }

  // sm: бейдж + 1 latest
  if (density === 'sm') {
    return (
      <Link href={inboxHref}>
        <Card className="flex h-full cursor-pointer flex-col justify-center gap-1 p-2 transition hover:ring-1 hover:ring-primary/30">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Inbox className="h-3 w-3" style={accent ? { color: accent } : undefined} />
            <span className="truncate">{title}</span>
            <span className="ml-auto tabular-nums">{loading ? '—' : messages.length}</span>
          </div>
          {latest && (
            <div className="truncate text-[11px] font-medium">
              {latest.subject ?? '(без темы)'}
            </div>
          )}
        </Card>
      </Link>
    );
  }

  // md / lg: список 3-5 сообщений + кнопка
  const displayLimit = density === 'lg' ? cfg.limit : 3;

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between pb-1.5">
        <CardTitle className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
          <Inbox className="h-4 w-4 shrink-0" style={accent ? { color: accent } : undefined} />
          <span className="truncate">{title}</span>
          {messages.length > 0 && (
            <span className="ml-1 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {messages.length}
            </span>
          )}
        </CardTitle>
        <Link
          href={inboxHref}
          className="flex shrink-0 items-center gap-0.5 rounded text-[10px] text-primary hover:underline"
        >
          Открыть <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-2 pt-1">
        {loading ? (
          <div className="text-center text-xs text-muted-foreground">Загрузка…</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Inbox className="mb-1 h-5 w-5 text-muted-foreground/40" />
            <div className="text-xs text-muted-foreground">Нет писем</div>
            <Link href="/app/inbox" className="mt-1 text-[10px] text-primary hover:underline">
              Подключить канал →
            </Link>
          </div>
        ) : (
          <ul className="space-y-1">
            {messages.slice(0, displayLimit).map((m) => (
              <li key={m.id} className="rounded p-1 hover:bg-muted/40">
                <Link href={`/app/inbox?message=${m.id}`} className="block">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="truncate text-[11px] font-medium">
                      {m.senderName ?? m.senderAddress ?? 'Без отправителя'}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {timeAgo(m.receivedAt)}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {m.subject ?? m.preview ?? '(без темы)'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InboxDashboardSettings({ config, onChange }: BlockSettingsFormProps) {
  const cfg = InboxDashboardConfig.parse(config ?? {});

  function set<K extends keyof Cfg>(key: K, value: Cfg[K]) {
    onChange({ ...cfg, [key]: value });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Заголовок</Label>
        <Input value={cfg.title} onChange={(e) => set('title', e.target.value || 'Входящие')} />
      </div>
      <div className="space-y-1.5">
        <Label>Сколько писем показывать</Label>
        <Input
          type="number"
          min={1}
          max={20}
          value={cfg.limit}
          onChange={(e) => set('limit', Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
        />
      </div>
      <div className="space-y-1.5">
        <Label>ID канала (опц.)</Label>
        <Input
          value={cfg.channelId ?? ''}
          onChange={(e) => set('channelId', e.target.value || null)}
          placeholder="Оставьте пустым — все каналы"
        />
        <p className="text-[11px] text-muted-foreground">
          Если указан UUID канала — показываются только письма из него.
        </p>
      </div>
    </div>
  );
}

export const InboxDashboardBlock: BlockDef = {
  type: 'inbox.dashboard',
  displayName: 'Входящие (компактно)',
  description:
    'Обзор последних входящих сообщений с drill-down на /inbox. Density-aware: бейдж → список',
  category: 'custom',
  icon: Inbox,
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 80, h: 40 },
  pages: ['dashboard', 'cashflow', 'inbox'],
  configSchema: InboxDashboardConfig,
  defaultConfig: () => ({ title: 'Входящие', limit: 5, channelId: null }),
  SettingsForm: InboxDashboardSettings,
  Render: RenderInboxDashboard,
};
