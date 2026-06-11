#!/usr/bin/env bash
# PURPOSE: PreToolUse-хук Claude Code — функциональный эквивалент path-scoped
# правил Cursor (.cursor/rules/*.mdc auto-attach по globs). Получает JSON
# события на stdin, по пути редактируемого файла подсказывает агенту, какой
# rules-файл прочитать перед правкой. Подсказка выдаётся один раз за сессию
# на каждый набор правил (маркер в $TMPDIR). Fail-open: при любой ошибке —
# exit 0 без вывода, правку не блокирует и разрешения не меняет.

set -u
INPUT="$(cat 2>/dev/null || true)"
command -v python3 >/dev/null 2>&1 || exit 0

python3 - "$INPUT" <<'PY' 2>/dev/null || exit 0
import json, os, sys, tempfile

try:
    event = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)

path = (event.get("tool_input") or {}).get("file_path") or ""
session = (event.get("session_id") or "nosession").replace("/", "_")
if not path:
    sys.exit(0)

# Порядок важен: специфичные области раньше общих (catalog/unit-* → unit-economics, не blocks).
RULES = [
    (("src/lib/auth/", "src/app/(auth)/", "src/middleware.ts", "src/lib/billing/",
      "src/lib/inbox/crypto", "src/lib/marketplaces/crypto", "src/lib/env.ts",
      "src/app/api/auth/", "src/app/api/billing/", "/.env"),
     "security", ".cursor/rules/security.mdc и ОБЯЗАТЕЛЬНО docs/SECURITY.md"),
    (("src/lib/db/", "drizzle/"),
     "drizzle", ".cursor/rules/drizzle.mdc"),
    (("src/lib/marketplaces/", "src/app/api/marketplaces/", "src/components/marketplaces/",
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
}, ensure_ascii=False))
PY
exit 0
