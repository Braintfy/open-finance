// PURPOSE: Оффлайн smoke-тесты маппинга отправлений Ozon (/v4/posting/fbs/list,
// /v3/posting/fbo/list) в строки ozon_orders и cursor-пагинации. Фикстуры —
// примеры ответов из справочника seller-api-docs.md (без сети и БД).
// Запуск: pnpm tsx scripts/test-ozon-orders-map.ts

import {
  forEachPostingPage,
  mapFboPosting,
  mapFbsPosting,
  moneyToAmountString,
  parseIntLike,
  splitDateWindow,
} from '../src/lib/marketplaces/ozon/orders-map';
import {
  FboPostingsResponseSchema,
  FbsPostingsResponseSchema,
  PostingItemSchema,
} from '../src/lib/marketplaces/ozon/types';

let failed = 0;
let passed = 0;
function expect(cond: boolean, name: string, hint?: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${hint ? ' — ' + hint : ''}`);
  }
}

// Пример ответа /v4/posting/fbs/list из справочника (сокращён до используемых полей).
const FBS_RESPONSE = {
  has_next: true,
  cursor: 'eyJmaWVsZHMiOlt7Im5hbWUiOiJvc3AuaW5fcHJvY2Vzc19hdCJ9XX0=',
  postings: [
    {
      posting_number: '41517061-0214-1',
      order_id: 34953320005,
      order_number: '41517061-0214',
      status: 'awaiting_deliver',
      in_process_at: '2026-05-04T06:44:37Z',
      shipment_date: '2026-05-05T06:44:37Z',
      delivering_date: null,
      cancellation: {
        cancel_reason_id: 0,
        cancel_reason: '',
        cancellation_type: '',
        cancelled_after_ship: false,
        cancellation_initiator: '',
      },
      products: [
        {
          offer_id: 'S5200657-28',
          name: 'Кроссовки для мальчика',
          sku: 4116250392,
          quantity: 1,
          price: { amount: '300', currency: 'RUB' },
        },
      ],
      analytics_data: { warehouse_id: 20605650762000, warehouse: '17023' },
    },
  ],
};

// Пример ответа /v3/posting/fbo/list из справочника (сокращён).
const FBO_RESPONSE = {
  has_next: true,
  cursor: 'eyJpdiI6IjUzUUhVeDlGZ0p3PT0iLCJ2YWx1ZSI6IlVxIn0=',
  postings: [
    {
      order_id: 123456789,
      order_number: '12345-1',
      posting_number: '42776709-0200-5',
      status: 'awaiting_packaging',
      created_at: '2026-02-08T13:56:07.751Z',
      in_process_at: '2026-02-08T13:56:07.751Z',
      products: [
        { sku: 123456, name: 'Смартфон', quantity: 1, offer_id: 'SM-A54', price: '29990.00', currency: 'RUB' },
        { sku: 789012, name: 'Чехол', quantity: 2, offer_id: 'CASE-A54', price: '890.00', currency: 'RUB' },
      ],
      cancellation: { cancel_reason: 'Отмена', cancellation_type: 'customer' },
    },
  ],
};

async function collect(pages: Array<Record<string, unknown>>) {
  const cursors: string[] = [];
  const got: string[] = [];
  let i = 0;
  const r = await forEachPostingPage<string>(
    async (cursor) => {
      cursors.push(cursor);
      return pages[i++] as never;
    },
    async (ps) => {
      got.push(...ps);
    },
  );
  return { cursors, got, pages: r.pages };
}

async function rejects(pages: Array<Record<string, unknown>>, re: RegExp): Promise<boolean> {
  try {
    await collect(pages);
    return false;
  } catch (e) {
    return re.test((e as Error).message);
  }
}

async function main() {
  console.log('— схемы принимают примеры справочника (delivering_date: null)');
  const fbsParsed = FbsPostingsResponseSchema.safeParse(FBS_RESPONSE);
  expect(fbsParsed.success, 'FBS v4 пример проходит схему', fbsParsed.success ? '' : fbsParsed.error.message);
  const fboParsed = FboPostingsResponseSchema.safeParse(FBO_RESPONSE);
  expect(fboParsed.success, 'FBO v3 пример проходит схему', fboParsed.success ? '' : fboParsed.error.message);
  expect(
    !FbsPostingsResponseSchema.safeParse({ result: { postings: [], has_next: false } }).success,
    'старая форма {result:{postings}} схемой отвергается',
  );
  const noPrice = structuredClone(FBO_RESPONSE) as unknown as {
    postings: Array<{ products: Array<Record<string, unknown>> }>;
  };
  delete noPrice.postings[0].products[0].price;
  expect(!FboPostingsResponseSchema.safeParse(noPrice).success, 'товар без price схемой отвергается');

  console.log('— маппинг FBS');
  const fbs = mapFbsPosting(FBS_RESPONSE.postings[0] as never);
  expect(fbs.ok === true, 'FBS маппится');
  if (fbs.ok) {
    expect(fbs.order.scheme === 'fbs' && fbs.order.postingNumber === '41517061-0214-1', 'scheme/posting_number');
    expect(fbs.order.status === 'awaiting_deliver', 'status');
    expect(
      fbs.order.orderCreatedAt?.toISOString() === '2026-05-04T06:44:37.000Z',
      'дата = in_process_at (created_at нет)',
    );
    expect(fbs.order.cancelledAt === null, 'cancelledAt null при пустой cancellation');
    expect(
      JSON.stringify(fbs.order.items) ===
        JSON.stringify([
          { sku: 4116250392, offerId: 'S5200657-28', name: 'Кроссовки для мальчика', quantity: 1, price: '300' },
        ]),
      'items: price из {amount} → строка «300»',
    );
  }
  const cancelled = mapFbsPosting({
    ...FBS_RESPONSE.postings[0],
    status: 'cancelled',
    cancellation: { cancelled_at: '2026-05-06T10:00:00Z' },
  } as never);
  expect(
    cancelled.ok && cancelled.order.cancelledAt?.toISOString() === '2026-05-06T10:00:00.000Z',
    'cancelled_at читается',
  );
  const nullCancellation = mapFbsPosting({ ...FBS_RESPONSE.postings[0], cancellation: null } as never);
  expect(nullCancellation.ok && nullCancellation.order.cancelledAt === null, 'cancellation: null не падает');

  console.log('— маппинг FBO');
  const fbo = mapFboPosting(FBO_RESPONSE.postings[0] as never);
  expect(fbo.ok === true, 'FBO маппится');
  if (fbo.ok) {
    expect(fbo.order.scheme === 'fbo' && fbo.order.status === 'awaiting_packaging', 'scheme/status');
    expect(fbo.order.orderCreatedAt?.toISOString() === '2026-02-08T13:56:07.751Z', 'created_at');
    expect(
      fbo.order.items.length === 2 && fbo.order.items[0].price === '29990.00' && fbo.order.items[1].quantity === 2,
      'items: price строкой, quantity',
    );
  }

  console.log('— невалидные данные → пропуск с причиной, не молчаливый ноль');
  const bad = mapFboPosting({
    ...FBO_RESPONSE.postings[0],
    products: [{ sku: 1, quantity: 1, offer_id: 'x' }],
  } as never);
  expect(!bad.ok && /price/.test(bad.reason), 'нет price → ok=false');
  const badSku = mapFbsPosting({
    ...FBS_RESPONSE.postings[0],
    products: [{ quantity: 1, price: '1' }],
  } as never);
  expect(!badSku.ok && /sku/.test(badSku.reason), 'нет sku → ok=false');
  expect(
    moneyToAmountString('abc') === null &&
      moneyToAmountString({ amount: '' }) === null &&
      moneyToAmountString(-1) === null &&
      moneyToAmountString(NaN) === null &&
      moneyToAmountString({ amount: 'x' }) === null &&
      moneyToAmountString(null) === null,
    'moneyToAmountString: мусор → null',
  );
  expect(
    moneyToAmountString('0x10') === null &&
      moneyToAmountString('1e3') === null &&
      moneyToAmountString({ amount: 'Infinity' }) === null &&
      moneyToAmountString(' 12.5 ') === '12.5' &&
      moneyToAmountString(1e21) === null &&
      moneyToAmountString({ amount: 300 }) === '300',
    "moneyToAmountString: hex/экспонента не проходят (SQL ::numeric на '0x10' упал бы), десятичные — да",
  );
  // Схема types.ts расширена до string | number — lenient-клиент не пишет
  // `[ozon] schema mismatch` на int64-строках и числовой цене.
  expect(
    PostingItemSchema.safeParse({ sku: '123', quantity: '2', offer_id: 'a', price: { amount: 300 } }).success &&
      PostingItemSchema.safeParse({ sku: 123, quantity: 2, offer_id: 'a', price: 29990 }).success,
    'PostingItemSchema принимает sku/quantity строкой и цену числом',
  );

  console.log('— lenient-приведение: int64 строкой, цена числом');
  const lenFbs = mapFbsPosting({
    ...FBS_RESPONSE.postings[0],
    products: [{ offer_id: 'A', sku: '4116250392', quantity: '2', price: { amount: 300.5, currency: 'RUB' } }],
  } as never);
  expect(
    lenFbs.ok &&
      lenFbs.order.items[0].sku === 4116250392 &&
      lenFbs.order.items[0].quantity === 2 &&
      lenFbs.order.items[0].price === '300.5',
    'FBS: sku/quantity строкой, amount числом → приведены',
  );
  const lenFbo = mapFboPosting({
    ...FBO_RESPONSE.postings[0],
    products: [{ offer_id: 'B', sku: 7, quantity: 0, price: 1990 }],
  } as never);
  expect(
    lenFbo.ok && lenFbo.order.items[0].price === '1990' && lenFbo.order.items[0].quantity === 0,
    'FBO: price числом, quantity 0 допустим',
  );
  const junk = (p: Record<string, unknown>) =>
    mapFboPosting({ ...FBO_RESPONSE.postings[0], products: [{ offer_id: 'x', sku: 1, quantity: 1, price: '1', ...p }] } as never);
  expect(!junk({ sku: '12abc' }).ok && !junk({ sku: 0 }).ok && !junk({ sku: 1.5 }).ok, 'мусорный sku → пропуск');
  expect(!junk({ quantity: -1 }).ok && !junk({ quantity: 'много' }).ok && !junk({ quantity: 1.5 }).ok, 'мусорный quantity → пропуск');
  expect(!junk({ price: -5 }).ok && !junk({ price: 'abc' }).ok && !junk({ price: Infinity }).ok, 'мусорная цена → пропуск');
  expect(parseIntLike('9007199254740993', 1) === null, 'parseIntLike: за пределами safe integer → null');

  console.log('— окно дат > года режется на куски ≤ 365 дней');
  const DAY = 86_400_000;
  const w0 = new Date('2024-01-01T00:00:00Z');
  const short = splitDateWindow(w0, new Date(w0.getTime() + 30 * DAY));
  expect(short.length === 1 && short[0].since.getTime() === w0.getTime(), 'короткое окно — один кусок');
  const exact = splitDateWindow(w0, new Date(w0.getTime() + 365 * DAY));
  expect(exact.length === 1, 'ровно 365 дней — один кусок');
  const longEnd = new Date(w0.getTime() + 800 * DAY + 5);
  const long = splitDateWindow(w0, longEnd);
  expect(long.length === 3, '800 дней → 3 куска', String(long.length));
  expect(
    long.every((c) => c.to.getTime() - c.since.getTime() <= 365 * DAY) &&
      long[0].since.getTime() === w0.getTime() &&
      long[long.length - 1].to.getTime() === longEnd.getTime() &&
      long.every((c, i) => i === 0 || c.since.getTime() === long[i - 1].to.getTime()),
    'куски смежные, каждый ≤ 365 дней, покрывают окно целиком',
  );
  expect(splitDateWindow(longEnd, w0).length === 1, 'to <= since → один кусок как есть');

  console.log('— пагинация');
  const three = await collect([
    { postings: ['a', 'b'], has_next: true, cursor: 'c1' },
    { postings: ['c'], has_next: true, cursor: 'c2' },
    { postings: ['d'], has_next: false, cursor: '' },
  ]);
  expect(three.got.join('') === 'abcd' && three.pages === 3, 'три страницы до конца');
  expect(three.cursors.join('|') === '|c1|c2', 'cursor: пусто → c1 → c2', three.cursors.join('|'));
  const empty = await collect([{ postings: [], has_next: false }]);
  expect(empty.got.length === 0 && empty.pages === 1, 'пустой ответ: одна страница, 0 элементов');
  expect(await rejects([{ result: { postings: [] } }], /postings/), 'ответ без postings → ошибка');
  expect(
    await rejects(
      [
        { postings: ['a'], has_next: true, cursor: 'same' },
        { postings: ['b'], has_next: true, cursor: 'same' },
      ],
      /не продвигается/,
    ),
    'зацикленный cursor → ошибка',
  );
  expect(await rejects([{ postings: ['a'] }], /has_next/), 'нет has_next → ошибка формы, не тихий стоп');
  expect(await rejects([{ postings: [], has_next: 'false' }], /has_next/), 'has_next не boolean → ошибка формы');
  expect(
    await rejects([{ postings: ['a'], has_next: true, cursor: '' }], /cursor пуст/),
    'has_next без cursor → ошибка',
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
