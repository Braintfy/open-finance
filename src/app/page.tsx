// PURPOSE: Главная страница — лендинг open-source проекта Open Finance
import Link from 'next/link';
import { APP_VERSION } from '@/lib/version';

// Ссылка на репозиторий. Для своего форка/инстанса — замените на свой URL.
const GITHUB_URL = 'https://github.com/open-finance/open-finance';

export default function HomePage() {
  return (
    <main className="container mx-auto flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="max-w-2xl space-y-8 text-center">
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            v{APP_VERSION} · Open Source · MIT
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Open Finance — открытый AI-финансовый управляющий
          </h1>
          <p className="text-balance text-lg text-muted-foreground">
            Self-hosted платформа финансов для предпринимателей: модульный конструктор, маркетплейсы, AI-аналитика.
            Полностью открытый код — данные и ключи остаются у вас.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Создать аккаунт
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Войти
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-accent"
          >
            GitHub
          </a>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Развернуть у себя: README · Личное использование: docs/PERSONAL_USE.md ·{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Конфиденциальность
          </Link>
        </p>
      </div>
    </main>
  );
}

const features = [
  {
    title: 'Открытый код, self-hosted',
    description: 'MIT-лицензия. Разверните на своём сервере или локально — все функции включены, без тарифов.',
  },
  {
    title: 'Данные и ключи — у вас',
    description: 'API-ключи маркетплейсов и AI шифруются AES-256-GCM и не покидают ваш инстанс. BYOK для AI.',
  },
  {
    title: 'AI-первая архитектура',
    description: 'AI работает поверх всех данных через RAG: связи, паттерны, аномалии. Claude, OpenAI или локальная Ollama.',
  },
  {
    title: 'Маркетплейсы и unit-экономика',
    description: 'Ozon sync, KPI, ДРР, ABC-анализ, AI-инсайты по SKU. Excel-режим с формулами в таблицах.',
  },
  {
    title: 'Inbox для AI',
    description: 'Кидаете чеки, договоры, заметки — AI разносит по транзакциям и блокам.',
  },
  {
    title: 'Налоги РФ',
    description: 'УСН/НДС/ПСН/НПД/АУСН/ОСНО — выберите режим, AI посчитает и сравнит.',
  },
];
