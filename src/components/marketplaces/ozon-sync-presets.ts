// PURPOSE: Pure-функции для расчёта диапазонов sync-пресетов
// (v0.22.2). Вынесены из `ozon-sync-dialog.tsx` ('use client') в обычный
// модуль, чтобы их можно было покрыть unit-тестами без mount React.
//
// Использование:
//   import { resolvePresetRange, describePreset } from './ozon-sync-presets';
//   const range = resolvePresetRange('auto', account.lastSyncAt);
//   const hint  = describePreset('auto', account.lastSyncAt);

export type DateRangePreset =
  | 'auto'
  | 'yesterday'
  | 'last3'
  | 'last7'
  | 'last30'
  | 'window'
  | 'custom';

export const PRESET_LABELS: Record<DateRangePreset, string> = {
  auto: 'Авто (с последнего sync)',
  yesterday: 'Вчера',
  last3: 'Последние 3 дня',
  last7: 'Последние 7 дней',
  last30: 'Последние 30 дней',
  window: 'Полное окно (настройки)',
  custom: 'Произвольный диапазон',
};

/** Сегодня в MSC (UTC+3) в формате `YYYY-MM-DD`. */
export function moscowToday(now: Date = new Date()): string {
  const msc = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return msc.toISOString().slice(0, 10);
}

export function shiftIsoDate(iso: string, deltaDays: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function diffDaysInclusive(fromIso: string, toIso: string): number {
  const f = new Date(fromIso + 'T00:00:00Z').getTime();
  const t = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((t - f) / (24 * 3600 * 1000)) + 1);
}

/**
 * Резолвит диапазон для пресета. Для `auto` нужен `lastSyncAtIso` — если
 * sync ещё не было или прошло > 90 дней, возвращаем 30-дневное окно как
 * безопасный дефолт. Для `window`/`custom` возвращаем null — UI берёт
 * диапазон из других мест (settings / user input).
 *
 * `now` экспортирован для тестов (фиксируем «сегодня» MSC).
 */
export function resolvePresetRange(
  preset: DateRangePreset,
  lastSyncAtIso?: string | null,
  now: Date = new Date(),
): {
  from: string;
  to: string;
} | null {
  const today = moscowToday(now);
  const yesterday = shiftIsoDate(today, -1);
  switch (preset) {
    case 'yesterday':
      return { from: yesterday, to: yesterday };
    case 'last3':
      return { from: shiftIsoDate(yesterday, -2), to: yesterday };
    case 'last7':
      return { from: shiftIsoDate(yesterday, -6), to: yesterday };
    case 'last30':
      return { from: shiftIsoDate(yesterday, -29), to: yesterday };
    case 'auto': {
      // Без lastSyncAt → 30 дней (типичное окно по умолчанию).
      if (!lastSyncAtIso) {
        return { from: shiftIsoDate(yesterday, -29), to: yesterday };
      }
      const last = new Date(lastSyncAtIso);
      if (Number.isNaN(last.getTime())) {
        return { from: shiftIsoDate(yesterday, -29), to: yesterday };
      }
      const lastIso = last.toISOString().slice(0, 10);
      const diffDays = Math.max(0, Math.floor((now.getTime() - last.getTime()) / (24 * 3600 * 1000)));
      // Если последний sync был сегодня/вчера — догружаем только вчера
      // (сегодня ещё не закрыто Ozon-ом для аналитики).
      if (diffDays <= 1) return { from: yesterday, to: yesterday };
      // Если > 90 дней — слишком много, безопасный fallback 30 дней.
      if (diffDays > 90) {
        return { from: shiftIsoDate(yesterday, -29), to: yesterday };
      }
      // Окно: от дня последнего sync до вчера (включительно).
      // Берём lastIso как начало (чтобы пере-захватить день, который мог быть
      // не полностью записан) — date-aware стейджи DELETE+INSERT в окне, так
      // что дубликатов не будет.
      const from = lastIso > yesterday ? yesterday : lastIso;
      return { from, to: yesterday };
    }
    case 'window':
    case 'custom':
      return null;
  }
}

/**
 * Человеческое описание пресета (для tooltip / hint под чипами). Для `auto`
 * показываем фактический рассчитанный диапазон, чтобы пользователь видел
 * что именно мы догрузим.
 */
export function describePreset(
  preset: DateRangePreset,
  lastSyncAtIso?: string | null,
  now: Date = new Date(),
): string {
  if (preset === 'auto') {
    const r = resolvePresetRange('auto', lastSyncAtIso, now);
    if (!r) return 'Авто';
    if (!lastSyncAtIso) return `Без истории sync → загрузим 30 дней (${r.from} → ${r.to})`;
    const days = diffDaysInclusive(r.from, r.to);
    return `Догрузим ${days} дн.: ${r.from} → ${r.to}`;
  }
  return PRESET_LABELS[preset];
}
