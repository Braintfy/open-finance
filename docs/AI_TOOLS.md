# AI_TOOLS.md — реестр AI-инструментов

> Все AI-tools проходят через `src/lib/ai/tools/`. Это единственный способ для AI мутировать данные.

## Принципы

1. **Типизация через Zod** — каждый tool описан схемой, преобразуется в JSON Schema для LLM
2. **Tenant context** — каждый handler получает `ctx.tenantId, ctx.userId, ctx.requestId`
3. **Audit log** — каждый вызов логируется в `ai_audit_log` таблицу
4. **Inverse action** — каждое действие может иметь обратное (для отката)
5. **Permission check** — tools проверяют tariff/role перед выполнением

## Стандартный интерфейс

```typescript
// src/lib/ai/tools/types.ts
import { z } from 'zod';

export type ToolContext = {
  tenantId: string;
  userId: string;
  requestId: string;
  agentId?: string;
};

export type Tool<TParams extends z.ZodTypeAny = z.ZodTypeAny, TResult = unknown> = {
  name: string;
  description: string; // для LLM, по-русски, кратко
  parameters: TParams;
  handler: (args: z.infer<TParams>, ctx: ToolContext) => Promise<TResult>;
  permissions?: {
    minPlan?: 'free' | 'trial_pro' | 'pro' | 'business' | 'enterprise';
    roles?: ('owner' | 'admin' | 'manager' | 'accountant' | 'viewer')[];
  };
  inverseAction?: (result: TResult, ctx: ToolContext) => Promise<void>;
};
```

## Реестр tools (по модулям)

### Транзакции
- `create_transaction` — создать запись о доходе/расходе
- `update_transaction` — изменить поля транзакции
- `delete_transaction` — удалить (soft-delete)
- `categorize_transaction` — назначить категорию
- `bulk_import_transactions` — импорт массива

### Блоки (модульный конструктор)
- `create_block` — создать виджет/блок на дашборде
- `update_block_data` — обновить inline-данные блока
- `move_block` — drag-n-drop позиция
- `delete_block` — удалить блок
- `apply_block_template` — применить шаблон (бюджет, ROI, поставки)

### Дедлайны
- `create_deadline` — добавить дедлайн на сущность
- `complete_deadline` — отметить выполненным
- `snooze_deadline` — отложить на N дней
- `setup_recurring` — повторяющийся (налоги, подписки)

### Налоги
- `calculate_tax` — рассчитать налог за период
- `compare_tax_modes` — сравнить «УСН 6% vs УСН 15%»
- `generate_kudir` — сгенерить КУДИР PDF/XLSX
- `find_tax_optimizations` — AI ищет способы оптимизации

### Inbox
- `process_inbox_file` — распарсить файл и создать сущности
- `approve_inbox_draft` — подтвердить черновик от AI
- `revert_inbox_action` — откатить разнесение

### Communications (AI-секретарь)
- `extract_contact` — извлечь контрагента из переписки
- `link_chat_to_order` — связать чат с заказом
- `create_reminder_from_chat` — напоминание из разговора
- `summarize_thread` — сжать переписку в факты

### Memory (RAG)
- `search_memory` — семантический поиск по embeddings
- `add_to_memory` — индексировать новый контент
- `forget` — удалить факты пользователя

### Reports
- `generate_report` — еженедельный/ежемесячный отчёт
- `forecast_cashflow` — прогноз 30/60/90 дней
- `detect_anomaly` — найти аномалии в транзакциях

### AI-агенты (Phase 2)
- `create_agent` — создать кастомного агента со скилами
- `run_agent_now` — запустить агента вне расписания
- `get_agent_skills` — список доступных скилов

## Чек-лист добавления нового tool

- [ ] Создан файл `src/lib/ai/tools/{verb-noun}.ts`
- [ ] Comment-header `// PURPOSE: ...`
- [ ] Параметры через Zod
- [ ] Description на русском, кратко
- [ ] Permission check (если нужен)
- [ ] Inverse action (если действие можно откатить)
- [ ] Handler возвращает результат с `auditId` для логирования
- [ ] Добавлен в `src/lib/ai/tools/index.ts`
- [ ] Тест: положительный кейс + RLS проверка (другой tenant)

## Audit log

После каждого вызова tool:

```typescript
await db.insert(aiAuditLog).values({
  tenantId: ctx.tenantId,
  agentId: ctx.agentId,
  toolName: tool.name,
  args: redactSensitive(args), // удалить пароли/ключи перед записью
  result: result,
  inverseAction: inverseDescriptor,
});
```

Пользователь видит лог в `/dashboard/ai-history` — может откатить любое действие.

## Защита от вредоносных вызовов

- **Pre-flight check** — нагрузка по токенам не превышена
- **Permission gate** — роль/тариф позволяют
- **Rate limiting** — не более X вызовов одного tool в минуту
- **Confirmation для destructive** — `delete_*` требуют явного подтверждения пользователя

## Связь с PaymentProvider / 152-ФЗ

- Tools НИКОГДА не дёргают платёжные API напрямую — только через `src/lib/billing/`
- Tools НЕ хранят raw переписки — только сущности (см. SECURITY.md)
