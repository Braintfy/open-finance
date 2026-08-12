# deploy/xray — управление Xray/VLESS из админки Open Finance

Как это устроено: **web-процесс не имеет sudo и не запускает процессы**. Он только
пишет валидированный `config.json` в spool-директорию. Всё привилегированное делает
root-овый systemd path-юнит.

```
Админка (super_admin)                  spool (пользователь приложения)         root
──────────────────────                 ───────────────────────────────         ────
POST /api/admin/ai/vpn/apply
  parseVlessLink → buildXrayConfig
  writeSpoolConfig()  ──────────────►  /var/lib/open-finance/xray/
                                         config.meta.json   (0600)
                                         config.json        (0600, atomic mv)
                                                    │
                                                    │ PathChanged
                                                    ▼
                                       of-xray-apply.path ──► of-xray-apply.service
                                                                 of-xray-apply.sh:
                                                                   jq-инварианты
                                                                   xray run -test -c
                                                                   install → /usr/local/etc/xray/config.json
                                                                   systemctl restart xray
                                                                   status.json  (0644)
                                       status.json  ◄──────────────────┘
GET /api/admin/ai/vpn/status
  readApplyStatus()   ◄──────────────  (честный отчёт хоста: ok/phase/error/xrayActive/externalIp)
```

## Что проверяет `of-xray-apply.sh` перед установкой

Отказ (со записью причины в `status.json`), если хотя бы одно нарушено:

- файл — валидный JSON и меньше 256KB;
- `log.access == "none"` — Xray не должен писать журнал посещённых доменов на диск;
- ровно **один** inbound: `protocol=http`, `listen=127.0.0.1`, `port=10809`;
- нет секции `api` (управляющий gRPC-интерфейс Xray);
- есть хотя бы один outbound;
- `xray run -test -c` (fallback `xray -test -config`) принимает конфиг.

Если Xray не поднялся после рестарта — автоматический откат на
`/usr/local/etc/xray/config.json.prev` и `status.json` с `phase: "rolled_back"`.
Бэкап намеренно лежит в root-only каталоге, а не в spool: иначе скомпрометированное
приложение могло бы подсунуть «предыдущий» конфиг и получить его установку в обход
валидации, вызвав неудачное применение.

## Установка на сервере (Raspberry Pi / Debian)

Предполагается: Xray уже установлен (`/usr/local/bin/xray`), сервис `xray` работает
**не от root**, приложение крутится от пользователя `openfinance` (подставьте свой).

```bash
APP_USER=openfinance
REPO=/opt/open-finance          # каталог с исходниками приложения

# 1. Spool-директория: пишет приложение, читает root.
sudo install -d -o "$APP_USER" -g "$APP_USER" -m 0700 /var/lib/open-finance/xray

# 2. Скрипт применения — только root может писать, все могут читать.
sudo install -o root -g root -m 0755 "$REPO/deploy/xray/of-xray-apply.sh" \
  /usr/local/sbin/of-xray-apply.sh

# 3. Юниты.
sudo install -o root -g root -m 0644 "$REPO/deploy/xray/of-xray-apply.service" \
  /etc/systemd/system/of-xray-apply.service
sudo install -o root -g root -m 0644 "$REPO/deploy/xray/of-xray-apply.path" \
  /etc/systemd/system/of-xray-apply.path

# 4. jq обязателен для валидации.
sudo apt-get install -y jq

# 5. Включить наблюдение.
sudo systemctl daemon-reload
sudo systemctl enable --now of-xray-apply.path
```

В `.env` приложения:

```bash
XRAY_SPOOL_PATH=/var/lib/open-finance/xray/config.json
```

Путь должен совпадать с `PathChanged=` в `of-xray-apply.path` и `XRAY_SPOOL_DIR=`
в `of-xray-apply.service`. Меняете один — меняйте все три.

## Права (важно)

| Путь | Владелец | Права | Кто пишет |
|------|----------|-------|-----------|
| `/var/lib/open-finance/xray/` | `$APP_USER` | `0700` | приложение |
| `…/config.json`, `…/config.meta.json` | `$APP_USER` | `0600` | приложение |
| `…/status.json` | root | `0644` | apply-скрипт |
| `/usr/local/etc/xray/config.json.prev` (бэкап для отката) | root | `0600` | apply-скрипт |
| `/usr/local/sbin/of-xray-apply.sh` | root | `0755` | только вручную |
| `/etc/systemd/system/of-xray-apply.*` | root | `0644` | только вручную |
| `/usr/local/etc/xray/config.json` | root (`:xray` при `XRAY_GROUP`) | `0644` / `0640` | apply-скрипт |

Приложение **не должно** иметь права записи в `/usr/local/sbin`, `/etc/systemd/system`
и `/usr/local/etc/xray` — иначе смысл разделения теряется.

Если Xray запущен от отдельного пользователя/группы (`xray`), раскомментируйте
`Environment=XRAY_GROUP=xray` в `of-xray-apply.service` — конфиг с UUID будет
поставлен как `0640 root:xray`, а не читаемым всем.

## Проверка

```bash
# Наблюдатель включён?
systemctl status of-xray-apply.path

# Что произошло при последнем применении
sudo journalctl -u of-xray-apply.service -n 50 --no-pager
cat /var/lib/open-finance/xray/status.json

# Прокси действительно работает
curl -x http://127.0.0.1:10809 -m 15 https://api.ipify.org; echo
curl -x http://127.0.0.1:10809 -m 15 -o /dev/null -w '%{http_code}\n' https://api.anthropic.com/v1/models
```

## Ручное применение (без админки)

```bash
sudo systemctl start of-xray-apply.service
```

Скрипт возьмёт текущий `config.json` из spool — полезно после ручной правки
или для проверки отката.

## Типовые проблемы

| Симптом | Причина | Что делать |
|---------|---------|------------|
| В UI «Spool-директория недоступна для записи» | не создана директория или чужой владелец | шаг 1 установки, проверить `$APP_USER` |
| `hostStatus: null` в статусе | юниты не установлены или приложение не видит `status.json` | шаги 2–5; проверить `XRAY_SPOOL_PATH` |
| `phase: "validating"`, ошибка про inbound | конфиг собран не приложением (правили руками) | не редактировать spool вручную |
| `phase: "rolled_back"` | Xray не поднялся с новым конфигом | `journalctl -u xray -n 50`, проверить ссылку/сервер |
| «drift» в UI | на хосте другой конфиг, чем последний записанный | нажать «Применить» повторно |
| `jq не установлен` в journalctl | нет пакета | `sudo apt-get install -y jq` |

## Чего здесь НЕТ (осознанно)

- **At-boot реконсиляции** — при старте хоста конфиг не переприменяется; расхождение
  видно в админке как «drift» (отложено, см. `docs/LK_V2_PLAN.md`, Этап 4).
- **Хранения ссылок серверов подписки на диске** — spool содержит только тот сервер,
  который выбрали; список подписки перекачивается по кнопке админа.
- **Автообновления подписки по крону** — только ручной фетч (мера против SSRF/утечек).
