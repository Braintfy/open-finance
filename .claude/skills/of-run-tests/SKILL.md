---
name: of-run-tests
version: 1.0.0
description: |
  Run Open Finance smoke tests (scripts/test-*.ts) — all or filtered by domain. There is NO test runner (no vitest/jest); each script is standalone with exit code 1 on failure.
  TRIGGER when: user says «прогони тесты», «smoke», «запусти тесты по X», or after edits to pure modules covered by scripts/test-*.ts.
  DO NOT TRIGGER when: user explicitly asks for the multi-agent sweep (use Workflow of-test-sweep instead) or for build verification only (use of-verify).
allowed-tools:
  - Bash
  - Read
  - Glob
---

# Smoke-тесты Open Finance

Единого тест-раннера НЕТ. Самодостаточные скрипты `scripts/test-*.ts` (актуальный список — `ls scripts | grep '^test-'`), каждый запускается отдельно:

```bash
pnpm tsx scripts/test-<name>.ts     # exit 1 при провале, в выводе «N passed, M failed»
```

**Грабли:** `pnpm tsx` в песочнице падает с `EPERM listen` — запускать без sandbox. Pure-helpers для тестов не должны импортировать db client (иначе `ZodError: DATABASE_URL Required`).

## Карта доменов → тесты

| Домен изменений | Скрипты `scripts/test-*` |
|---|---|
| Ozon API / sync / аналитика | `ozon-upsert`, `ozon-sync-diff`, `ozon-sync-presets`, `ozon-sync-incremental`, `ozon-analytics`, `ozon-import-mapping`, `ozon-perf-{client,campaigns,period}`, `ozon-warehouse-stocks`, `ozon-cluster-agg`, `ozon-ai-insights-parse` (CSV-парсер дополнительно проверяется `scripts/debug-ozon-perf-csv.ts`) |
| Слой метрик (`src/lib/metrics/**`, `docs/METRICS_LAYER_DESIGN.md`) | `metrics-{lines,formulas,period,allocate,resolve-link,tax}`, `stock-cost-series`; при правке `tax.ts` — ещё `unit-economics` и `yandex-calc` (калькуляторы импортируют `calcUnitTax`) |
| Блоки / формулы / sheet / custom.data | `custom-data-formulas`, `sheet-fill`, `sheet-import-export`, `block-import-export`, `fill-handle`, `formula-pick-mode`, `source-binding`, `source-context`, `virtual-sources`, `blockgrid-responsive` |
| Периоды | `block-period`, `page-period-context`, `period-panel-visibility`, `period-picker` |
| Юнит-экономика / Мой магазин | `unit-economics`, `my-store-compute`, `decimal-resolution`, `unit-tabs-crud` |
| KPI / cashflow | `kpi-grid-config`, `cashflow-kpi`, `tinkoff-import` |
| AI | `prompt-resolver`, `vision-router`, `ozon-ai-insights-parse` |
| Воркспейсы («кабинеты») | `workspace-templates` |
| VPN / VLESS | `vless-parse` |

Если домен неочевиден — `ls scripts/ | grep '^test-'` и выбрать по именам. **Карту не считать полной**: при добавлении нового `scripts/test-*.ts` дописывать сюда строку (иначе домен молча выпадает из прогонов).

## Прогон всех

```bash
fails=""; for f in scripts/test-*.ts; do pnpm tsx "$f" >/tmp/of-test.log 2>&1 || fails="$fails $f"; done; echo "FAILED:${fails:- none}"
```

Для параллельного мультиагентного прогона со сводкой — воркфлоу `of-test-sweep` (`.claude/workflows/of-test-sweep.js`).

## Новый smoke-тест (конвенция)

Шапка `// PURPOSE: ...` + строка `// Запуск: pnpm tsx scripts/test-<name>.ts`, самописные `ok()/expect()` со счётчиками, итог `N passed, M failed`, `process.exit(1)` при провале. Только pure-функции — без БД/HTTP. НЕ добавлять vitest/jest.
