// PURPOSE: Глобальный токенайзер для всех ИИ-ассистентов проекта.
// Точный подсчёт токенов через js-tiktoken (BPE o200k_base, lazy + client-only),
// с мгновенной эвристикой как fallback (SSR / до загрузки энкодера / ошибка).
// Используется счётчиком контекста в модалках ИИ (бюджет токенов/символов).
import { useEffect, useState } from 'react';

type EncodeFn = (text: string) => number;

let encoderPromise: Promise<EncodeFn | null> | null = null;

/** Лениво грузит pure-JS BPE-энкодер (o200k_base). Только на клиенте. */
async function loadEncoder(): Promise<EncodeFn | null> {
  if (typeof window === 'undefined') return null;
  try {
    const [{ Tiktoken }, rank] = await Promise.all([
      import('js-tiktoken/lite'),
      import('js-tiktoken/ranks/o200k_base'),
    ]);
    const enc = new Tiktoken(rank.default);
    return (text: string) => enc.encode(text).length;
  } catch {
    return null;
  }
}

/** Singleton-загрузчик энкодера (один раз на сессию). */
export function getEncoderLoader(): Promise<EncodeFn | null> {
  if (!encoderPromise) encoderPromise = loadEncoder();
  return encoderPromise;
}

/**
 * Быстрая эвристика количества токенов без зависимостей.
 * Кириллица токенизируется дороже латиницы → разный вес.
 * Погрешность ~10-20%, помечается в UI как «≈».
 */
export function heuristicTokens(text: string): number {
  if (!text) return 0;
  const cyrillic = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const rest = text.length - cyrillic;
  return Math.ceil(cyrillic / 2.8 + rest / 4);
}

export function countChars(text: string): number {
  return text ? text.length : 0;
}

export type TokenCount = {
  tokens: number;
  chars: number;
  /** true — точный подсчёт (tiktoken), false — эвристика. */
  exact: boolean;
};

/**
 * React-хук: возвращает функцию подсчёта токенов/символов.
 * До загрузки энкодера использует эвристику, затем — точный tiktoken.
 */
export function useTokenizer(): {
  ready: boolean;
  count: (text: string) => TokenCount;
} {
  const [encoder, setEncoder] = useState<EncodeFn | null>(null);

  useEffect(() => {
    let active = true;
    void getEncoderLoader().then((fn) => {
      if (active && fn) setEncoder(() => fn);
    });
    return () => {
      active = false;
    };
  }, []);

  const count = (text: string): TokenCount => {
    const chars = countChars(text);
    if (encoder) return { tokens: encoder(text), chars, exact: true };
    return { tokens: heuristicTokens(text), chars, exact: false };
  };

  return { ready: encoder !== null, count };
}
