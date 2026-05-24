#!/usr/bin/env bash
# PURPOSE: Импорт старых Claude Code JSONL транскриптов в agentmemory.
# Не нужен если ты новый user — используй только если хочешь восстановить историю.
#
# Что делает:
#   1. Проверяет, что agentmemory сервер запущен.
#   2. Импортирует все JSONL транскрипты из ~/.claude/projects (default).
#   3. (Опц.) Импортирует Cursor agent-transcripts если они есть.
#
# Источники транскриптов:
#   - ~/.claude/projects/             # Claude Code native
#   - ~/.cursor/projects/.../agent-transcripts/  # Cursor (формат может отличаться)

set -euo pipefail

HEALTH_URL="http://localhost:3111/agentmemory/health"
CLAUDE_PROJECTS="$HOME/.claude/projects"
CURSOR_TRANSCRIPTS="$HOME/.cursor/projects/Users-firay-open-finance-open-finance/agent-transcripts"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

ok() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERR]${NC} $*"; }

echo "=== import claude transcripts → agentmemory ==="
echo ""

if ! curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  err "agentmemory сервер не запущен на $HEALTH_URL"
  err "Запусти: launchctl load -w ~/Library/LaunchAgents/com.agentmemory.server.plist"
  exit 1
fi
ok "agentmemory сервер работает"

# 1. Claude Code transcripts (стандартный формат)
echo ""
if [ -d "$CLAUDE_PROJECTS" ]; then
  COUNT=$(find "$CLAUDE_PROJECTS" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$COUNT" -gt 0 ]; then
    echo "Найдено $COUNT Claude Code JSONL транскриптов в $CLAUDE_PROJECTS"
    echo -n "Импортировать всё? [Y/n] "
    read -r ANSWER
    if [[ ! "$ANSWER" =~ ^[Nn]$ ]]; then
      if command -v agentmemory >/dev/null 2>&1; then
        agentmemory import-jsonl 2>&1 | tail -20
      else
        npx -y @agentmemory/agentmemory@latest import-jsonl 2>&1 | tail -20
      fi
      ok "импорт завершён"
    fi
  else
    warn "JSONL файлов не найдено в $CLAUDE_PROJECTS"
  fi
else
  warn "$CLAUDE_PROJECTS не существует (нормально если не использовал Claude Code CLI)"
fi

# 2. Cursor transcripts (требует конвертации, формат может отличаться)
echo ""
if [ -d "$CURSOR_TRANSCRIPTS" ]; then
  COUNT=$(find "$CURSOR_TRANSCRIPTS" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$COUNT" -gt 0 ]; then
    warn "Найдено $COUNT Cursor транскриптов в $CURSOR_TRANSCRIPTS"
    warn "Cursor использует свой формат JSONL — agentmemory import-jsonl ожидает Claude Code формат"
    warn "Прямой импорт скорее всего не сработает. Возможные опции:"
    warn "  1. Использовать только Claude Code транскрипты (если использовался)."
    warn "  2. Дождаться поддержки Cursor JSONL в agentmemory (issue/feature request)."
    warn "  3. Manual: попросить агента прочитать важные транскрипты и сохранить ключевые решения через MCP 'memory_save'."
  fi
fi

echo ""
echo "=== DONE ==="
echo ""
echo "Проверить, что импортировано:"
echo "  curl http://localhost:3111/agentmemory/profile | jq"
echo "  Открыть viewer: http://localhost:3113 (вкладка Sessions)"
