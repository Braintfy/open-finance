# Email через Beget

## Шаг 1: Создай ящик в Beget

1. Войди в [Beget Панель](https://cp.beget.com/)
2. Перейди: **Почта → Управление почтой → Создать ящик**
3. Создай `noreply@твойдомен.ru` (или любой другой)
4. Установи пароль (Beget не показывает потом — сохрани сразу)

## Шаг 2: Параметры SMTP

Beget предоставляет два варианта:

| Параметр | SSL (рекомендуется) | TLS |
|----------|---------------------|-----|
| **SMTP host** | `smtp.beget.com` | `smtp.beget.com` |
| **Port** | `465` | `2525` или `587` |
| **Encryption** | SSL/TLS | STARTTLS |
| **Auth** | LOGIN | LOGIN |
| **Username** | полный email (`noreply@домен.ru`) | то же |
| **Password** | пароль ящика | тот же |

## Шаг 3: Заполни `.env.local`

```bash
SMTP_HOST=smtp.beget.com
SMTP_PORT=465
SMTP_USER=noreply@твойдомен.ru
SMTP_PASSWORD=твой_пароль_от_ящика
SMTP_FROM=Open Finance <noreply@твойдомен.ru>

APP_URL=https://открытыефинансы.ру  # для ссылок в письмах
```

## Шаг 4: Проверь

После рестарта dev-сервера:

```bash
# через REST API:
curl -X POST http://localhost:3000/api/auth/forgot-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"твой@email.ru"}'

# Через UI: /forgot-password
```

Должно прийти письмо на ящик.

## Шаг 5: SPF / DKIM (для надёжной доставки)

Чтобы письма не падали в спам:

### SPF (TXT-запись)
В DNS своего домена добавь:
```
v=spf1 include:beget.com ~all
```

### DKIM
В Beget панели: **Почта → DKIM** → включи. Beget сам подскажет какую TXT-запись добавить в DNS.

### DMARC (опционально, но желательно)
```
TXT _dmarc.твойдомен.ru:
v=DMARC1; p=quarantine; rua=mailto:postmaster@твойдомен.ru
```

## Лимиты Beget

- Базовый тариф: **до 200 писем/час** на ящик
- Стандарт: **до 1000 писем/час**
- Этого хватит для ранней beta. Когда понадобится масштаб — переключаемся на сервис типа Resend / SendGrid (1 строка в `transport.ts`)

## Если SMTP не работает

В `transport.ts` есть **fallback в dev**: если `SMTP_HOST` пустой — письма пишутся в консоль сервера. Это удобно при разработке.

В проде проверь:

```bash
# Проверка что 465 порт открыт с твоего сервера:
nc -vz smtp.beget.com 465

# Проверка авторизации:
curl --url 'smtps://smtp.beget.com:465' \
  --user 'noreply@домен.ru:пароль' \
  --mail-from 'noreply@домен.ru' \
  --mail-rcpt 'тест@email.ru' \
  --upload-file mail.txt
```

## Альтернативы

| Сервис | Когда уместен |
|--------|---------------|
| **Beget SMTP** | сейчас — у тебя уже хостинг |
| **Yandex SMTP** | если домен на Яндекс.360 |
| **SendGrid / Resend** | от 10к писем/мес — стабильнее |
| **Amazon SES** | дёшево при больших объёмах (но заблокирован в РФ напрямую) |
