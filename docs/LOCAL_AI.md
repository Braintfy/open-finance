# Локальная AI-модель в dev (Ollama)

> Зачем: разрабатывать с реальным AI без расходов на API и без VPN.
> Как работает: Ollama крутится у тебя на маке, отдаёт OpenAI-совместимый JSON, наш `OllamaProvider` к нему ходит.

## Способ 1 — через Ollama.app (рекомендую для соло-разработчика)

Самый простой. Один раз поставил — забыл.

```bash
# Установка (один раз)
brew install ollama

# Запустить как сервис (автостарт при перезагрузке)
brew services start ollama

# Скачать модель (~5 GB, делается один раз)
ollama pull qwen2.5:7b

# Проверить что живо
curl http://localhost:11434/api/tags
# или
pnpm ollama:check
```

**Какую модель брать на M-серии Mac:**

| Модель | Размер | RAM | Качество | Скорость | Когда брать |
|--------|--------|-----|----------|----------|-------------|
| `qwen2.5:3b` | 2 GB | 4 GB | средне | ~50 t/s | минимальный mac, быстрые ответы |
| `qwen2.5:7b` ✅ | 4.7 GB | 8 GB | хорошо | ~25 t/s | **дефолт** для разработки |
| `llama3.1:8b` | 4.7 GB | 8 GB | хорошо | ~20 t/s | альтернатива qwen |
| `qwen2.5:14b` | 9 GB | 16 GB | отлично | ~10 t/s | если M2 Pro+ |
| `qwen2.5:32b` | 20 GB | 32 GB | premium | ~5 t/s | M3 Max / Studio |

Для embeddings (RAG-память) отдельно:

```bash
ollama pull nomic-embed-text
```

## Способ 2 — Ollama в Docker (если хочешь изолировать)

Не рекомендую на macOS: контейнер не видит Apple Silicon GPU и крутится на CPU в 5–10 раз медленнее. На Linux-сервере — нормально.

```yaml
# Если всё-таки надо, добавь в docker-compose.yml:
ollama:
  image: ollama/ollama:latest
  container_name: openfinance-ollama
  ports:
    - "11434:11434"
  volumes:
    - openfinance_ollama_data:/root/.ollama
```

## Способ 3 — Через настройки в админке (план)

В роадмапе: страница `/admin/ai/local-models` где:

1. Кнопка «Скачать qwen2.5:7b» — фронт триггерит API → backend пушит `ollama pull` через локального демона
2. Прогресс-бар скачивания (стриминг от Ollama API)
3. Список установленных моделей + кнопка «Удалить»
4. Тест-чат прямо из админки

API Ollama для этого:
- `GET /api/tags` — список моделей
- `POST /api/pull` — скачать (стриминг JSON)
- `DELETE /api/delete` — удалить
- `POST /api/generate` — чат

**Примечание по безопасности:** менеджмент моделей доступен ТОЛЬКО когда:
- `NODE_ENV=development` ИЛИ
- Это Tauri-сборка (Local-First режим, всё локально)

В SaaS-проде эта страница недоступна.

## Что делать если Ollama не поднимается

1. Проверь `brew services list` — должен быть `ollama started`
2. Проверь порт: `lsof -i :11434`
3. Логи: `tail -f ~/.ollama/logs/server.log`
4. Если занят порт — выключи через `brew services stop ollama` и запусти руками: `OLLAMA_HOST=127.0.0.1:11434 ollama serve`

## Когда Ollama НЕ нужен

- В админке выбран `mock` провайдер (`AI_DEFAULT_PROVIDER=mock`)
- Юзер использует Anthropic/OpenAI с реальным ключом
- На продакшене SaaS

## Связанные файлы

- `src/lib/ai/providers/ollama.ts` — провайдер (TODO в Этапе 2)
- `src/lib/ai/providers/mock.ts` — mock-провайдер для тестов (TODO)
- `.env.example` — `OLLAMA_BASE_URL`, `OLLAMA_DEFAULT_MODEL`, `AI_DEFAULT_PROVIDER`
