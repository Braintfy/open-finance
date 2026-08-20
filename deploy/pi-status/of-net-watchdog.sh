#!/usr/bin/env bash
# PURPOSE: Сторож сети Raspberry Pi. Если связь пропала надолго — сначала пробует
# вылечить мягко (перезапуск сетевого стека), и только потом перезагружает плату.
# Решает конкретную проблему: после включения питания Wi-Fi иногда не ассоциируется,
# и приходится перезагружать руками.
#
# Принципы:
#   * перезагрузка — крайняя мера, до неё две более дешёвые попытки;
#   * не больше MAX_REBOOTS перезагрузок подряд — иначе плата уйдёт в вечный цикл
#     при поломке роутера, и до неё будет не достучаться даже когда сеть вернётся;
#   * счётчик обнуляется, когда сеть стабильно продержалась STABLE_OK_MIN минут;
#   * перед перезагрузкой проверяется, не идёт ли синхронизация Ozon (graceful
#     shutdown у неё нет — job повиснет).
#
# Установка и проверка — deploy/pi-status/README.md

set -uo pipefail

STATE_DIR="${STATE_DIR:-/var/lib/of-net-watchdog}"
REBOOTS_FILE="$STATE_DIR/reboots"
LAST_ACTION_FILE="$STATE_DIR/last-action"

CHECK_INTERVAL="${CHECK_INTERVAL:-30}"      # секунд между проверками
FAILS_BEFORE_SOFT="${FAILS_BEFORE_SOFT:-4}"  # ~2 мин — перезапуск сетевого стека
FAILS_BEFORE_HARD="${FAILS_BEFORE_HARD:-8}"  # ~4 мин — переподнятие интерфейса
FAILS_BEFORE_REBOOT="${FAILS_BEFORE_REBOOT:-16}" # ~8 мин — перезагрузка
MAX_REBOOTS="${MAX_REBOOTS:-3}"
DISK_FAILS_BEFORE_REBOOT="${DISK_FAILS_BEFORE_REBOOT:-3}" # ~1.5 мин: отказ ФС мягко не лечится
STABLE_OK_MIN="${STABLE_OK_MIN:-10}"        # минут стабильной сети до сброса счётчика
BOOT_GRACE_SEC="${BOOT_GRACE_SEC:-180}"     # не трогаем систему первые 3 минуты после старта
PG_CONTAINER="${PG_CONTAINER:-openfinance-postgres}"

log() { logger -t of-net-watchdog "$*"; printf '%s %s\n' "$(date '+%F %T')" "$*"; }

mkdir -p "$STATE_DIR"
[ -f "$REBOOTS_FILE" ] || echo 0 > "$REBOOTS_FILE"

uptime_sec() { awk '{print int($1)}' /proc/uptime; }

# Сеть жива, если есть маршрут по умолчанию и шлюз отвечает.
# Пингуем именно шлюз, а не интернет: задача сторожа — локальная связность,
# при падении провайдера перезагружать плату бессмысленно.
network_ok() {
  local gw
  gw="$(ip route show default 2>/dev/null | awk '{print $3; exit}')"
  [ -n "$gw" ] || return 1
  ping -c 1 -W 3 "$gw" >/dev/null 2>&1
}

# Корневой диск жив? Проверка появилась после реального отказа 13.08.2026:
# NVMe отвалился от шины PCIe, ядро и уже загруженные процессы продолжали
# работать (пинг шёл, nginx держал порт и отдавал 502), а всё, что требовало
# чтения с диска, падало — sshd не запускался, приложение не перезапускалось.
# Сторож тогда НЕ сработал, потому что смотрел только на сеть.
# Пишем и читаем пробный файл: если ФС отвалилась или ушла в read-only,
# операция провалится. Единственное лечение такого состояния — перезагрузка.
storage_ok() {
  local probe="$STATE_DIR/.probe"
  { echo "$(date +%s)" > "$probe"; } 2>/dev/null || return 1
  [ -s "$probe" ] || return 1
  rm -f "$probe" 2>/dev/null
  return 0
}

# ВАЖНО: обязательно под timeout. При мёртвой ФС `docker exec` не возвращается,
# и без ограничения сторож завис бы ровно в тот момент, когда обязан перезагрузить.
sync_running() {
  timeout 10 docker exec "$PG_CONTAINER" sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM ozon_sync_jobs WHERE status IN ('"'"'pending'"'"','"'"'running'"'"')"' \
    2>/dev/null | tr -d ' \n' | grep -qE '^[1-9]'
}

soft_fix() {
  log "сети нет ${1} проверок подряд — перезапускаю сетевой стек"
  systemctl restart NetworkManager 2>/dev/null || systemctl restart networking 2>/dev/null
  echo "soft $(date '+%F %T')" > "$LAST_ACTION_FILE"
}

harder_fix() {
  log "сети всё ещё нет (${1}) — переподнимаю интерфейсы"
  for dev in $(ls /sys/class/net | grep -vE '^(lo|docker|veth|br-)'); do
    nmcli device disconnect "$dev" >/dev/null 2>&1
    sleep 2
    nmcli device connect "$dev" >/dev/null 2>&1 || ip link set "$dev" up 2>/dev/null
  done
  echo "hard $(date '+%F %T')" > "$LAST_ACTION_FILE"
}

# do_reboot <причина> [skip_sync_check]
do_reboot() {
  local reason="$1" skip_sync="${2:-}" count
  count="$(cat "$REBOOTS_FILE" 2>/dev/null || echo 0)"

  if [ "$count" -ge "$MAX_REBOOTS" ]; then
    log "${reason}, но лимит перезагрузок исчерпан (${count}/${MAX_REBOOTS}) — жду восстановления без перезагрузки"
    return
  fi
  # При отказе диска проверку синка пропускаем: обратиться к базе всё равно
  # нельзя, а откладывать перезагрузку в этом состоянии бессмысленно —
  # job уже сломан, и чинится он только поднятием системы.
  if [ "$skip_sync" != "skip-sync" ] && sync_running; then
    log "${reason}, но идёт синхронизация Ozon — перезагрузку откладываю"
    return
  fi

  count=$(( count + 1 ))
  echo "$count" > "$REBOOTS_FILE" 2>/dev/null
  echo "reboot $(date '+%F %T') #${count} — ${reason}" > "$LAST_ACTION_FILE" 2>/dev/null
  log "${reason} — ПЕРЕЗАГРУЖАЮ плату (попытка ${count}/${MAX_REBOOTS})"
  sync
  sleep 2
  systemctl reboot || reboot -f    # если systemd уже не отвечает из-за мёртвой ФС
}

fails=0
ok_since=0
disk_fails=0

log "сторож запущен: проверка каждые ${CHECK_INTERVAL} с (сеть + запись на диск), перезагрузка после ${FAILS_BEFORE_REBOOT} сетевых или ${DISK_FAILS_BEFORE_REBOOT} дисковых неудач, лимит ${MAX_REBOOTS}"

while true; do
  if [ "$(uptime_sec)" -lt "$BOOT_GRACE_SEC" ]; then
    sleep "$CHECK_INTERVAL"; continue      # даём системе спокойно догрузиться
  fi

  # Отказ диска лечится ТОЛЬКО перезагрузкой: мягкие меры бессмысленны, потому
  # что запустить что-либо система уже не может. Действуем быстрее, чем по сети.
  if ! storage_ok; then
    disk_fails=$(( disk_fails + 1 ))
    log "корневая ФС не отвечает на запись (${disk_fails}/${DISK_FAILS_BEFORE_REBOOT})"
    if [ "$disk_fails" -ge "$DISK_FAILS_BEFORE_REBOOT" ]; then
      do_reboot "корневая ФС мертва (${disk_fails} проверок)" skip-sync
      disk_fails=0
    fi
    sleep "$CHECK_INTERVAL"; continue
  fi
  disk_fails=0

  if network_ok; then
    if [ "$fails" -gt 0 ]; then
      log "сеть восстановилась после ${fails} неудачных проверок"
      fails=0
    fi
    [ "$ok_since" -eq 0 ] && ok_since="$(date +%s)"
    # Сеть держится долго — считаем инцидент закрытым и разрешаем будущие попытки
    if [ "$(cat "$REBOOTS_FILE" 2>/dev/null || echo 0)" -gt 0 ] \
       && [ $(( ($(date +%s) - ok_since) / 60 )) -ge "$STABLE_OK_MIN" ]; then
      echo 0 > "$REBOOTS_FILE"
      log "сеть стабильна ${STABLE_OK_MIN} мин — счётчик перезагрузок сброшен"
    fi
  else
    ok_since=0
    fails=$(( fails + 1 ))
    case "$fails" in
      "$FAILS_BEFORE_SOFT")   soft_fix "$fails" ;;
      "$FAILS_BEFORE_HARD")   harder_fix "$fails" ;;
      *)
        if [ "$fails" -ge "$FAILS_BEFORE_REBOOT" ] \
           && [ $(( (fails - FAILS_BEFORE_REBOOT) % FAILS_BEFORE_REBOOT )) -eq 0 ]; then
          do_reboot "сети нет ${fails} проверок подряд"
        fi
        ;;
    esac
  fi

  sleep "$CHECK_INTERVAL"
done
