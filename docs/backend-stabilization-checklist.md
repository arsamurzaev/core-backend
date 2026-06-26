# Чеклист backend-стабилизации

Дата: 2026-05-17

## 1. Safety Layer

- [x] Создать `docs/domain-invariants.md`.
- [x] Зафиксировать product/variant/price/stock/cart/capability/integration инварианты.
- [x] Добавить backend architecture boundary test в report-only режиме.
- [x] Сканировать `src/modules/**/*.ts`, исключая spec-файлы.
- [x] Разрешить cross-module imports через `contracts.ts`, `public.ts`, shared/core infra и auth whitelist.
- [x] Получить baseline report: 96 текущих cross-module violations.
- [x] Снизить boundary baseline до 88 violations после перевода cron на ports.
- [x] Снизить boundary baseline до 82 violations после закрытия cart module/helper imports.
- [x] Снизить boundary baseline до 80 violations после закрытия category -> product DTO/module.
- [x] Снизить boundary baseline до 78 violations после переноса catalog visibility helper в shared.
- [x] Снизить boundary baseline до 55 violations после перевода capability module/constants/decorators на public API и часть сервисов на ports.
- [x] Снизить boundary baseline до 50 violations после перевода integration на capability ports.
- [x] Снизить boundary baseline до 41 violations после перевода observability на recorder port.
- [x] Снизить boundary baseline до 33 violations после закрытия S3 imports через public API.
- [x] Снизить boundary baseline до 21 violations после закрытия SEO/attribute/product-type public imports и capability ports в admin/catalog.
- [x] Снизить boundary baseline до 17 violations после перевода audit на recorder port.
- [x] Снизить boundary baseline до 13 violations после выделения auth session issuer port.
- [x] Снизить boundary baseline до 0 violations после оформления catalog advanced settings/auth/integration/capability public API.
- [x] Включить boundary test как обязательный после закрытия critical violations.

## 2. Public Contracts

- [x] Добавить `PRODUCT_EXTERNAL_SYNC_PORT`.
- [x] Добавить `ProductExternalSyncPort`.
- [x] Добавить `INVENTORY_EXTERNAL_STOCK_PORT`.
- [x] Добавить `InventoryExternalStockPort`.
- [x] Перевести integration product writes на `ProductExternalSyncPort`.
- [x] Экспортировать новые contracts через `public.ts`.
- [x] Зарегистрировать безопасные provider bindings для новых port tokens.
- [x] Добавить `PRODUCT_MAINTENANCE_PORT` для cron-задач.
- [x] Добавить `CATALOG_DOMAIN_MAINTENANCE_PORT` для cron-задач.
- [x] Добавить `OBSERVABILITY_RECORDER_PORT` для cron/queue/auth/integration/inventory metrics.
- [x] Добавить `AUDIT_RECORDER_PORT`.
- [x] Добавить `AUTH_SESSION_ISSUER_PORT`.

## 3. Cart/Sellable

- [x] Cart add/update использует `ProductSellableReader`.
- [x] Simple product без `variantId` выбирает hidden default variant.
- [x] Matrix product без `variantId` возвращает ошибку выбора вариации.
- [x] Cart pricing не читает `Product.price` напрямую как источник истины.
- [x] Checkout snapshot использует sellable projection и external links.
- [x] Добить regression tests после boundary cleanup.

## 4. Inventory

- [x] Reserve/release/consume идут через `variantId`.
- [x] External stock apply представлен портовым контрактом.
- [x] `InventoryMode.INTERNAL` не перезаписывается external stock sync.
- [x] `stock=null` считается неотслеживаемым остатком.
- [x] Добавить отдельный integration-level тест на `InventoryExternalStockPort`.

## 5. Integration

- [x] Full stock sync и webhook stock delta используют общий `applyExternalStockMap`.
- [x] Product writes перевести на `ProductExternalSyncPort`.
- [x] Stock writes экспонированы через `InventoryExternalStockPort`.
- [x] Нормализовать skipped reasons под единый список.
- [x] Partial snapshot не должен агрессивно скрывать товары без подтверждений.
- [x] Добавить regression tests для partial snapshot policy.

## 6. Domain Events

- [x] Stock/price/product/integration/capability events описаны в contracts.
- [x] Stock changes из inventory/integration публикуют events.
- [x] SEO sync частично вынесен в product domain event handler.
- [x] Cache invalidation полностью перевести на handlers.
- [x] Integration diagnostics обновлять через `integration.sync_completed`.
- [x] Добавить явную idempotency policy для handlers.

## 7. Boundary Cleanup

- [x] Закрыть `cart -> product concrete service`.
- [x] Закрыть `cart -> inventory concrete service`.
- [x] Закрыть `cart -> integration concrete service`.
- [x] Закрыть `integration -> product internals`.
- [x] Закрыть `category -> product DTO/module`.
- [x] Закрыть `cron -> concrete modules`.
- [x] Закрыть все cross-module internal imports, boundary report = 0.

## 8. Следующий backend-шаг: integration -> product ports cleanup

Дата фиксации: 2026-06-26

Цель: пройти `integration` и убрать прямую зависимость integration sync от широкого `product/public.ts` там, где ее можно заменить на узкие product ports/contracts.

- [ ] Просканировать `src/modules/integration/**` на импорты из `@/modules/product/public`.
- [ ] Разделить реальные потребности integration sync: write/sync, read/projection, maintenance, DTO/types.
- [ ] Оставить прямой импорт из `product/public.ts` только там, где он действительно является публичным контрактом модуля.
- [ ] Для sync-flow заменить широкие зависимости на узкие product ports/contracts, например `ProductExternalSyncPort`, отдельные reader/projection ports или новые минимальные contracts.
- [ ] Не протаскивать `ProductService`, repository и внутренние DTO через integration.
- [ ] Обновить provider bindings в `ProductModule`/`IntegrationModule`, если понадобится новый port.
- [ ] Прогнать architecture boundary test и integration/moysklad regression tests после cleanup.

## Verification

- [x] `npm run prisma:generate`
- [x] `npm run build`
- [x] `npm run prod:check -- --fast --skip-db`
- [x] `npm test -- cron --runInBand`
- [x] `npm test -- product --runInBand`
- [x] `npm test -- product-external-sync --runInBand`
- [x] `npm test -- cart --runInBand`
- [x] `npm test -- inventory --runInBand`
- [x] `npm test -- integration --runInBand`
- [x] `npm test -- moysklad.stock-sync --runInBand`
- [x] `npm test -- moysklad.sync-run-recorder --runInBand`
- [x] `npm test -- moysklad.sync-completed-diagnostics --runInBand`
- [x] `npm test -- moysklad.queue --runInBand`
- [x] `npm test -- category --runInBand`
- [x] `npm test -- auth inventory integration s3 --runInBand`
- [x] `npm test -- catalog admin product architecture --runInBand`
- [x] `npm test -- catalog integration inventory audit architecture --runInBand`
- [x] `npm test -- user auth architecture --runInBand`
- [x] `npm test -- --runInBand`
- [x] `npm test -- architecture --runInBand`
- [x] `npm test -- domain-events --runInBand`
- [x] `npm test -- product-seo-domain-event --runInBand`
- [x] `npm test -- admin --runInBand`
- [x] `npm test -- catalog --runInBand`
- [x] `npm test -- seo --runInBand`
- [x] `npm test -- attribute --runInBand`
- [x] `npm test -- product-type --runInBand`
- [x] `npm test -- product-write-finalizer --runInBand`
- [x] `bun db:audit-default-variants`
