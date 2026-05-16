// PURPOSE: React-хук для использования marketplace-аккаунтов в Block-Grid
// блоках (unit-ozon-*). Загружает список через GET /api/marketplaces/accounts,
// кэширует на life-time компонента. Защита от setState после unmount.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountPublic, MarketplaceKind } from '@/lib/marketplaces/types';

export function useMarketplaceAccounts(args?: { marketplace?: MarketplaceKind }) {
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = args?.marketplace
        ? `/api/marketplaces/accounts?marketplace=${args.marketplace}`
        : '/api/marketplaces/accounts';
      const res = await fetch(url);
      const data = await res.json();
      if (!mounted.current) return;
      if (data.ok) {
        setAccounts(data.accounts);
      } else {
        setError(data.error ?? 'Failed to load accounts');
      }
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [args?.marketplace]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  return { accounts, loading, error, reload: load };
}
