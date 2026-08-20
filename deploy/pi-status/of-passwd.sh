#!/usr/bin/env bash
# PURPOSE: Управление паролями Open Finance прямо на сервере — по SSH или с монитора.
# Обёртка над `pnpm admin:reset-password`, которая подставляет DATABASE_URL из
# .env.production. Без неё CLI ищет базу в .env.local (которого на проде нет)
# и молча уходит на дев-адрес.
#
#   sudo of-passwd --list                 кто есть в системе
#   sudo of-passwd admin@openfinance.local   сгенерировать надёжный пароль и показать
#   sudo of-passwd admin@openfinance.local --stdin   ввести свой (не попадёт в историю)
#
# Установка — deploy/pi-status/README.md
#
# ПОЧЕМУ ТАК СЛОЖНО С ПЕРЕДАЧЕЙ DATABASE_URL (а не `env VAR=... pnpm …`).
# В строке подключения лежит пароль базы. Всё, что попадает в АРГУМЕНТЫ команды,
# видно любому пользователю системы: /proc/<pid>/cmdline читается всеми, и
# обычный `ps aux` во время выполнения печатает пароль на экран соседа. Поэтому
# секрет идёт только двумя путями, и оба — не argv:
#   • тот же пользователь  → export в СОБСТВЕННОЕ окружение процесса;
#   • смена пользователя   → временный файл 0600, который дочерний shell
#     считывает (`.`) себе в окружение и сразу удаляет.
# Окружение процесса (/proc/<pid>/environ) читает только владелец процесса и
# root, а файл 0600 принадлежит тому же пользователю, что и .env.production, —
# то есть новых читателей секрета не появляется.
# Вариант `sudo --preserve-env=DATABASE_URL` тоже закрыл бы argv, но зависит от
# права setenv в sudoers: на чужой машине он молча теряет переменную, и CLI
# уходит на дев-адрес — ровно та беда, ради которой обёртка написана.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/firay/open-finance}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.production}"
# Владелец приложения: pnpm store и node_modules — его, root'ом их трогать нельзя.
RUN_USER="${RUN_USER:-firay}"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ Не найден $ENV_FILE — без него неизвестен адрес базы." >&2
  exit 1
fi

# Берём ТОЛЬКО DATABASE_URL: остальное окружение приложения здесь не нужно,
# а лишние переменные (ключи, секреты) незачем тащить в процесс.
# `|| true` — иначе pipefail уронит скрипт молча, не дав сказать, что строки нет.
DB_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)"

# Снимаем ТОЛЬКО обрамляющие кавычки. Прежний `tr -d` вырезал кавычки отовсюду,
# включая середину пароля, — и подключение молча уходило с чужим паролем.
case "$DB_URL" in
  '"'*'"') DB_URL="${DB_URL:1:${#DB_URL}-2}" ;;
  "'"*"'") DB_URL="${DB_URL:1:${#DB_URL}-2}" ;;
esac

if [ -z "$DB_URL" ]; then
  echo "✗ В $ENV_FILE нет DATABASE_URL." >&2
  exit 1
fi

# Уже нужный пользователь — sudo не нужен: секрет уходит в собственное окружение
# процесса (не в argv), дочерний node наследует его напрямую.
if [ "$(id -un)" = "$RUN_USER" ]; then
  cd "$APP_DIR"
  export DATABASE_URL="$DB_URL"
  exec pnpm admin:reset-password "$@"
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "✗ Запускать от $RUN_USER или через sudo: sudo of-passwd …" >&2
  exit 1
fi

# umask ДО mktemp: файл обязан родиться с 0600, а не «родиться и почти сразу
# ужаться» — между созданием и chmod чужой процесс успел бы его открыть.
umask 077
ENV_TMP="$(mktemp "${TMPDIR:-/tmp}/of-passwd.XXXXXXXX")"
trap 'rm -f "$ENV_TMP"' EXIT INT TERM
# printf — builtin bash: отдельного процесса (и его argv) не возникает.
printf 'DATABASE_URL=%s\n' "$DB_URL" >"$ENV_TMP"
chown "$RUN_USER" "$ENV_TMP"

# В argv уходят только ПУТИ — они не секрет. Сам URL дочерний shell забирает
# из файла в своё окружение и тут же файл удаляет.
status=0
sudo -u "$RUN_USER" /bin/bash -c '
  set -euo pipefail
  set -a
  . "$1"
  set +a
  rm -f "$1"
  cd "$2"
  shift 2
  exec pnpm admin:reset-password "$@"
' of-passwd "$ENV_TMP" "$APP_DIR" "$@" || status=$?
exit "$status"
