# VPN для зарубежных AI API

## Проблема

В РФ заблокированы / нестабильны:
- **OpenAI API** (`api.openai.com`)
- **Anthropic Claude** (`api.anthropic.com`)
- **Google Gemini** — частично

Решение: ходить в эти API через VPN-прокси.

## Доступные подходы

### 1. SOCKS5/HTTP прокси (рекомендуется)

**Подходит:** для серверных вызовов (наш случай — API roytes).

В `.env.local`:

```bash
AI_PROXY_URL=socks5://login:password@proxy.host.com:1080
# или HTTP/HTTPS прокси:
AI_PROXY_URL=http://login:password@proxy.host.com:8080
```

В коде Open Finance прокси автоматически применяется в `src/lib/ai/providers/anthropic.ts` и `openai.ts` через `https-proxy-agent` / `socks-proxy-agent`.

### 2. WireGuard / OpenVPN на VPS

**Подходит:** если у вас свой VPS не в РФ — пробросьте через него весь трафик. Сложнее, но контроль 100%.

```bash
# На VPS:
docker run -d --name=wg \
  --cap-add=NET_ADMIN \
  -e PUID=1000 -e PGID=1000 \
  -e SERVERURL=ваш_vps_ip \
  -p 51820:51820/udp \
  -v $(pwd)/wg-config:/config \
  linuxserver/wireguard

# На клиенте подключаетесь по конфигу из /config/peer1/
```

### 3. Cloudflare Workers / Vercel Edge как прокси

Не рекомендуется — у Cloudflare есть rate-limit, а у вас будет 1 worker = 1 пользователь.

## Подключение через bvpn.cc подписку

> Ссылка от пользователя: `https://bvpn.cc/subs/...`

bvpn.cc даёт VLESS / VMess / Shadowsocks подписки. Это формат для **Xray / V2Ray клиента**, не классический SOCKS5.

### Шаг 1: Поднять локальный SOCKS5-прокси через Xray

```bash
# Установка xray-core (mac):
brew install xray

# Конфиг ~/.xray/config.json:
{
  "log": { "loglevel": "info" },
  "inbounds": [{
    "port": 10808,
    "listen": "127.0.0.1",
    "protocol": "socks",
    "settings": { "auth": "noauth", "udp": true }
  }],
  "outbounds": [{
    "protocol": "vless",
    "settings": {
      "vnext": [{
        "address": "адрес_сервера_из_подписки",
        "port": 443,
        "users": [{
          "id": "uuid_из_подписки",
          "encryption": "none",
          "flow": "xtls-rprx-vision"
        }]
      }]
    },
    "streamSettings": {
      "network": "tcp",
      "security": "reality",
      "realitySettings": {
        "fingerprint": "chrome",
        "serverName": "google.com",
        "publicKey": "ключ_из_подписки",
        "shortId": "из_подписки"
      }
    }
  }]
}
```

### Шаг 2: Получить конфиг из подписки

```bash
# Декодировать подписку:
curl -s 'https://bvpn.cc/subs/3h8hnfgFtfD_hg9M' | base64 -d
# Получишь vless://... ссылки. Парсить руками или через:
# https://github.com/yuhan6665/v2rayNG-helper

# Альтернатива — GUI клиент:
# - V2Box (mac): https://v2box.app/
# - V2RayN (win): https://github.com/2dust/v2rayN
# Импортировать туда подписку, включить SOCKS5 inbound на 10808
```

### Шаг 3: Подключить в Open Finance

В `.env.local`:

```bash
AI_PROXY_URL=socks5://127.0.0.1:10808
```

### Проверка

```bash
# Без прокси:
curl https://api.anthropic.com/v1/messages
# (зависнет / 403)

# Через прокси:
curl --socks5 127.0.0.1:10808 https://api.anthropic.com/v1/messages
# (вернёт 401 — это значит прошло)
```

## Безопасность

- **НИКОГДА** не пушить `.env.local` с прокси-кредами в git (он в `.gitignore` — проверь)
- Прокси-логин/пароль ротировать раз в квартал
- На проде VPS — лучше WireGuard на роутере, чтобы весь трафик контейнера шёл через VPN, без логирования внутри

## Альтернативные провайдеры

| Сервис | Тип | Цена/мес |
|--------|-----|----------|
| **bvpn.cc** | VLESS подписка | ~300 ₽ |
| **Outline VPN** (свой VPS) | Shadowsocks | стоимость VPS |
| **VPS + WireGuard** | свой канал | от 300 ₽ |
| **Mullvad** | OpenVPN/WireGuard | ~5 €/мес, оплата криптой |
| **iCloud Private Relay** | только Safari | бесплатно для подписчиков iCloud+ |

## Когда прокси не нужен

Если вы используете:
- **Yandex GPT** (`https://llm.api.cloud.yandex.net`) — российский, без VPN
- **GigaChat** (Сбер) — российский
- **Локальную Ollama** — на твоём ПК

Тогда `AI_PROXY_URL` оставь пустым.
