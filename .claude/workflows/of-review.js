// PURPOSE: Сохранённый воркфлоу Open Finance — мультиагентный ревью диффа по 5 доменным
// измерениям (tenant/SQL, blocks/React, деньги/формат, security, AI-слой) с адверсариальной
// верификацией каждой находки (2 скептика, находка живёт только если оба не опровергли).
// Запуск: Workflow({ name: 'of-review' }) — рабочее дерево против HEAD (если чисто — последний коммит);
//         Workflow({ name: 'of-review', args: 'main' }) — дифф против указанного git-ref.
export const meta = {
  name: 'of-review',
  description: 'Мультиагентный ревью диффа по инвариантам Open Finance с адверсариальной проверкой находок',
  whenToUse: 'Перед выдачей git-команд для коммита значимых изменений: «проревьюй изменения», «ревью диффа». args (опц., string): git-ref базы диффа.',
  phases: [
    { title: 'Review', detail: '5 доменных ревьюеров параллельно' },
    { title: 'Verify', detail: '2 скептика на находку' },
    { title: 'Synthesize', detail: 'итоговый отчёт' },
  ],
}

const ROOT = '/Users/firay/open-finance/open-finance'
const base = typeof args === 'string' && args.trim() ? args.trim() : null
const DIFF_INSTRUCTION = base
  ? `Дифф для ревью: git -C ${ROOT} diff ${base}`
  : `Дифф для ревью: git -C ${ROOT} diff HEAD (незакоммиченное). Если он пуст — ревьюй последний коммит: git -C ${ROOT} show HEAD.`

const DIMENSIONS = [
  {
    key: 'tenant-sql',
    rules: `Сначала прочитай ${ROOT}/.cursor/rules/drizzle.mdc. Проверяй: tenant_id в каждом DB-запросе и каждой новой таблице; top-level try/catch + NextResponse.json({ok:false,error}) во всех routes; Date в raw sql только через toISOString()+::timestamp; JSONB merge через || c JSON.stringify; onConflictDoUpdate с COALESCE-fallback; регистрация новых таблиц в schema/index.ts.`,
  },
  {
    key: 'blocks-react',
    rules: `Сначала прочитай ${ROOT}/.cursor/rules/blocks.mdc. Проверяй: hooks (useBlockValuePublisher/useMemo/useState/useEffect) выше early-returns; parseConfig только через useMemo; BlockDef не через RSC props (iconName string); DndContext id={useId()}; пользовательский выбор персистится через onConfigChange; нативный select в шапках запрещён (DropdownSelect); min-w-0 в DialogContent; sticky-конвенции (bg-card, z-index 45/36/35/30, PIN_SHADOW); window/localStorage не в useState-инициализаторе; import type из route-файлов; key={blockId} в shell-модалках.`,
  },
  {
    key: 'money-format',
    rules: `Сначала прочитай раздел «Universal грабли» в ${ROOT}/MEMORY.md (Grep по «Universal грабли», читай ~30 строк). Проверяй: деньги в useBlockValuePublisher — копейки (×100) + __money; курс валют НЕ money; moneyRefs в config (не эвристика по имени); formatRublesWithSettings принимает копейки; Intl.NumberFormat кэшируется на модульном уровне; decimals-резолверы.`,
  },
  {
    key: 'security',
    rules: `Сначала прочитай ${ROOT}/.cursor/rules/security.mdc и ${ROOT}/docs/SECURITY.md. Проверяй: секреты/ключи/токены/пароли в диффе (sk-*, ghp_*, api_key=); .env-файлы; bcryptjs в edge/middleware; api_key только AES-256-GCM + maskSecret на клиент/в логи; новые env → src/lib/env.ts и .env.example; хардкод URL/ключей.`,
  },
  {
    key: 'ai-layer',
    rules: `Сначала прочитай ${ROOT}/.cursor/rules/ai-tools.mdc. Проверяй: новые AI-маршруты через resolvePromptStack() + getActiveCredentials(); NDJSON (start/token/done/error/aborted); AI-мутации только через Tools Layer (регистрация в tools/index.ts); cross-section контекст — серверный резолв по refs (телу клиента не доверять); паритет токенов через общий билдер; js-tiktoken lazy client-only.`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string', description: 'что нарушено, какое правило, как чинить' },
          severity: { type: 'string', enum: ['blocker', 'warning'] },
        },
        required: ['file', 'title', 'detail', 'severity'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(
      `Ты ревьюер Open Finance, измерение «${d.key}». ${DIFF_INSTRUCTION}\n${d.rules}\nРевьюй ТОЛЬКО изменённые строки диффа (контекст файлов читать можно). Не выдумывай находки ради объёма — пустой findings валиден. Ничего не правь.`,
      { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }
    ),
  (review, d) =>
    parallel(
      ((review && review.findings) || []).map((f) => () =>
        parallel(
          [1, 2].map((n) => () =>
            agent(
              `Адверсариально ОПРОВЕРГНИ находку ревью Open Finance (скептик #${n}). Находка: ${JSON.stringify(f)}. Прочитай реальный код вокруг ${f.file}${f.line ? `:${f.line}` : ''} и сам дифф (${DIFF_INSTRUCTION.replace('Дифф для ревью: ', '')}). refuted=true если: код на самом деле корректен, правило неприменимо к этому месту, находка про неизменённые строки, или это вкусовщина без правила. При неуверенности — refuted=true.`,
              { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
            )
          )
        ).then((votes) => ({
          ...f,
          dimension: d.key,
          confirmed: votes.filter(Boolean).filter((v) => !v.refuted).length === 2,
          skepticNotes: votes.filter(Boolean).map((v) => v.reason),
        }))
      )
    )
)

const flat = results.filter(Boolean).flat().filter(Boolean)
const confirmed = flat.filter((f) => f.confirmed)
const rejected = flat.length - confirmed.length
log(`Находок: ${flat.length}, подтверждено скептиками: ${confirmed.length}, отсеяно: ${rejected}`)

return {
  blockers: confirmed.filter((f) => f.severity === 'blocker'),
  warnings: confirmed.filter((f) => f.severity === 'warning'),
  rejectedCount: rejected,
}
