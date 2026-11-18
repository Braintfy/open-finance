#!/usr/bin/env bash
# PURPOSE: PreToolUse-хук Claude Code — функциональный эквивалент path-scoped
# правил Cursor (.cursor/rules/*.mdc auto-attach по globs). Получает JSON
# события на stdin, по пути редактируемого файла подсказывает агенту, какой
# rules-файл прочитать перед правкой. Подсказка выдаётся один раз за сессию
# на каждый набор правил (маркер в $TMPDIR). Fail-open: при любой ошибке —
# exit 0 без вывода, правку не блокирует и разрешения не меняет.

set -u
INPUT="$(cat 2>/dev/null || true)"
# На Windows `python3` — заглушка Microsoft Store (есть в PATH, но ничего не исполняет),
# поэтому интерпретатор выбираем по факту работоспособности, а не по наличию имени.
PY_BIN=""
for candidate in python3 python; do
  if "$candidate" -c 'import sys' >/dev/null 2>&1; then PY_BIN="$candidate"; break; fi
done
[ -n "$PY_BIN" ] || exit 0
# PYTHONUTF8: иначе Windows читает скрипт из stdin в cp1251 и падает на кириллице.

PYTHONUTF8=1 "$PY_BIN" - "$INPUT" <<'PY' 2>/dev/null || exit 0
import json, os, sys, tempfile

try:
    event = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)

# Windows отдаёт путь с обратными слэшами — префиксы правил написаны с прямыми.
path = ((event.get("tool_input") or {}).get("file_path") or "").replace("\\", "/")
session = (event.get("session_id") or "nosession").replace("/", "_")
if not path:
    sys.exit(0)

# Порядок важен: специфичные области раньше общих (catalog/unit-* → unit-economics, не blocks).
RULES = [
    (("src/lib/ai/vpn/", "src/app/api/admin/ai/vpn", "vpn-card", "deploy/xray/"),
     "vless", ".cursor/rules/security.mdc — раздел «VLESS/Xray — граница доверия web→root» "
              "(НЕ ai-tools.mdc) плюс deploy/xray/README.md"),
    (("src/lib/auth/", "src/app/(auth)/", "src/middleware.ts", "src/lib/billing/",
      "src/lib/inbox/crypto", "src/lib/marketplaces/crypto", "src/lib/env.ts",
      "src/lib/legal.ts", "src/app/api/auth/", "src/app/api/billing/",
      "src/app/api/admin/", "src/app/app/admin/", "deploy/", "/.env"),
     "security", ".cursor/rules/security.mdc и ОБЯЗАТЕЛЬНО docs/SECURITY.md"),
    (("src/lib/workspaces/", "src/app/api/workspaces/", "src/components/workspaces/"),
     "workspaces", ".cursor/rules/drizzle.mdc (раздел «Workspace-скоуп») "
                   "и .cursor/rules/blocks.mdc (раздел «Workspace-скоуп раскладок»)"),
    (("src/lib/db/", "drizzle/"),
     "drizzle", ".cursor/rules/drizzle.mdc"),
    (("src/lib/marketplaces/", "src/app/api/marketplaces/", "src/components/marketplaces/",
      "src/app/app/marketplaces/", "src/app/app/settings/integrations/",
      "src/components/unit-economics/ozon-"),
     "marketplaces", ".cursor/rules/marketplaces.mdc"),
    (("src/lib/ai/", "src/app/api/ai/", "src/components/micro-agent/"),
     "ai-tools", ".cursor/rules/ai-tools.mdc"),
    (("src/lib/unit-economics/", "src/app/api/unit-economics/", "src/components/unit-economics/",
      "src/lib/blocks/catalog/unit-"),
     "unit-economics", ".cursor/rules/unit-economics.mdc"),
    (("src/lib/blocks/", "src/components/blocks/"),
     "blocks", ".cursor/rules/blocks.mdc"),
]

hint = key = None
for prefixes, name, files in RULES:
    if any(p in path for p in prefixes):
        hint, key = files, name
        break
if not hint:
    sys.exit(0)

marker = os.path.join(tempfile.gettempdir(), f"of-rules-hint-{session}-{key}")
if os.path.exists(marker):
    sys.exit(0)
try:
    open(marker, "w").close()
except Exception:
    pass

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": (
            f"Open Finance path-rules: для файла {path} действуют правила {hint}. "
            "Прочитай их перед правкой, если ещё не читал в этой сессии."
        ),
    }
}))  # ASCII-эскейпы: консоль Windows (cp1251) падает на не-ASCII выводе
PY
exit 0
