# Backend Prod Quality Gate

Дата: 2026-05-17

Перед выкладкой backend запускаем один gate:

```bash
npm run prod:check
```

Он выполняет:

- `npm run prisma:migrate:check`
- `npm run prisma:generate`
- `npm run build`
- `npm run openapi:export -- --output=runtime/openapi.json`
- `npm test -- --runInBand`
- `npm run db:audit-default-variants`

Быстрый локальный вариант:

```bash
npm run prod:check -- --fast
```

Если нужно проверить код без доступа к базе:

```bash
npm run prod:check -- --skip-db
```

Если OpenAPI не нужен в конкретном прогоне:

```bash
npm run prod:check -- --skip-openapi
```

Если в CI/stage настроена shadow-БД и нужно сделать ее обязательной:

```bash
npm run prod:check -- --require-shadow
```

Production apply-скрипты запускаются только после dry-run, backup и зеленого gate.

Для изменений Prisma schema используй flow из [prisma-migrations.md](./prisma-migrations.md).
