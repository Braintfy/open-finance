// PURPOSE: Сохранённый воркфлоу Open Finance — параллельный прогон всех smoke-тестов
// scripts/test-*.ts батчами по агентам со сводкой pass/fail и маппингом провалов на коммиты.
// Запуск: Workflow({ name: 'of-test-sweep' }) или Workflow({ name: 'of-test-sweep', args: 'ozon' }) — фильтр по подстроке имени.
export const meta = {
  name: 'of-test-sweep',
  description: 'Параллельный прогон всех smoke-тестов scripts/test-*.ts со сводкой pass/fail',
  whenToUse: 'Перед релизом, после крупного рефакторинга, по запросу «прогони все тесты». args (опц., string): подстрока-фильтр имени теста, напр. "ozon" или "my-store".',
  phases: [
    { title: 'Discover', detail: 'список scripts/test-*.ts' },
    { title: 'Run', detail: 'батчи по 4 теста на агента' },
    { title: 'Report', detail: 'сводка + маппинг провалов на последние коммиты' },
  ],
}

const ROOT = '.' // корень репозитория = cwd сессии (абсолютные пути не хардкодим — проект живёт на разных машинах)
const filter = typeof args === 'string' && args.trim() ? args.trim() : null

phase('Discover')
const LIST_SCHEMA = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string' } } },
  required: ['files'],
}
const discovered = await agent(
  `Выполни через Bash: ls ${ROOT}/scripts | grep '^test-.*\\.ts$'. Верни ВСЕ имена файлов (только имена, без пути).`,
  { label: 'discover', schema: LIST_SCHEMA }
)
const files = (discovered && discovered.files) || []
const targets = files.filter((f) => !filter || f.includes(filter))
if (!targets.length) {
  return { error: `Нет тестов под фильтр «${filter}». Всего найдено: ${files.length}.` }
}
log(`Тестов к запуску: ${targets.length}${filter ? ` (фильтр: ${filter})` : ''} из ${files.length}`)

const BATCH = 4
const batches = []
for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH))

phase('Run')
const RUN_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          ok: { type: 'boolean' },
          summary: { type: 'string', description: 'строка «N passed, M failed»; при провале — 1-2 ключевые упавшие проверки дословно' },
        },
        required: ['file', 'ok', 'summary'],
      },
    },
  },
  required: ['results'],
}
const runs = await parallel(
  batches.map((batch, i) => () =>
    agent(
      `Прогони smoke-тесты Open Finance ПО ОЧЕРЕДИ (cwd = ${ROOT}):
${batch.map((f) => `pnpm tsx scripts/${f}`).join('\n')}
Для каждого: ok = (exit code 0). В summary возьми итоговую строку «N passed, M failed» из вывода; при провале добавь 1-2 ключевые упавшие проверки дословно. ГРАБЛЯ: если pnpm tsx падает с «EPERM listen» — это песочница, перезапусти команду без sandbox. Тесты НЕ чинить, код НЕ менять — только запустить и отрепортить.`,
      { label: `batch-${i + 1}/${batches.length}`, phase: 'Run', schema: RUN_SCHEMA }
    )
  )
)

phase('Report')
const all = runs.filter(Boolean).flatMap((r) => r.results)
const failed = all.filter((r) => !r.ok)
const missing = targets.length - all.length
log(`Прошло: ${all.length - failed.length}/${all.length}; провалов: ${failed.length}${missing > 0 ? `; не отрепорчено агентами: ${missing}` : ''}`)

let blame = null
if (failed.length) {
  blame = await agent(
    `Smoke-тесты Open Finance провалились: ${JSON.stringify(failed)}. Выполни git -C ${ROOT} log --oneline -10 и git -C ${ROOT} status --short. Сопоставь провалы с последними коммитами/незакоммиченными правками по доменам имён тестов (ozon/my-store/sheet/period/...). Ответь кратко по-русски: тест → вероятная причина.`,
    { label: 'blame' }
  )
}

return {
  total: all.length,
  passed: all.length - failed.length,
  failed,
  notReported: missing > 0 ? missing : 0,
  blame,
}
