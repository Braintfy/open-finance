// PURPOSE: Клиентский виджет Yandex SmartCaptcha (I6). Рендерится только если
// задан NEXT_PUBLIC_YANDEX_SMARTCAPTCHA_CLIENT_KEY; иначе возвращает null и форма
// отправляется без токена (капча считается выключенной). Токен одноразовый и живёт
// 5 минут — родитель ремонтит виджет через `key` при ошибке отправки (resetCaptcha).
'use client';

import { useEffect, useRef, useState } from 'react';

type SmartCaptchaGlobal = {
  render: (
    container: HTMLElement | string,
    params: {
      sitekey: string;
      hl?: string;
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
    },
  ) => number;
  destroy: (widgetId: number) => void;
  reset: (widgetId?: number) => void;
};

declare global {
  interface Window {
    smartCaptcha?: SmartCaptchaGlobal;
  }
}

/** Публичный client-key. Пусто → капча выключена. */
export const CAPTCHA_CLIENT_KEY = process.env.NEXT_PUBLIC_YANDEX_SMARTCAPTCHA_CLIENT_KEY ?? '';
export const captchaEnabled = CAPTCHA_CLIENT_KEY.length > 0;

const SCRIPT_ID = 'ya-smartcaptcha-script';
const SCRIPT_SRC = 'https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload';

function loadCaptchaScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.smartCaptcha) return resolve();
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('smartcaptcha script failed')));
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('smartcaptcha script failed'));
    document.head.appendChild(script);
  });
}

/** Виджет «я не робот». `onVerify` получает токен (или '' при истечении). */
export function SmartCaptcha({ onVerify }: { onVerify: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!captchaEnabled) return;
    let cancelled = false;

    loadCaptchaScript()
      .then(() => {
        if (cancelled || !window.smartCaptcha || !containerRef.current) return;
        if (widgetIdRef.current !== null) return; // защита от двойного рендера (StrictMode)
        widgetIdRef.current = window.smartCaptcha.render(containerRef.current, {
          sitekey: CAPTCHA_CLIENT_KEY,
          hl: 'ru',
          callback: (token: string) => onVerify(token),
          'expired-callback': () => onVerify(''),
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && window.smartCaptcha) {
        try {
          window.smartCaptcha.destroy(widgetIdRef.current);
        } catch {
          /* noop */
        }
        widgetIdRef.current = null;
      }
    };
    // onVerify — стабильный setState, виджет не пересоздаём при ре-рендере
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!captchaEnabled) return null;

  return (
    <div className="space-y-1">
      <div ref={containerRef} />
      {failed && (
        <p className="text-xs text-destructive">
          Не удалось загрузить проверку «я не робот». Обновите страницу.
        </p>
      )}
    </div>
  );
}
