#!/usr/bin/env bash
# PURPOSE: Установить git hooks для проекта (pre-push для sync-mempalace, pre-commit для secret check).
# Запускать один раз после клонирования или ручного pull.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "ERROR: $HOOKS_DIR не существует. Это git репозиторий?"
  exit 1
fi

# pre-push hook — sync mempalace
cat > "$HOOKS_DIR/pre-push" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by scripts/install-hooks.sh
# Sync MemPalace context перед каждым push.

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
SYNC_SCRIPT="$PROJECT_ROOT/scripts/sync-mempalace.sh"

if [ -x "$SYNC_SCRIPT" ]; then
  echo "[pre-push] Синхронизирую MemPalace source..."
  "$SYNC_SCRIPT" || echo "[pre-push] WARN: sync-mempalace failed (не блокируем push)"
fi

exit 0
EOF
chmod +x "$HOOKS_DIR/pre-push"
echo "[install-hooks] установлен pre-push: $HOOKS_DIR/pre-push"

# pre-commit hook — secret check
cat > "$HOOKS_DIR/pre-commit" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by scripts/install-hooks.sh
# Защита от случайного коммита секретов.

# Список запрещённых паттернов в именах файлов
FORBIDDEN_FILES='\.env(\..*)?$|credentials.*\.json$|\.pem$|\.key$|secret.*\.(json|yaml|yml|env)$|id_rsa$|id_ed25519$'

STAGED=$(git diff --cached --name-only)

if [ -z "$STAGED" ]; then
  exit 0
fi

VIOLATIONS=$(echo "$STAGED" | grep -E "$FORBIDDEN_FILES" || true)
if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: пытаешься закоммитить файлы похожие на секреты:"
  echo "$VIOLATIONS"
  echo ""
  echo "Если уверен — используй \`git commit --no-verify\`."
  echo "Иначе — удали из staging: \`git restore --staged <file>\`."
  exit 1
fi

# Содержательный grep на типовые секреты
SECRET_PATTERNS='(api[_-]?key|secret|password|token)\s*[:=]\s*["\x27][a-zA-Z0-9_\-/+=]{16,}["\x27]|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{30,}'
SECRET_MATCH=$(git diff --cached -U0 | grep -E "^\+" | grep -iE "$SECRET_PATTERNS" || true)
if [ -n "$SECRET_MATCH" ]; then
  echo "WARN: возможный секрет в diff:"
  echo "$SECRET_MATCH" | head -5
  echo ""
  echo "Если ложно-положительное — \`git commit --no-verify\`."
  echo "Иначе — удали секрет из кода (используй env vars)."
  exit 1
fi

exit 0
EOF
chmod +x "$HOOKS_DIR/pre-commit"
echo "[install-hooks] установлен pre-commit: $HOOKS_DIR/pre-commit"

echo ""
echo "[install-hooks] DONE. Хуки активны для $PROJECT_ROOT"
echo ""
echo "Тест pre-push (без реального push):"
echo "  $HOOKS_DIR/pre-push"
echo ""
echo "Тест pre-commit (на staged файлах):"
echo "  $HOOKS_DIR/pre-commit"
