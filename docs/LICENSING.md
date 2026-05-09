# LICENSING.md — Инструкция по лицензированию для AI агента

## Цель
Память для будущих AI агентов про реализацию лицензирования в Local-First версии Open Finance (Tauri 2.0).

## Архитектурное решение

### Принцип
- Local-First приложение работает **offline-first**
- Лицензия = подписанный JWT (RS256), хранится локально
- Веб-валидация раз в 7 дней (grace period — работает без интернета 7 дней)
- Все данные пользователя — только на устройстве (никаких серверов компании)

### Зачем именно так
1. **Приватность** — данные финансов не покидают устройство
2. **Offline** — приложение работает без интернета почти всегда
3. **Безопасность** — JWT с public-key проверкой нельзя подделать без приватного ключа сервера
4. **UX** — пользователь не страдает от сбоев интернета

## Компоненты

### 1. License Server (cloud)
- Расположение: `api.openfinance.ru/license/*`
- Технологии: Next.js API Routes + JWT библиотека (jose)
- Хранит: пары RS256 ключей, базу лицензий, связь с биллингом
- Endpoints:
  - `POST /license/issue` — выдача лицензии после оплаты
  - `POST /license/refresh` — продление JWT (раз в N дней)
  - `POST /license/revoke` — отзыв (при возврате денег / нарушении)
  - `GET /license/.well-known/jwks.json` — публичный ключ для верификации

### 2. Tauri App (desktop)
- Внутри ОС:
  - **macOS:** хранение в Keychain (`@tauri-apps/plugin-stronghold` или `keytar`)
  - **Windows:** Credential Manager
  - **Linux:** Secret Service (libsecret)
- Бандлит **публичный ключ** License Server в исходниках (read-only)
- Локально проверяет подпись JWT без интернета

### 3. Billing → License связь
- При успешной оплате (см. BILLING.md) cloud-сервис вызывает License Server
- License Server генерирует JWT и отправляет на email пользователю + сохраняет в БД
- Пользователь копирует ключ в Tauri app

## JWT Payload

```json
{
  "iss": "openfinance.ru",
  "sub": "user_uuid",
  "plan": "lifetime|monthly|free",
  "iat": 1700000000,
  "exp": 1700604800,
  "jti": "license_uuid",
  "deviceLimit": 3,
  "features": ["ai_advisor", "marketplace_sync", "tax_all_modes"],
  "tier": "pro"
}
```

### Важно
- `exp` для месячной подписки = `iat + 7 days` (refresh раз в 7 дней с интернета)
- `exp` для lifetime = `iat + 365 days` (refresh раз в год)
- `deviceLimit` — сколько устройств можно активировать (3 по умолчанию)

## Подпись и валидация

### Server (issue)
```typescript
import { SignJWT, importPKCS8 } from 'jose';

const privateKey = await importPKCS8(process.env.LICENSE_PRIVATE_KEY!, 'RS256');

const jwt = await new SignJWT({ plan: 'monthly', tier: 'pro' })
  .setProtectedHeader({ alg: 'RS256' })
  .setIssuer('openfinance.ru')
  .setSubject(userId)
  .setExpirationTime('7d')
  .setIssuedAt()
  .setJti(licenseId)
  .sign(privateKey);
```

### Client (Tauri)
```typescript
import { jwtVerify, importSPKI } from 'jose';

// Публичный ключ зашит в исходниках
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----`;

const publicKey = await importSPKI(PUBLIC_KEY_PEM, 'RS256');

try {
  const { payload } = await jwtVerify(licenseJwt, publicKey, {
    issuer: 'openfinance.ru',
  });
  // payload.plan, payload.tier, payload.exp — доступны
  return { valid: true, ...payload };
} catch (err) {
  // exp expired или подпись невалидна
  return { valid: false };
}
```

## Хранение в Tauri (Rust)

```rust
// src-tauri/src/license.rs
use keyring::Entry;

pub fn store_license(jwt: &str) -> Result<(), Box<dyn std::error::Error>> {
    let entry = Entry::new("OpenFinance", "license")?;
    entry.set_password(jwt)?;
    Ok(())
}

pub fn load_license() -> Result<String, Box<dyn std::error::Error>> {
    let entry = Entry::new("OpenFinance", "license")?;
    Ok(entry.get_password()?)
}
```

## Поток активации

```
1. User скачивает Tauri app (Free Local mode)
2. В app нажимает "Активировать Pro" → открывается браузер
3. Веб-страница: тарифы + оплата (Т-Касса/CloudPayments)
4. После оплаты:
   - License Server генерирует JWT
   - Отправляет на email + показывает на странице успеха
   - (Опционально) deep link `openfinance://activate?key=...`
5. User копирует ключ → вставляет в app
6. App валидирует подпись → сохраняет в keychain → активирует фичи
7. Раз в 7 дней (или при запуске после долгой паузы):
   - App пытается получить новый JWT через /license/refresh
   - Если интернета нет — работает по старому JWT до exp
   - Если exp прошёл и нет интернета — переходит в Free режим
```

## Защита от пиратства

### Что делаем
- RS256 подпись — нельзя подделать без приватного ключа
- `deviceId` (UUID хоста) в payload при первой активации — лицензия привязана
- `deviceLimit` — сколько устройств можно
- Revoke list — публикуем JTI отозванных лицензий (download раз в день)

### Что НЕ делаем
- Не обфускируем код насмерть — Tauri app open-source-friendly, легче поддерживать
- Не блокируем при отсутствии интернета — UX важнее теоретической пиратки
- Не собираем телеметрию о использовании — privacy-first

### Реалистичный подход
- 95% пользователей платят, если продукт стоит того
- Параноидальная защита создаёт UX-боль для платящих
- Главный enforcement — постоянные обновления (пиратские версии устаревают)

## Что AI агенту нужно сделать (чеклист)

### License Server (cloud-side)
- [ ] Endpoint `app/api/license/issue/route.ts` (POST)
- [ ] Endpoint `app/api/license/refresh/route.ts` (POST)
- [ ] Endpoint `app/api/license/revoke/route.ts` (POST, admin)
- [ ] Endpoint `app/api/license/.well-known/jwks.json` (GET)
- [ ] Schema Drizzle: `licenses` таблица (id, userId, jti, plan, deviceIds, status)
- [ ] Связь с billing: при `payment.status=succeeded` → issue license
- [ ] Email шаблон: «Ваш ключ: `eyJ...`»

### Tauri App (client-side)
- [ ] Tauri plugin `keyring-rs` для безопасного хранения JWT
- [ ] React hook `useLicense()` с состоянием (free / pro / expired)
- [ ] UI: модалка «Активировать Pro» с input для ключа
- [ ] Background task: refresh JWT за 1 день до exp
- [ ] Graceful degradation: при exp без интернета → Free режим + warning banner
- [ ] Deep link handler: `openfinance://activate?key=...`

## Ссылки
- Tauri Keyring plugin: https://github.com/tauri-apps/plugins-workspace
- jose JWT library: https://github.com/panva/jose
- Keyforge tutorial (как пример): https://keyforge.dev/blog/how-to-license-tauri-app

## Решения, требующие обсуждения
- Использовать ли Keyforge / Lemon Squeezy как готовый License Server (быстрее, но vendor lock-in)
- Делать ли trial-period (14 дней Pro бесплатно, потом Free) — UX vs revenue
- Как обрабатывать смену устройства (revoke + reissue?)
- Family plan / team plan для Local — есть ли спрос
