// PURPOSE: Pure-функции нормализации дат от Ozon Performance API.
// Вынесены в отдельный модуль (без импорта db client), чтобы
// тестировать без поднятия env/Drizzle.

/**
 * Парсит дату от Ozon Performance API в формат `YYYY-MM-DD` или null.
 *
 * Зачем: Ozon отдаёт `"toDate": ""` для бессрочных кампаний — пустая
 * строка крашит INSERT в `date` колонку PostgreSQL с ошибкой
 * `invalid input syntax for type date: ""`.
 *
 * Поддерживаемые входы:
 *  - `""` / `"   "` → null
 *  - `"2026-04-07"` → `"2026-04-07"`
 *  - `"2026-04-07T13:16:59Z"` → `"2026-04-07"`
 *  - не-строки → null
 */
export function toDateOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length < 10) return null;
  return trimmed.slice(0, 10);
}
