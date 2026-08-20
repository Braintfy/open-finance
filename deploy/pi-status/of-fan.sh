#!/usr/bin/env bash
# PURPOSE: Управление вентилятором корпуса Argon ONE V3 по температуре процессора.
# Вентилятор висит на шине I2C (адрес 0x1a) и управляется одним байтом —
# процентом оборотов 0-100. Штатное управление Raspberry Pi OS на него НЕ действует:
# оно рассчитано на фирменный активный кулер, а не на корпус стороннего производителя.
#
# Требует: dtparam=i2c_arm=on в /boot/firmware/config.txt, модуль i2c-dev, пакет i2c-tools.
# Установка и настройка порогов — deploy/pi-status/README.md
#
# Кривая с гистерезисом: обороты СНИЖАЮТСЯ только когда температура упала заметно
# ниже порога включения. Без этого вентилятор «пилит» — то включается, то глохнет
# на границе, и это слышно сильнее, чем ровный шум.

set -uo pipefail

I2C_BUS="${I2C_BUS:-1}"
I2C_ADDR="${I2C_ADDR:-0x1a}"
INTERVAL="${INTERVAL:-10}"
HYSTERESIS="${HYSTERESIS:-3}"        # на сколько градусов остыть, чтобы сбросить обороты
FAIL_SAFE_PCT="${FAIL_SAFE_PCT:-55}" # обороты при выходе из скрипта — лучше шуметь, чем перегреть

# Пороги «температура:проценты», по возрастанию. Менять в systemd-юните через FAN_CURVE.
FAN_CURVE="${FAN_CURVE:-50:0 55:30 62:50 68:70 75:100}"

log() { logger -t of-fan "$*"; printf '%s %s\n' "$(date '+%F %T')" "$*"; }

cpu_temp() { awk '{printf "%d", $1/1000}' /sys/class/thermal/thermal_zone0/temp; }

set_fan() { # set_fan <проценты>
  i2cset -y "$I2C_BUS" "$I2C_ADDR" "$1" 2>/dev/null
}

# Целевые обороты для температуры: берём последний порог, который она превысила.
target_for() {
  local t="$1" pct=0 pair thr val
  for pair in $FAN_CURVE; do
    thr="${pair%%:*}"; val="${pair##*:}"
    [ "$t" -ge "$thr" ] && pct="$val"
  done
  echo "$pct"
}

cleanup() {
  log "выхожу — ставлю безопасные ${FAIL_SAFE_PCT}%"
  set_fan "$FAIL_SAFE_PCT"
  exit 0
}
trap cleanup INT TERM

if ! i2cget -y "$I2C_BUS" "$I2C_ADDR" >/dev/null 2>&1; then
  # Устройство может не отвечать на чтение, но принимать запись — проверяем записью.
  if ! set_fan 0; then
    log "контроллер ${I2C_ADDR} на шине ${I2C_BUS} не отвечает — выхожу"
    exit 1
  fi
fi

log "управление вентилятором запущено: кривая [${FAN_CURVE}], гистерезис ${HYSTERESIS}°C"

current=-1
applied_at_temp=0

while true; do
  t="$(cpu_temp)"
  want="$(target_for "$t")"

  if [ "$want" -gt "$current" ]; then
    # Греется — реагируем сразу
    set_fan "$want" && { log "температура ${t}°C → обороты ${want}%"; current="$want"; applied_at_temp="$t"; }
  elif [ "$want" -lt "$current" ] && [ "$t" -le $(( applied_at_temp - HYSTERESIS )) ]; then
    # Остыл достаточно — снижаем
    set_fan "$want" && { log "температура ${t}°C (остыло) → обороты ${want}%"; current="$want"; applied_at_temp="$t"; }
  fi

  # Текущее состояние — для дашборда
  printf '%s %s %s\n' "$(date +%s)" "$t" "$current" > /run/of-fan.state 2>/dev/null

  sleep "$INTERVAL"
done
