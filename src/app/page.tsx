// PURPOSE: Главная страница (минимальный лендинг — заглушка для MVP)
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="container mx-auto flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="max-w-2xl space-y-8 text-center">
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">v0.6.0 · MVP foundation</p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Open Finance — AI Финансовый Управляющий
          </h1>
          <p className="text-balance text-lg text-muted-foreground">
            Персональный AI-финансист для предпринимателей. Модульный конструктор, AI-секретарь, налоги РФ — в одном
            месте.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Попробовать Pro · 14 дней бесплатно
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Войти
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const features = [
  {
    title: 'AI-первая архитектура',
    description: 'AI работает поверх всех твоих данных через RAG: видит связи, паттерны, аномалии.',
  },
  {
    title: 'Inbox для AI',
    description: 'Кидаешь чеки, договоры, заметки — AI сам разносит по транзакциям и блокам.',
  },
  {
    title: 'AI-секретарь',
    description: 'Подключи email, Telegram, WhatsApp — AI следит за заказами и напоминает.',
  },
  {
    title: 'Налоги РФ нативно',
    description: 'УСН/НДС/ПСН/НПД/АУСН/ОСНО — выбери режим, AI посчитает и сравнит.',
  },
];
