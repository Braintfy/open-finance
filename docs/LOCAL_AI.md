# Локальный AI для разработки (Ollama)

## Зачем

В разработке не хочется тратить деньги на API. Ollama запускает модели локально и предоставляет HTTP API совместимый с OpenAI-форматом (с нюансами).

## Шаг 1: Установка Ollama

```bash
# macOS:
brew install ollama
brew services start ollama

# Linux:
curl -fsSL https://ollama.com/install.sh | sh

# Проверка:
curl http://localhost:11434/api/tags
# → {"models":[]}
pnpm ollama:check
```

После этого Ollama слушает на `http://localhost:11434`.

## Шаг 2: Скачать модель

### Через UI приложения (рекомендуется)

1. Открой `/admin/ai/local-models` под аккаунтом super-admin
2. Выбери модель из каталога → нажми «Загрузить»
3. Прогресс-бар покажет скачивание
4. После загрузки модель появится в «Установленных»

### Через CLI

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text   # для RAG embeddings (обязательно если AI используется)
```

## Подбор модели под Mac M3 18GB

Mac M3 с 18GB unified memory — sweet spot для локального LLM. Apple Silicon GPU использует ту же память, поэтому модели работают шустро.

| Модель | Размер | Скорость на M3 18GB | Качество русского |
|--------|--------|---------------------|-------------------|
| `qwen2.5:7b` | 4.7 GB | ~30-40 ток/с | ⭐⭐⭐⭐ хорошо |
| `qwen2.5:14b` | 9 GB | ~15-20 ток/с | ⭐⭐⭐⭐⭐ отлично, но медленно |
| `llama3.2:3b` | 2 GB | ~60+ ток/с | ⭐⭐⭐ нормально |
| `llama3.1:8b` | 4.7 GB | ~30 ток/с | ⭐⭐⭐ нормально |
| `gemma2:9b` | 5.4 GB | ~25 ток/с | ⭐⭐⭐⭐ хорошо |
| `nomic-embed-text` | 274 MB | мгновенно | — для embeddings |

**Рекомендация для M3 18GB:** `qwen2.5:7b` (чат) + `nomic-embed-text` (RAG).

Если памяти мало — переключайся на `llama3.2:3b`.

## Шаг 3: Подключить в Open Finance

В `.env.local`:

```bash
AI_DEFAULT_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=qwen2.5:7b
```

После рестарта dev-сервера AI-инструменты будут ходить в Ollama.

## Тест

```bash
# Прямой:
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b",
  "prompt": "Привет! Кто ты?",
  "stream": false
}'

# Через UI: /admin/ai/local-models — увидишь модель в «Установленных»
```

## Ollama в Docker (не рекомендуется на mac)

На macOS контейнер не видит Apple Silicon GPU и крутится на CPU в 5–10 раз медленнее. На Linux-сервере — нормально.

```yaml
# docker-compose.yml фрагмент:
ollama:
  image: ollama/ollama:latest
  container_name: openfinance-ollama
  ports: ['127.0.0.1:11434:11434']
  volumes: [openfinance_ollama:/root/.ollama]
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

## Troubleshooting

### Модель «тормозит»
- `ollama ps` — модель должна быть в памяти
- Большие модели (14B+) выгружаются между запросами на 18GB
- Закрой Chrome и тяжёлые приложения — освободит RAM

### `curl: (7) Failed to connect`
```bash
brew services start ollama
# или вручную:
ollama serve
```

### Порт 11434 занят
```bash
OLLAMA_HOST=127.0.0.1:11500 ollama serve
# и в .env.local:
OLLAMA_BASE_URL=http://localhost:11500
```

### `pnpm ollama:check` показывает ошибку
Ollama не запущена. См. выше — `brew services start ollama`.

## Альтернативы Ollama

| Решение | Когда |
|---------|-------|
| **Ollama** | дефолт, простота, авто-загрузка |
| **LM Studio** | GUI без кода, но только macOS/Win |
| **llama.cpp** | максимум контроля |
| **vLLM** | прод-inference, тонкая настройка |

## Ссылки

- [Ollama library](https://ollama.com/library)
- [Apple Silicon perf benchmarks](https://github.com/ggerganov/llama.cpp/discussions/4167)
- [Qwen 2.5 release notes](https://qwenlm.github.io/blog/qwen2.5/)
