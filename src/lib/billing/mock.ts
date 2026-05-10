// PURPOSE: Mock-провайдер биллинга для dev и e2e тестов.
// Активен когда FEATURE_BILLING_MOCK=true.
// Все вызовы возвращают success без обращений к Т-Кассе/CloudPayments.
// В проде заменяется реальной имплементацией (см. docs/BILLING.md).

import { env } from '@/lib/env';

export type Plan = 'free' | 'trial' | 'pro' | 'business';

export type CreatePaymentInput = {
  tenantId: string;
  plan: Exclude<Plan, 'free' | 'trial'>;
  period: 'monthly' | 'yearly';
  amount: number; // в копейках
};

export type CreatePaymentResult =
  | { ok: true; paymentId: string; redirectUrl: string }
  | { ok: false; error: string };

export type WebhookPayload = {
  paymentId: string;
  status: 'success' | 'failed' | 'pending';
};

export const isMockBillingEnabled = () => env.FEATURE_BILLING_MOCK;

export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  if (!isMockBillingEnabled()) {
    throw new Error('Mock billing disabled. Use real provider.');
  }
  const paymentId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ok: true,
    paymentId,
    redirectUrl: `/billing/mock-success?paymentId=${paymentId}&tenantId=${input.tenantId}&plan=${input.plan}`,
  };
}

export async function verifyWebhook(_signature: string, payload: WebhookPayload): Promise<boolean> {
  // В моке всегда «подпись валидна»
  return Boolean(payload.paymentId);
}

export async function getPaymentStatus(paymentId: string) {
  return { paymentId, status: 'success' as const, paidAt: new Date() };
}
