# Cashflow Module

**Назначение:** денежный поток — учёт доходов/расходов, остаток, прогноз.

## Что внутри (Этап 2 PLAN.md)
- Виджеты: KPI (доход/расход/остаток), график тренда, P&L, cashflow forecast 30/60/90 дней
- AI tools: `query_cashflow`, `forecast_cashflow`, `find_cashflow_anomaly`
- Использует таблицу `transactions` (см. `src/lib/db/schema/transactions.ts`)

## Минимальный план: Free
Free пользователь видит базовый виджет «остаток на сегодня» и тренд. Прогноз и аномалии — Pro.
