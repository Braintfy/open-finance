#!/usr/bin/env bash
# PURPOSE: Применить spool-конфиг Xray, который записала админка Open Finance.
# Запускается ТОЛЬКО root-овым systemd-юнитом of-xray-apply.service, который дёргает
# path-юнит of-xray-apply.path при изменении $SPOOL_DIR/config.json.
# У web-приложения нет sudo/exec — оно только пишет файл; вся привилегированная
# часть (валидация → xray run -test → install → restart) живёт здесь.
#
# Инварианты, которые скрипт обязан проверить ДО установки конфига:
#   * ровно один inbound, protocol=http, listen=127.0.0.1, port=10809;
#   * log.access == "none" (иначе Xray пишет все посещённые домены на диск);
#   * нет секции api (grpc-управление Xray);
#   * файл — валидный JSON и меньше 256KB.
#
# Установка и права — deploy/xray/README.md.
set -euo pipefail

SPOOL_DIR="${XRAY_SPOOL_DIR:-/var/lib/open-finance/xray}"
SPOOL_CONFIG="${SPOOL_DIR}/config.json"
SPOOL_META="${SPOOL_DIR}/config.meta.json"
STATUS_FILE="${SPOOL_DIR}/status.json"
TARGET_CONFIG="${XRAY_CONFIG_PATH:-/usr/local/etc/xray/config.json}"
# Бэкап лежит РЯДОМ С ЦЕЛЕВЫМ конфигом (root-only), а не в spool: иначе пользователь
# приложения мог бы подсунуть свой «предыдущий» конфиг и получить его установку
# по пути отката — в обход валидации и xray run -test.
BACKUP_CONFIG="${XRAY_BACKUP_PATH:-${TARGET_CONFIG}.prev}"
XRAY_BIN="${XRAY_BIN:-/usr/local/bin/xray}"
XRAY_SERVICE="${XRAY_SERVICE:-xray}"
XRAY_GROUP="${XRAY_GROUP:-}"
EXPECT_LISTEN="127.0.0.1"
EXPECT_PORT="${XRAY_HTTP_PORT:-10809}"
MAX_BYTES=$((256 * 1024))

FINGERPRINT=""
SERVER=""
# Неизменяемая root-owned копия spool-конфига (создаётся ниже, вне SPOOL_DIR).
# ВСЯ валидация, xray run -test и install работают ТОЛЬКО с ней: сам spool-файл
# писабелен приложением и может быть подменён между проверкой и установкой (TOCTOU).
VERIFIED_CONFIG=""

log() { printf '[of-xray-apply] %s\n' "$*" >&2; }

json_escape() {
  # Экранирование произвольной строки для вставки в JSON.
  printf '%s' "${1:-}" | jq -Rs .
}

write_status() {
  # write_status <ok:true|false> <phase> <error-message>
  local ok="$1" phase="$2" error="${3:-}"
  local active="false"
  if systemctl is-active --quiet "${XRAY_SERVICE}" 2>/dev/null; then active="true"; fi
  # sha считаем с ПРОВЕРЕННОЙ root-only копии, а не с мутабельного spool-файла.
  local sha=""
  if [ -n "${VERIFIED_CONFIG:-}" ] && [ -f "${VERIFIED_CONFIG}" ]; then
    sha="$(sha256sum "${VERIFIED_CONFIG}" | cut -d' ' -f1)"
  fi

  # Пишем во временный файл через mktemp (O_EXCL — не идёт по симлинку и не
  # перезаписывает существующий), затем атомарно переименовываем. Приложение
  # писабельно в SPOOL_DIR, поэтому прямой `cat >status.json.tmp` дал бы ему
  # возможность подставить симлинк и получить произвольную root-запись.
  local tmp
  tmp="$(mktemp "${SPOOL_DIR}/.status.XXXXXX" 2>/dev/null)" || {
    log "не удалось создать временный status-файл"
    return 0
  }
  cat >"${tmp}" <<EOF
{
  "ok": ${ok},
  "phase": $(json_escape "${phase}"),
  "fingerprint": $(json_escape "${FINGERPRINT}"),
  "server": $(json_escape "${SERVER}"),
  "appliedAt": $(json_escape "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "error": $(json_escape "${error}"),
  "xrayActive": ${active},
  "externalIp": $(json_escape "${EXTERNAL_IP:-}"),
  "configSha256": $(json_escape "${sha}")
}
EOF
  chmod 0644 "${tmp}"
  mv -f "${tmp}" "${STATUS_FILE}"
}

fail() {
  local phase="$1" message="$2"
  log "FAIL (${phase}): ${message}"
  write_status false "${phase}" "${message}"
  exit 1
}

install_config() {
  # install_config <src> — конфиг содержит UUID, поэтому читаемым он должен быть
  # только root и (если задана) группе Xray.
  local src="$1"
  if [ -n "${XRAY_GROUP}" ] && getent group "${XRAY_GROUP}" >/dev/null 2>&1; then
    install -o root -g "${XRAY_GROUP}" -m 0640 "${src}" "${TARGET_CONFIG}"
  else
    install -o root -g root -m 0644 "${src}" "${TARGET_CONFIG}"
  fi
}

rollback() {
  local message="$1"
  log "ROLLBACK: ${message}"
  if [ -f "${BACKUP_CONFIG}" ]; then
    install_config "${BACKUP_CONFIG}" || log "не удалось восстановить предыдущий конфиг"
    systemctl restart "${XRAY_SERVICE}" || log "не удалось перезапустить ${XRAY_SERVICE} после отката"
  else
    log "бэкапа предыдущего конфига нет — откат невозможен"
  fi
  write_status false "rolled_back" "${message}"
  exit 1
}

# ── 0. Предусловия ───────────────────────────────────────────────────────────
command -v jq >/dev/null 2>&1 || { log "jq не установлен (apt install jq)"; exit 1; }
[ -x "${XRAY_BIN}" ] || fail "validating" "xray не найден по пути ${XRAY_BIN}"
[ -f "${SPOOL_CONFIG}" ] || fail "validating" "spool-конфиг ${SPOOL_CONFIG} отсутствует"

# Метаданные (пишет приложение рядом с конфигом) — только для отчётности.
if [ -f "${SPOOL_META}" ]; then
  FINGERPRINT="$(jq -r '.fingerprint // ""' "${SPOOL_META}" 2>/dev/null || echo "")"
  SERVER="$(jq -r '.server // ""' "${SPOOL_META}" 2>/dev/null || echo "")"
fi

# ── 0.1 Снимок конфига (защита от TOCTOU) ────────────────────────────────────
# Приложение может перезаписать ${SPOOL_CONFIG} в любой момент — в том числе между
# валидацией и install. Поэтому СРАЗУ делаем одну копию в root-only файл вне spool
# и дальше не читаем spool-конфиг вообще.
cleanup() {
  [ -n "${VERIFIED_CONFIG}" ] && rm -f "${VERIFIED_CONFIG}"
  return 0
}
trap cleanup EXIT

# Симлинк вместо конфига — попытка заставить root прочитать чужой файл.
[ ! -L "${SPOOL_CONFIG}" ] || fail "validating" "spool-конфиг не должен быть симлинком"

VERIFY_TMPDIR="/run"
[ -d "${VERIFY_TMPDIR}" ] && [ -w "${VERIFY_TMPDIR}" ] || VERIFY_TMPDIR="${TMPDIR:-/tmp}"
# Расширение .json обязательно: Xray определяет формат конфига по нему, и без него
# `xray run -test -c` падает с «Failed to get format of …» (проверено на Pi).
VERIFIED_CONFIG="$(mktemp --suffix=.json "${VERIFY_TMPDIR}/of-xray-config.XXXXXX" 2>/dev/null \
  || mktemp "${VERIFY_TMPDIR}/of-xray-config.XXXXXX.json")" \
  || { log "не удалось создать временный файл для проверки конфига"; exit 1; }
chmod 0600 "${VERIFIED_CONFIG}"
cp -- "${SPOOL_CONFIG}" "${VERIFIED_CONFIG}" \
  || fail "validating" "не удалось снять копию spool-конфига"

# ── 1. Валидация конфига (только по неизменяемой копии) ──────────────────────
SIZE="$(wc -c <"${VERIFIED_CONFIG}" | tr -d ' ')"
[ "${SIZE}" -le "${MAX_BYTES}" ] || fail "validating" "конфиг больше 256KB (${SIZE} байт)"

jq -e . "${VERIFIED_CONFIG}" >/dev/null 2>&1 || fail "validating" "конфиг не является валидным JSON"

# Allowlist top-level секций: ровно то, что генерит buildXrayConfig
# (src/lib/ai/vpn/vless.ts → {log, inbounds, outbounds, routing}). Любой лишний
# ключ (dns/stats/policy/api/observatory/reverse/fakedns) — отказ.
jq -e '(keys - ["log","inbounds","outbounds","routing"]) | length == 0' "${VERIFIED_CONFIG}" >/dev/null \
  || fail "validating" "в конфиге есть посторонние top-level секции: $(jq -r '(keys - ["log","inbounds","outbounds","routing"]) | join(", ")' "${VERIFIED_CONFIG}" 2>/dev/null)"

# Внутри log допустимы только loglevel/access/error.
jq -e '(.log // {}) | (keys - ["loglevel","access","error"]) | length == 0' "${VERIFIED_CONFIG}" >/dev/null \
  || fail "validating" "в секции log есть посторонние ключи"

ACCESS_LOG="$(jq -r '.log.access // ""' "${VERIFIED_CONFIG}")"
[ "${ACCESS_LOG}" = "none" ] || fail "validating" "log.access должен быть \"none\" (получено: '${ACCESS_LOG}')"

# log.error пишет root-овый Xray, поэтому произвольный путь запрещён:
# либо пусто (buildXrayConfig ставит ""), либо файл под /var/log/xray/.
ERROR_LOG="$(jq -r '.log.error // ""' "${VERIFIED_CONFIG}")"
case "${ERROR_LOG}" in
  "" | /var/log/xray/*) ;;
  *) fail "validating" "log.error разрешён только пустым или под /var/log/xray/ (получено: '${ERROR_LOG}')" ;;
esac

jq -e '.api == null' "${VERIFIED_CONFIG}" >/dev/null \
  || fail "validating" "секция api (управляющий gRPC Xray) запрещена"

INBOUND_COUNT="$(jq -r '.inbounds | length' "${VERIFIED_CONFIG}")"
[ "${INBOUND_COUNT}" = "1" ] || fail "validating" "ожидается ровно один inbound (получено: ${INBOUND_COUNT})"

IN_LISTEN="$(jq -r '.inbounds[0].listen // ""' "${VERIFIED_CONFIG}")"
IN_PORT="$(jq -r '.inbounds[0].port // ""' "${VERIFIED_CONFIG}")"
IN_PROTO="$(jq -r '.inbounds[0].protocol // ""' "${VERIFIED_CONFIG}")"
[ "${IN_LISTEN}" = "${EXPECT_LISTEN}" ] \
  || fail "validating" "inbound.listen должен быть ${EXPECT_LISTEN} (получено: '${IN_LISTEN}')"
[ "${IN_PORT}" = "${EXPECT_PORT}" ] \
  || fail "validating" "inbound.port должен быть ${EXPECT_PORT} (получено: '${IN_PORT}')"
[ "${IN_PROTO}" = "http" ] \
  || fail "validating" "inbound.protocol должен быть http (получено: '${IN_PROTO}')"

OUTBOUND_COUNT="$(jq -r '.outbounds | length' "${VERIFIED_CONFIG}")"
[ "${OUTBOUND_COUNT}" -ge 1 ] || fail "validating" "в конфиге нет outbounds"

# ── 2. Синтаксическая проверка самим Xray ────────────────────────────────────
write_status false "testing" ""
if ! TEST_OUT="$("${XRAY_BIN}" run -test -c "${VERIFIED_CONFIG}" 2>&1)"; then
  # Старые сборки понимают только `xray -test -config`.
  if ! TEST_OUT="$("${XRAY_BIN}" -test -config "${VERIFIED_CONFIG}" 2>&1)"; then
    fail "testing" "xray отверг конфиг: $(printf '%s' "${TEST_OUT}" | tail -c 400)"
  fi
fi

# ── 3. Установка ─────────────────────────────────────────────────────────────
write_status false "installing" ""
install -d -m 0755 "$(dirname "${TARGET_CONFIG}")"
if [ -f "${TARGET_CONFIG}" ]; then
  install -m 0600 "${TARGET_CONFIG}" "${BACKUP_CONFIG}"
fi

install_config "${VERIFIED_CONFIG}"

# ── 4. Рестарт + проверка ────────────────────────────────────────────────────
write_status false "restarting" ""
if ! systemctl restart "${XRAY_SERVICE}"; then
  rollback "не удалось перезапустить ${XRAY_SERVICE}"
fi

sleep 2
if ! systemctl is-active --quiet "${XRAY_SERVICE}"; then
  rollback "${XRAY_SERVICE} не поднялся после рестарта"
fi

# Best-effort: внешний IP через свежий прокси (не влияет на успех применения).
EXTERNAL_IP=""
if command -v curl >/dev/null 2>&1; then
  EXTERNAL_IP="$(curl -fsS -x "http://${EXPECT_LISTEN}:${EXPECT_PORT}" -m 10 https://api.ipify.org 2>/dev/null || echo "")"
fi

write_status true "applied" ""
log "OK: применён ${SERVER:-конфиг} (${FINGERPRINT:0:8}); внешний IP: ${EXTERNAL_IP:-неизвестен}"
