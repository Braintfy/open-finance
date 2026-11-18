// PURPOSE: Сохранённый воркфлоу Open Finance — аудит дрейфа правил между всеми файлами
// агентной обвязки (CLAUDE.md / START.md / AGENTS.md / .cursor/rules / .claude/* / MEMORY.md):
// хардкоженные версии, мёртвые ссылки, противоречивые процедуры, скопированные правила.
// Запуск: Workflow({ name: 'of-rules-audit' }). Рекомендуется на минорный релиз / раз в квартал.
export const meta = {
  name: 'of-rules-audit',
  description: 'Аудит дрейфа правил: версии, мёртвые ссылки, противоречия между CLAUDE.md/.cursor/rules/.claude/AGENTS.md/START.md',
  whenToUse: 'На минорный релиз или раз в квартал; после правок инвариант-файлов; по запросу «проверь, не разъехались ли правила».',
  phases: [
    { title: 'Scan', detail: 'параллельные аудиторы по группам файлов' },
    { title: 'Cross-check', detail: 'сверка противоречий между группами' },
  ],
}

const ROOT = '.' // корень репозитория = cwd сессии (абсолютные пути не хардкодим — проект живёт на разных машинах)

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    staleVersions: { type: 'array', items: { type: 'string' }, description: 'хардкоженные версии vX.Y.Z с указанием файла:строки (текущая версия = первый ## [X.Y.Z] в CHANGELOG.md)' },
    deadRefs: { type: 'array', items: { type: 'string' }, description: 'ссылки на несуществующие файлы/команды/инструменты (проверять существование через ls/Glob!)' },
    contradictions: { type: 'array', items: { type: 'string' }, description: 'утверждения, противоречащие другим файлам группы или фактическому состоянию репо' },
    copiedRules: { type: 'array', items: { type: 'string' }, description: 'места, где правило продублировано текстом вместо ссылки на источник' },
  },
  required: ['staleVersions', 'deadRefs', 'contradictions', 'copiedRules'],
}

const COMMON = `Ты аудитор консистентности документации Open Finance (${ROOT}). Текущая версия проекта = ПЕРВЫЙ заголовок ## [X.Y.Z] в CHANGELOG.md — прочитай его первые 5 строк. Принципы проекта: версии нигде не хардкодятся; правила живут в .cursor/rules/*.mdc и НЕ копируются в .claude/ (там только ссылки и процедуры); mempalace deprecated (замена — agentmemory). Каждую подозрительную ссылку на файл ПРОВЕРЯЙ через ls/Glob, не верь тексту. Репортуй только реальные проблемы с файл:строка.`

phase('Scan')
const groups = await parallel([
  () => agent(`${COMMON}\nПроверь корневые файлы: CLAUDE.md, START.md, AGENTS.md, README.md.`,
    { label: 'audit:root-docs', schema: AUDIT_SCHEMA }),
  () => agent(`${COMMON}\nПроверь все .cursor/rules/*.mdc (список — ls .cursor/rules/).`,
    { label: 'audit:cursor-rules', schema: AUDIT_SCHEMA }),
  () => agent(`${COMMON}\nПроверь всю обвязку .claude/: agents/*.md, skills/*/SKILL.md, workflows/*.js, settings*.json, README.md. Особо: каждый упомянутый путь к файлу проекта существует; команды (pnpm-скрипты) есть в package.json; имена скилов/агентов в перекрёстных ссылках совпадают с фактическими.`,
    { label: 'audit:claude-env', schema: AUDIT_SCHEMA }),
  () => agent(`${COMMON}\nПроверь MEMORY.md (большой файл — сначала wc -l, читай частями) и первые 100 строк LEARNING_LOG.md: ссылки на файлы существуют, команды актуальны, размер MEMORY.md в бюджете (~450 строк).`,
    { label: 'audit:memory', schema: AUDIT_SCHEMA }),
])

phase('Cross-check')
const valid = groups.filter(Boolean)
const report = await agent(
  `Сведи результаты 4 аудиторов консистентности Open Finance в один отчёт (JSON ниже). Дедуплицируй, отсортируй по серьёзности: (1) противоречия процедур, (2) мёртвые ссылки, (3) устаревшие версии, (4) копии правил. Для каждой проблемы — конкретная правка (файл, что заменить на что). Отметь и то, что в порядке. По-русски.\n${JSON.stringify(valid, null, 2)}`,
  { label: 'cross-check' }
)

return { groups: valid, report }
