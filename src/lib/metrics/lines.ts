// PURPOSE: Реестр статей слоя метрик (docs/METRICS_LAYER_DESIGN.md, раздел 3): коды, названия,
// группы водопада P&L, признак участия в прибыли и ожидаемый знак. Единственное место, где
// определено, что входит в прибыль, — формулы и сборка читают списки отсюда, а не держат свои.

export type LineCode =
  | 'revenue'
  | 'returns'
  | 'mp_topup'
  | 'commission'
  | 'logistics'
  | 'return_logistics'
  | 'last_mile'
  | 'storage'
  | 'acquiring'
  | 'penalties'
  | 'other_fees'
  | 'compensation'
  | 'ads'
  | 'cogs'
  | 'tax'
  | 'opex'
  | 'unclassified'
  | 'ads_settled'
  | 'ads_bonus'
  | 'rlz_revenue'
  | 'rlz_returns'
  | 'rlz_commission'
  | 'rlz_topup'
  | 'ordered'
  | 'views'
  | 'cart_adds';

export type LineGroup =
  | 'sales'
  | 'mp_fees'
  | 'mp_income'
  | 'ads'
  | 'own'
  | 'unclassified'
  | 'control'
  | 'measure';

export interface LineDef {
  code: LineCode;
  title: string;
  group: LineGroup;
  /** Входит ли статья в прибыль. Контрольные статьи и меры — никогда. */
  inProfit: boolean;
  /** Ожидаемый знак суммы (для отображения и контроля); 0 — знак любой. Знак не навязывается. */
  expectedSign: 1 | -1 | 0;
  /** Несёт ли статья штуки (qty) осмысленно. */
  hasQty: boolean;
}

// Порядок массива = порядок водопада P&L.
export const LINES: readonly LineDef[] = [
  { code: 'revenue', title: 'Выручка', group: 'sales', inProfit: true, expectedSign: 1, hasQty: true },
  { code: 'returns', title: 'Возвраты', group: 'sales', inProfit: true, expectedSign: -1, hasQty: true },
  { code: 'mp_topup', title: 'Доплаты площадки', group: 'sales', inProfit: true, expectedSign: 1, hasQty: false },
  { code: 'commission', title: 'Комиссия', group: 'mp_fees', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'logistics', title: 'Логистика', group: 'mp_fees', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'return_logistics', title: 'Логистика возвратов', group: 'mp_fees', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'last_mile', title: 'Последняя миля', group: 'mp_fees', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'storage', title: 'Хранение', group: 'mp_fees', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'acquiring', title: 'Эквайринг', group: 'mp_fees', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'penalties', title: 'Штрафы', group: 'mp_fees', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'other_fees', title: 'Прочие удержания', group: 'mp_fees', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'compensation', title: 'Компенсации', group: 'mp_income', inProfit: true, expectedSign: 1, hasQty: false },
  { code: 'ads', title: 'Реклама', group: 'ads', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'cogs', title: 'Себестоимость', group: 'own', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'tax', title: 'Налог', group: 'own', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'opex', title: 'Прочие расходы', group: 'own', inProfit: true, expectedSign: -1, hasQty: false },
  { code: 'unclassified', title: 'Неразобранное', group: 'unclassified', inProfit: true, expectedSign: 0, hasQty: false },
  { code: 'ads_settled', title: 'Реклама по взаиморасчётам', group: 'control', inProfit: false, expectedSign: -1, hasQty: false },
  { code: 'ads_bonus', title: 'Бонусы на рекламу', group: 'control', inProfit: false, expectedSign: -1, hasQty: false },
  { code: 'rlz_revenue', title: 'Выручка по отчёту о реализации', group: 'control', inProfit: false, expectedSign: 1, hasQty: true },
  { code: 'rlz_returns', title: 'Возвраты по отчёту о реализации', group: 'control', inProfit: false, expectedSign: -1, hasQty: true },
  { code: 'rlz_commission', title: 'Комиссия по отчёту о реализации', group: 'control', inProfit: false, expectedSign: -1, hasQty: false },
  { code: 'rlz_topup', title: 'Доплаты по отчёту о реализации', group: 'control', inProfit: false, expectedSign: 1, hasQty: false },
  { code: 'ordered', title: 'Заказано', group: 'measure', inProfit: false, expectedSign: 1, hasQty: true },
  { code: 'views', title: 'Показы', group: 'measure', inProfit: false, expectedSign: 1, hasQty: true },
  { code: 'cart_adds', title: 'Добавления в корзину', group: 'measure', inProfit: false, expectedSign: 1, hasQty: true },
];

export const LINE_BY_CODE: Readonly<Record<LineCode, LineDef>> = Object.fromEntries(
  LINES.map((l) => [l.code, l]),
) as Record<LineCode, LineDef>;

const CODE_SET: ReadonlySet<string> = new Set(LINES.map((l) => l.code));

export function isLineCode(s: string): s is LineCode {
  return CODE_SET.has(s);
}

export const PROFIT_LINES: readonly LineCode[] = LINES.filter((l) => l.inProfit).map((l) => l.code);

export const MP_FEE_LINES: readonly LineCode[] = LINES.filter((l) => l.group === 'mp_fees').map((l) => l.code);
