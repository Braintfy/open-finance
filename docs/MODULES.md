# MODULES.md — как добавить модуль

## Что такое модуль

В Open Finance модуль — это **самодостаточная бизнес-фича**, которая:
- Имеет свои таблицы в БД (опционально)
- Регистрирует свои виджеты в Module Registry
- Предоставляет AI-tools для своих сущностей
- Может быть включён/выключен пользователем

## Структура модуля

```
src/modules/{name}/
├── README.md           # 1-2 параграфа: что это, зачем
├── index.ts            # Экспорт регистрации модуля
├── schema.ts           # Drizzle таблицы (опционально)
├── widgets/            # React-компоненты для дашборда
├── tools/              # AI-tools для этого модуля
├── api/                # tRPC роутеры или Server Actions
└── lib/                # Утилиты, расчёты
```

## Минимальный модуль

```typescript
// src/modules/myfeature/index.ts
import type { Module } from '@/lib/modules/types';
import { MyWidget } from './widgets/MyWidget';
import { myTools } from './tools';

export const myFeatureModule: Module = {
  slug: 'myfeature',
  name: 'My Feature',
  icon: 'Sparkles', // Lucide icon name
  description: 'Краткое описание для пользователя',
  category: 'finance', // 'finance' | 'analytics' | 'automation' | 'ai'
  widgets: [
    {
      slug: 'my-widget',
      name: 'My Widget',
      component: MyWidget,
      defaultSize: 'md',
    },
  ],
  tools: myTools,
  // Минимальный тариф для активации модуля
  minPlan: 'free', // 'free' | 'pro' | 'business' | 'enterprise'
};
```

## Регистрация модуля

```typescript
// src/lib/modules/registry.ts
import { myFeatureModule } from '@/modules/myfeature';

export const moduleRegistry = [
  cashflowModule,
  taxesModule,
  myFeatureModule, // ← добавить сюда
];
```

## Чек-лист при добавлении модуля

- [ ] Создана папка `src/modules/{name}/` с `README.md`
- [ ] Comment-headers в каждом файле (`// PURPOSE: ...`)
- [ ] Все таблицы имеют `tenantId` колонку
- [ ] AI-tools зарегистрированы в `src/lib/ai/tools/index.ts`
- [ ] Виджеты типизированы и имеют пропсы `tenantId`
- [ ] Если нужны фоновые задачи — добавлен worker в `workers/`
- [ ] Если нужны secrets — описаны в `docs/SECURITY.md` и `.env.example`
- [ ] Обновлён CHANGELOG

## Примеры готовых модулей

См. реальные примеры:
- `src/modules/cashflow/` — денежный поток
- `src/modules/taxes/` — налоги (УСН/НДС/ПСН/...)
- `src/modules/inbox/` — drop-папка для AI
- `src/modules/communications/` — AI-секретарь
