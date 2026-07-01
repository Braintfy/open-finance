// PURPOSE: Запрос на сброс пароля
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SmartCaptcha, captchaEnabled } from '@/components/captcha/smart-captcha';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  function resetCaptcha() {
    setCaptchaToken('');
    setCaptchaKey((k) => k + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, captchaToken }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Не удалось отправить. Попробуйте позже.');
        setLoading(false);
        resetCaptcha();
        return;
      }
      setDone(true);
      setLoading(false);
    } catch {
      setError('Ошибка сети');
      setLoading(false);
      resetCaptcha();
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-zinc-900">Восстановление пароля</h1>
        <p className="mb-6 text-sm text-zinc-500">
          Введите email — пришлём ссылку для сброса пароля. В dev-режиме токен пишется в консоль сервера.
        </p>

        {done ? (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Если такой email зарегистрирован — мы отправили ссылку (или вывели токен в консоль для dev).
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              placeholder="you@example.com"
              autoFocus
            />
            {error && <p className="text-sm text-red-600">{error}</p>}

            <SmartCaptcha key={captchaKey} onVerify={setCaptchaToken} />

            <button
              type="submit"
              disabled={loading || (captchaEnabled && !captchaToken)}
              className="w-full rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? 'Отправляем…' : 'Отправить ссылку'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-zinc-600 hover:text-zinc-900">
            ← Назад ко входу
          </Link>
        </p>
      </div>
    </main>
  );
}
