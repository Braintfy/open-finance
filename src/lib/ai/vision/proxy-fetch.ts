// PURPOSE: fetch через tenant-прокси для vision-провайдеров с requiresVpn
// (claude/openai). Тот же механизм, что в src/lib/ai/providers/openai-compat.ts:
// undici ProxyAgent из createProxyDispatcher(tenant.settings.aiProxy) кладётся
// в init.dispatcher. Обычно это локальный Xray http://127.0.0.1:10809 (Этап 4).
//
// Не применяется к:
//  * yandex — Yandex Cloud доступен из РФ напрямую, прокси только замедлит;
//  * tesseract/mock — работают локально, сети нет;
//  * скачиванию самого изображения (S3/вложение) — это внутренний трафик.

import { createProxyDispatcher } from '@/lib/ai/providers/proxy';
import type { VisionContext } from './types';

/** Тип dispatcher'а из undici — any, чтобы не тянуть @types/undici (как в proxy.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dispatcher = any;

/**
 * Собрать dispatcher под конкретного провайдера.
 * Возвращает undefined, если прокси выключен/не задан.
 * Бросает понятную ошибку, если прокси включён, но недоступен (нет undici,
 * socks5) — молча ходить напрямую нельзя: из РФ запрос всё равно не пройдёт,
 * а пользователь получил бы невнятный таймаут вместо причины.
 */
export async function getVisionDispatcher(
  ctx: VisionContext | undefined,
  providerId: string,
): Promise<Dispatcher | undefined> {
  const proxy = ctx?.proxy;
  if (!proxy?.enabled || !proxy.url) return undefined;
  try {
    return await createProxyDispatcher(proxy);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown';
    throw new Error(`Vision (${providerId}) через прокси не запустился: ${reason}`);
  }
}

/**
 * fetch с прокси-dispatcher'ом. Сигнатура повторяет обычный fetch,
 * dispatcher добавляется в init только если он есть.
 */
export async function fetchViaProxy(
  url: string,
  init: RequestInit,
  dispatcher: Dispatcher | undefined,
): Promise<Response> {
  if (!dispatcher) return fetch(url, init);
  const withDispatcher: RequestInit = { ...init };
  // @ts-expect-error - undici dispatcher param на Node.js fetch
  withDispatcher.dispatcher = dispatcher;
  return fetch(url, withDispatcher);
}
