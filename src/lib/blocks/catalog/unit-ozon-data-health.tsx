// PURPOSE: Блок «Ozon · Состояние данных» — показывает статус последнего
// sync (по аккаунту), наличие perf-кредов, и CTA при проблемах.

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';

export const OzonDataHealthBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
});
function parseConfig(raw: unknown) {
  return OzonDataHealthBlockConfigSchema.parse(raw ?? {});
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'никогда';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'неизвестно';
  const ms = Date.now() - date.getTime();
  const hours = ms / 1000 / 60 / 60;
  if (hours < 1) return `${Math.round(ms / 1000 / 60)} мин назад`;
  if (hours < 24) return `${Math.round(hours)} ч назад`;
  return `${Math.round(hours / 24)} д назад`;
}

function RenderOzonDataHealth({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const { accounts, loading, error, reload } = useMarketplaceAccounts({ marketplace: 'ozon' });
  useReportBlockLoading(loading);
  const account = accounts.find((a) => a.id === config.accountId);

  // Hook должен вызываться безусловно — поэтому считаем диагностику здесь,
  // даже если account ещё не выбран. При отсутствии account публикуем 0/-1.
  const sellerOk = !!account && account.status === 'active' && account.lastSyncStatus !== 'error';
  const perfOk = !!account && account.perfConnected && account.perfStatus !== 'error';
  const hoursSinceSync = account?.lastSyncAt
    ? (Date.now() - new Date(account.lastSyncAt).getTime()) / 1000 / 60 / 60
    : Infinity;
  const stale = hoursSinceSync > 24;
  // Primary value — общий «zdorov'ye» (1 = всё ок, 0 = есть проблемы).
  // __labels для русских названий в модалке «Связать ячейку».
  useBlockValuePublisher(instance.id, {
    value: sellerOk && perfOk && !stale ? 1 : 0,
    sellerOk: sellerOk ? 1 : 0,
    perfOk: perfOk ? 1 : 0,
    perfConnected: account?.perfConnected ? 1 : 0,
    sellerHoursSinceSync: Number.isFinite(hoursSinceSync) ? hoursSinceSync : -1,
    stale: stale ? 1 : 0,
    sellerLastSyncStatus: account?.lastSyncStatus ?? '',
    perfStatus: account?.perfStatus ?? '',
    sellerErrorMessage: account?.lastSyncError ?? '',
    perfErrorMessage: account?.perfLastSyncError ?? '',
    __labels:
      'value=Состояние API (1=ok),sellerOk=Seller API OK,perfOk=Performance API OK,' +
      'perfConnected=Performance API подключён,perfStatus=Статус Performance sync,' +
      'sellerLastSyncStatus=Статус Seller sync,sellerErrorMessage=Ошибка Seller API,' +
      'perfErrorMessage=Ошибка Performance API,stale=Данные устарели (>24ч),' +
      'sellerHoursSinceSync=Часов с последней синхронизации',
  });

  if (loading) {
    return (
      <Card className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        Загрузка…
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[12px] text-rose-700 dark:text-rose-300">
        <AlertTriangle className="h-5 w-5" />
        Не удалось загрузить статус интеграций
        <span className="text-[11px] opacity-80">{error}</span>
        <button
          type="button"
          onClick={() => reload()}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <RefreshCw className="h-3 w-3" /> Повторить
        </button>
      </Card>
    );
  }

  if (accounts.length === 0) {
    return (
      <Card className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[12px] text-muted-foreground">
        <AlertTriangle className="h-5 w-5" />
        Ни один Ozon-магазин не подключён
        <Link
          href="/app/settings/integrations"
          className="text-[11px] text-primary hover:underline"
        >
          Подключить в Настройках → Интеграции →
        </Link>
      </Card>
    );
  }

  if (!account) {
    return (
      <Card className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[12px] text-muted-foreground">
        <AlertTriangle className="h-5 w-5" />
        Выберите магазин в настройках блока.
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">
          Состояние данных · {account.name || account.clientId}
        </div>
        <Link
          href="/app/settings/integrations"
          className="text-[10px] text-primary hover:underline"
        >
          Открыть Интеграции →
        </Link>
      </div>
      <div className="space-y-2">
        <HealthRow
          icon={sellerOk ? CheckCircle2 : AlertTriangle}
          tone={sellerOk ? 'ok' : 'error'}
          label="Seller API"
          value={
            account.lastSyncStatus === 'error'
              ? `Ошибка: ${account.lastSyncError ?? 'неизвестная'}`
              : sellerOk
                ? 'OK'
                : 'Не синхронизирован'
          }
        />
        <HealthRow
          icon={Clock}
          tone={stale ? 'warning' : 'ok'}
          label="Последний sync"
          value={formatRelativeTime(account.lastSyncAt)}
        />
        <HealthRow
          icon={perfOk ? CheckCircle2 : AlertTriangle}
          tone={perfOk ? 'ok' : account.perfConnected ? 'error' : 'warning'}
          label="Performance API"
          value={
            !account.perfConnected
              ? 'Не подключён'
              : account.perfStatus === 'error'
                ? `Ошибка: ${account.perfLastSyncError ?? 'неизвестная'}`
                : 'OK'
          }
        />
        {account.perfConnected && (
          <HealthRow
            icon={Clock}
            tone="muted"
            label="Последний perf-sync"
            value={formatRelativeTime(account.perfLastSyncAt)}
          />
        )}
      </div>
      {!account.perfConnected && (
        <Link
          href="/app/settings/integrations"
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
        >
          <RefreshCw className="h-3 w-3" />
          Подключить Performance API
        </Link>
      )}
    </Card>
  );
}

function HealthRow({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof Activity;
  tone: 'ok' | 'warning' | 'error' | 'muted';
  label: string;
  value: string;
}) {
  const cls =
    tone === 'ok'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'error'
          ? 'text-rose-700 dark:text-rose-400'
          : 'text-muted-foreground';
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1.5">
      <Icon className={'h-3.5 w-3.5 ' + cls} />
      <span className="text-[11px] font-medium">{label}</span>
      <span className={'ml-auto text-[11px] ' + cls}>{value}</span>
    </div>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  return (
    <OzonAccountSelector
      value={parsed.accountId}
      onChange={(id) =>
        onChange({ ...parsed, accountId: id } as unknown as Record<string, unknown>)
      }
      showPerfStatus
    />
  );
}

export const UnitOzonDataHealthBlock: BlockDef = {
  type: 'unit.ozon-data-health',
  displayName: 'Ozon · Состояние данных',
  description:
    'Статус подключения, последняя синхронизация Seller API и Performance API, CTA при проблемах.',
  category: 'stats',
  icon: Activity,
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonDataHealthBlockConfigSchema,
  defaultConfig: () => OzonDataHealthBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonDataHealth,
};
