// PURPOSE: Минимальный onboarding-визард (заглушка с одной кнопкой "пропустить")
// Полная имплементация — в Этапе 1 по docs/ONBOARDING.md
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const OCCUPATIONS = [
  { id: 'marketplace_seller', label: 'Селлер маркетплейсов', emoji: '🏷️' },
  { id: 'freelancer', label: 'ИП на услугах / фриланс', emoji: '💼' },
  { id: 'small_business', label: 'Малый бизнес', emoji: '🏪' },
  { id: 'self_employed', label: 'Самозанятый (НПД)', emoji: '🪪' },
  { id: 'personal', label: 'Личные финансы', emoji: '🏠' },
  { id: 'other', label: 'Что-то ещё', emoji: '✨' },
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [occupation, setOccupation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function complete(occ: string | null) {
    setLoading(true);
    await fetch('/api/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ occupation: occ ?? 'other' }),
    });
    router.push('/app/dashboard');
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl pt-12">
      <h1 className="mb-2 text-2xl font-semibold text-zinc-900">Привет 👋</h1>
      <p className="mb-8 text-zinc-600">Чем ты занимаешься? Подберём подходящий шаблон модулей.</p>

      <div className="grid gap-3 md:grid-cols-2">
        {OCCUPATIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => setOccupation(o.id)}
            className={`rounded-xl border p-4 text-left transition ${
              occupation === o.id
                ? 'border-zinc-900 bg-zinc-50'
                : 'border-zinc-200 bg-white hover:border-zinc-400'
            }`}
          >
            <div className="text-2xl">{o.emoji}</div>
            <div className="mt-2 text-sm font-medium text-zinc-900">{o.label}</div>
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={() => complete(null)}
          className="text-sm text-zinc-500 hover:text-zinc-900"
          disabled={loading}
        >
          Пропустить — настрою сам
        </button>
        <button
          onClick={() => complete(occupation)}
          disabled={!occupation || loading}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? 'Создаём…' : 'Продолжить'}
        </button>
      </div>

      <p className="mt-6 text-center text-xs text-zinc-400">
        Полный визард с 6 шагами появится в Этапе 1. Сейчас — упрощённая версия.
      </p>
    </div>
  );
}
