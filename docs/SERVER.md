# SERVER.md — паспорт прод-сервера

> Единая точка правды «где что лежит на сервере». Секретов здесь нет: пароли и токены — в `SERVER.local.md` в корне репозитория (файл вне git, маска `*.local.md` в `.gitignore`).
> Рутина обновления — скил `of-deploy-pi`. Бэкап, восстановление, перенос на NVMe — `docs/BACKUP_RESTORE.md`. Первичная установка — `docs/DEPLOY_RPI5.md`.
> Составлен 2026-11-17 по документации проекта. **Вживую по SSH в этот день не проверялся** — с новой рабочей машины нет ключа (см. «Доступ с новой машины»).

> **2026-11-18: сервер будет переустановлен с нуля на новый NVMe** (`docs/BACKUP_RESTORE.md`). Всё ниже описывает старую систему на флешке; после переустановки паспорт переписать по факту.

## Железо и сеть

| Что | Значение |
|---|---|
| Плата | Raspberry Pi 5, 16 ГБ, корпус Argon ONE V3 с платой M.2 NVMe |
| Диск | Kingston KC3000 1 ТБ (NVMe). По `docs/DEPLOY_NVME_MIGRATION.md` система перенесена на него 2026-08-13 — **факт надо перепроверить**: `findmnt -no SOURCE /` |
| Адрес (провод) | `192.168.31.222` — основной |
| Адрес (Wi-Fi) | `192.168.31.225` — резервный, сервер сам уходит на радио при обрыве кабеля |
| mDNS | `openfinance.local` |
| Доступность | только локальная сеть; наружу ничего не открыто |
| Веб | `https://192.168.31.222` (nginx :443, сертификат самоподписанный) |

## Что где работает

```
браузер ──HTTPS──> nginx :443 ──> next start :3000 (systemd: open-finance, один процесс)
                                      ├─> Postgres 16 + pgvector (Docker: openfinance-postgres, 127.0.0.1:5434)
                                      └─> HTTP-прокси для AI (Xray, 127.0.0.1:10809) ──VLESS──> внешние AI API
systemd-таймер of-ozon-sync ──> scripts/sync-ozon-daily.ts (ежедневный синк Ozon)
```

| Что | Где |
|---|---|
| Пользователь ОС | `firay`, sudo без пароля |
| Код приложения | `/home/firay/open-finance` (доставляется с рабочей машины, это не git-клон) |
| Секреты приложения | `/home/firay/open-finance/.env.production` |
| База | контейнер `openfinance-postgres`, база `openfinance`, пользователь `openfinance_user` |
| Юниты systemd | `open-finance`, `of-ozon-sync.{service,timer}`, `of-xray-apply.{path,service}`, `xray`, `of-console-status`, `of-net-watchdog`, `of-fan` |
| Конфиг Xray | `/usr/local/etc/xray/config.json` |
| Логи | `journalctl -u open-finance`; деплой — `/home/firay/{install,build,start}.log` |
| Исходники юнитов и скриптов | `deploy/{ozon-sync,pi-status,xray,backup}/` в репозитории |

## Пароли приложения

Сброс пароля делается на сервере, без почты и без базы руками:

```bash
sudo of-passwd --list                    # кто есть и с какой ролью
sudo of-passwd admin@openfinance.local   # сгенерировать новый пароль и показать
sudo of-passwd admin@openfinance.local --stdin   # задать свой, минуя историю оболочки
```

Учётная запись администратора — `admin@openfinance.local` (роль `super_admin`). Актуальный пароль — в `SERVER.local.md`. Заводской `admin12345` из сида использовать нельзя: если он ещё действует, сменить командой выше.

## Доступ с новой машины

SSH-ключ `~/.ssh/openfinance_pi` остался на прежней рабочей машине (Mac). На Windows-ПК его нет, поэтому деплой, бэкап и любые проверки сервера отсюда пока невозможны. Починка — один раз:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/openfinance_pi -C "windows-pc"
```

Затем добавить публичный ключ на сервер любым из способов:

- знаете Linux-пароль пользователя `firay` (сервер парольный вход принимает):
  ```bash
  cat ~/.ssh/openfinance_pi.pub | ssh firay@192.168.31.222 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
  ```
- пароль не помните — монитор и клавиатура в Pi, `Alt+F2`, вход, и вписать содержимое `openfinance_pi.pub` в `~/.ssh/authorized_keys`;
- либо выполнить `ssh-copy-id` со старой машины, где ключ есть.

Проверка:

```bash
ssh -i ~/.ssh/openfinance_pi firay@192.168.31.222 "hostname; findmnt -no SOURCE /; systemctl is-active open-finance"
```

После того как ключ заработает, парольный вход по SSH стоит выключить (`PasswordAuthentication no`).

## Что забрать с сервера в репозиторий

Код на сервер уезжал из рабочего дерева, которое опережало git, поэтому на Pi может лежать то, чего нет в истории:

1. **`/home/firay/open-finance/.cursor/rules/*.mdc`** — доменные правила. В git они не попали ни разу (каталог был в `.gitignore`), а на них ссылается вся агентная обвязка. Забрать и закоммитить в первую очередь.
2. Незакоммиченные правки кода — сравнить серверную копию с `HEAD`.

```bash
scp -r -i ~/.ssh/openfinance_pi firay@192.168.31.222:/home/firay/open-finance/.cursor/rules ./.cursor/
```
