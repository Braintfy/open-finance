# CLAUDE.md — Open Finance SaaS

## Проект
**Open Finance SaaS** — облачная платформа финансовой аналитики для селлеров и бизнеса. Multi-tenant, подписочная модель, продакшн-grade надёжность.

**Референс:** yoolip.ai (аналитика OZON), но шире — все МП + финансы + налоги + AI.

**Начинать любую задачу** с чтения `MEMORY.md` и `PLAN.md`.

---

## Стек
| Слой | Технология |
|------|-----------|
| Frontend + API | Next.js 15 App Router, TypeScript |
| UI | Tailwind CSS, shadcn/ui, Lucide Icons |
| State | Zustand + TanStack Query |
| Auth | NextAuth.js (credentials + OAuth) |
| ORM | Prisma |
| DB | PostgreSQL 16 (Docker, replication-ready) |
| Cache | Redis (Docker) |
| Queue | BullMQ (Redis-backed) |
| Storage | S3-compatible (MinIO local / AWS S3 prod) |
| AI | Claude API / OpenAI / Ollama |
| Notifications | Telegram Bot + Email (Resend) |
| Charts | Recharts / Tremor |
| Mindmap | ReactFlow |
| Monitoring | Sentry + Prometheus + Grafana |
| Deploy | Docker Compose (dev) → Kubernetes (prod) |

## Ключевые отличия от локальной версии
1. **PostgreSQL в Docker** — надёжность, репликация, бэкапы
2. **Multi-tenant** — изоляция данных по организациям
3. **Auth + Roles** — владелец, менеджер, бухгалтер (read-only)
4. **Подписки** — тарифы по обороту (как yoolip.ai)
5. **API-интеграции** — прямое подключение к OZON/WB/Яндекс API
6. **Background jobs** — BullMQ для синхронизации данных
7. **Горизонтальное масштабирование** — stateless app, DB отдельно

---

## Коммуникация
- Лаконично, без воды
- При неясности — уточнить ПЕРЕД выполнением

## Жёсткие ограничения
- **Git**: НИКОГДА не делать git add/commit/push — только команды
- **БД**: НИКОГДА не запускать миграции — только команды
- **Интерактив**: `-y`, `--yes`, `--force`

## Процесс работы
1. Читать `MEMORY.md` → `CHANGELOG.md` → `PLAN.md`
2. Читать файлы ПЕРЕД изменением
3. После изменений — `npm run build`
4. Обновить CHANGELOG, MEMORY, PLAN
5. Дать git-команды

## CHANGELOG формат
```markdown
## [X.Y.Z] - YYYY-MM-DD
### Added / Changed / Fixed / Removed
- **Компонент** — описание
```
