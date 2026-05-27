// PURPOSE: Хук для автообновления Ozon-блоков после ручной синхронизации.
// Подписывается на window-событие 'ozon-sync-completed', которое
// диспатчится SyncAllButton после завершения OzonSyncDialog.
// Каждый блок, использующий этот хук, вызовет fetchData() автоматически.

import { useEffect } from 'react';

export function useOzonSyncListener(fetchData: () => void): void {
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('ozon-sync-completed', handler);
    return () => window.removeEventListener('ozon-sync-completed', handler);
  }, [fetchData]);
}
