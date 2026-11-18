# BACKUP_RESTORE.md — бэкап, восстановление и перенос на NVMe

> Составлен 2026-11-17. Паспорт сервера — `docs/SERVER.md`. Подробности о железе и уроки первой попытки переноса — `docs/DEPLOY_NVME_MIGRATION.md`.
> **Скрипт `deploy/backup/of-backup.sh` написан, но на сервере ещё не запускался** (нет SSH с новой машины). Первый запуск — под присмотром, с проверкой содержимого архива.

## Что бэкапим и почему именно это

| Что | Где на сервере | Можно ли восстановить без бэкапа |
|---|---|---|
| Секреты приложения | `/home/firay/open-finance/.env.production` | **Нет.** Без `MARKETPLACE_SECRET_KEY` и `INBOX_SECRET_KEY` дамп базы не расшифрует ключи Ozon и почты |
| База | Postgres в Docker | **Нет** для своего: себестоимость, поставки, склад, настройки. Данные Ozon перекачиваются, но только за окно, которое отдаёт API |
| Конфиг VPN | `/usr/local/etc/xray/config.json` | Да, из подписки, но долго |
| nginx, TLS, юниты systemd | `/etc/nginx`, `/etc/systemd/system/of-*` | Да, из `deploy/` и `docs/DEPLOY_RPI5.md`, но часы работы |
| Серверная копия кода | `/home/firay/open-finance` | Частично: сервер исторически опережал git, и только там лежат `.cursor/rules/*.mdc` |
| `node_modules`, `.next` | там же | Да, пересборкой. В бэкап не входят |

Всё это собирает один скрипт в один архив: `of-backup-full-<дата>.tar` (с кодом) или `of-backup-nightly-<дата>.tar` (без). Ротация у них раздельная.

**Что уже есть на сервере.** По `deploy/ozon-sync/README.md`, в crontab пользователя `firay` в 03:30 идёт бэкап базы. Его скрипта в репозитории нет, куда он пишет и хранит ли секреты — неизвестно. При первом входе посмотреть `crontab -l` и каталог назначения. Старый cron не отключать, пока `of-backup` не отработает несколько ночей и не пройдёт проверку восстановлением; потом оставить один механизм.

## Установка (один раз, на сервере)

```bash
sudo install -o root -g root -m 0755 deploy/backup/of-backup.sh /usr/local/bin/of-backup
sudo install -o root -g root -m 0644 deploy/backup/of-backup.service deploy/backup/of-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now of-backup.timer
```

Таймер каждую ночь в 04:30 МСК кладёт архив «база + секреты + конфиги» в `/home/firay/backups` и хранит семь последних. Полный архив с копией кода — вручную: `sudo of-backup`.

Шифрование (по желанию): положить парольную фразу в `/home/firay/.of-backup-pass` (права `600`) и поставить `gpg` — архив станет `*.tar.gpg`. Фразу записать в `SERVER.local.md`: без неё архив бесполезен.

## Бэкап на сервере — это ещё не бэкап

Архив на том же диске, что и база, не спасает от отказа диска. Его нужно забирать на ПК:

```bash
mkdir -p ~/of-backups && scp -i ~/.ssh/openfinance_pi "firay@192.168.31.222:/home/firay/backups/of-backup-*" ~/of-backups/
```

Каталог `~/of-backups` — вне репозитория и вне облачных папок (в архиве секреты). Следующий шаг после переноса на NVMe — автоматизировать вытягивание по расписанию Windows и держать вторую копию на microSD, которая останется в плате.

## Проверка, что бэкап годен

Бэкап, который ни разу не восстанавливали, — предположение. Раз в месяц и обязательно перед переносом:

```bash
mkdir /tmp/ofb && tar -xf /home/firay/backups/of-backup-<дата>.tar -C /tmp/ofb && cat /tmp/ofb/MANIFEST
(cd /tmp/ofb && sha256sum -c <(sed -n '/--- sha256/,$p' MANIFEST | tail -n +2))
docker exec openfinance-postgres createdb -U openfinance_user of_restore_test
docker exec -i openfinance-postgres pg_restore -U openfinance_user -d of_restore_test < /tmp/ofb/db.dump
docker exec openfinance-postgres psql -U openfinance_user -d of_restore_test -tAc "select count(*) from ozon_orders"
docker exec openfinance-postgres dropdb -U openfinance_user of_restore_test
rm -rf /tmp/ofb
```

Зашифрованный архив сначала расшифровать: `gpg -d of-backup-….tar.gpg > /tmp/of.tar`. Последняя строка обязательна — в `/tmp/ofb` лежат распакованные секреты.

Число строк должно совпасть с боевой базой. `dropdb` удаляет только тестовую базу `of_restore_test`.

## Восстановление на чистую систему

1. Поставить ОС и окружение по `docs/DEPLOY_RPI5.md`, фазы B и D (Docker, Node, pnpm, контейнер Postgres с расширениями).
2. Распаковать архив; `code.tgz` → `/home/firay/`, `secrets.tgz` → в корень (`sudo tar -xzf secrets.tgz -C /`).
3. **`etc.tgz` в корень не распаковывать:** в нём `fstab` и `cmdline.txt` с идентификаторами старого диска — новая система перестанет грузиться. Распаковать во временный каталог и перенести руками только nginx и юниты `of-*`/`open-finance`.
4. `docker exec -i openfinance-postgres pg_restore -U openfinance_user -d openfinance --clean --if-exists < db.dump`.
5. `pnpm install --frozen-lockfile`, сборка, `systemctl enable --now` юнитов — как в скиле `of-deploy-pi`.
6. Health-чек из того же скила.

Миграции после восстановления не нужны: дамп несёт схему и журнал Drizzle.

---

# Перенос системы на NVMe Kingston 1 ТБ

> **Решение владельца 2026-11-18: ставим заново.** Новый диск, свежая ОС, приложение разворачивается с нуля, данные переносятся со старой флешки. Клон (ниже, раздел «Запасной путь: клон») не используется, оставлен как справка.

## Основной путь: чистая установка

**Главное правило: старую флешку не форматировать и не перезаписывать, пока новая система не проработает две недели.** На ней единственные экземпляры базы и секретов. Новую ОС записывать только на NVMe.

### 1. Снять данные со старой системы — два способа

**А. Дамп до замены (предпочтительно).** Пока плата ещё грузится со старой флешки: монитор и клавиатура, `Alt+F2`, вход, затем
```bash
sudo bash /home/firay/open-finance/deploy/backup/of-backup.sh
```
(скрипт сначала положить на флешку или набрать вручную минимум: `docker exec openfinance-postgres pg_dump -U openfinance_user -d openfinance -Fc > /home/firay/db.dump`). Архив останется на старой флешке — этого достаточно, заберём его на шаге 3.

**Б. Без загрузки старой системы.** Если дамп заранее не снят — не страшно: все файлы лежат на флешке, а базу можно поднять из копии каталога данных. Перед тем как вынуть флешку, плату выключить штатно (`sudo poweroff`), а не питанием — иначе каталог базы может потребовать восстановления.

### 2. Новая система

Raspberry Pi OS Lite 64-bit на NVMe (Raspberry Pi Imager пишет прямо на диск через USB-переходник, либо сетевая установка самой платы). В Imager сразу задать пользователя `firay`, имя хоста и **публичный SSH-ключ этого ПК** — тогда вход по ключу работает с первой загрузки и пароль не нужен. Дальше — `docs/DEPLOY_RPI5.md`, фазы B (база ОС, Docker, Node, pnpm) и C (VPN для AI, если нужен).

### 3. Подключить старую флешку и забрать с неё всё

Флешку — в USB (microSD через картридер). Монтировать **только на чтение**:
```bash
lsblk -o NAME,SIZE,MODEL,MOUNTPOINT
sudo mkdir -p /mnt/old && sudo mount -o ro /dev/sdX2 /mnt/old
```
`sdX2` — корневой раздел старой флешки из вывода `lsblk` (не `nvme0n1`).

| Что | Откуда на `/mnt/old` | Куда |
|---|---|---|
| секреты приложения | `home/firay/open-finance/.env.production` | тот же путь на новой системе; **ключи `INBOX_SECRET_KEY` и `MARKETPLACE_SECRET_KEY` переносить как есть**, иначе ключи Ozon в базе не расшифруются |
| доменные правила | `home/firay/open-finance/.cursor/rules/` | на ПК в репозиторий и закоммитить |
| серверная копия кода | `home/firay/open-finance/` | на ПК — сравнить с git, забрать расхождения |
| VPN | `usr/local/etc/xray/config.json` | тот же путь |
| nginx и сертификат | `etc/nginx/` | как образец; `fstab` и `cmdline.txt` со старой системы **не копировать** |
| готовые дампы | `home/firay/backups/`, `home/firay/*.dump` | если есть — базу брать отсюда |
| старый cron-бэкап | `var/spool/cron/crontabs/firay` | посмотреть, куда он писал |

### 4. База

Есть дамп (способ А или найденный на флешке) — восстановить его в новый контейнер:
```bash
docker exec -i openfinance-postgres pg_restore -U openfinance_user -d openfinance --clean --if-exists < db.dump
```

Дампа нет (способ Б) — поднять временный Postgres той же версии на **копии** каталога данных и снять дамп с него:
```bash
sudo ls /mnt/old/var/lib/docker/volumes/
sudo cp -a /mnt/old/var/lib/docker/volumes/<том-postgres>/_data /home/firay/pg-old
docker run -d --name pg-old -v /home/firay/pg-old:/var/lib/postgresql/data pgvector/pgvector:pg16
docker exec pg-old pg_dump -U openfinance_user -d openfinance -Fc > /home/firay/db.dump
docker rm -f pg-old
```
Копия нужна потому, что флешка смонтирована только на чтение, а Postgres при старте пишет в свой каталог. Тег образа взять тот же, что в `docker-compose.yml`.

Миграции после восстановления не запускать: дамп несёт схему и журнал Drizzle. Они понадобятся, только если код новее схемы в дампе, — тогда по скилу `of-db-migrate`.

### 5. Приложение и проверка

Код с ПК (скил `of-deploy-pi`), сборка, юниты из `deploy/`, health-чек. Затем: вход в приложение, блок аналитики Ozon показывает данные, тестовый синк проходит (значит, ключи расшифровались). После этого — установить `of-backup` и таймер, снять первый архив и унести на ПК.

### Что чистая установка даёт попутно

Один пароль администратора вместо двух, SSH только по ключу с первого дня, без контейнеров `redis`/`minio`/`adminer`, единый путь приложения в доках и юнитах, бэкап-таймер вместо безымянного cron.

## Запасной путь: клон

## Шаг 0. Сначала выяснить, не сделано ли уже

`docs/DEPLOY_NVME_MIGRATION.md` утверждает, что перенос выполнен 2026-08-13. Владелец 2026-11-17 говорит о переносе как о предстоящем. Проверка одной командой:

```bash
findmnt -no SOURCE / && lsblk -o NAME,SIZE,MODEL,MOUNTPOINT
```

- `/dev/nvme0n1p2` → система уже на NVMe, переносить нечего; остаётся только наладить бэкапы.
- `/dev/mmcblk0p2` → система на карте, идём дальше. То же самое видно на мониторе, подключённом к плате (строка «корень»).

## Два пути

| | Клон карты на NVMe | Чистая установка + восстановление |
|---|---|---|
| Суть | копируем работающую систему как есть | свежая ОС на NVMe, данные из архива `of-backup` |
| Время | около часа | 3–4 часа |
| Риск | переносим накопленный мусор | ничего не забыть помогает архив |
| Когда выбирать | **по умолчанию** | если клон не загрузился или хочется чистую систему |

Рекомендация — клон. Архив `of-backup` делается в обоих случаях: для клона это страховка, для чистой установки — источник данных.

## Порядок (клон)

1. **Полный бэкап и вынос его с сервера.** `sudo of-backup`, затем `scp` на ПК (команда выше), затем проверка восстановлением. Без этого шага к диску не прикасаться.
2. **Убедиться, что не идёт синк Ozon**, и остановить ночные таймеры: `sudo systemctl stop of-ozon-sync.timer of-backup.timer`.
3. **Выключить плату, поставить диск**, включить. Диск должен появиться в `lsblk` как `nvme0n1`. Если нет — `dtparam=pciex1` в `/boot/firmware/config.txt` и проверка шлейфа.
4. **Обновить загрузчик:** `sudo rpi-eeprom-update -a`, перезагрузка.
5. **Остановить всё, что пишет:**
   ```bash
   sudo systemctl stop open-finance of-xray-apply.path xray && sudo systemctl stop docker.socket docker
   ```
6. **Разметить и скопировать.** `rpi-clone` на NVMe не работает (проверено, причина — в `DEPLOY_NVME_MIGRATION.md`), поэтому вручную. Выполнять по одной строке, читая вывод; строки «СТОП» — предохранители (без смонтированного NVMe `rsync` скопировал бы систему в каталог на самой карте). **Команда `parted` стирает диск `nvme0n1` — убедиться по `lsblk`, что это именно новый Kingston, а не карта.**
   ```bash
   [ "$(findmnt -no SOURCE /)" = /dev/mmcblk0p2 ] || { echo "корень не на карте — СТОП"; exit 1; }
   sudo parted -s /dev/nvme0n1 mklabel msdos mkpart primary fat32 4MiB 516MiB mkpart primary ext4 516MiB 100%
   sudo mkfs.vfat -F 32 -n bootfs /dev/nvme0n1p1 && sudo mkfs.ext4 -F -L rootfs /dev/nvme0n1p2
   sudo mkdir -p /mnt/nvboot /mnt/nvroot && sudo mount /dev/nvme0n1p2 /mnt/nvroot && sudo mount /dev/nvme0n1p1 /mnt/nvboot
   mountpoint -q /mnt/nvroot && mountpoint -q /mnt/nvboot || { echo "разделы NVMe не смонтированы — СТОП"; exit 1; }
   sudo rsync -aHAXx --numeric-ids --info=progress2 / /mnt/nvroot/
   sudo rsync -a /boot/firmware/ /mnt/nvboot/
   ```
7. **Прописать новые идентификаторы разделов** — без этого ядро ищет корень на карте и падает:
   ```bash
   OLD=$(findmnt -no PARTUUID / | cut -d- -f1); NEW=$(sudo blkid -s PARTUUID -o value /dev/nvme0n1p2 | cut -d- -f1); echo "$OLD -> $NEW"
   sudo sed -i "s/$OLD/$NEW/g" /mnt/nvroot/etc/fstab /mnt/nvboot/cmdline.txt
   grep -H PARTUUID /mnt/nvroot/etc/fstab /mnt/nvboot/cmdline.txt
   ```
   В выводе `grep` не должно остаться старого идентификатора. Обе переменные должны быть непустыми и разными — иначе `sed` не запускать.
8. **Порядок загрузки:** `sudo rpi-eeprom-config --edit` → `BOOT_ORDER=0xf416` (сначала NVMe, потом карта).
9. **Размонтировать, выключить, вынуть карту, включить.** Первая загрузка с нового диска долгая — до 5–10 минут не паниковать; смотреть на монитор, а не на `ping`.
10. **Проверка:**
    ```bash
    findmnt -no SOURCE / ; systemctl is-active open-finance docker xray ; curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/ ; vcgencmd get_throttled
    ```
    Ждём `/dev/nvme0n1p2`, три `active`, `200`, `0x0`.
11. **После успеха:** `sudo systemctl enable fstrim.timer`, вернуть таймеры (`sudo systemctl start of-ozon-sync.timer of-backup.timer`), проверить `systemctl is-enabled open-finance docker xray of-xray-apply.path`.

## Страховка

- **Карту не трогать минимум две недели.** Это единственный мгновенный откат: вставил, включил — прежняя система. Автоматического отката загрузчик не делает, если ядро с NVMe стартовало.
- Архив `of-backup` на ПК — второй рубеж, если умрут и диск, и карта.
- После двух недель карту не выбрасывать: перезаписать её свежей системой как аварийную и раз в месяц класть на неё архив бэкапа.

## Чего нельзя

Клонировать при работающем Postgres. Переносить во время синка Ozon. Передавать `.env.production` через репозиторий или мессенджеры. Пробовать `dtparam=pciex1_gen=3` до того, как система неделю отработала стабильно.
