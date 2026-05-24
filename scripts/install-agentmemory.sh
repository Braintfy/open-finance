#!/usr/bin/env bash
# PURPOSE: Установка agentmemory + iii-engine + Cursor MCP (взамен mempalace).
# Запускать один раз. Идемпотентно: можно безопасно перезапускать.
#
# Что делает:
#   1. Проверяет Node.js ≥20 (требование agentmemory).
#   2. Устанавливает iii-engine v0.11.2 (нативный бинарник, agentmemory его требует).
#   3. (Опц.) Устанавливает @xenova/transformers для local embeddings (free, +8pp recall).
#   4. (Опц.) Глобальная установка @agentmemory/agentmemory (избегает npx version cache).
#   5. Устанавливает launchd-агент com.agentmemory.server (auto-start на login).
#   6. Запускает агент сейчас и проверяет health endpoint.
#   7. Выводит дальнейшие шаги (перезапуск Cursor, проверка MCP).
#
# Что НЕ делает:
#   - Не правит ~/.cursor/mcp.json (уже сделано setup-кодом ранее).
#   - Не мигрирует историю из mempalace (см. scripts/import-claude-transcripts.sh ниже).
#   - Не настраивает LLM-провайдеры (по умолчанию работает без них — BM25 + local embeddings).

set -euo pipefail

PLIST_LABEL="com.agentmemory.server"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
HEALTH_URL="http://localhost:3111/agentmemory/health"
VIEWER_URL="http://localhost:3113"
III_VERSION="v0.11.2"
III_BIN="$HOME/.local/bin/iii"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

ok() { echo -e "${GREEN}[OK]${NC} $*"; }
info() { echo -e "${BLUE}[..]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERR]${NC} $*"; }

echo "=== agentmemory installer ==="
echo ""

# ----- 1. Node.js check -----
if ! command -v node >/dev/null 2>&1; then
  err "Node.js не найден. Установи через https://nodejs.org или 'volta install node'"
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=${NODE_VERSION%%.*}
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "agentmemory требует Node.js ≥20 (у тебя $NODE_VERSION). Обнови: volta install node@20"
  exit 1
fi
ok "Node.js $NODE_VERSION"

# ----- 2. iii-engine -----
echo ""
info "[2/6] Проверяю iii-engine ${III_VERSION}..."
if [ -x "$III_BIN" ] && "$III_BIN" --version 2>/dev/null | grep -q "0.11.2"; then
  ok "iii-engine уже установлен ($III_BIN)"
elif command -v iii >/dev/null 2>&1 && iii --version 2>/dev/null | grep -q "0.11.2"; then
  ok "iii-engine найден в PATH ($(which iii))"
else
  warn "iii-engine не найден или другая версия"

  # Определяем архитектуру macOS
  ARCH=$(uname -m)
  if [ "$ARCH" = "arm64" ]; then
    III_ARCHIVE="iii-aarch64-apple-darwin.tar.gz"
  else
    III_ARCHIVE="iii-x86_64-apple-darwin.tar.gz"
  fi

  info "скачиваю iii-engine ${III_VERSION} для ${ARCH}..."
  mkdir -p "$HOME/.local/bin"
  III_URL="https://github.com/iii-hq/iii/releases/download/iii/${III_VERSION}/${III_ARCHIVE}"
  if curl -fsSL "$III_URL" | tar -xz -C "$HOME/.local/bin" 2>&1; then
    chmod +x "$III_BIN"
    ok "iii-engine установлен: $III_BIN"
    "$III_BIN" --version
  else
    err "не удалось скачать iii-engine. URL: $III_URL"
    err "Альтернатива: использовать Docker (docker-compose) или MCP-only mode (без REST/viewer)"
    err "См. https://github.com/rohitg00/agentmemory#windows для Windows и Docker инструкций"
    exit 1
  fi

  # Добавляем ~/.local/bin в PATH если ещё нет
  if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    warn "$HOME/.local/bin не в PATH"
    warn "добавь в ~/.zshrc: export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
fi

# ----- 3. Local embeddings (опц.) -----
echo ""
info "[3/6] Local embeddings (@xenova/transformers, ~300MB)..."
echo -n "    Установить для free local vector search (рекомендую, +8pp recall)? [Y/n] "
read -r ANSWER
if [[ "$ANSWER" =~ ^[Nn]$ ]]; then
  warn "пропускаю — будет работать только BM25 (без semantic search)"
else
  if npm list -g @xenova/transformers >/dev/null 2>&1; then
    ok "@xenova/transformers уже установлен глобально"
  else
    info "ставлю глобально (потребуется ~300MB на модель)..."
    npm install -g @xenova/transformers || warn "global install failed (возможно нужен sudo)"
  fi
fi

# ----- 4. Global agentmemory (опц., рекомендуется) -----
echo ""
info "[4/6] Глобальная установка @agentmemory/agentmemory..."
echo -n "    Установить глобально (избегает npx version-cache проблем, рекомендую)? [Y/n] "
read -r ANSWER
USE_GLOBAL=false
if [[ "$ANSWER" =~ ^[Nn]$ ]]; then
  warn "пропускаю — буду использовать npx -y @agentmemory/agentmemory@latest"
else
  if npm install -g @agentmemory/agentmemory 2>&1 | tail -3; then
    ok "@agentmemory/agentmemory установлен глобально"
    USE_GLOBAL=true
    if command -v agentmemory >/dev/null 2>&1; then
      ok "команда 'agentmemory' доступна: $(which agentmemory)"
    fi
  else
    warn "global install failed, fallback на npx"
  fi
fi

# ----- 5. launchd plist -----
echo ""
info "[5/6] launchd-агент..."
if [ ! -f "$PLIST_PATH" ]; then
  err "$PLIST_PATH не найден. Запусти сначала setup из репозитория."
  exit 1
fi
ok "plist найден: $PLIST_PATH"

# Перезагружаю если уже был
if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
  info "агент уже загружен, перезапускаю..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

launchctl load -w "$PLIST_PATH"
ok "launchd загружен ($PLIST_LABEL)"

# ----- 6. Health check -----
echo ""
info "[6/6] Жду запуска сервера (до 60 секунд — первый старт скачивает зависимости)..."
HEALTHY=false
for i in $(seq 1 60); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    ok "сервер запущен на :3111 после $i сек"
    HEALTHY=true
    break
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "    ... ждём ${i}s"
  fi
  sleep 1
done

if ! $HEALTHY; then
  err "сервер не отвечает после 60 секунд"
  err "логи: tail -50 ~/Library/Logs/agentmemory.err.log"
  echo ""
  echo "Что проверить:"
  echo "  1. tail -100 ~/Library/Logs/agentmemory.err.log — реальная ошибка"
  echo "  2. launchctl list | grep agentmemory — статус процесса"
  echo "  3. ${III_BIN} --version — iii-engine работает?"
  echo "  4. npx -y @agentmemory/agentmemory --verbose — запуск напрямую с отладкой"
  exit 1
fi

# Health detail
HEALTH=$(curl -s "$HEALTH_URL" 2>&1 || echo "FAIL")
ok "health response: $(echo "$HEALTH" | head -1)"

# Run doctor
echo ""
info "Запускаю 'agentmemory doctor' для диагностики..."
if $USE_GLOBAL && command -v agentmemory >/dev/null 2>&1; then
  agentmemory doctor 2>&1 | head -30 || true
else
  npx -y @agentmemory/agentmemory@latest doctor 2>&1 | head -30 || true
fi

echo ""
echo "=== DONE ==="
echo ""
ok "agentmemory MCP server работает на $HEALTH_URL"
ok "real-time viewer: $VIEWER_URL"
ok "логи: ~/Library/Logs/agentmemory.{out,err}.log"
echo ""
echo "Дальнейшие шаги:"
echo "  1. Перезапусти Cursor (Cmd+Q и снова открой), чтобы он подцепил agentmemory в MCP."
echo "  2. В Cursor: Settings → MCP Servers → проверь 'agentmemory' (зелёный)."
echo "  3. Открой viewer: $VIEWER_URL"
echo "  4. (Опц.) Импорт истории из старых Claude Code транскриптов:"
echo "       ./scripts/import-claude-transcripts.sh"
echo "  5. (Опц.) Настрой LLM-провайдер в ~/.agentmemory/.env для auto-compression:"
echo "       ANTHROPIC_API_KEY=sk-ant-..."
echo "       AGENTMEMORY_AUTO_COMPRESS=true"
echo "     (без них работает только BM25 + local embeddings — этого достаточно для старта)"
echo "  6. Прочитай docs/MEMORY_SETUP.md для деталей и troubleshooting."
echo ""
echo "Управление:"
echo "  Старт:    launchctl load -w $PLIST_PATH"
echo "  Стоп:     launchctl unload $PLIST_PATH"
echo "  Логи:     tail -f ~/Library/Logs/agentmemory.out.log"
echo "  Health:   curl $HEALTH_URL"
echo "  Doctor:   $($USE_GLOBAL && echo 'agentmemory doctor' || echo 'npx -y @agentmemory/agentmemory doctor')"
