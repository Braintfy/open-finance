// PURPOSE: Доменная ошибка модуля «Склад» с готовым HTTP-статусом и текстом
// для человека. Вынесена из posting.ts отдельным файлом, чтобы её могли бросать
// и ЧИСТЫЕ модули (doc-plan.ts, import-sales.ts), не таща за собой db-клиент:
// posting.ts импортирует db, а чистый модуль обязан оставаться тестируемым
// через `pnpm tsx scripts/test-*.ts` без базы.
//
// posting.ts ре-экспортирует StockError — старые импорты (`from './posting'`)
// продолжают работать, роуты мапят ошибку через src/lib/stock/http.ts.

export type StockErrorCode =
  | 'not_found'
  | 'bad_request'
  | 'period_locked'
  | 'wrong_status'
  | 'not_implemented';

/** Доменная ошибка с HTTP-статусом: роуты мапят её без анализа текста. */
export class StockError extends Error {
  readonly code: StockErrorCode;
  readonly status: number;

  constructor(code: StockErrorCode, message: string) {
    super(message);
    this.name = 'StockError';
    this.code = code;
    this.status =
      code === 'not_found'
        ? 404
        : code === 'period_locked'
          ? 403
          : code === 'wrong_status'
            ? 409
            : code === 'not_implemented'
              ? 501
              : 400;
  }
}
