// PURPOSE: TanStack Query провайдер (был в deps, но не подключён). Даёт кэш +
// дедупликацию запросов между блоками и отсутствие повторной загрузки при
// ре-навигации/ремоунте (staleTime). Один QueryClient на сессию (useState-init).
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 60с «свежести» → возврат на страницу не перезагружает данные блоков.
            staleTime: 60_000,
            // держим в кэше 5 мин после анмаунта (ремоунт берёт кэш мгновенно).
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
