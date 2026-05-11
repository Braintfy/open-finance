// PURPOSE: Глобальные настройки форматирования чисел (копейки и т.д.)
// Хранятся в localStorage, доступны через React context.
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'of:format-settings';

export type FormatSettings = {
  /** Показывать копейки (дробную часть) — например 1 234,56 ₽ */
  showKopecks: boolean;
};

const DEFAULT: FormatSettings = {
  showKopecks: false,
};

type Ctx = {
  settings: FormatSettings;
  update: (patch: Partial<FormatSettings>) => void;
};

const FormatSettingsContext = createContext<Ctx>({
  settings: DEFAULT,
  update: () => {},
});

export function FormatSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<FormatSettings>(DEFAULT);

  // Загружаем из localStorage при mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FormatSettings>;
        setSettings((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  const update = useCallback((patch: Partial<FormatSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <FormatSettingsContext.Provider value={{ settings, update }}>
      {children}
    </FormatSettingsContext.Provider>
  );
}

export function useFormatSettings() {
  return useContext(FormatSettingsContext);
}

/**
 * Форматирует копейки в строку с символом валюты.
 * Если showKopecks=true: "1 234,56 ₽"
 * Если showKopecks=false: "1 235 ₽" (округление)
 */
export function formatRublesWithSettings(
  amountInKopecks: number,
  showKopecks: boolean
): string {
  if (showKopecks) {
    const rubles = amountInKopecks / 100;
    const formatted = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(rubles);
    return `${formatted} ₽`;
  }
  const rubles = Math.round(amountInKopecks / 100);
  const formatted = new Intl.NumberFormat('ru-RU').format(rubles);
  return `${formatted} ₽`;
}

/**
 * Хук для форматирования рублей с учётом глобальных настроек.
 * Возвращает функцию: (amountInKopecks) => "строка"
 */
export function useFormatRubles() {
  const { settings } = useFormatSettings();
  return useCallback(
    (amountInKopecks: number) =>
      formatRublesWithSettings(amountInKopecks, settings.showKopecks),
    [settings.showKopecks]
  );
}
