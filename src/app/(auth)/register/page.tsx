// PURPOSE: Страница регистрации (shadcn)
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SmartCaptcha, captchaEnabled } from '@/components/captcha/smart-captcha';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, consent, captchaToken }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Не удалось зарегистрироваться');
        setLoading(false);
        resetCaptcha();
        return;
      }
      router.push('/app/onboarding');
      router.refresh();
    } catch {
      setError('Ошибка сети');
      setLoading(false);
      resetCaptcha();
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Регистрация</CardTitle>
          <CardDescription>Self-hosted: все функции включены, без тарифов.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Имя</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Иван Петров"
                autoComplete="name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Минимум 8 символов"
                autoComplete="new-password"
              />
            </div>

            <div className="flex items-start gap-2">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
              />
              <Label
                htmlFor="consent"
                className="text-sm font-normal leading-snug text-muted-foreground"
              >
                Я согласен с{' '}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="font-medium text-foreground hover:underline"
                >
                  политикой конфиденциальности
                </Link>{' '}
                и обработкой персональных данных
              </Label>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <SmartCaptcha key={captchaKey} onVerify={setCaptchaToken} />

            <Button
              type="submit"
              disabled={loading || !consent || (captchaEnabled && !captchaToken)}
              className="w-full"
            >
              {loading ? 'Создаём…' : 'Создать аккаунт'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Уже есть аккаунт?{' '}
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Войти
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
