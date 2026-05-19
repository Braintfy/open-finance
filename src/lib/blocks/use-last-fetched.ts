// PURPOSE: Хук «обновлено N сек/мин/час назад» для блоков аналитики.
// Возвращает {lastFetchedAt, markFetched, label, justUpdated}.
// `justUpdated` пульсирует true ~1.2с после `markFetched()` — для зелёной
// точки рядом с кнопкой «Обновить».

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useLastFetched() {
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);
  const [, force] = useState(0);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Пересчёт лейбла раз в 30 секунд.
  useEffect(() => {
    if (!lastFetchedAt) return;
    const id = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, [lastFetchedAt]);

  // Cleanup pulse-таймера.
  useEffect(() => {
    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, []);

  const markFetched = useCallback(() => {
    setLastFetchedAt(new Date());
    setJustUpdated(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setJustUpdated(false), 1200);
  }, []);

  const label = lastFetchedAt ? formatRelative(lastFetchedAt) : null;

  return { lastFetchedAt, markFetched, label, justUpdated };
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return 'только что';
  if (sec < 60) return `${sec} сек назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  return `${day} д назад`;
}
