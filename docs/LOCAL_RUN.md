# Как запустить Open Finance на этом ПК (памятка владельцу)

> Действует до переезда на отдельный Mac-сервер (решение 2026-11-19, `docs/HUB_PLAN.md`, этап 0).
> Секретов здесь нет: пароли лежат в `.env.local` (на этом ПК, вне git) и в `SERVER.local.md`.

## Каждый день

1. Запустить **Docker Desktop** (иконка кита) и дождаться статуса «Engine running».
2. Открыть PowerShell в папке проекта:
   ```powershell
   cd <папка проекта>
   ```
3. Поднять базу (если контейнер уже работает, команда ничего не сломает):
   ```powershell
   docker compose --env-file .env.local up -d postgres
   ```
4. Запустить приложение:
   ```powershell
   pnpm dev
   ```
5. Открыть в браузере http://localhost:3000 и войти как `admin@openfinance.local`. Пароль — в `SERVER.local.md`.

Остановить приложение — `Ctrl+C` в окне PowerShell. База продолжит работать в Docker, это нормально.

## Обновить данные Ozon

Кнопка «Синхронизировать» на странице «Аналитика» или из PowerShell:

```powershell
pnpm tsx scripts/sync-ozon-daily.ts
```

Полный синк идёт около 7 минут. Итог печатается в конце: «стейджей ok N, ошибок M».

## Если что-то не так

| Симптом | Что сделать |
|---|---|
| `pnpm dev` пишет про `DATABASE_URL` или не может подключиться | Docker Desktop не запущен, либо не выполнен шаг 3 |
| Страница не открывается | Посмотреть, что пишет окно с `pnpm dev`; перезапустить его |
| Нужна копия базы | `docker exec openfinance-postgres pg_dump -U openfinance_user -Fc -f /tmp/of.dump openfinance`, затем `docker cp openfinance-postgres:/tmp/of.dump .\of-backup.dump`. Перенаправление `>` не использовать: PowerShell портит двоичный файл |

## Где что лежит

- Код — папка, куда склонирован репозиторий.
- База — Docker-том `open-finance_openfinance_postgres_data`. Восстановлена из бэкапа старого сервера от 2026-11-18 (путь к бэкапу — в `SERVER.local.md`).
- Старый сервер Raspberry Pi работает со старой версией 0.54 с карты памяти (адрес — в `docs/SERVER.md`). Новые данные туда не попадают.
