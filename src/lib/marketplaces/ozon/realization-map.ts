// PURPOSE: Чистый маппинг строки отчёта о реализации Ozon v2 → колонки
// `ozon_realization`. Без db/React — поэтому его же импортирует диагностический
// скрипт `scripts/test-ozon-realization.ts` и сверяет суммы с `ozon_transactions`.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Это деньги: если маппинг живёт внутри `insertRealizationBatch`,
// проверить его можно только записью в БД. Вынесенная pure-функция позволяет
// прогнать её по живому ответу API и сравнить итоги с независимым источником,
// НЕ трогая продовую таблицу.
//
// ЭКОНОМИКА СТРОКИ (сверено с живым ответом, июль 2026):
//
//   seller_price_per_instance × quantity   цена продавца (его скидки уже учтены)
//     = amount                             сумма реализации (заплатил покупатель)
//     + bonus                              баллы за скидки — компенсирует Ozon
//     + compensation                       доплата за счёт Ozon
//     + bank_coinvestment                  «зелёные цены» (соинвестирование банка)
//     + stars                              баллы за отзывы
//     + pick_up_point_coinvestment         выплаты ПВЗ
//   total = (всё перечисленное) − standard_fee − commission   ИТОГО К НАЧИСЛЕНИЮ
//
// Пример реальной строки: 6487 = 3706.52 + 2743.41 + 37.07; standard_fee 2659.67
// (ровно commission_ratio 0.41 × 6487); total 3827.33 = 6487 − 2659.67.
//
// ПОЧЕМУ gross СЧИТАЕТСЯ ОТ `total`, А НЕ СУММОЙ КОМПОНЕНТОВ.
// Ozon доносит новые виды выплат (`pick_up_point_coinvestment` появился позже
// `bank_coinvestment`). Такое поле сразу попадает в `total`, но в нашу сумму
// компонентов — только после правки кода. `gross = total + вознаграждение`
// не «протухает» от новых полей, а инвариант gross − commission = total
// выполняется по построению. Сумма компонентов при этом считается тоже — как
// контрольная: расхождение больше `MISMATCH_TOLERANCE_RUB` означает, что форма
// ответа снова изменилась, и стейдж обязан сказать об этом вслух.

import { rublesToKopecks } from '@/lib/stock/money';
import type { RealizationCommission, RealizationRow } from './types';

/**
 * Порог расхождения «total + вознаграждение» против суммы компонентов выплат,
 * рубли. 1 ₽ — запас на копеечные округления Ozon внутри строки.
 */
export const MISMATCH_TOLERANCE_RUB = 1;

export type RealizationRowPlan = {
  sku: string | null;
  offerId: string | null;
  /** Реализовано минус возвращено, штук. Может быть отрицательным. */
  qty: number;
  /** Выручка продавца до вознаграждения Ozon, копейки. */
  grossKopecks: number;
  /** Фактическое удержание Ozon (standard_fee + commission), копейки. */
  commissionKopecks: number;
  /** Итого к начислению по строке = gross − commission, копейки. Для сверки. */
  netKopecks: number;
  /** |gross − сумма компонентов выплат| в рублях. > порога = форма изменилась. */
  residualRub: number;
};

/**
 * Единственный парсер денег проекта (`src/lib/stock/money.ts`) принимает строку —
 * он писался под пользовательский ввод. Числа из API прогоняем через него же,
 * чтобы округление «рубли → копейки» жило в одном месте, а не расползалось по
 * доменам. Округление выполняется ОДИН раз, на границе: суммы складываются в
 * рублях (как их прислал Ozon) и конвертируются только на выходе.
 */
function toKopecks(rubles: number): number {
  if (!Number.isFinite(rubles)) return 0;
  return rublesToKopecks(String(rubles));
}

function num(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Вознаграждение Ozon по блоку, рубли. */
function feeRub(c: RealizationCommission): number {
  // `standard_fee` — базовое вознаграждение (в живом ответе именно оно ненулевое
  // и ровно равно commission_ratio × цену продавца). `commission` — вознаграждение
  // «с учётом скидок и наценок»; у обычных строк 0, но если Ozon его заполнит,
  // это тоже удержание, поэтому суммируем оба, а не выбираем одно.
  return num(c.standard_fee) + num(c.commission);
}

/** Выручка продавца по блоку, рубли: «итого к начислению» + вознаграждение. */
function grossRub(c: RealizationCommission): number {
  return num(c.total) + feeRub(c);
}

/** Контрольная сумма выплат: сумма всех известных компонентов выручки, рубли. */
function partsRub(c: RealizationCommission): number {
  return (
    num(c.amount) +
    num(c.bonus) +
    num(c.compensation) +
    num(c.bank_coinvestment) +
    num(c.stars) +
    num(c.pick_up_point_coinvestment)
  );
}

/**
 * Строка отчёта → значения колонок `ozon_realization`.
 *
 * ВОЗВРАТЫ СХЛОПНУТЫ В ТУ ЖЕ СТРОКУ, СО ЗНАКОМ «МИНУС». Обоснование: Ozon отдаёт
 * `delivery_commission` и `return_commission` как два блока ОДНОЙ строки по одному
 * SKU, а у таблицы естественный ключ (account, period, sku) и нет колонки «тип
 * движения». Разложить их в две записи — значит задвоить ключ и сломать сверку
 * «сколько строк в отчёте — столько в БД». Поэтому в колонках лежит НЕТТО-реализация
 * (возврат уменьшает и qty, и выручку, и удержанное вознаграждение — Ozon возвращает
 * вознаграждение вместе с товаром), а оба блока целиком сохраняются в `raw`,
 * так что валовые и возвратные суммы пересчитываются задним числом без ресинка.
 */
export function mapRealizationRow(row: RealizationRow): RealizationRowPlan {
  const delivery = row.delivery_commission ?? null;
  const ret = row.return_commission ?? null;

  const qty = (delivery ? num(delivery.quantity) : 0) - (ret ? num(ret.quantity) : 0);
  const gross = (delivery ? grossRub(delivery) : 0) - (ret ? grossRub(ret) : 0);
  const fee = (delivery ? feeRub(delivery) : 0) - (ret ? feeRub(ret) : 0);
  const parts = (delivery ? partsRub(delivery) : 0) - (ret ? partsRub(ret) : 0);

  const skuRaw = row.item?.sku;
  const sku =
    skuRaw === undefined || skuRaw === null || skuRaw === '' ? null : String(skuRaw);
  const offerId = row.item?.offer_id ? row.item.offer_id : null;

  const grossKopecks = toKopecks(gross);
  const commissionKopecks = toKopecks(fee);

  return {
    sku,
    offerId,
    qty,
    grossKopecks,
    commissionKopecks,
    netKopecks: grossKopecks - commissionKopecks,
    residualRub: Math.abs(gross - parts),
  };
}
