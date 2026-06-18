-- PURPOSE: разовая data-миграция под /app-префикс маршрутов.
-- Старые navigate.card в block_layouts.blocks (jsonb BlockInstance[]) хранят
-- config.href без /app (напр. '/cashflow') → префиксуем на '/app/cashflow'.
--
-- БЕЗОПАСНОСТЬ:
--   • Идемпотентна — повторный запуск ничего не меняет (guard NOT LIKE '/app/%').
--   • Внешние (http/mailto), лендинг '/', auth (/login,/register,/forgot-password,
--     /reset-password), /api и уже-мигрированные /app — НЕ трогаем.
--   • Затрагивает только строки с хотя бы одной navigate.card.
--
-- Дублирует runtime-нормализацию в navigate-card.tsx (normalizeNavHref) — это
-- «belt-and-suspenders», чтобы данные в БД тоже были корректны (а не только на рендере).
--
-- ЗАПУСКАЕТ ПОЛЬЗОВАТЕЛЬ (миграции не запускаются автоматически):
--   psql "$DATABASE_URL" -f drizzle/data/2026-06-19_app-prefix-navcards.sql

UPDATE block_layouts AS bl
SET blocks = sub.new_blocks,
    updated_at = now()
FROM (
  SELECT bl2.id,
         jsonb_agg(
           CASE
             WHEN elem->>'type' = 'navigate.card'
              AND (elem->'config'->>'href') LIKE '/%'
              AND (elem->'config'->>'href') NOT LIKE '/app/%'
              AND (elem->'config'->>'href') <> '/'
              AND (elem->'config'->>'href') !~ '^/(login|register|forgot-password|reset-password|api|app)(/|$)'
             THEN jsonb_set(elem, '{config,href}',
                            to_jsonb('/app' || (elem->'config'->>'href')))
             ELSE elem
           END
           ORDER BY ord
         ) AS new_blocks
  FROM block_layouts bl2,
       LATERAL jsonb_array_elements(bl2.blocks) WITH ORDINALITY AS t(elem, ord)
  WHERE bl2.blocks @> '[{"type":"navigate.card"}]'
  GROUP BY bl2.id
) AS sub
WHERE bl.id = sub.id
  AND bl.blocks @> '[{"type":"navigate.card"}]';
