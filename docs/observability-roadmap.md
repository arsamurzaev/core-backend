# Observability Roadmap

## Цель

Собрать для backend-а единый слой наблюдаемости на базе `Grafana + Loki + Tempo + Mimir + Alloy`, чтобы:

- видеть поведение API, Prisma, Redis, BullMQ и cron в одном контуре;
- связывать `traceId`, `requestId`, application logs и метрики;
- перейти от точечных логов к repeatable debugging flow;
- получить file-based provisioning для локального запуска и дальнейшего прод-выноса.

## Что уже реализовано

- overlay compose: `docker-compose.observability.yml`
- конфиги `Alloy`, `Loki`, `Tempo`, `Mimir`
- provisioning datasource и стартового dashboard для Grafana
- structured JSON logger в backend
- OTLP traces bootstrap для Node/Nest
- `/metrics` и `/observability/health`
- HTTP request metrics и access logs
- cron metrics и trace span для nightly discount cleanup

## Фаза 1. Foundation

### Infra

- поднять `Grafana`, `Loki`, `Tempo`, `Mimir`, `Alloy`
- включить volumes и provisioning из репозитория
- писать backend logs в `runtime/logs/backend.jsonl`
- скрейпить backend metrics через Alloy
- принимать traces по `OTLP HTTP` и `OTLP gRPC`

### App

- перевести системный logger на JSON
- добавить единый `requestId`
- подключить OpenTelemetry SDK до импорта `AppModule`
- завести `/metrics`
- собирать базовые HTTP и cron метрики

## Фаза 2. Service Coverage

- добавить manual spans и metrics для BullMQ jobs
- добавить integration metrics для MoySklad sync
- вынести Prisma slow queries в отдельную counter/histogram метрику
- добавить Redis cache hit/miss counters
- добавить alert rules на:
  - `5xx rate`
  - `p95 latency`
  - `cron failures`
  - `queue failures`
  - `integration sync stalled`

## Фаза 3. Production Hardening

- заменить local filesystem storage на `S3/MinIO`
- вынести retention и compaction policy в env/config
- зафиксировать image versions вместо `latest`
- добавить auth и сеть для Grafana/internal services
- добавить backup strategy и runbooks

## Definition of Done

- observability stack поднимается через compose без ручной настройки UI
- в Grafana доступны datasource `Mimir`, `Loki`, `Tempo`
- backend отдаёт `/metrics`
- traces уходят в Alloy и видны в Tempo
- JSON logs пишутся в файл и доступны в Loki
- dashboard `Backend Overview` отображает request rate, p95, 5xx и in-flight
- nightly cron виден в метриках и трассах
