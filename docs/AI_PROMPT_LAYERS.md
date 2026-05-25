# AI Prompt Layers — иерархия промптов

> Актуально для v0.24.0+. Реализовано в `src/lib/ai/prompt-resolver.ts`.

## Концепция

Каждый AI-запрос в Open Finance проходит через composer `resolvePromptStack()`, который собирает system prompt из 9 слоёв (от самого общего к самому специфичному). Более специфичный слой **дополняет**, не заменяет предыдущие.

```
global → section-group → per-page → block-skill → supplement → capabilities → snapshot
```

## Слои (сверху вниз = от общего к частному)

| # | Слой | Где хранится | Кто управляет |
|---|------|-------------|---------------|
| 1 | **Global** | `tenants.settings.aiSystemPrompt` или `DEFAULT_SYSTEM_PROMPT` | Админ |
| 2 | **Micro-agent system** | Hardcoded в `prompt-resolver.ts` (scope: block/pointwise) | Код |
| 3 | **Section group** | `SECTION_GROUP_DEFAULTS[groupId]` или tenant override `aiPrompts.sections.groups` | Код + Админ |
| 4 | **Per-page** | `PAGE_KEY_HINTS[pageKey]` или tenant override `aiPrompts.sections.pages` | Код + Админ |
| 5 | **Block-type skill** | `BLOCK_SKILLS[blockType]` или tenant override `aiPrompts.blocks[type]` | Код + Админ |
| 6 | **Pointwise** | `DEFAULT_POINTWISE_PROMPT` или tenant override `aiPrompts.pointwise` (scope: pointwise) | Код + Админ |
| 7 | **User supplement** | `BlockInstance.aiPromptSupplement` (max 500 chars) | Пользователь |
| 8 | **Legacy aiPrompt** | `BlockInstance.aiPrompt` (deprecated, fallback) | Пользователь |
| 9 | **Block capabilities** | `BLOCK_CAPABILITIES[blockType]` (scope: block) | Код |
| 10 | **Data snapshot** | `blockData` (config) + `publishedValue` (live) | Runtime |
| 11 | **Section context** | Список блоков страницы (scope: section) | Runtime |
| 12 | **Quick action** | `QUICK_ACTIONS[id].prompt` | UI/Runtime |

## API

```typescript
import { resolvePromptStack } from '@/lib/ai/prompt-resolver';

const { systemPrompt, meta } = resolvePromptStack({
  tenantSettings,      // TenantSettings | null
  pageKey: 'cashflow', // для section и page слоёв
  blockType: 'stat.income',
  blockTitle: 'Доходы',
  blockData: { ... },  // block config snapshot
  aiPromptSupplement: 'Отвечай только на русском',
  publishedValue: { value: 150000, __money: 'value' },
  scope: 'block',      // 'block' | 'section' | 'pointwise'
});

// meta.layers: ['global', 'micro-agent', 'section', 'block-skill', 'supplement', ...]
```

## Scope

| Scope | Когда | Включает слои |
|-------|-------|---------------|
| `block` | Micro-agent диалог конкретного блока | global, micro-agent, section, block-skill, supplement, capabilities, snapshot |
| `section` | «AI Анализ» раздела (`/api/ai/analyze-section`) | global, section, block-skill (нет), section-context |
| `pointwise` | Анализ dependency-tree | global, micro-agent, section, pointwise, supplement |

## Section Groups

Группы определены в `src/lib/ai/sections.ts`:

| ID | Label | pageKeys |
|----|-------|---------|
| `dashboard` | Главная | `dashboard` |
| `finance` | Финансы | `cashflow` |
| `marketplaces` | Маркетплейсы | `marketplaces-ozon-dashboard` |
| `unit-economics` | Юнит-экономика | `/^unit-economics-/` |
| `inbox` | Входящие | `inbox` |
| `boards` | Доски | `/^board-/` |

## Block Skills

Файлы `src/lib/ai/prompts/block-skills/`:
- `cashflow.ts` — 7 cashflow-блоков (stat.income/expense/balance/custom, top-categories, transactions, chart)
- `sheet.ts` — 3 spreadsheet-блока (sheet, excel.cell, custom.data)
- `ozon.ts` — 11 Ozon-блоков (kpi/chart/analytics/abc/campaigns/…)
- `unit-economics.ts` — 4 UE-блока (ozon-calculator, multi-table, yandex-calculator, my-store-table)
- `generic.ts` — остальные (navigate.card, computed.sum, ai.micro-agent, inbox, currency.rates)

## Admin Override

Через `/admin/ai/system-prompt` (4 tab'а: Глобальный / Разделы / Блоки / Точечные):

```
tenants.settings.aiPrompts = {
  sections: {
    groups: { 'finance': 'Кастомный промпт для финансов...' },
    pages:  { 'cashflow': 'Промпт только для cashflow...' }
  },
  blocks: {
    'stat.income': 'Кастомный skill для блока доходов...'
  },
  pointwise: 'Кастомный pointwise prompt...'
}
```

## User Keys

Пользователь может подключить свои AI-ключи в `/settings/ai`:
- DeepSeek, Yandex GPT, GigaChat, VseGPT (без VPN из РФ)
- OpenAI, Anthropic, OpenRouter (через VPN)

Хранятся в `user_ai_credentials` таблице. Приоритет над admin-ключами если `enabled=true`.

Резолвер: `getActiveCredentials()` в `src/lib/ai/user-keys.ts`.

## Section AI

Кнопка **«AI Анализ»** (Sparkles) в header каждого раздела:
- `/dashboard`, `/cashflow`, `/inbox`, `/marketplaces/ozon`, `/unit-economics`, `/boards/[id]`

Компоненты: `section-ai-button.tsx`, `section-ai-dialog.tsx`  
Endpoint: `POST /api/ai/analyze-section`

Параметры запроса:
```json
{
  "pageKey": "cashflow",
  "scope": "all" | "subgraph",
  "userQuery": "необязательный вопрос",
  "blockIds": ["..."]
}
```

`scope: 'subgraph'` — автоматически выбирает связанные блоки (dependency tree).

## Добавление нового блока

1. Добавить skill в нужный файл `src/lib/ai/prompts/block-skills/`.
2. Экспортировать из `index.ts`.
3. (Опц.) Добавить в `BLOCK_CAPABILITIES` для технического формата config.
4. Пользователь может дописать доп. промпт в Settings dialog блока (таб «AI / Промпт»), до 500 символов.
