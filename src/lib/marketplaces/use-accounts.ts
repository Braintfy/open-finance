// PURPOSE: React-хук для marketplace-аккаунтов в Block-Grid блоках (unit-ozon-*).
// На TanStack Query: общий queryKey ['marketplace-accounts', marketplace] →
// 5 одинаковых блоков на дашборде Ozon дают ОДИН запрос (дедуп), кэш переживает
// ремоунт/ре-навигацию (staleTime из QueryProvider). API совместим со старым
// ({ accounts, loading, error, reload }).

'use client';

import { useQuery } from '@tanstack/react-query';
import type { AccountPublic, MarketplaceKind } from '@/lib/marketplaces/types';

async function fetchAccounts(marketplace?: MarketplaceKind): Promise<AccountPublic[]> {
  const url = marketplace
    ? `/api/marketplaces/accounts?marketplace=${marketplace}`
    : '/api/marketplaces/accounts';
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'Failed to load accounts');
  return data.accounts as AccountPublic[];
}

export function useMarketplaceAccounts(args?: { marketplace?: MarketplaceKind }) {
  const marketplace = args?.marketplace;
  const query = useQuery({
    queryKey: ['marketplace-accounts', marketplace ?? 'all'],
    queryFn: () => fetchAccounts(marketplace),
  });

  return {
    accounts: query.data ?? [],
    // isPending = первая загрузка без кэша. На ремоунте с тёплым кэшем — false
    // (мгновенные данные, без flash). refetch не поднимает loading (только isFetching).
    loading: query.isPending,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Network error') : null,
    reload: query.refetch,
  };
}
