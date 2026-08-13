#!/usr/bin/env bash
# PURPOSE: Живая консоль состояния Open Finance на Raspberry Pi.
# Показывается на локальном мониторе (tty1) и доступна по SSH как `of-status`.
# Задача — чтобы, воткнув монитор, сразу видеть: жив ли сервер, что со связью,
# питанием, температурой, базой и синхронизациями. Без интернета и зависимостей.
#
# Использование:
#   of-status            — снимок один раз и выход
#   of-status --loop     — обновляется каждые 5 секунд (режим для tty1)
# Установка — deploy/pi-status/README.md

set -uo pipefail

APP_DIR="${APP_DIR:-/home/firay/open-finance}"
PG_CONTAINER="${PG_CONTAINER:-openfinance-postgres}"
PROXY_URL="${PROXY_URL:-http://127.0.0.1:10809}"
INTERVAL="${INTERVAL:-5}"

C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_B=$'\033[1m'
C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_HEAD=$'\033[36m'

# Печатает значение цветом по состоянию: ok/warn/err
mark() { # mark <состояние> <текст>
  case "$1" in
    ok)   printf '%s%s%s' "$C_OK" "$2" "$C_RESET" ;;
    warn) printf '%s%s%s' "$C_WARN" "$2" "$C_RESET" ;;
    *)    printf '%s%s%s' "$C_ERR" "$2" "$C_RESET" ;;
  esac
}

head_line() { printf '%s── %s %s%s\n' "$C_HEAD" "$1" "$(printf '─%.0s' $(seq 1 $((58 - ${#1}))))" "$C_RESET"; }

svc_state() { # svc_state <юнит>
  local unit="$1" act enb
  act="$(systemctl is-active "$unit" 2>/dev/null)"
  enb="$(systemctl is-enabled "$unit" 2>/dev/null)"
  if [ "$act" = "active" ]; then
    if [ "$enb" = "enabled" ]; then mark ok "active"; else mark warn "active (без автозапуска!)"; fi
  else
    mark err "${act:-нет}"
  fi
}

human_ago() { # human_ago <unix-время>
  local t="$1" now diff
  if [ -z "$t" ] || [ "$t" = "0" ]; then printf '—'; return; fi
  now=$(date +%s); diff=$(( now - t ))
  if   [ "$diff" -lt 60 ]    ; then printf '%d с назад' "$diff"
  elif [ "$diff" -lt 3600 ]  ; then printf '%d мин назад' $(( diff / 60 ))
  elif [ "$diff" -lt 86400 ] ; then printf '%d ч назад' $(( diff / 3600 ))
  else printf '%d дн назад' $(( diff / 86400 )); fi
}

render() {
  local now; now="$(date '+%d.%m %H:%M:%S')"

  printf '%s%s OPEN FINANCE · %s %s%s\n' "$C_B" "$C_HEAD" "$(hostname)" "$now" "$C_RESET"
  printf '%sобновляется каждые %s с · выход Ctrl+C · подробности: journalctl -u open-finance -f%s\n\n' \
    "$C_DIM" "$INTERVAL" "$C_RESET"

  # ── Приложение ───────────────────────────────────────────────
  head_line "ПРИЛОЖЕНИЕ"
  local ver http
  ver="$(grep -o '"NEXT_PUBLIC_APP_VERSION"[[:space:]]*:[[:space:]]*"[^"]*"' "$APP_DIR/.next/required-server-files.json" 2>/dev/null | head -1 | sed 's/.*"\([0-9][^"]*\)"$/\1/')"
  http="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 4 https://localhost/ 2>/dev/null)"
  printf '  версия      %s\n' "${ver:-неизвестна}"
  printf '  сайт        '
  case "$http" in
    200|301|302|307) mark ok "HTTP $http" ;;
    000|"")          mark err "не отвечает" ;;
    *)               mark warn "HTTP $http" ;;
  esac
  printf '\n'
  printf '  open-finance %s   nginx %s\n' "$(svc_state open-finance)" "$(svc_state nginx)"
  printf '  docker      %s   xray  %s\n' "$(svc_state docker)" "$(svc_state xray)"
  printf '\n'

  # ── Железо ───────────────────────────────────────────────────
  head_line "ЖЕЛЕЗО"
  local temp thr load mem_used mem_tot
  temp="$(vcgencmd measure_temp 2>/dev/null | sed 's/temp=//;s/'"'"'C//')"
  thr="$(vcgencmd get_throttled 2>/dev/null | sed 's/throttled=//')"
  load="$(cut -d' ' -f1-3 /proc/loadavg)"
  mem_tot=$(( $(grep MemTotal /proc/meminfo | tr -dc '0-9') / 1024 ))
  mem_used=$(( mem_tot - $(grep MemAvailable /proc/meminfo | tr -dc '0-9') / 1024 ))

  printf '  температура '
  if   awk "BEGIN{exit !(${temp:-0} < 70)}"; then mark ok "${temp}°C"
  elif awk "BEGIN{exit !(${temp:-0} < 80)}"; then mark warn "${temp}°C (греется)"
  else mark err "${temp}°C (троттлинг!)"; fi

  printf '   питание '
  case "$thr" in
    0x0) mark ok "норма" ;;
    "")  mark warn "неизвестно" ;;
    *)   mark err "$thr — просадка/троттлинг!" ;;
  esac
  printf '\n'
  printf '  память      %s / %s МБ    нагрузка %s\n' "$mem_used" "$mem_tot" "$load"
  printf '  аптайм      %s\n' "$(uptime -p 2>/dev/null | sed 's/^up //')"

  # диски
  local root_use
  root_use="$(df -h / | awk 'NR==2{print $3" / "$2" ("$5")"}')"
  printf '  корень      %s' "$root_use"
  if lsblk -no NAME,MOUNTPOINT 2>/dev/null | grep -q '^nvme.*/$\|nvme0n1p2 */$'; then
    printf ' %sна NVMe%s' "$C_OK" "$C_RESET"
  elif findmnt -no SOURCE / 2>/dev/null | grep -q mmcblk; then
    printf ' %sна microSD%s' "$C_WARN" "$C_RESET"
  fi
  printf '\n'
  if lsblk -dno NAME,SIZE,MODEL 2>/dev/null | grep -q nvme; then
    printf '  NVMe        %s\n' "$(lsblk -dno SIZE,MODEL /dev/nvme0n1 2>/dev/null | xargs)"
  fi
  printf '\n'

  # ── Сеть ─────────────────────────────────────────────────────
  head_line "СЕТЬ"
  local ip4 wifi_ssid wifi_sig wifi_chan eth_state
  ip4="$(hostname -I 2>/dev/null | awk '{print $1}')"
  eth_state="$(cat /sys/class/net/eth0/operstate 2>/dev/null)"
  printf '  адрес       %s\n' "${ip4:-нет}"
  printf '  ethernet    '
  [ "$eth_state" = "up" ] && mark ok "подключён" || mark warn "не подключён (рекомендуется для сервера)"
  printf '\n'
  if [ -d /sys/class/net/wlan0 ]; then
    wifi_ssid="$(nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2 | head -1)"
    wifi_sig="$(awk 'NR==3{gsub(/\./,"",$4); print $4}' /proc/net/wireless 2>/dev/null)"
    wifi_chan="$(nmcli -t -f active,chan dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2 | head -1)"
    printf '  wi-fi       %s' "${wifi_ssid:-—}"
    if [ -n "${wifi_sig:-}" ]; then
      printf ' · '
      if   [ "$wifi_sig" -gt -55 ] 2>/dev/null; then mark ok "${wifi_sig} dBm"
      elif [ "$wifi_sig" -gt -70 ] 2>/dev/null; then mark warn "${wifi_sig} dBm"
      else mark err "${wifi_sig} dBm (слабо)"; fi
      printf ' · канал %s' "${wifi_chan:-?}"
      [ "${wifi_chan:-0}" -le 14 ] 2>/dev/null && printf ' %s(2.4 ГГц)%s' "$C_DIM" "$C_RESET"
    fi
    printf '\n'
  fi
  # VPN-прокси для AI. Проверяем именно api.anthropic.com — ради него прокси и стоит.
  # 401 = достучались (нет ключа), 403 = гео-блок (прокси не работает), 000 = нет связи.
  # НЕ проверять через api.ipify.org: через этот outbound он рвёт TLS, хотя прокси исправен.
  # Туннель периодически роняет отдельные соединения (~1 из 5), поэтому одна
  # неудача — не повод показывать красное: пробуем дважды.
  local proxy_code
  for _ in 1 2; do
    proxy_code="$(curl -x "$PROXY_URL" -sS -o /dev/null -m 12 -w '%{http_code}' https://api.anthropic.com/v1/models 2>/dev/null)"
    case "$proxy_code" in 401|200|403) break ;; esac
  done
  printf '  vpn (xray)  '
  case "$proxy_code" in
    401|200) mark ok "работает (anthropic $proxy_code)" ;;
    403)     mark err "гео-блок — VPN не работает" ;;
    *)       mark err "нет ответа (${proxy_code:-timeout}) — туннель нестабилен" ;;
  esac
  printf '\n\n'

  # ── База и синхронизации ─────────────────────────────────────
  head_line "БАЗА И СИНХРОНИЗАЦИИ"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${PG_CONTAINER}$"; then
    local dbsize jobs
    dbsize="$(docker exec "$PG_CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT pg_size_pretty(pg_database_size(current_database()))"' 2>/dev/null | tr -d ' ')"
    jobs="$(docker exec "$PG_CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM ozon_sync_jobs WHERE status IN ('"'"'pending'"'"','"'"'running'"'"')"' 2>/dev/null | tr -d ' ')"
    printf '  postgres    %s · размер %s\n' "$(mark ok 'работает')" "${dbsize:-?}"
    printf '  синк ozon   '
    if [ "${jobs:-0}" -gt 0 ] 2>/dev/null; then
      mark warn "$jobs активных — НЕ перезагружать"
    else
      mark ok "нет активных"
    fi
    printf '\n'
  else
    printf '  postgres    %s\n' "$(mark err 'контейнер не запущен')"
  fi

  # последний деплой = mtime сборки
  local build_t
  build_t="$(stat -c %Y "$APP_DIR/.next/required-server-files.json" 2>/dev/null)"
  printf '  сборка      %s\n' "$(human_ago "${build_t:-0}")"

  # ошибки в журнале за сутки
  local errs
  errs="$(journalctl -u open-finance --since '24 hours ago' -p err --no-pager 2>/dev/null | grep -c . )"
  printf '  ошибки/сутки '
  if [ "${errs:-0}" -le 1 ] 2>/dev/null; then mark ok "нет"; else mark warn "$errs строк (journalctl -u open-finance -p err)"; fi
  printf '\n'
}

if [ "${1:-}" = "--loop" ]; then
  # Скрыть курсор, вернуть при выходе
  printf '\033[?25l'
  trap 'printf "\033[?25h\n"; exit 0' INT TERM
  while true; do
    out="$(render)"
    printf '\033[H\033[2J%s' "$out"   # домой + очистка, одним куском (без мигания)
    sleep "$INTERVAL"
  done
else
  render
fi
