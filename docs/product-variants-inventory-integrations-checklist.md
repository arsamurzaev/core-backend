---
title: 'ТЗ-чеклист: вариации, склад и интеграции'
aliases:
 - Product Variants Inventory Checklist
 - ТЗ вариации склад интеграции
tags:
 - catalog/backend
 - catalog/architecture
 - product-variants
 - inventory
 - integrations
 - tasks
created: 2026-05-10
source: 'docs/product-variants-inventory-integrations-architecture.md'
---

# ТЗ-чеклист: вариации, склад и интеграции

> [!summary]
> Этот файл переводит архитектурный план `product-variants-inventory-integrations-architecture.md` в рабочее ТЗ. Его можно использовать как основу для задач backend, frontend, database migrations и QA.

## 0. Главные правила реализации

- [x] Витрина, корзина и заказы работают от нашей модели `Product` + `ProductVariant`.
- [x] Внешние системы не диктуют UX и не протаскивают свои форматы в core-модель.
- [x] `Product` является карточкой товара, а `ProductVariant` является покупаемой SKU.
- [x] Товар без модификаций всегда имеет один default variant.
- [x] Корзина и заказ всегда используют связку `productId + variantId`.
- [x] `Product.price` используется как витринная/агрегированная цена.
- [x] `ProductVariant.price` используется как цена покупки.
- [x] Собственный склад не создается каждому каталогу.
- [x] Собственный склад доступен только по тарифу и backend entitlement.
- [x] Экспорт заказа в МойСклад выполняется асинхронно после локального создания заказа.
- [x] Ошибка МойСклад не откатывает локальный заказ.

## 1. Database and migrations

### 1.1 Подготовительный аудит

- [x] Посчитать товары без вариантов.
- [x] Посчитать товары с несколькими вариантами.
- [x] Посчитать активные `CartItem` без `variantId`.
- [x] Проверить, есть ли `ProductVariant` с одинаковым `variantKey` внутри товара.
- [x] Проверить, есть ли `ProductVariant` с `stock < 0`.
- [x] Проверить, есть ли `ProductVariant.price`, который не совпадает с ожидаемой ценой покупки.
- [x] Проверить активные `CartItem`, где `variantId` указывает на variant другого `productId`.
- [x] Подготовить dry-run отчет до миграций.

### 1.2 Default variants

- [x] Создать migration/backfill для default variant у товаров без вариантов.
- [x] Default variant должен получать стабильный `variantKey`, например `default`.
- [x] Default variant должен наследовать `Product.sku` или безопасно генерировать variant SKU.
- [x] Default variant должен наследовать `Product.price`.
- [x] Default variant должен наследовать простой остаток, если он уже есть в данных или внешнем sync.
- [x] Миграция должна быть идемпотентной.
- [x] Миграция должна иметь dry-run режим или безопасный отчет.

### 1.3 CartItem.variantId

- [x] Добавить или усилить связь `CartItem.variantId -> ProductVariant.id`.
- [x] Backfill текущих cart items на default variant там, где `variantId = null`.
- [x] Проверить, что `variantId` принадлежит тому же `productId`.
- [x] Добавить индекс для быстрых запросов корзины по `variantId`.
- [x] Сохранить совместимость для legacy snapshot, где `variantId` отсутствует.

### 1.4 IntegrationVariantLink

- [x] Добавить модель `IntegrationVariantLink`.
- [x] Поля: `integrationId`, `variantId`, `externalId`, `externalCode`, `externalUpdatedAt`, `rawMeta`.
- [x] Unique: `[integrationId, externalId]`.
- [x] Unique: `[integrationId, variantId]`.
- [x] Index: `[variantId]`.
- [x] Добавить cascade delete от integration.
- [x] Не ломать существующий `IntegrationProductLink`.

### 1.5 IntegrationOrderExport

- [x] Добавить модель `IntegrationOrderExport`.
- [x] Поля: `integrationId`, `orderId`, `provider`, `idempotencyKey`, `externalId`, `status`, `attempts`, `lastError`, `payload`, `response`.
- [x] Unique: `[integrationId, orderId]`.
- [x] Unique: `idempotencyKey`.
- [x] Index: `[status, requestedAt]`.
- [x] Предусмотреть статусы: `PENDING`, `RUNNING`, `SUCCESS`, `ERROR`, `SKIPPED`.
- [x] Сохранять `exportedAt` при успехе.

### 1.6 Inventory mode and entitlements

- [x] Добавить режим учета каталога: `NONE`, `EXTERNAL`, `INTERNAL`.
- [x] Рекомендуемое место: явное поле в `CatalogSettings`.
- [x] Добавить backend service для проверки возможности `inventory.internal`.
- [x] Добавить модель или механизм `CatalogFeatureEntitlement`.
- [x] Feature key для собственного склада: `inventory.internal`.
- [x] Без entitlement нельзя включить `INTERNAL`.
- [x] При создании каталога не создавать `Warehouse`, `StockBalance`, `Reservation`, `InventoryMovement`.

## 2. Backend domain logic

### 2.1 Product and variant invariants

- [x] Добавить service/helper, который гарантирует наличие default variant.
- [x] При создании товара без variants создавать default variant.
- [x] При обновлении товара не удалять все variants без явного действия.
- [x] Запретить активный товар без активного или default variant.
- [x] При смене `Product.price` определить политику синхронизации с default variant.
- [x] `Product.price` пересчитывать как min/display price по активным вариантам или оставлять как ручное витринное поле с явной политикой.

### 2.2 Variant price in cart

- [x] Обновить cart select, чтобы читать выбранный `ProductVariant`.
- [x] Line total считать от `variant.price`, если `variantId` есть.
- [x] Legacy fallback на `product.price` оставить только для старых данных.
- [x] Проверка остатка должна использовать выбранный variant.
- [x] Разные варианты одного товара должны быть разными строками корзины.
- [x] Поиск существующей строки корзины должен учитывать `productId + variantId`.
- [x] Ошибка: если у товара несколько активных variants и `variantId` не передан, вернуть понятный `BadRequestException`.
- [x] Если у товара один активный/default variant и `variantId` не передан, backend может подставить его автоматически.

### 2.2.1 Sale units / единицы продажи

- [x] `ProductVariantSaleUnit` добавлен как явная, опциональная сущность варианта.
- [x] `CatalogSaleUnit` добавлен как справочник текущего каталога: каждый каталог создает свои форматы продажи.
- [x] `ProductVariantSaleUnit` ссылается на `catalogSaleUnitId`, а цена и `baseQuantity` остаются настройкой конкретного товара/варианта.
- [x] Единицы продажи не создаются всем товарам автоматически: если менеджер их не добавил, покупка идет по `ProductVariant.price`.
- [x] `шт` не является системным дефолтом; это только возможное пользовательское название единицы.
- [x] Backend принимает `saleUnits` без технического `code`; код генерируется из названия только для стабильного storage/API mapping.
- [x] Корзина принимает `saleUnitId`, но оставляет `saleUnitId = null` для обычных товаров без единиц продажи.
- [x] Ключ строки корзины учитывает `productId + variantId + saleUnitId`, чтобы упаковка и палета не склеивались в одну позицию.
- [x] Цена покупки берется из `ProductVariantSaleUnit.price`, если выбрана единица продажи; иначе fallback на `ProductVariant.price`.
- [x] В cart/order snapshot сохраняются `saleUnitId`, `saleUnit`, `unitPriceSnapshot`, `baseQuantity`.
- [x] Для `INTERNAL` inventory резерв и списание используют `baseQuantity`, а не пользовательское количество упаковок/палет.
- [x] UI покупателя показывает выбор единицы только если у выбранного варианта явно есть несколько `saleUnits`.
- [x] UI менеджера позволяет выбрать формат из справочника каталога или создать новый прямо в форме без технических `code`.

### 2.3 Order snapshot

- [x] Расширить snapshot товаров в заказе.
- [x] Сохранять `variantId`.
- [x] Сохранять variant SKU.
- [x] Сохранять выбранные атрибуты варианта.
- [x] Сохранять unit price от variant.
- [x] Сохранять external product/variant ids, если они есть.
- [x] Сохранять line total.
- [x] Не зависеть от будущих изменений товара после создания заказа.

### 2.4 Order completion

- [x] Локальный `Order` создается в транзакции.
- [x] Корзина переводится в `CONVERTED` в той же транзакции.
- [x] После commit создается pending export record, если включен экспорт в МойСклад.
- [x] Ошибка постановки export job логируется и не откатывает заказ.
- [x] Для `INTERNAL` inventory добавить списание/резервирование через отдельную фазу, когда складской модуль будет готов.

## 3. Variation dictionaries

### 3.1 Product type внутри каталога

- [x] Спроектировать product type внутри каталога, например `Мужская обувь`.
- [x] Product type должен быть scoped к каталогу или системному шаблону.
- [x] Product type должен хранить список атрибутов.
- [x] Атрибуты product type должны иметь флаги `isVariant`, `isRequired`, `displayOrder`.
- [x] Системные шаблоны должны помогать стартовать, но не быть жестким глобальным справочником.

### 3.2 Attribute enum values

- [x] Значения вариаций не должны быть свободным текстом в variant.
- [x] Значения должны храниться как управляемые `AttributeEnumValue`.
- [x] Значения должны иметь display order.
- [x] Значения должны поддерживать archive вместо физического удаления.
- [x] Значения должны поддерживать aliases.
- [x] Значения должны поддерживать merge.
- [x] Значения должны поддерживать `businessId` или code для интеграций.

### 3.3 Normalization

- [x] Нормализовать ввод значения: trim, collapse spaces, NFKC.
- [x] Нормализовать поисковый ключ значения.
- [x] Предлагать существующее значение, если новое похоже на него.
- [x] Не создавать дубликаты `Черный`, `черный`, `чёрный`, `black` без review.
- [x] Для импортированных значений ставить origin/source.

### 3.4 Admin workflows

- [x] UI создания product type.
- [x] Быстрое создание product type использует простой конструктор значений: ввод по одному, Enter/плюс, плашки, удаление и стартовые наборы; менеджеру не нужно вводить значения через запятую.
- [x] UI добавления variant attributes.
- [x] UI добавления enum values.
- [x] UI сортировки enum values.
- [x] UI archive value.
- [x] UI merge values.
- [x] UI просмотра imported unknown values.
- [x] UI подтверждения mapping перед применением sync.

### 3.5 ProductType -> Product binding, backend next

Реализовано в текущем дереве по анализу от 2026-05-11:

- [x] `ProductType` и `ProductTypeAttribute` уже добавлены в Prisma schema.
- [x] `ProductTypeModule` подключен в `AppModule`.
- [x] Есть backend API для catalog-scoped product types, system templates и копирования template в каталог.
- [x] `ProductTypeAttribute` хранит `isVariant`, `isRequired`, `displayOrder`.

Текущие ограничения после анализа:

- Product create/update flow уже принимает nullable `productTypeId`; product list/detail возвращает `productType` summary; typed products валидируют product attributes и variant attributes через `ProductTypeAttribute`, а products без `productTypeId` остаются на legacy catalog `typeId` fallback.
- `Product.productTypeId` nullable на первом шаге, чтобы не создавать default product type для всех существующих товаров.
- Matrix schema endpoint уже есть и является контрактной точкой для построения frontend matrix editor.

Новые backend задачи:

- [x] Добавить persisted связь `Product.productTypeId -> ProductType.id`.
- [x] Добавить relation `Product.productType` и reverse relation `ProductType.products`.
- [x] Добавить индекс для фильтрации товаров по `catalogId + productTypeId`.
- [x] Определить migration/backfill policy для существующих товаров: nullable на первом шаге или default catalog product type.
- [x] Добавить `productTypeId` в create/update DTO товара.
- [x] Задокументировать, что create/update DTO принимает `productTypeId: string | null`.
- [x] На create/update валидировать, что product type принадлежит текущему каталогу, active и not archived.
- [x] Переключить `ProductAttributeBuilder` и `ProductVariantBuilder` на атрибуты выбранного product type вместо catalog `typeId`.
- [x] Запретить назначение product attributes, которых нет в выбранном product type.
- [x] Запретить variant attributes, которых нет в выбранном product type или у которых `isVariant=false`.
- [x] При смене product type у товара определить strict policy: запрет при несовместимых атрибутах/вариантах или explicit remap.
- [x] Отдавать product type summary/detail в product list/detail DTO.
- [x] Задокументировать, что product list/detail response возвращает `productType` summary.
- [x] Следующий backend slice: добавить фильтр товаров по `productTypeId` в read API для admin product list.
- [x] Acceptance фильтра: выдавать только товары текущего каталога.
- [x] Acceptance фильтра: при заданном `productTypeId` товары с `productTypeId = null` не попадают в выдачу.
- [x] Acceptance фильтра: legacy products без `productTypeId` продолжают читаться без filter.
- [x] Acceptance фильтра: invalid/cross-catalog `productTypeId` не должен раскрывать товары вне текущего каталога.
- [x] Обновить SEO/cache invalidation: product type changes должны инвалидировать товары, которые зависят от его атрибутной схемы.
- [x] Покрыть edge tests для ProductType validation: archived, unavailable/inactive, incompatible product attributes, incompatible variant attributes/variants.
- [x] Покрыть tests для базового create/update product type binding и чужого catalog product type.
- [x] Покрыть tests для ProductType scope в `ProductAttributeBuilder`, `ProductVariantBuilder`, create variants и strict product type change policy.
- [x] Задокументировать контракт для frontend: сначала выбрать product type, затем строить form/matrix variants из его attributes.
- [x] Задокументировать контракт matrix editor: frontend загружает существующий matrix schema endpoint для выбранного product type.
- [x] Задокументировать frontend-блокировки несовместимых product attrs, variant attrs и variant combinations по matrix schema.
- [x] Задокументировать политику смены product type: strict default, без silent drop/remap; при несовместимых attrs/variants нужен явный user decision.
- [x] Следующий backend slice: matrix apply endpoint для полной замены variant matrix товара.
- [x] Acceptance matrix apply: endpoint заменяет всю variant matrix товара одним запросом, а не патчит отдельные строки.
- [x] Acceptance matrix apply: request принимает массив `items`, где каждый item содержит `attributes[]` в том же формате, что `ProductVariantDtoReq`.
- [x] Acceptance matrix apply: для typed products используется schema выбранного `ProductType`.
- [x] Acceptance matrix apply: комбинации variant attributes проверяются на дубли внутри payload и относительно итоговой matrix.
- [x] Acceptance matrix apply: для товаров без `productTypeId` сохраняется legacy fallback на catalog `typeId`.
- [x] Acceptance matrix apply: validation/db ошибки не должны частично менять варианты товара; вся операция атомарна.
- [x] Acceptance matrix apply: старый `setVariants` остается legacy/simple endpoint для существующего сценария с single `variantAttributeId`.

- [x] Backend endpoint `POST /product/:id/product-type/compatibility-preview` returns no-write compatibility preview for changing `productTypeId`.
- [x] Acceptance preview: reports product attribute conflicts, variant attribute conflicts, strict-policy block, and never updates the product.
- [x] Backend endpoint `POST /product/:id/product-type/apply` applies confirmed product type change with `confirm: true`.
- [x] Acceptance apply: supports stale UI guard through `expectedCurrentProductTypeId`.
- [x] Acceptance apply: product attribute conflicts require explicit `removeAttributeIds`.
- [x] Acceptance apply: variant attribute conflicts require full replacement `items` matrix.
- [x] Acceptance apply: product type, product attributes and variants are changed atomically.
- [x] Matrix schema enum values expose `businessId`, `source`, `mergedIntoId`, `isArchived=false`, and active `aliases` for frontend dictionary UX.
- [x] ProductType `includeArchived` query parsing accepts common boolean strings and rejects invalid values.

Roadmap note: `docs/product-type-product-binding-roadmap.md`.

## 4. Integration adapter layer

### 4.1 Общий контракт адаптера

- [x] Описать provider adapter interface.
- [x] Методы: `testConnection`, `pullProducts`, `pullVariants`, `pullStock`.
- [x] Опциональные методы: `pullPrices`, `pushOrder`, `reserveStock`, `releaseReservation`.
- [x] Все адаптеры должны возвращать нормализованные DTO, а не raw provider responses.
- [x] Raw provider response сохранять только в `rawMeta`/`raw`.

### 4.2 Provider capabilities

- [x] Добавить capability matrix для providers.
- [x] Capability: product import.
- [x] Capability: variant import.
- [x] Capability: stock import.
- [x] Capability: image import.
- [x] Capability: order export.
- [x] Capability: reservation.
- [x] Capability: webhook.
- [x] UI должен показывать только доступные возможности.

### 4.3 Sync runs

- [x] Расширить `IntegrationSyncRun` metadata для variants/stock/errors.
- [x] Сохранять количество обработанных products.
- [x] Сохранять количество обработанных variants.
- [x] Сохранять количество stock rows.
- [x] Сохранять количество skipped rows.
- [x] Сохранять warnings без падения всего sync.
- [x] Сохранять hard errors.

## 5. MoySklad implementation

### 5.1 Client methods

- [x] Добавить тип `MoySkladVariant`.
- [x] Добавить чтение `/entity/variant`.
- [x] Добавить чтение варианта по id.
- [x] Добавить чтение variants по product или через ассортимент.
- [x] Расширить stock report mapping, чтобы он понимал `variant`, а не только `product`.
- [x] Поддержать фильтрацию stock по `assortmentId`.
- [x] Поддержать фильтрацию stock по складу, если включено.

### 5.2 Product sync

- [x] `product` МойСклад мапится в наш `Product`.
- [x] `productFolder` мапится в категории.
- [x] Изображения импортируются через текущий S3 pipeline.
- [x] Archived product не должен удалять товар физически.
- [x] Ручной `DRAFT`/удаленный статус не должен перетираться без политики.

### 5.3 Variant sync

- [x] `variant` МойСклад мапится в наш `ProductVariant`.
- [x] `variant.product` связывается с `IntegrationProductLink`.
- [x] `variant.id` сохраняется в `IntegrationVariantLink.externalId`.
- [x] `variant.externalCode` сохраняется в link/rawMeta.
- [x] `variant.characteristics` мапятся в variant attributes.
- [x] `variant.salePrices` мапится в `ProductVariant.price`.
- [x] `variant.barcodes` сохраняются в rawMeta или будущую barcode model.
- [x] Если у товара нет variants в МойСклад, создать default variant.

### 5.4 Characteristic preview

- [x] Перед применением sync собрать неизвестные характеристики.
- [x] Показать attribute mapping preview.
- [x] Показать enum value mapping preview.
- [x] Предложить merge с похожими значениями.
- [x] Дать режим auto-create для доверенных каталогов.
- [x] Все auto-created значения помечать как imported.

### 5.5 Stock sync

- [x] Stock sync отделить от catalog/product sync.
- [x] В `EXTERNAL` обновлять `ProductVariant.stock`.
- [x] Не перетирать `DISABLED` variant только из-за stock.
- [x] Нулевой остаток переводит variant в `OUT_OF_STOCK`, если он не disabled вручную.
- [x] В `INTERNAL` решить политику: внешний stock как источник или только reconciliation.
- [x] Добавить `lastStockSyncedAt` на уровне metadata или link.

### 5.6 Rate limits and retries

- [x] Сохранить provider-level rate limit.
- [x] Обрабатывать `429`.
- [x] Учитывать `Retry-After`, если provider его вернул.
- [x] Не держать Prisma transaction во время внешних HTTP/S3 операций.
- [x] Ошибка одного изображения не должна валить весь товар.
- [x] Ошибка одного товара не должна валить весь sync без причины.

## 6. Order export to MoySklad

### 6.1 Settings

- [x] Добавить настройку `exportOrders` в MoySklad metadata.
- [x] По умолчанию безопасное значение выбрать явно в migration plan.
- [x] UI должен показывать, включен ли экспорт заказов.
- [x] Без активной интеграции экспорт не создается.

- [x] Service validation blocks `exportOrders=true` before DB write when organization/counterparty/store refs are missing.

### 6.2 Queue and worker

- [x] Создать очередь `order-export`.
- [x] Создать worker для export jobs.
- [x] Создать service `MoySkladOrderExportService`.
- [x] Worker должен читать `IntegrationOrderExport`.
- [x] Worker должен быть идемпотентным.
- [x] Worker должен писать attempts.
- [x] Worker должен писать lastError.
- [x] Worker должен сохранять external id при успехе.

### 6.3 Payload

- [x] Сформировать payload из order snapshot.
- [x] Использовать external variant id, если он есть.
- [x] Если external variant id отсутствует, экспортировать fallback product line или помечать ошибку mapping.
- [x] Сохранять payload в `IntegrationOrderExport.payload`.
- [x] Сохранять provider response в `IntegrationOrderExport.response`.

### 6.4 Retry UI/API

- [x] Endpoint повторной отправки заказа.
- [x] Endpoint просмотра export status.
- [x] UI status: pending.
- [x] UI status: success.
- [x] UI status: error.
- [x] UI action: retry.
- [x] Retry не должен создавать дубль при уже успешном export.

## 7. Internal inventory core

### 7.1 Feature gate

- [x] Все endpoints internal inventory закрыть entitlement guard.
- [x] Все service methods internal inventory проверяют entitlement.
- [x] Cart/order tx inventory операции повторно проверяют entitlement перед созданием нового резерва или sale movement.
- [x] Frontend скрывает раздел склада без entitlement.
- [x] Backend остается главным источником правды по доступу.
- [x] Добавить тесты на bypass.

### 7.2 Warehouses

- [x] Создать модель `InventoryWarehouse`.
- [x] Создать CRUD склада.
- [x] Запретить создание склада без `INTERNAL`.
- [x] Не создавать склад автоматически при создании каталога.
- [x] Поддержать active/disabled warehouse.

### 7.3 Balances

- [x] Создать модель `InventoryStockBalance`.
- [x] Баланс хранится по `warehouseId + variantId`.
- [x] Поля: `onHand`, `reserved`, `available`.
- [x] `available` пересчитывается из `onHand - reserved`.
- [x] Суммарный available обновляет `ProductVariant.stock`.

### 7.4 Movements

- [x] Создать модель `InventoryMovement`.
- [x] Типы: receipt, write-off, adjustment, reserve, release, sale.
- [x] Каждое изменение остатка создает movement.
- [x] Movement нельзя редактировать после создания, только компенсировать новым movement.
- [x] Добавить audit metadata: actor, source, reason.
- [x] Movement history endpoint нормализует string query `limit`, отклоняет невалидные значения и ограничивает максимум `100`.

### 7.5 Reservations

- [x] Создать модель `InventoryReservation`.
- [x] Резерв может быть связан с cart или order.
- [x] Резерв имеет TTL.
- [x] Просроченные резервы освобождаются job-ом.
- [x] Для `INTERNAL` корзин `ACTIVE` резерв синхронизируется при `share`, старте/heartbeat менеджера и изменении публичной корзины.
- [x] При удалении позиции, удалении корзины и истечении `SHARED` корзины активные резервы освобождаются.
- [x] При завершении заказа резерв превращается в sale movement.
- [x] При завершении заказа зарезервированная часть списывается со склада резерва, а direct-часть с текущего sales/default склада.
- [x] Reservation history endpoint нормализует string query `limit`, отклоняет невалидные значения и ограничивает максимум `100`.

## 8. API and DTO

### 8.1 Product list

- [x] В массовой выдаче добавить легкий `variantSummary`.
- [x] `variantSummary.minPrice`.
- [x] `variantSummary.maxPrice`.
- [x] `variantSummary.activeCount`.
- [x] `variantSummary.totalStock`.
- [x] `variantSummary.singleVariantId`, если вариант один.

### 8.2 Product detail

- [x] В detail API отдавать все активные variants.
- [x] Для каждого variant отдавать price.
- [x] Для каждого variant отдавать stock.
- [x] Для каждого variant отдавать status.
- [x] Для каждого variant отдавать attributes.
- [x] Для каждого variant отдавать integration info, если доступно owner/admin режиму.

### 8.3 Cart API

- [x] `variantId` поддерживается явно.
- [x] Если нужен variant, но его нет, вернуть понятную ошибку.
- [x] В cart item response добавить variant label.
- [x] В cart item response добавить variant attributes.
- [x] В cart item response показывать цену выбранного variant.

### 8.4 Integration API

- [x] Runs/order-export history endpoints normalize string query `limit`, reject invalid values, and cap at `100`.
- [x] Cancel MoySklad sync endpoint contract `{ ok: true }` is covered by controller/service tests.
- [x] Admin catalog list exposes `config.inventoryMode` and `config.canUseInternalInventory` for future inventory UI gating.
- [x] Owner-only `GET /catalog/current/features` exposes inventory UI feature flags without leaking entitlements through public catalog cache.
- [x] `CatalogFeatureEntitlementService` exposes typed beta capabilities for product types, variants, sale units, internal inventory and MoySklad.
- [x] Admin-only feature API can read and toggle beta capabilities per catalog.
- [x] MoySklad jobs/services re-check `integration.moysklad` capability outside HTTP request flow.
- [x] MoySklad sync falls back to simple product import when product type/variant capabilities are disabled.

- [x] Status sync показывает products, variants, stock rows.
- [x] Runs history показывает warnings/errors.
- [x] Preview endpoint для MoySklad mapping.
- [x] Apply mapping endpoint.
- [x] Retry order export endpoint.

## 9. Frontend checklist

### 9.1 Product card

- [x] Один variant: кнопка добавляет сразу.
- [x] Несколько variants: кнопка открывает picker.
- [x] Нет доступных variants: кнопка disabled.
- [x] Цена одного variant показывается конкретно.
- [x] Несколько цен показываются как `от N`.
- [x] Остаток учитывает выбранный variant.

### 9.2 Product detail

- [x] Picker группирует values по атрибутам.
- [x] Невозможные комбинации disabled.
- [x] Выбор variant меняет цену.
- [x] Выбор variant меняет остаток.
- [x] Выбор variant меняет CTA.
- [x] Выбранный variant можно восстановить из URL/state.

### 9.3 Cart

- [x] Cart context хранит quantity по `productId + variantId`.
- [x] Разные variants одного product не объединяются.
- [x] Под названием товара показываются характеристики variant.
- [x] Цена строки берется из variant.
- [x] Share/public cart включает variant label.

### 9.4 Product admin

- [x] Создание product type.
- [x] Выбор product type у товара.
- [x] Настройка variant attributes.
- [x] Matrix editor variants.
- [x] Управление enum values.
- [x] Merge/archive values.
- [x] Imported values review.
- [x] Product editor hides product type field when `product.types` capability is disabled.
- [x] Product editor hides variants and skips variant payload when `product.variants` capability is disabled.
- [x] Product editor hides sale units and skips sale-unit payload when `catalog.sale_units` capability is disabled.
- [x] Storefront hides variant/sale-unit pickers when capabilities are disabled and keeps legacy add-to-cart flow.

### 9.4.1 Global admin feature gates

- [x] Global admin drawer exposes per-catalog beta feature switches.
- [x] Feature switches invalidate current catalog and current features cache after update.
- [x] Global admin trigger is visible only for `ADMIN` role.

### 9.5 Integration wizard

- [x] Token.
- [x] Test connection.
- [x] Price type.
- [x] Import images.
- [x] Sync stock.
- [x] Export orders.
- [x] Mapping preview.
- [x] Unknown characteristics review.
- [x] Sync launch.
- [x] Sync report.

### 9.6 Internal inventory UI

- [x] Раздел скрыт без entitlement.
- [x] Warehouses list.
- [x] Stock balances.
- [x] Movement journal.
- [x] Receipt flow.
- [x] Write-off flow.
- [x] Adjustment flow.
- [x] Reservations list.

Frontend audit от 2026-05-11:

- Product editor уже выбирает `productTypeId`, грузит matrix schema выбранного типа и строит variant matrix по enum values.
- MoySklad admin drawer уже показывает unknown attributes/enum values из mapping preview и применяет подтвержденный mapping.
- Internal inventory drawer сейчас только читает warehouses, balances и movements; generated hooks для reservations и manual stock adjustments в UI не используются.
- Generated hooks для create/update/archive product types и enum value create/update/remove/merge есть, но frontend UI flows для них не найдены.

## 10. Observability

- [x] Метрика duration sync по provider.
- [x] Метрика products created/updated/skipped.
- [x] Метрика variants created/updated/skipped.
- [x] Метрика stock rows applied/skipped.
- [x] Метрика order export success/error/retry.
- [x] Метрика inventory movement count.
- [x] Метрика stale stock age.
- [x] Логи order export с `orderId`, `integrationId`, `idempotencyKey`.
- [x] Логи sync item errors с external id.
- [x] Dashboard Integration Health.
- [x] Dashboard Order Export Health.
- [x] Dashboard Inventory Health.

## 11. Security and access control

- [x] Все catalog-level изменения идут через catalog context.
- [x] Integration settings доступны только владельцу каталога/admin.
- [x] Internal inventory endpoints требуют entitlement.
- [x] Retry export требует права владельца каталога/admin.
- [x] Raw provider errors не раскрывают токены.
- [x] MoySklad token остается encrypted.
- [x] Audit log для включения internal inventory.
- [x] Audit log для ручных inventory movements.
- [x] Audit log для retry order export.

## 12. QA scenarios

### 12.1 Product and variants

- [x] Создать товар без вариантов, получить default variant.
- [x] Создать товар с одним вариантом, добавить в корзину без picker.
- [x] Создать товар с несколькими вариантами, добавить разные варианты в корзину.
- [x] Проверить, что разные варианты одного товара не схлопываются.
- [x] Проверить, что disabled variant нельзя купить.
- [x] Проверить, что out-of-stock variant нельзя купить.

### 12.2 Prices

- [x] Product price отличается от variant price, корзина считает variant price.
- [x] Order snapshot сохраняет variant price.
- [x] Старый cart item без variant использует legacy fallback или мигрированный default variant.

### 12.3 MoySklad

- [x] Импорт товара без модификаций создает default variant.
- [x] Импорт товара с модификациями создает несколько variants.
- [x] Characteristics превращаются в variant attributes.
- [x] Unknown characteristic попадает в preview.
- [x] Stock report обновляет variant stock.
- [x] Ошибка одного товара не валит весь sync.

### 12.4 Order export

- [x] Завершение заказа создает локальный `Order`.
- [x] После завершения появляется pending export.
- [x] Успешный export сохраняет external id.
- [x] Ошибка МойСклад не откатывает локальный order.
- [x] Retry после ошибки не создает дубль.
- [x] Retry после success ничего не отправляет повторно.

### 12.5 Internal inventory

- [x] Каталог без entitlement не видит складской UI.
- [x] Каталог без entitlement получает forbidden от API.
- [x] Каталог с entitlement может создать warehouse.
- [x] Приход увеличивает stock balance.
- [x] Списание уменьшает stock balance.
- [x] Movement journal сохраняет историю.
- [x] Обычному каталогу не создаются warehouse records автоматически.

## 13. Definition of Done

- [x] Все новые миграции имеют rollback/restore strategy или documented recovery (`docs/product-variants-migration-recovery.md`).
- [x] Все backfill scripts идемпотентны.
- [x] Default variant audit script доступен через `bun run db:audit-default-variants`.
- [x] Default variant audit script блокирует apply при дубликатах `variantKey`, mismatched cart variants, отрицательном stock или невалидной цене.
- [x] Все новые endpoints покрыты unit/integration tests.
- [x] Все изменения cart/order покрыты regressions.
- [x] Все provider errors логируются без секретов.
- [x] Все тарифные ограничения проверяются на backend.
- [x] API документация Swagger обновлена.
- [x] Backend умеет экспортировать OpenAPI без поднятого HTTP-сервера через `npm run openapi:export -- --output=runtime/openapi.json`.
- [x] Frontend regenerated API types обновлены.
- [ ] QA matrix пройдена.
- [x] Observability добавлена для sync/export/inventory.
- [x] Документация обновлена после реализации.

## 14. Не входит в первую реализацию

- [ ] Полная двусторонняя синхронизация остатков с несколькими источниками одновременно.
- [ ] Автоматический push товаров из нашего каталога в МойСклад.
- [ ] Онлайн-резервирование в МойСклад до оформления заказа.
- [ ] Полная бухгалтерская модель себестоимости.
- [ ] Серийные номера и партии.
- [ ] Несколько валют в одном заказе.
- [ ] Автоматическое разрешение всех конфликтов mapping без участия владельца.
