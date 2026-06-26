# Prisma Migrations

Дата: 2026-06-25

Backend больше не должен развивать production-схему через `prisma db push`. История схемы хранится в `prisma/migrations`, а production применяет только проверенные миграции.

## Команды

Проверить структуру миграций:

```bash
npm run prisma:migrate:check
```

Создать миграцию после изменения Prisma schema:

```bash
npm run prisma:migrate:dev -- --name short_change_name
```

Проверить статус миграций относительно подключенной БД:

```bash
npm run prisma:migrate:status
```

Применить миграции на production/stage:

```bash
npm run prisma:migrate:deploy
```

`npm run prisma:push` намеренно отключен. Для одноразовой локальной песочницы можно использовать:

```bash
npm run prisma:push:unsafe
```

## Shadow Database

Для полного drift-check в CI/stage добавь отдельную пустую PostgreSQL-базу и переменную:

```bash
SHADOW_DATABASE_URI=postgresql://...
```

После этого `npm run prisma:migrate:check` дополнительно сравнит `prisma/migrations` с текущей schema через `prisma migrate diff`.

Чтобы сделать shadow database обязательной в gate:

```bash
npm run prod:check -- --require-shadow
```

## Baseline

Первая миграция `20260625000000_baseline` является снимком текущей схемы.

Для новой пустой БД она применяется обычным способом:

```bash
npm run prisma:migrate:deploy
```

Для уже существующей БД, которая была создана через `prisma db push` и уже соответствует текущей schema, baseline нельзя накатывать как SQL поверх живых таблиц. Ее нужно пометить как уже примененную:

```bash
npx prisma migrate resolve --applied 20260625000000_baseline
npm run prisma:migrate:status
```

Перед этим обязательно:

- сделать backup;
- проверить, что schema в БД действительно соответствует текущей Prisma schema;
- прогнать `npm run prod:check -- --skip-db` или полный gate на stage.

## Production Rule

Порядок выкладки schema changes:

1. Изменить `prisma/schema`.
2. Создать миграцию через `npm run prisma:migrate:dev -- --name ...`.
3. Просмотреть SQL в новой папке `prisma/migrations`.
4. Запустить `npm run prisma:migrate:check`.
5. Запустить `npm run prod:check`.
6. На production после backup выполнить `npm run prisma:migrate:deploy`.

Rollback для destructive changes делается через backup/restore или отдельную forward-migration. Prisma не хранит down-миграции.
