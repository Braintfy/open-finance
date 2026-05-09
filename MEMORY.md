# MEMORY — Open Finance SaaS

## Проект
- **Open Finance SaaS** — облачная платформа финансовой аналитики
- Целевая аудитория: селлеры МП, малый бизнес, ИП
- Модель монетизации: подписка по обороту (как yoolip.ai)
- Референс: yoolip.ai (Ozon analytics), но шире

## Архитектура
- **Multi-tenant** — каждая организация изолирована (tenant_id в каждой таблице)
- **Next.js 15** — SSR + API Routes + Server Actions
- **PostgreSQL 16** в Docker — primary + replica, WAL archiving, pg_basebackup
- **Redis** — кэш + очереди (BullMQ)
- **S3/MinIO** — хранение загруженных файлов
- **Docker Compose** — dev среда, Kubernetes — prod

## Надёжность (production-grade)
1. PostgreSQL replication (streaming + WAL archive)
2. Automated backups (pg_dump + WAL → S3, retention 30 дней)
3. Health checks + auto-restart (Docker)
4. Rate limiting + DDOS protection
5. Row-Level Security (RLS) для tenant isolation
6. Encrypted at rest + TLS in transit
7. Sentry error tracking + Prometheus metrics

## Связь с другими проектами
- `/Users/firay/open-finance/` — локальная версия (personal use)
- `/Users/firay/NALOG/` — алгоритмы налогов для миграции

## Текущий статус
- Фаза: **Планирование** (PLAN.md)
- Следующий шаг: утверждение плана → Этап 1
