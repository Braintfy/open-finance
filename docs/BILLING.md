# BILLING.md — Инструкция по биллингу для AI агента

## Цель
Этот файл — память для будущих AI агентов, которые будут реализовывать биллинг в Open Finance. Содержит контекст, решения и точки внимания.

## Архитектурное решение

### Двойная резервируемость
**Принцип:** биллинг абстрагирован за интерфейсом `PaymentProvider`. Конкретный провайдер выбирается runtime-конфигом (`BILLING_PROVIDER=tkassa|cloudpayments`).

**Зачем:**
- Если один шлюз падает / блокируется / меняет ставки — переключаемся без даунтайма
- A/B тестирование (часть юзеров на одном, часть на другом)
- Региональные разрезы (РФ vs международные пользователи)

## Провайдеры

### Основной: Т-Касса (Тинькофф / Т-Бизнес)
- **Документация:** https://www.tbank.ru/kassa/develop/
- **API endpoint:** `https://securepay.tinkoff.ru/v2/`
- **Аутентификация:** TerminalKey + SHA-256 подпись запроса с SecretKey
- **Ключевые методы:**
  - `Init` — создание платежа, возвращает `PaymentId` и `PaymentURL`
  - `Confirm` — подтверждение двухстадийного платежа
  - `Cancel` / `Refund` — отмена / возврат
  - `Charge` — рекуррентный платёж по rebill-токену (для подписок)
- **Webhook:** `NotificationURL` принимает POST с `Status` (AUTHORIZED, CONFIRMED, REJECTED, REFUNDED)
- **Рекурренты:** на первом платеже передать `Recurrent=Y` и `CustomerKey`. На последующих — `Charge` с `RebillId` из webhook.
- **Чеки 54-ФЗ:** объект `Receipt` в `Init` — автоматическая фискализация через aQsi/Эвотор партнёра.
- **Ставки:** 1.99-2.49% карты, 0.4-0.7% СБП

### Резервный: CloudPayments
- **Документация:** https://developers.cloudpayments.ru/
- **API endpoint:** `https://api.cloudpayments.ru/`
- **Аутентификация:** Basic Auth (Public ID + API password)
- **Ключевые методы:**
  - `/payments/cards/charge` — оплата карты
  - `/payments/cards/auth` — двухстадийная авторизация
  - `/subscriptions/create` — создание подписки (нативные планы)
  - `/payments/refund` — возврат
- **Webhooks (Notifications):** Check / Pay / Fail / Recurrent — отдельные URLs в личном кабинете
- **Рекурренты:** через объект `Subscription` с `Interval=Month` и `Period=1`
- **Виджет на сайте:** JS-скрипт `widget.cloudpayments.ru/bundles/cloudpayments` — открывает форму без редиректа
- **Ставки:** ~2.7%

## Интерфейс провайдера

```typescript
// src/lib/billing/provider.ts
export interface PaymentProvider {
  name: 'tkassa' | 'cloudpayments';

  // Одноразовый платёж
  charge(params: ChargeParams): Promise<Payment>;

  // Подписка (рекурренты)
  createSubscription(params: SubscriptionParams): Promise<Subscription>;
  cancelSubscription(id: string): Promise<void>;

  // Возврат
  refund(paymentId: string, amount?: number): Promise<Refund>;

  // Webhook обработка (валидация подписи + парсинг)
  handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent>;

  // Получение URL для оплаты
  getCheckoutUrl(payment: Payment): string;
}

export interface ChargeParams {
  amount: number;            // в копейках
  currency: 'RUB';
  customerId: string;        // user_id или email
  description: string;
  successUrl: string;
  failUrl: string;
  receipt?: Receipt54FZ;     // для фискализации
  metadata?: Record<string, string>;
}

export interface SubscriptionParams extends ChargeParams {
  planId: 'pro_monthly' | 'pro_yearly' | 'business_monthly' | 'business_yearly';
  interval: 'month' | 'year';
}
```

## Безопасность

### Webhook валидация
- **Т-Касса:** SHA-256 подпись = `sha256(token + props_alphabetical_sorted)`. См. `crypto.createHash('sha256')`.
- **CloudPayments:** HMAC-SHA256 с API password. Заголовок `Content-HMAC`.

### Хранение секретов
- НЕ хардкодить ключи! Только через переменные окружения / Docker secrets.
- В Local-First версии секреты не нужны (биллинг идёт через License Server в облаке).

### Idempotency
- На каждый платёж генерировать `idempotency_key` (UUID) на стороне Open Finance.
- Сохранять `external_payment_id` от провайдера для лукапа.
- Webhook может прийти несколько раз — обрабатывать через `payments.status` enum, не повторять действия.

## Схема БД (Drizzle)

```typescript
// src/lib/db/schema/billing.ts
export const subscriptions = pgTable('subscriptions', {
  id: uuid().defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  planId: varchar('plan_id', { length: 50 }).notNull(),
  provider: varchar('provider', { length: 20 }).notNull(),
  externalSubId: varchar('external_sub_id', { length: 100 }), // ID у провайдера
  status: varchar('status', { length: 20 }).notNull(), // active, canceled, past_due
  currentPeriodStart: timestamp('current_period_start').notNull(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid().defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  subscriptionId: uuid('subscription_id'),
  provider: varchar('provider', { length: 20 }).notNull(),
  externalPaymentId: varchar('external_payment_id', { length: 100 }),
  amount: integer().notNull(), // копейки
  currency: varchar('currency', { length: 3 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull().unique(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

## Тарифы (cloud SaaS)

| Plan ID | Описание | Цена (мес) | Цена (год) |
|---------|----------|-----------|-----------|
| `free` | Бесплатный | 0 ₽ | 0 ₽ |
| `pro_monthly` | Pro помесячно | 990 ₽ | — |
| `pro_yearly` | Pro в год | — | 9 900 ₽ |
| `business_monthly` | Business помесячно | 2 990 ₽ | — |
| `business_yearly` | Business в год | — | 29 900 ₽ |
| `enterprise` | Кастомный | по договору | по договору |

## Тарифы (local desktop)

| Plan ID | Описание | Цена |
|---------|----------|------|
| `local_lifetime` | Lifetime лицензия | 9 990 ₽ разово |
| `local_monthly` | Месячная подписка | 990 ₽/мес |

## Поток оплаты (cloud)

```
[User] → [POST /api/billing/checkout]
              ↓ создание payment в БД (status=pending)
              ↓ вызов provider.charge() / .createSubscription()
              ↓ возврат checkoutUrl
[User] → переход на checkoutUrl → оплата
[Provider] → POST /api/webhooks/{tkassa|cloudpayments}
              ↓ валидация подписи
              ↓ обновление payments.status
              ↓ если success → активация subscription
              ↓ → апгрейд тарифа в tenants
```

## Поток активации лицензии (local)

```
[User] → веб-страница оплаты (cloud) → оплачивает
[License Server] → генерирует JWT (RS256)
                  ↓ payload: { sub, plan, exp, deviceId? }
[License Server] → отправляет ключ на email
[User] → копирует ключ в Tauri app
[Tauri app] → проверяет JWT публичным ключом (offline-валидация)
            ↓ сохраняет в keychain (macOS) / credential store (Windows)
            ↓ работает offline до exp
            ↓ за N дней до exp → фоновое обновление через License Server
```

## Что AI агенту нужно сделать (чеклист)

- [ ] Создать `src/lib/billing/provider.ts` с интерфейсом
- [ ] Реализовать `src/lib/billing/tkassa.ts`
- [ ] Реализовать `src/lib/billing/cloudpayments.ts`
- [ ] Создать схему `src/lib/db/schema/billing.ts` с Drizzle
- [ ] Endpoint `app/api/billing/checkout/route.ts` (POST)
- [ ] Endpoint `app/api/webhooks/tkassa/route.ts` (POST)
- [ ] Endpoint `app/api/webhooks/cloudpayments/route.ts` (POST)
- [ ] UI: страница тарифов `app/(dashboard)/billing/page.tsx`
- [ ] UI: форма выбора тарифа + редирект на провайдера
- [ ] Cron: проверка истёкших подписок (downgrade на free)
- [ ] Тесты: webhook идемпотентность, подписи, эджкейсы

## Ссылки на документацию
- Т-Касса API: https://www.tbank.ru/kassa/develop/api/
- CloudPayments API: https://developers.cloudpayments.ru/
- 54-ФЗ (фискализация): https://www.tbank.ru/kassa/develop/api/receipt/
- Drizzle ORM: https://orm.drizzle.team/

## Решения, которые НЕ принимать без обсуждения
- Хранение PAN/CVC карт у себя (не делать! только токенизация у провайдера)
- Самописный криптошифр (не делать! используй стандартные подписи провайдера)
- Игнорирование webhook-идемпотентности (приведёт к двойным списаниям)
- Хардкод суммы / тарифов в коде (только из БД / config)
