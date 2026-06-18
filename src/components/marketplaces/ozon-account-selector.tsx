// PURPOSE: Селектор Ozon-аккаунта для SettingsForm любого блока.
// Использует useMarketplaceAccounts({ marketplace: 'ozon' }), показывает
// статус подключения и Performance API в подписи. Если у пользователя
// нет ни одного Ozon-аккаунта — рендерит CTA с ссылкой на /app/settings/integrations.

'use client';

import Link from 'next/link';
import { Label } from '@/components/ui/label';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';

export type OzonAccountSelectorProps = {
  /** Выбранный accountId (или null/undefined). */
  value: string | null | undefined;
  onChange: (accountId: string | null) => void;
  /** Подпись поля (default "Магазин Ozon"). */
  label?: string;
  /** Show подсказку о статусе Performance API. */
  showPerfStatus?: boolean;
};

export function OzonAccountSelector({
  value,
  onChange,
  label = 'Магазин Ozon',
  showPerfStatus = false,
}: OzonAccountSelectorProps) {
  const { accounts, loading } = useMarketplaceAccounts({ marketplace: 'ozon' });

  if (loading) {
    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <div className="rounded-md border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground">
          Загрузка магазинов…
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <div className="rounded-md border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
          Нет подключённых магазинов.{' '}
          <Link
            href="/app/settings/integrations"
            className="font-medium text-primary hover:underline"
          >
            Подключить Ozon →
          </Link>
        </div>
      </div>
    );
  }

  const active = accounts.find((a) => a.id === value) ?? null;

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">— Выберите магазин —</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name || a.clientId}
            {a.perfConnected ? ' · Perf API ✓' : ''}
          </option>
        ))}
      </select>
      {showPerfStatus && active && (
        <div className="text-[10px] text-muted-foreground">
          {active.perfConnected ? (
            <>
              Performance API подключён. Реклама/CTR/CPC/CPO доступны.
              {active.perfLastSyncAt &&
                ` Последний perf-sync: ${new Date(active.perfLastSyncAt).toLocaleString('ru-RU')}.`}
            </>
          ) : (
            <>
              Performance API не подключён.{' '}
              <Link
                href="/app/settings/integrations"
                className="text-primary hover:underline"
              >
                Подключить →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
