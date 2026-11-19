// PURPOSE: Чистый маппинг начислений Ozon `/v1/finance/accrual/by-day` и
// справочника `/v1/finance/accrual/types` в строки ozon_accruals /
// ozon_accrual_types, нарезка окна синка на дни и решение «можно ли заменять
// окно дня». Без импорта db и клиента — тестируется офлайн
// (scripts/test-ozon-accruals-map.ts).
//
// ФОРМА ОТВЕТА — ПО ЖИВОМУ ОТВЕТУ (2026-11-19; справочник seller-api-docs.md тут
// устарел и врёт): `{ accruals: [...], last_id }`, одностраничный день → last_id "".
//  - начисление: `accrual_id` (число, устойчивый), `date`, `total_amount`,
//    `unit_number`, `accrued_category` ITEM | NON_ITEM | POSTING, и ровно ОДИН
//    из блоков `item_fees` / `non_item_fee` / `posting` (остальные null).
//  - ВЕРХНЕГО `type_id` НЕТ. Тип живёт в строках: item_fees.fees[].fees[].type_id,
//    non_item_fee.type_id, posting.products[].delivery.services[].type_id.
//  - ITEM: `item_fees.fees[{sku, quantity, fees[{type_id, accrued}]}]`.
//  - POSTING: `unit_number` = номер отправления; `products[{sku, quantity,
//    delivery{total_accrued, services[]}, commission{...}}]`. `commission_ratio`
//    приходит строкой вида `value:"0.51"` — не число, не парсим (остаётся в raw).
//  - СВЕРКА с total_amount (проверено на примерах): ITEM = сумма item_fee;
//    NON_ITEM = non_item_fee; POSTING = sale_amount + commission + delivery_total
//    (delivery_total = сумма delivery_service; sale_commission == commission,
//    а bonus/coinvestment в итог НЕ входят — это справочные компоненты,
//    их складывать с остальным нельзя). Расхождение — не ошибка, а problems.
//  - Деньги: `amount` — СТРОКА со знаком.
// ЧЕГО ПО-ПРЕЖНЕМУ НЕ ЗНАЕМ: полный набор значений accrued_category, зону `date`,
// есть ли у других POSTING (возвраты) иная арифметика итога.

import type { NewOzonAccrual, OzonAccrualLineKind } from '@/lib/db/schema/marketplaces';
import {
  addDays,
  addMonths,
  diffDays,
  eachDay,
  isIsoDate,
  monthOf,
} from '@/lib/metrics/period';
import {
  AccrualByDayResponseSchema,
  AccrualTypesResponseSchema,
  type AccrualByDay,
} from './types';

export type AccrualInsert = NewOzonAccrual;

/** Самая ранняя дата by-day (справочник). */
export const ACCRUAL_EARLIEST_DATE = '2022-01-01';
/** Предохранитель длины окна (дней). Больше — догружать кусками. */
export const MAX_ACCRUAL_WINDOW_DAYS = 400;
/** Предохранитель пагинации одного дня. */
export const MAX_ACCRUAL_PAGES_PER_DAY = 500;

// ---- Числа ----------------------------------------------------------------

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;

/**
 * Сумма Ozon → копейки, точно (без float): «-1234.565» → -123457.
 * Третий и далее знаки округляются половиной от нуля. Число тоже принимается
 * и идёт через ту же строковую ветку (String(-1234.565) = «-1234.565» →
 * -123457, а не Math.round(-123456.5) = -123456): одно правило для обоих типов.
 * Мусор/пусто/null → null (НЕ 0): вызывающий решает, что это ошибка.
 */
export function parseAmountKopecks(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    // String() даёт кратчайшую точную десятичную запись; экспоненту (1e21,
    // 1e-7) DECIMAL_RE не примет → null, что для копеек и верно.
    return parseAmountKopecks(String(v));
  }
  if (typeof v !== 'string') return null;
  const m = DECIMAL_RE.exec(v.trim());
  if (!m) return null;
  const neg = m[1] === '-';
  const intPart = Number(m[2]);
  const frac = m[3] ?? '';
  let kop = intPart * 100 + Number((frac + '00').slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) kop += 1;
  if (!Number.isSafeInteger(kop)) return null;
  return neg && kop !== 0 ? -kop : kop;
}

/** Целое из number | digit-string (int64 у grpc-gateway — строкой). null = мусор. */
export function parseIntId(v: unknown, min: number): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) n = Number(v.trim());
  else return null;
  return Number.isSafeInteger(n) && n >= min ? n : null;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// ---- Окно синка -------------------------------------------------------------

export type AccrualWindowPlan = {
  /** Дни к загрузке, от НОВЫХ к старым (свежие данные — первыми). */
  days: string[];
  from: string | null;
  to: string | null;
  /** Замечания для StageResult.warnings (урезание, сдвиг границ). */
  problems: string[];
  /** Неисправимая ошибка входа (битые даты) — стейдж не запускается. */
  error?: string;
};

/**
 * Окно стейджа начислений. По умолчанию — с первого числа ПОЗАПРОШЛОГО месяца
 * по сегодня (МСК): ровно три месяца, которые пересобирает слой метрик
 * (METRICS_LAYER_DESIGN §7 «Покрытие сырья»). Override — включительно, МСК.
 * by-day принимает одну дату, поэтому «нарезка на допустимые интервалы» —
 * это список дней; будущие дни и дни раньше 2022-01-01 отсекаются.
 */
export function planAccrualWindow(args: {
  todayMsk: string;
  overrideFrom?: string;
  overrideTo?: string;
}): AccrualWindowPlan {
  const problems: string[] = [];
  if (!isIsoDate(args.todayMsk)) {
    return { days: [], from: null, to: null, problems, error: `Некорректная текущая дата «${args.todayMsk}»` };
  }
  let from: string;
  let to: string;
  if (args.overrideFrom || args.overrideTo) {
    if (!isIsoDate(args.overrideFrom) || !isIsoDate(args.overrideTo)) {
      return {
        days: [],
        from: null,
        to: null,
        problems,
        error: `Диапазон начислений задан не полностью или с ошибкой: «${args.overrideFrom ?? ''}»..«${args.overrideTo ?? ''}»`,
      };
    }
    from = args.overrideFrom;
    to = args.overrideTo;
    if (from > to) {
      return { days: [], from: null, to: null, problems, error: `Начало диапазона ${from} позже конца ${to}` };
    }
  } else {
    from = addMonths(monthOf(args.todayMsk), -2);
    to = args.todayMsk;
  }
  if (to > args.todayMsk) {
    problems.push(`Начисления: конец диапазона ${to} в будущем — урезан до ${args.todayMsk}`);
    to = args.todayMsk;
  }
  if (from < ACCRUAL_EARLIEST_DATE) {
    problems.push(
      `Начисления: Ozon отдаёт by-day не раньше ${ACCRUAL_EARLIEST_DATE} — начало ${from} сдвинуто`,
    );
    from = ACCRUAL_EARLIEST_DATE;
  }
  if (from > to) {
    problems.push(`Начисления: после урезания диапазон пуст (${from}..${to})`);
    return { days: [], from, to, problems };
  }
  const span = diffDays(from, to) + 1;
  if (span > MAX_ACCRUAL_WINDOW_DAYS) {
    const newFrom = addDays(to, -(MAX_ACCRUAL_WINDOW_DAYS - 1));
    problems.push(
      `Начисления: диапазон ${span} дн. больше лимита ${MAX_ACCRUAL_WINDOW_DAYS} — загружены ${newFrom}..${to}, ` +
        `раннюю часть догрузите отдельным запуском`,
    );
    from = newFrom;
  }
  const days = eachDay({ fromDate: from, toDateExclusive: addDays(to, 1) }).reverse();
  return { days, from, to, problems };
}

// ---- Пагинация by-day -------------------------------------------------------

export type LastIdPage<T> = {
  items: T[];
  lastId: string;
  /** false — форма ответа не та: выборка не может считаться полной. */
  shapeOk: boolean;
  problems: string[];
};

/**
 * Пагинация по `last_id` с инъекцией `fetchPage` (чистая). Первый запрос —
 * `last_id: ''`. Признака последней страницы справочник не описывает, поэтому
 * конец — пустая страница или пустой `last_id`. `complete=false` (форма не та,
 * `last_id` не сдвинулся, лимит страниц) — окно дня заменять НЕЛЬЗЯ.
 */
export async function collectLastIdPages<T>(opts: {
  label: string;
  maxPages: number;
  fetchPage: (lastId: string) => Promise<unknown>;
  parse: (data: unknown) => LastIdPage<T>;
}): Promise<{ items: T[]; shapeOk: boolean; complete: boolean; pages: number; warnings: string[] }> {
  const items: T[] = [];
  const warnings: string[] = [];
  let lastId = '';
  for (let page = 0; page < opts.maxPages; page += 1) {
    const parsed = opts.parse(await opts.fetchPage(lastId));
    warnings.push(...parsed.problems);
    if (!parsed.shapeOk) return { items, shapeOk: false, complete: false, pages: page + 1, warnings };
    if (parsed.items.length === 0) return { items, shapeOk: true, complete: true, pages: page + 1, warnings };
    items.push(...parsed.items);
    if (!parsed.lastId) return { items, shapeOk: true, complete: true, pages: page + 1, warnings };
    if (parsed.lastId === lastId) {
      warnings.push(`${opts.label}: last_id не изменился (${lastId}) — выборка неполная`);
      return { items, shapeOk: true, complete: false, pages: page + 1, warnings };
    }
    lastId = parsed.lastId;
  }
  warnings.push(`${opts.label}: достигнут лимит ${opts.maxPages} страниц — выборка неполная`);
  return { items, shapeOk: true, complete: false, pages: opts.maxPages, warnings };
}

/** Одна страница by-day: валидация схемой + last_id. */
export function parseAccrualByDayPage(data: unknown): LastIdPage<AccrualByDay> {
  const parsed = AccrualByDayResponseSchema.safeParse(data);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`)
      .join('; ');
    return {
      items: [],
      lastId: '',
      shapeOk: false,
      problems: [`/v1/finance/accrual/by-day: ответ не прошёл схему (${summary})`],
    };
  }
  return {
    items: parsed.data.accruals,
    lastId: parsed.data.last_id ?? '',
    shapeOk: true,
    problems: [],
  };
}

// ---- Маппинг дня ------------------------------------------------------------

export type AccrualDayMapping = {
  rows: AccrualInsert[];
  accrualCount: number;
  /** Некритичные замечания (null-сумма услуги, чужая валюта). */
  problems: string[];
  /** Ключевое поле не разобрано — день НЕ заменяется. */
  fatal: string[];
};

const COMMISSION_PARTS: ReadonlyArray<{
  field: 'sale_amount' | 'commission' | 'sale_commission' | 'bonus' | 'coinvestment';
  kind: OzonAccrualLineKind;
}> = [
  { field: 'sale_amount', kind: 'commission_sale_amount' },
  { field: 'commission', kind: 'commission_commission' },
  { field: 'sale_commission', kind: 'commission_sale_commission' },
  { field: 'bonus', kind: 'commission_bonus' },
  { field: 'coinvestment', kind: 'commission_coinvestment' },
];
// `sale_price` / `seller_price` — цены, а не начисления: строками не пишутся,
// остаются в raw строки `total`. `commission_ratio` — доля, тоже в raw.

const MAX_PROBLEMS = 20;
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(['ITEM', 'NON_ITEM', 'POSTING']);

/**
 * Канонический набор видов строк, из которых складывается `total_amount`
 * (см. шапку файла). НЕ входят: delivery_service (раскладка delivery_total),
 * commission_sale_commission (повторяет commission_commission), а также
 * commission_bonus / commission_coinvestment (справочные, вне итога).
 */
export const TOTAL_COMPOSING_KINDS: ReadonlySet<OzonAccrualLineKind> = new Set<OzonAccrualLineKind>([
  'item_fee',
  'non_item_fee',
  'commission_sale_amount',
  'commission_commission',
  'delivery_total',
]);

/** Пары видов, дублирующих друг друга: вместе в одной сумме задваивают. */
const OVERLAPPING_PAIRS: ReadonlyArray<readonly [OzonAccrualLineKind, OzonAccrualLineKind]> = [
  ['delivery_service', 'delivery_total'],
  ['commission_commission', 'commission_sale_commission'],
];

/**
 * Бросает, если запрошенные виды пересекаются по смыслу: `total` с чем угодно
 * ещё (итог уже включает составляющие), delivery_service + delivery_total,
 * commission_commission + commission_sale_commission. Составляющие итога —
 * `TOTAL_COMPOSING_KINDS`; commission_bonus / commission_coinvestment В ИТОГ НЕ
 * ВХОДЯТ (справочные), их читают отдельным запросом.
 */
export function assertNonOverlappingKinds(kinds: readonly OzonAccrualLineKind[]): void {
  const set = new Set(kinds);
  if (set.has('total') && set.size > 1) {
    throw new Error(
      `sumOzonAccruals: 'total' нельзя суммировать с другими видами (${kinds.join(', ')}); ` +
        `составляющие итога: ${Array.from(TOTAL_COMPOSING_KINDS).join(', ')}`,
    );
  }
  for (const [a, b] of OVERLAPPING_PAIRS) {
    if (set.has(a) && set.has(b)) {
      throw new Error(`sumOzonAccruals: виды ${a} и ${b} дублируют друг друга — задвоение суммы`);
    }
  }
}

/**
 * Начисления одного дня → строки ozon_accruals. `seq` — позиция начисления в
 * выдаче дня, `line_no` — позиция строки в начислении (0 = `total`).
 * Битое ключевое поле (сумма, type_id, sku) → `fatal`, начисление не пишется,
 * а вызывающий не заменяет окно дня: старые строки дня остаются.
 */
export function mapAccrualDay(args: {
  tenantId: string;
  accountId: string;
  day: string;
  accruals: AccrualByDay[];
  offerBySku: Map<string, string>;
}): AccrualDayMapping {
  const rows: AccrualInsert[] = [];
  const problems: string[] = [];
  const fatal: string[] = [];
  const foreignCurrencies = new Set<string>();
  const note = (list: string[], msg: string) => {
    if (list.length < MAX_PROBLEMS) list.push(msg);
  };

  // seq = позиция в выдаче дня, ОТСОРТИРОВАННОЙ по accrual_id: ключ строки
  // (account, date, seq, line_no) не зависит от порядка/страниц, в котором
  // Ozon отдал начисления, а повторный синк даёт те же ключи. Без accrual_id
  // (нет поля) — прежний порядок выдачи (sort стабилен).
  const sorted = args.accruals
    .map((a, i) => ({ a, i, id: parseIntId(a.accrual_id, 0) }))
    .sort((x, y) => (x.id ?? Infinity) - (y.id ?? Infinity) || x.i - y.i);

  // Дубли accrual_id (например, начисление на стыке страниц): то же тело —
  // отбрасываем с предупреждением; другое тело при том же id — fatal (день не
  // перезаписывается: непонятно, какой вариант верный).
  const ordered: typeof sorted = [];
  for (const cur of sorted) {
    const prev = ordered[ordered.length - 1];
    if (cur.id !== null && prev && prev.id === cur.id) {
      if (JSON.stringify(prev.a) === JSON.stringify(cur.a)) {
        note(problems, `${args.day}: accrual_id ${cur.id} повторён с теми же данными — дубль отброшен`);
      } else {
        note(fatal, `${args.day}: accrual_id ${cur.id} повторён с РАЗНЫМИ данными`);
      }
      continue;
    }
    ordered.push(cur);
  }

  ordered.forEach(({ a, id: accrualId }, seq) => {
    const where = `${args.day} #${seq}`;
    const accrualFatal: string[] = [];
    const lines: AccrualInsert[] = [];
    if (a.accrued_category && !KNOWN_CATEGORIES.has(a.accrued_category)) {
      note(problems, `${where}: неизвестный accrued_category «${a.accrued_category}» — строки записаны, сверка с total не гарантирована`);
    }
    if ((a as Record<string, unknown>).container_fees != null) {
      note(problems, `${where}: container_fees не пуст — не разбирается, в строки не попал`);
    }
    const category = nonEmpty(a.accrued_category);
    const unitNumber = nonEmpty(a.unit_number);
    const deliverySchema = nonEmpty(a.posting?.delivery_schema);
    const ozonDate = nonEmpty(a.date);

    const push = (
      kind: OzonAccrualLineKind,
      money: { amount: unknown; currency?: string | null },
      opts: {
        feeTypeId?: number | null;
        sku?: string | null;
        qty?: number | null;
        raw?: Record<string, unknown>;
      },
      label: string,
    ) => {
      const kop = parseAmountKopecks(money.amount);
      if (kop === null) {
        accrualFatal.push(`${where}: ${label}.amount «${String(money.amount)}» не сумма`);
        return;
      }
      // Верхний регистр — чтобы фильтр потребителей `currency IS NULL OR
      // currency = 'RUB'` (accruals-read.ts) не зависел от написания.
      const currency = nonEmpty(money.currency)?.toUpperCase() ?? null;
      if (currency && currency !== 'RUB') foreignCurrencies.add(currency);
      const sku = opts.sku ?? null;
      lines.push({
        tenantId: args.tenantId,
        accountId: args.accountId,
        accrualDate: args.day,
        seq,
        lineNo: lines.length,
        lineKind: kind,
        // Верхнего type_id у начисления нет (живой ответ). accrual_type_id —
        // NOT NULL, схему не меняем, поэтому: у строки со своим типом сбора
        // (item_fee / non_item_fee / delivery_service) он равен fee_type_id,
        // у остальных (total, commission_*, delivery_total) — 0 (sentinel
        // «тип не определён»; в справочнике типов id 0 нет, он начинается с 1).
        // Потребителям различать виды по line_kind + fee_type_id, а не по этой колонке.
        accrualTypeId: opts.feeTypeId ?? 0,
        accrualId,
        feeTypeId: opts.feeTypeId ?? null,
        accruedCategory: category,
        unitNumber,
        // unit_number категории POSTING — номер отправления («0164135132-0133-5»).
        // Для ITEM/NON_ITEM это иной идентификатор — posting_number не заполняем.
        postingNumber: category === 'POSTING' ? unitNumber : null,
        sku,
        offerId: sku ? (args.offerBySku.get(sku) ?? null) : null,
        qty: opts.qty ?? null,
        amountKopecks: kop,
        currency,
        ozonDate,
        deliverySchema,
        raw: opts.raw ?? {},
      });
    };

    // line_no = 0 — итог начисления, raw = весь объект.
    push('total', a.total_amount, { raw: a as unknown as Record<string, unknown> }, 'total_amount');

    for (const [g, group] of (a.item_fees?.fees ?? []).entries()) {
      const sku = parseIntId(group.sku, 1);
      if (sku === null) {
        accrualFatal.push(`${where}: item_fees.fees[${g}].sku «${String(group.sku)}» не sku`);
        continue;
      }
      const groupQty = parseIntId(group.quantity, 0);
      for (const [f, fee] of group.fees.entries()) {
        // min 1: 0 зарезервирован как sentinel «нет типа» в accrual_type_id
        const feeType = parseIntId(fee.type_id, 1);
        if (feeType === null) {
          accrualFatal.push(`${where}: item_fees.fees[${g}].fees[${f}].type_id не целое`);
          continue;
        }
        push('item_fee', fee.accrued, { feeTypeId: feeType, sku: String(sku), qty: groupQty }, `item_fees.fees[${g}].fees[${f}].accrued`);
      }
    }

    if (a.non_item_fee) {
      const feeType = parseIntId(a.non_item_fee.type_id, 1);
      if (feeType === null) accrualFatal.push(`${where}: non_item_fee.type_id не целое`);
      else push('non_item_fee', a.non_item_fee.accrued, { feeTypeId: feeType }, 'non_item_fee.accrued');
    }

    for (const [p, product] of (a.posting?.products ?? []).entries()) {
      const sku = parseIntId(product.sku, 1);
      if (sku === null) {
        accrualFatal.push(`${where}: posting.products[${p}].sku «${String(product.sku)}» не sku`);
        continue;
      }
      const skuStr = String(sku);
      const qty = parseIntId(product.quantity, 0);
      const commission = product.commission;
      if (commission) {
        for (const part of COMMISSION_PARTS) {
          const money = commission[part.field];
          if (money) push(part.kind, money, { sku: skuStr, qty }, `posting.products[${p}].commission.${part.field}`);
        }
      }
      for (const [s, svc] of (product.delivery?.services ?? []).entries()) {
        const feeType = parseIntId(svc.type_id, 1);
        if (feeType === null) {
          accrualFatal.push(`${where}: posting.products[${p}].delivery.services[${s}].type_id не целое`);
          continue;
        }
        if (svc.accrued.amount === null) {
          // В примере справочника здесь именно null. Не 0: строку не пишем.
          note(problems, `${where}: delivery.services[${s}] (sku ${skuStr}, type ${feeType}) без суммы — строка пропущена`);
          continue;
        }
        push(
          'delivery_service',
          { amount: svc.accrued.amount, currency: svc.accrued.currency },
          { feeTypeId: feeType, sku: skuStr, qty },
          `posting.products[${p}].delivery.services[${s}].accrued`,
        );
      }
      const total = product.delivery?.total_accrued;
      if (total) push('delivery_total', total, { sku: skuStr, qty }, `posting.products[${p}].delivery.total_accrued`);
    }

    if (accrualFatal.length > 0) {
      for (const f of accrualFatal) note(fatal, f);
      return;
    }
    // Сверка: строки-составляющие должны давать total_amount (не фатально —
    // у возвратов арифметика может отличаться; просто видно в warnings).
    const totalRow = lines[0];
    const composed = lines.reduce(
      (acc, l) => (TOTAL_COMPOSING_KINDS.has(l.lineKind) ? acc + l.amountKopecks : acc),
      0,
    );
    if (totalRow && composed !== totalRow.amountKopecks) {
      note(
        problems,
        `${where} (${category ?? '?'}): строки дают ${composed} коп., total_amount ${totalRow.amountKopecks} коп. — не сходится`,
      );
    }
    rows.push(...lines);
  });

  if (foreignCurrencies.size > 0) {
    note(
      problems,
      `${args.day}: начисления в валюте ${Array.from(foreignCurrencies).join(', ')} — суммы записаны как есть, без пересчёта; ` +
        'в рублёвые суммы (sumOzonAccruals) они не попадают',
    );
  }
  return { rows, accrualCount: args.accruals.length, problems, fatal };
}

// ---- Решение о замене окна --------------------------------------------------

/**
 * Можно ли заменить окно «аккаунт × день»: только полная выборка (вся
 * пагинация пройдена, форма верна) без фатальных ошибок маппинга. Иначе
 * старые строки дня остаются, а причина уходит в StageResult.error.
 */
export function decideAccrualDayWrite(args: {
  complete: boolean;
  shapeOk: boolean;
  fatal: string[];
}): { replace: true } | { replace: false; reason: string } {
  if (!args.shapeOk) return { replace: false, reason: 'ответ не прошёл схему' };
  if (!args.complete) return { replace: false, reason: 'выборка неполная (пагинация оборвана)' };
  if (args.fatal.length > 0) {
    return { replace: false, reason: `не разобраны ключевые поля: ${args.fatal.slice(0, 3).join('; ')}` };
  }
  return { replace: true };
}

// ---- Ключи ------------------------------------------------------------------

/** Окно идемпотентности: всё, что синк заменяет одной транзакцией. */
export function accrualWindowKey(accountId: string, day: string): string {
  return `${accountId}|${day}`;
}

/** Ключ строки внутри окна (= уникальный индекс ozon_accruals). */
export function accrualRowKey(r: Pick<AccrualInsert, 'accountId' | 'accrualDate' | 'seq' | 'lineNo'>): string {
  return `${r.accountId}|${r.accrualDate}|${r.seq}|${r.lineNo}`;
}

/**
 * Ключи для журнала слоя метрик (fin_entries, source_kind='ozon_accrual').
 * Документ — начисление (`acc:<accrual_id>`, устойчиво между синками; без
 * accrual_id — `день:seq`, устойчиво лишь в пределах выгрузки дня), часть —
 * строка разбивки. Слой пересобирает месяц целиком (§7).
 */
export function accrualSourceRef(day: string, seq: number, accrualId?: number | null): string {
  // accrual_id устойчив между синками; day:seq — запасной вариант без него.
  return accrualId != null ? `acc:${accrualId}` : `${day}:${seq}`;
}

export function accrualSourcePart(r: Pick<AccrualInsert, 'lineKind' | 'lineNo' | 'sku'>): string {
  return r.sku ? `${r.lineKind}:${r.lineNo}/sku:${r.sku}` : `${r.lineKind}:${r.lineNo}`;
}

// ---- Справочник типов -------------------------------------------------------

export type AccrualTypeRow = {
  typeId: number;
  name: string;
  description: string | null;
  raw: Record<string, unknown>;
};

/** Ответ /v1/finance/accrual/types → строки справочника. */
export function mapAccrualTypes(data: unknown): {
  rows: AccrualTypeRow[];
  shapeOk: boolean;
  problems: string[];
} {
  const parsed = AccrualTypesResponseSchema.safeParse(data);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`)
      .join('; ');
    return {
      rows: [],
      shapeOk: false,
      problems: [`/v1/finance/accrual/types: ответ не прошёл схему (${summary})`],
    };
  }
  const problems: string[] = [];
  const byId = new Map<number, AccrualTypeRow>();
  let skipped = 0;
  for (const t of parsed.data.accrual_types) {
    const typeId = parseIntId(t.id, 0);
    const name = t.name.trim();
    if (typeId === null || !name) {
      skipped += 1;
      continue;
    }
    byId.set(typeId, {
      typeId,
      name,
      description: nonEmpty(t.description),
      raw: t as unknown as Record<string, unknown>,
    });
  }
  if (skipped > 0) problems.push(`/v1/finance/accrual/types: ${skipped} типов без id/названия пропущено`);
  return { rows: Array.from(byId.values()), shapeOk: true, problems };
}
