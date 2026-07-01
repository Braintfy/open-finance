// PURPOSE: Серверная проверка Yandex SmartCaptcha (I6).
// Капча включается ТОЛЬКО если задан YANDEX_SMARTCAPTCHA_SERVER_KEY (в dev по
// умолчанию выключена — verifyCaptcha() возвращает true без обращения к сервису).
// Политика ошибок: fail-open при недоступности сервиса Yandex (не блокируем
// пользователя из-за их аварии/таймаута), fail-closed при явном вердикте «робот»
// или отсутствии токена при включённой капче.
import { env } from '@/lib/env';

const VALIDATE_URL = 'https://smartcaptcha.cloud.yandex.ru/validate';
const TIMEOUT_MS = 5000;

/** Включена ли капча (задан ли серверный ключ). */
export function isCaptchaEnabled(): boolean {
  return !!env.YANDEX_SMARTCAPTCHA_SERVER_KEY;
}

/**
 * Проверяет токен SmartCaptcha.
 * @returns true если проверка пройдена ИЛИ капча выключена; false если робот/нет токена.
 */
export async function verifyCaptcha(
  token: string | undefined | null,
  ip: string,
): Promise<boolean> {
  const secret = env.YANDEX_SMARTCAPTCHA_SERVER_KEY;
  if (!secret) return true; // капча выключена
  if (!token) return false; // включена, но фронт не прислал токен

  const params = new URLSearchParams({ secret, token });
  if (ip && ip !== 'unknown') params.set('ip', ip);

  try {
    const res = await fetch(VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) {
      // Ошибка сервиса → пропускаем (fail-open), чтобы не ронять вход/регистрацию.
      console.error('[captcha] validate HTTP', res.status, '→ fail-open');
      return true;
    }
    const data = (await res.json()) as { status?: string; message?: string };
    if (data.status !== 'ok') {
      console.warn('[captcha] rejected:', data.message || 'robot');
      return false;
    }
    return true;
  } catch (e) {
    console.error('[captcha] validate error → fail-open:', e);
    return true;
  }
}
