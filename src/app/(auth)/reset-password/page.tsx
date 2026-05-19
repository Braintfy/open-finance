// PURPOSE: Страница установки нового пароля по reset-токену из email.
// Ссылка из письма: ${APP_URL}/reset-password?token=<token>
'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Токен отсутствует. Откройте ссылку из письма ещё раз.');
      return;
    }
    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов');
      return;
    }
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Не удалось обновить пароль');
        setLoading(false);
        return;
      }
      setDone(true);
      setLoading(false);
      // Через 1.5с редиректим на login.
      setTimeout(() => router.push('/login'), 1500);
    } catch {
      setError('Ошибка сети');
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Новый пароль</CardTitle>
          <CardDescription>
            Введите новый пароль для входа в Open Finance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <Alert variant="destructive">
              <AlertDescription>
                Токен сброса пароля не найден в ссылке. Откройте письмо и кликните по
                ссылке ещё раз, либо{' '}
                <Link href="/forgot-password" className="font-medium underline">
                  запросите новую
                </Link>
                .
              </AlertDescription>
            </Alert>
          ) : done ? (
            <Alert>
              <AlertDescription>
                Пароль обновлён. Перенаправляем на страницу входа…
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Новый пароль</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 8 символов"
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Повторите пароль</Label>
                <Input
                  id="confirm"
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Сохраняем…' : 'Установить пароль'}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-sm">
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              ← Назад ко входу
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
