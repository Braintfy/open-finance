// PURPOSE: Стейдж синхронизации поисковых фраз Ozon Performance API.
// Использует тот же async-flow что и perf-sku-stats, но другой отчёт.
// На момент имплементации Performance API не отдаёт публичный CSV-отчёт
// «поисковые фразы» через простой endpoint без авторизованного флоу.
// Поэтому стейдж в текущей версии заглушка: помечает себя success+0
// если perf-client есть, иначе error «нет кредов». При появлении
// реального endpoint — добавить generate+wait+downloadReport как в
// perf-sku-stats.

import { runStageWithTiming, type StageContext, type StageResult } from './types';

export async function syncPerfPhrasesStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    if (!ctx.perfClient) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: 'Performance API не подключён для этого аккаунта',
      };
    }
    // TODO: реализовать когда у пользователя появится постоянный доступ к
    // запуску отчёта «поисковые фразы» через Performance API. На текущий
    // момент возвращаем no-op success — sync-job не падает, а блок поисковых
    // фраз показывает «нет данных».
    return { itemsProcessed: 0, itemsTotal: 0, warnings: ['Поисковые фразы: TODO real implementation'] };
  });
}
