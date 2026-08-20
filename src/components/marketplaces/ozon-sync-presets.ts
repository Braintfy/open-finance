// PURPOSE: Pure-функции для расчёта диапазонов sync-пресетов
// (v0.22.2). Вынесены из `ozon-sync-dialog.tsx` ('use client') в обычный
// модуль, чтобы их можно было покрыть unit-тестами без mount React.
//
// БЕЗ импортов БД — покрытие данными приходит параметром (`coveredThroughIso`),
// его считает `getAnalyticsCoverageByAccount()` в `lib/marketplaces/queries.ts`.
//
// Использование:
//   import { resolvePresetRange, describePreset } from './ozon-sync-presets';
//   const range = resolvePresetRange('auto', account.lastSyncAt, undefined,
//                                    account.analyticsCoveredThrough);
//   const hint  = describePreset('auto', account.lastSyncAt, undefined,
//                                account.analyticsCoveredThrough);
//
// Инвариант `auto` (v0.51.1): начало окна = БОЛЕЕ РАННЯЯ из двух дат —
// (день последнего фактического покрытия `ozon_analytics_daily`) и (день,
// который даёт логика по `lastSyncAt`). Так дыра в данных затягивается
// следующим же sync'ом, а привычное «догрузить только вчера» сохраняется,
// когда дыр нет. Опора только на `lastSyncAt` создавала дыры: упавший sync
// двигал таймстамп, окно схлопывалось в 1 день, пропущенные дни не
// запрашивались уже никогда.

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
 * Предохранитель: максимальная ширина `auto`-окна. Ozon ограничивает окно
 * аналитики ~90 днями (`analyticsWindowDays` по умолчанию 90), плюс это
 * защита от «мегасинка» после долгого простоя. Если расчётное окно шире —
 * clamp'им и честно сообщаем об этом в `describePreset`.
 */
export const MAX_AUTO_WINDOW_DAYS = 90;

export type PresetRange = {
  from: string;
  to: string;
  /** Окно урезано до `MAX_AUTO_WINDOW_DAYS` — часть дыры остаётся незакрытой. */
  clamped?: boolean;
  /** Окно расширено назад из-за отставания фактического покрытия данными. */
  gapDetected?: boolean;
};

/** Начало окна по «старой» логике — от `lastSyncAt`. */
function autoStartFromLastSync(
  lastSyncAtIso: string | null | undefined,
  now: Date,
  yesterday: string,
): string {
  const fallback30 = shiftIsoDate(yesterday, -29);
  // Без lastSyncAt → 30 дней (типичное окно по умолчанию).
  if (!lastSyncAtIso) return fallback30;
  const last = new Date(lastSyncAtIso);
  if (Number.isNaN(last.getTime())) return fallback30;
  const lastIso = last.toISOString().slice(0, 10);
  const diffDays = Math.max(
    0,
    Math.floor((now.getTime() - last.getTime()) / (24 * 3600 * 1000)),
  );
  // Если последний sync был сегодня/вчера — догружаем только вчера
  // (сегодня ещё не закрыто Ozon-ом для аналитики).
  if (diffDays <= 1) return yesterday;
  // Окно: от дня последнего sync до вчера (включительно).
  // Берём lastIso как начало (чтобы пере-захватить день, который мог быть
  // не полностью записан) — date-aware стейджи DELETE+INSERT в окне, так
  // что дубликатов не будет. lastIso в будущем (кривые часы) → yesterday.
  return lastIso > yesterday ? yesterday : lastIso;
}

/**
 * Начало окна по фактическому покрытию. Сам день покрытия включаем в окно:
 * последний записанный день мог быть неполным (sync упал на середине).
 * Покрытие «по сегодня/вперёд» дыры не даёт → null.
 */
function autoStartFromCoverage(
  coveredThroughIso: string | null | undefined,
  yesterday: string,
): string | null {
  if (!coveredThroughIso) return null;
  const iso = coveredThroughIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return iso > yesterday ? null : iso;
}

/**
 * Резолвит диапазон для пресета. Для `auto` учитываются ОБА сигнала:
 * `lastSyncAtIso` (когда запускали sync) и `coveredThroughIso` (по какой день
 * реально есть строки в `ozon_analytics_daily`) — берётся более раннее начало.
 * Для `window`/`custom` возвращаем null — UI берёт диапазон из других мест
 * (settings / user input).
 *
 * `now` экспортирован для тестов (фиксируем «сегодня» MSC).
 */
export function resolvePresetRange(
  preset: DateRangePreset,
  lastSyncAtIso?: string | null,
  now: Date = new Date(),
  coveredThroughIso?: string | null,
): PresetRange | null {
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
      let from = autoStartFromLastSync(lastSyncAtIso, now, yesterday);
      const fromCoverage = autoStartFromCoverage(coveredThroughIso, yesterday);

      // Дыра в данных: покрытие отстаёт от того, что даёт lastSyncAt.
      // Расширяем окно назад — так дыра затягивается следующим же sync'ом.
      let gapDetected = false;
      if (fromCoverage && fromCoverage < from) {
        from = fromCoverage;
        gapDetected = true;
      }

      // Предохранитель: не шире MAX_AUTO_WINDOW_DAYS (включительно).
      let clamped = false;
      const earliest = shiftIsoDate(yesterday, -(MAX_AUTO_WINDOW_DAYS - 1));
      if (from < earliest) {
        from = earliest;
        clamped = true;
      }
      if (from > yesterday) from = yesterday;

      const range: PresetRange = { from, to: yesterday };
      if (gapDetected) range.gapDetected = true;
      if (clamped) range.clamped = true;
      return range;
    }
    case 'window':
    case 'custom':
      return null;
  }
}

/**
 * Человеческое описание пресета (для tooltip / hint под чипами). Для `auto`
 * показываем фактический рассчитанный диапазон, чтобы пользователь видел
 * что именно мы догрузим — включая обнаруженную дыру в данных и урезание
 * окна по `MAX_AUTO_WINDOW_DAYS` (молча сужать окно нельзя: пользователь
 * должен понимать, что часть дыры придётся догрузить вручную).
 */
export function describePreset(
  preset: DateRangePreset,
  lastSyncAtIso?: string | null,
  now: Date = new Date(),
  coveredThroughIso?: string | null,
): string {
  if (preset !== 'auto') return PRESET_LABELS[preset];

  const r = resolvePresetRange('auto', lastSyncAtIso, now, coveredThroughIso);
  if (!r) return 'Авто';
  const days = diffDaysInclusive(r.from, r.to);

  let text =
    !lastSyncAtIso && !r.gapDetected
      ? `Без истории sync → загрузим ${days} дней (${r.from} → ${r.to})`
      : `Догрузим ${days} дн.: ${r.from} → ${r.to}`;

  if (r.gapDetected) {
    const covered = (coveredThroughIso ?? '').slice(0, 10);
    text += ` · дыра в данных: аналитика есть только по ${covered}`;
  }
  if (r.clamped) {
    text +=
      ` · окно урезано до ${MAX_AUTO_WINDOW_DAYS} дн. (лимит аналитики Ozon)` +
      ' — более ранние дни догрузите пресетом «Произвольный диапазон»';
  }
  return text;
}
