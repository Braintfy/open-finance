#!/usr/bin/env bash
# PURPOSE: Полный бэкап прод-инстанса Open Finance одним архивом — база, секреты,
# системные конфиги и серверная копия кода. Запускается НА СЕРВЕРЕ (Raspberry Pi).
# Ничего не останавливает и не меняет: только читает и пишет в каталог бэкапов.
#
#   sudo of-backup              полный бэкап в /home/firay/backups (of-backup-full-*)
#   sudo of-backup --no-code    без копии кода (of-backup-nightly-*: база + секреты + конфиги)
#
# Что внутри архива of-backup-<дата>.tar:
#   db.dump        pg_dump -Fc (восстановление — pg_restore)
#   secrets.tgz    .env.production, конфиг Xray, TLS-ключи nginx  ← самое ценное:
#                  без INBOX_SECRET_KEY / MARKETPLACE_SECRET_KEY дамп базы не
#                  расшифрует сохранённые ключи Ozon и почты
#   etc.tgz        nginx, юниты systemd проекта, fstab, config.txt, cmdline.txt
#   code.tgz       /home/firay/open-finance без node_modules/.next (серверная копия
#                  исторически опережает git и содержит .cursor/rules)
#   MANIFEST       версия сборки, размеры, sha256 каждого файла
#
# Архив НЕ зашифрован, если нет файла с парольной фразой (см. PASS_FILE): держать
# его вне облачных папок. Установка и восстановление — docs/BACKUP_RESTORE.md

set -euo pipefail

APP_DIR="${APP_DIR:-/home/firay/open-finance}"
OUT_ROOT="${OUT_ROOT:-/home/firay/backups}"
RUN_USER="${RUN_USER:-firay}"
PG_CONTAINER="${PG_CONTAINER:-openfinance-postgres}"
PG_USER="${PG_USER:-openfinance_user}"
PG_DB="${PG_DB:-openfinance}"
KEEP="${KEEP:-7}"                                   # сколько последних архивов хранить на сервере
PASS_FILE="${PASS_FILE:-/home/firay/.of-backup-pass}" # есть файл и gpg → архив шифруется
WITH_CODE=1
[ "${1:-}" = "--no-code" ] && WITH_CODE=0

if [ "$(id -u)" -ne 0 ]; then
  echo "✗ Нужен root (конфиг Xray и ключи nginx читает только он): sudo of-backup" >&2
  exit 1
fi

# Без главного секрета архив бесполезен: дамп не расшифрует ключи Ozon и почты.
[ -r "$APP_DIR/.env.production" ] || { echo "✗ нет $APP_DIR/.env.production — бэкап прерван" >&2; exit 1; }
[ "$KEEP" -ge 1 ] 2>/dev/null || { echo "✗ KEEP должен быть числом >= 1" >&2; exit 1; }

# Полные и ночные архивы ротируются раздельно: иначе семь ночных вытеснят
# единственный архив с копией кода.
KIND=full; [ "$WITH_CODE" -eq 0 ] && KIND=nightly
STAMP="$(date +%Y%m%d-%H%M%S)"
BUNDLE="$OUT_ROOT/of-backup-$KIND-$STAMP.tar"
umask 077
# Каталог бэкапов принадлежит непривилегированному пользователю, а пишет в него
# root: симлинк на месте каталога или архива заставил бы root перезаписать чужой файл.
[ -L "$OUT_ROOT" ] && { echo "✗ $OUT_ROOT — симлинк, отказ" >&2; exit 1; }
mkdir -p "$OUT_ROOT"
# Рабочий каталог — в /root-овом tmp с непредсказуемым именем, не в OUT_ROOT.
WORK="$(mktemp -d /var/tmp/of-backup.XXXXXXXX)"
PARTIAL="$BUNDLE.partial"
trap 'rm -rf "$WORK"; rm -f "$PARTIAL" "$PARTIAL.gpg"' EXIT
rm -f "$PARTIAL"

echo "→ база: pg_dump $PG_DB"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$WORK/db.dump"
# Пустой или обрезанный дамп — худший вид бэкапа: он есть, но не восстанавливается.
docker exec -i "$PG_CONTAINER" pg_restore --list < "$WORK/db.dump" > /dev/null \
  || { echo "✗ дамп не читается pg_restore — бэкап прерван" >&2; exit 1; }

echo "→ секреты"
SECRETS=()
for p in "$APP_DIR/.env.production" /usr/local/etc/xray/config.json /etc/nginx/ssl /etc/ssl/private; do
  [ -e "$p" ] && SECRETS+=("${p#/}")
done
# -h: ключи nginx часто лежат симлинками — в архив должны попасть сами файлы.
tar -czhf "$WORK/secrets.tgz" -C / "${SECRETS[@]}"

echo "→ системные конфиги"
ETC=()
for p in /etc/nginx /etc/fstab /etc/hostname /boot/firmware/config.txt /boot/firmware/cmdline.txt \
         /etc/systemd/system/open-finance.service /usr/local/bin/of-status /usr/local/bin/of-passwd \
         /usr/local/bin/of-backup; do
  [ -e "$p" ] && ETC+=("${p#/}")
done
for p in /etc/systemd/system/of-*; do [ -e "$p" ] && ETC+=("${p#/}"); done
tar -czf "$WORK/etc.tgz" --exclude='etc/nginx/ssl' -C / "${ETC[@]}"

if [ "$WITH_CODE" -eq 1 ]; then
  echo "→ код (без node_modules/.next)"
  tar -czf "$WORK/code.tgz" \
    --exclude='node_modules' --exclude='.next' --exclude='.env*' --exclude='.claude/worktrees' \
    -C "$(dirname "$APP_DIR")" "$(basename "$APP_DIR")"
fi

{
  echo "created: $(date -Is)"
  echo "host: $(hostname)"
  echo "root-device: $(findmnt -no SOURCE /)"
  echo "app-version: $(grep -o '"NEXT_PUBLIC_APP_VERSION":"[^"]*"' "$APP_DIR/.next/required-server-files.json" 2>/dev/null || echo unknown)"
  echo "db-size: $(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc "select pg_size_pretty(pg_database_size('$PG_DB'))")"
  echo "--- secrets: ${SECRETS[*]}"
  echo "--- sha256"
  (cd "$WORK" && sha256sum -- *.dump *.tgz)
} > "$WORK/MANIFEST"

# Пишем в *.partial и переименовываем: оборванный архив не должен выглядеть
# готовым и вытеснять годные при ротации.
tar -cf "$PARTIAL" -C "$WORK" .

if [ -r "$PASS_FILE" ] && command -v gpg >/dev/null 2>&1; then
  echo "→ шифрование (gpg, парольная фраза из $PASS_FILE)"
  gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256     --passphrase-file "$PASS_FILE" -o "$PARTIAL.gpg" "$PARTIAL"
  rm -f "$PARTIAL"
  BUNDLE="$BUNDLE.gpg"
  mv -f "$PARTIAL.gpg" "$BUNDLE"
else
  mv -f "$PARTIAL" "$BUNDLE"
  echo "⚠ АРХИВ НЕ ЗАШИФРОВАН (нет gpg или $PASS_FILE): внутри секреты, доступные $RUN_USER." >&2
fi

chown -h "$RUN_USER:$RUN_USER" "$OUT_ROOT" "$BUNDLE"
chmod 600 "$BUNDLE"

# Ротация: KEEP последних архивов своего вида; только обычные файлы в самом каталоге.
find "$OUT_ROOT" -maxdepth 1 -type f -name "of-backup-$KIND-*.tar*" ! -name '*.partial*' -printf '%T@ %p
'   | sort -rn | tail -n +"$((KEEP + 1))" | cut -d' ' -f2- | xargs -r -d '
' rm -f --

echo "✓ $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
cat "$WORK/MANIFEST"
