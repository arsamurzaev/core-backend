# Полный анализ модулей backend и frontend

Дата: 2026-05-17  
Контекст: backend `./backend`, storefront frontend `../frontend`, dashboard `../dashboard` как отдельный админский клиент.

Статус реализации backend-стабилизации вынесен в [backend-stabilization-checklist.md](./backend-stabilization-checklist.md). Доменные правила закреплены в [domain-invariants.md](./domain-invariants.md).

## 1. Executive summary

Проект уже развивается в правильную сторону: это модульный монолит, а не набор преждевременных микросервисов. В backend появились публичные контракты у ключевых модулей (`product`, `cart`, `inventory`, `integration`, `capability`, `product-type`), есть domain events, outbox, generated OpenAPI и заметное движение к единому sellable-core. Во frontend есть сильная идея `catalog-runtime` и расширений под разные типы каталога.

Главная проблема сейчас не в отсутствии модулей, а в том, что границы модулей пока не везде защищены технически. Часть кода уже общается через порты, но рядом остаются прямые импорты соседних сервисов, DTO и repositories. Это нормально для быстро растущего продукта, но перед большим продом такие связи нужно зафиксировать и постепенно сжать до публичных контрактов.

Самая важная архитектурная линия:

- `Product` остается карточкой и витриной.
- `ProductVariant` становится продаваемой единицей.
- `Inventory` становится складской правдой.
- `Cart/Order` работают только со snapshot и sellable-проекцией.
- `Integration` пишет внешние изменения через порты, а не через внутренности product/inventory.
- `Capability` управляет доступностью функций и видимостью, но не уничтожает данные.

Если это выдержать, система сможет спокойно расти: простой каталог без склада, каталог с вариациями, каталог с МойСклад, внутренний склад, заказы, аналитика, repair, импорт/экспорт, будущие маркетплейсы.

## 2. Что уже хорошо

- Backend не размазан по одному сервису: есть отдельные модули для catalog, product, cart, inventory, integration, auth, admin, observability.
- У core-модулей появились `contracts.ts` и `public.ts`.
- Root `AppModule` подключает доменные модули через `public.ts`, а architecture boundary test защищает `src/core` от глубоких импортов в `src/modules`.
- Architecture boundary test также защищает выбранные `public.ts` и Nest `module.exports` от повторного экспорта implementation services.
- Architecture boundary test защищает выбранные `public.ts` от повторного экспорта внутренних helper-файлов, например product read mapper/utils и `product-variant-card-projection`.
- Architecture boundary test запрещает repository imports во всех `contracts.ts`; для `auth`, `inventory`, `product` и `product-type` также закреплен DTO-free contract rule.
- `ProductSellableReader` уже оформлен как правильная точка для цены, доступности и выбора варианта.
- `InventoryReservationPort` уже выделен.
- МойСклад разделен на client, sync, stock sync, product sync, variant sync, queue, order export.
- Есть `DomainEventBus` / dispatcher / outbox и события для product, variant, integration, capability.
- Frontend использует generated API, то есть контракт backend -> frontend формализован.
- Во frontend уже есть boundary test, который запрещает базовые нарушения: `shared` не импортирует `core`, modules не импортируют widgets/views, production не импортирует sandbox.
- `catalog-runtime` дает хороший фундамент для разных типов каталогов без разветвления всего приложения.

## 3. Главные риски

1. **Скрытая связность между backend-модулями.**  
   Например, cart импортирует product/inventory/integration modules, catalog тянет auth/integration/capability/seo, product знает про seo/s3/capability. Это не катастрофа, но без правил один модуль сможет случайно сломать другой.

2. **DTO и repositories местами становятся общими внутренностями.**  
   Если соседний модуль импортирует чужой DTO или repository, этот DTO/repository перестает быть внутренней деталью и превращается в неявный API.

3. **Capabilities могут смешиваться с data model.**  
   Флаг должен скрывать UI/поведение, но не должен удалять и ломать данные. Особенно критично для вариаций, склада, МойСклад и sale units.

4. **Product price vs variant price.**  
   `Product.price` должен оставаться legacy/display mirror. Источник коммерческой правды должен быть variant/sellable projection. Иначе товары с вариациями, корзина, фильтры и интеграции будут расходиться.

5. **Stock semantics должны быть железными.**  
   Сейчас правильная модель: `stock = null` значит остаток не отслеживается, `stock = 0` значит нет в наличии, `stock > 0` значит конечный остаток. Это нужно закрепить в тестах и документации.

6. **Integration sync опасен при неполном snapshot.**  
   Внешняя система может прислать только часть данных. Нельзя агрессивно удалять/скрывать товары без надежного полного snapshot и понятной политики ownership.

7. **Cart/Order должны жить на snapshot.**  
   Заказ нельзя пересчитывать по текущему товару после оформления. Цена, variantId, sale unit, external links и название должны сохраняться в snapshot.

8. **Frontend product editor слишком большой.**  
   Сейчас create/edit/product editor имеют много похожей логики. Это увеличивает риск расхождения при изменениях в price/stock/variants/capabilities.

9. **Есть риск битой кириллицы.**  
   Уже встречалась проблема mojibake. Для продового продукта с русским UI нужен отдельный text-encoding gate.

10. **Dashboard пока тонкий, но быстро станет критичным.**  
    Он использует admin/auth generated API. Если dashboard начнет дублировать бизнес-логику storefront, появится второй источник UI-правил.

## 4. Backend: карта модулей

В `src/modules` сейчас 25 модулей, около 370 файлов и 78 backend spec-файлов.

| Модуль               | Роль                                                                      | Текущее состояние                                              | Главный риск                                                | Что сделать                                                                   |
| -------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `activity`           | Активности и события использования                                        | Небольшой модуль                                               | Может пересечься с audit/analytics                          | Оставить read/write API простым, события писать через общий audit/event слой  |
| `admin`              | Админские операции, каталоги, платежи, feature entitlements, outbox       | Сильный сервисный вход                                         | Слишком широкие права и знание внутренних моделей           | Разделить admin commands и read-only diagnostics                              |
| `attribute`          | Пользовательские атрибуты                                                 | Service/repository внутренние, наружу DTO + module             | Связь с product/product-type может разрастись               | Выделять schema/value contracts только при реальном внешнем потребителе       |
| `audit`              | Аудит изменений                                                           | Global audit sink через `AUDIT_RECORDER_PORT`                  | Может стать случайной свалкой логов                         | Держать запись аудита через порт, service не экспортировать                   |
| `auth`               | Сессии, guards, login, handoff                                            | Центральный infrastructure module с DI-портами                 | Guards/decorators остаются sanctioned infra boundary        | Не возвращать concrete services в `auth/public.ts`                            |
| `brand`              | Бренды каталога                                                           | Простой CRUD                                                   | Связь с product через DTO/filters                           | Держать как справочник, наружу только brand summary                           |
| `capability`         | Возможности каталога                                                      | Ports/contracts закреплены, concrete service не экспортируется | Правила могут дублироваться на frontend/backend             | Держать единый effective capability contract и тесты                          |
| `cart`               | Корзина, линии, pricing, reservations, checkout, SSE, share, manager flow | Один из главных core-модулей                                   | Много зависимостей на product/inventory/integration         | Оставить зависимости только на product/inventory/integration ports            |
| `catalog`            | Каталог, настройки, домены, SEO, feature entitlements                     | Очень широкий модуль                                           | Станет god-module                                           | Разделить settings/domain/feature/checkout policies внутри модуля             |
| `catalog-modifier`   | Группы/опции модификаторов и привязка модификаторов к товарам             | Management port, service/repository закрыты внутри модуля      | Может смешать catalog templates, product bindings и cart UX | Держать наружу `CatalogModifierManagementPort`, чтение корзины вести snapshot |
| `catalog-price-list` | Прайс-листы каталога и активный price-list context                        | Management/resolver ports                                      | Resolver может стать скрытым pricing API                    | Держать управление через port, pricing-read отдельно                          |
| `catalog-sale-unit`  | Единицы продаж                                                            | Отдельный справочник с management port                         | Может быть смешан с price variants                          | Держать наружу `CatalogSaleUnitManagementPort`, не service/repository         |
| `category`           | Категории, позиции, category-products                                     | Есть прямые связи с product DTO/module                         | Смена product DTO ломает category                           | Вынести category product summary в product public contract                    |
| `cron`               | Планировщики                                                              | Оркестратор на DI-портах                                       | Новые scheduled jobs могут начать дергать concrete services | Держать scheduled jobs на ports/domain commands                               |
| `integration`        | Интеграции, МойСклад, sync, webhook, order export                         | Большой и важный модуль                                        | Может знать слишком много о product/inventory               | Писать во внутренние данные только через external sync ports                  |
| `inventory`          | Склады, остатки, резервы, движения                                        | Reservation/stock ports, concrete service не экспортируется    | Нужно строго держать variantId как ключ                     | Все операции только через variantId и inventory policy                        |
| `metric`             | Метрики                                                                   | Небольшой модуль                                               | Дублирование observability                                  | Четко отделить business metrics от technical observability                    |
| `observability`      | HTTP observability, metrics/tracing                                       | Recorder port, concrete service не экспортируется              | Может стать зависимостью domain-кода                        | Давать только logger/metrics interfaces                                       |
| `order`              | Заказы                                                                    | Сейчас тонкий                                                  | Логика заказа пока может жить в cart                        | Постепенно выделить order lifecycle и snapshots                               |
| `payment`            | Платежи                                                                   | Тонкий                                                         | Будущая сложность подписок/оплат заказов                    | Сразу строить через provider ports                                            |
| `product`            | Товары, варианты, pricing, read, sellable, maintenance, SEO sync          | Core-модуль, активно укрепляется                               | Repository/service могут стать слишком большими             | Зафиксировать Product как владелец карточки и variant commercial state        |
| `product-type`       | Типы товаров, schema, variant attributes, combinations                    | Хорошая отдельная зона                                         | Может напрямую управлять product data                       | Наружу только schema/compatibility ports                                      |
| `regionality`        | Региональность                                                            | Небольшой модуль                                               | Будущая связь с price/delivery                              | Описать как catalog policy                                                    |
| `s3`                 | Storage/media upload                                                      | Infrastructure module с `MediaStoragePort`                     | Может разрастись в общий media-domain                       | Держать наружу storage contract, domain-логику оставлять в media helpers      |
| `seo`                | SEO сущности и sync                                                       | Отдельный модуль с `SeoSettingsPort`                           | Может смешать SEO storage и генерацию SEO                   | Держать repository внутренним, генерацию вызывать через port/event handlers   |
| `type`               | Типы каталогов                                                            | Справочник                                                     | Может пересечься с catalog-runtime/frontend types           | Держать как справочник с публичным DTO                                        |
| `user`               | Пользователи                                                              | Тонкий                                                         | Рост auth/account логики                                    | Не смешивать с auth sessions                                                  |

## 5. Backend: текущие публичные контракты

Уже есть хорошая база:

- `capability/contracts.ts`: `CAPABILITY_READER_PORT`, `CAPABILITY_ASSERT_PORT`.
- `auth/contracts.ts`: `AUTH_SESSION_ISSUER_PORT`, `AUTH_PASSWORD_COMMAND_PORT`, `AUTH_SESSION_MANAGEMENT_PORT`, `AUTH_HANDOFF_ISSUER_PORT`.
- `audit/contracts.ts`: `AUDIT_RECORDER_PORT`.
- `catalog-modifier/contracts.ts`: `CATALOG_MODIFIER_MANAGEMENT_PORT`.
- `catalog-price-list/contracts.ts`: `CATALOG_PRICE_LIST_MANAGEMENT_PORT`, `CATALOG_PRICE_LIST_RESOLVER_PORT`.
- `catalog-sale-unit/contracts.ts`: `CATALOG_SALE_UNIT_MANAGEMENT_PORT`.
- `cart/contracts.ts`: `CART_COMMAND_PORT`, `ORDER_READER_PORT`.
- `category/contracts.ts`: `CATEGORY_READER_PORT`, `CATEGORY_COMMAND_PORT`.
- `email/contracts.ts`: `EMAIL_SENDER_PORT`.
- `integration/contracts.ts`: `ORDER_EXPORT_PORT`, `INTEGRATION_ADVANCED_SETTINGS_PORT` и provider adapter type exports.
- `inventory/contracts.ts`: `INVENTORY_RESERVATION_PORT`, `INVENTORY_EXTERNAL_STOCK_PORT`.
- `observability/contracts.ts`: `OBSERVABILITY_RECORDER_PORT`.
- `product/contracts.ts`: `PRODUCT_COMMAND_PORT`, `PRODUCT_READER_PORT`, `PRODUCT_PRICING_PORT`, `PRODUCT_SELLABLE_READER_PORT`, `PRODUCT_EXTERNAL_SYNC_PORT`, `PRODUCT_MAINTENANCE_PORT`, `PRODUCT_VARIANT_PROJECTION_PORT`.
- `product-type/contracts.ts`: `PRODUCT_TYPE_COMMAND_PORT`, `PRODUCT_TYPE_SCHEMA_PORT`, `PRODUCT_TYPE_VARIANT_ATTRIBUTES_PORT`.
- `s3/contracts.ts`: `MEDIA_STORAGE_PORT`, `MediaStoragePort`.
- `seo/contracts.ts`: `SEO_SETTINGS_PORT`, `SeoSettingsPort`.
- `shared/domain-events/domain-events.contract.ts`: event bus, dispatcher, outbox, product/order/integration/capability events.

Недостающий кусок: эти контракты должны стать не просто удобным API, а единственным разрешенным способом общения между core-модулями.

## 6. Backend: импортные связи

Самые заметные cross-module связи по скану:

- `catalog -> auth`: много контроллеров/advanced settings завязаны на auth/session.
- `integration -> capability`: интеграция активно проверяет фичи.
- `inventory -> capability`: склад зависит от режима и возможностей.
- `product -> capability`: product скрывает/показывает варианты и sale units.
- `cart -> auth`: cart endpoints и manager flow завязаны на сессию.
- `catalog -> integration`: настройки каталога управляют интеграциями.
- `cart -> product`: корзина читает product/sellable.
- `product -> seo`: синхронизация SEO.
- `category -> product`: category-products завязаны на product DTO/module.
- `cron -> inventory/product/catalog`: планировщик переведен на public module imports и DI-порты.

Правило, которое нужно ввести:

```text
Модуль может импортировать соседний модуль только через:
- contracts.ts
- public.ts
- явно разрешенный infrastructure слой, например auth decorators/guards
- generated API во frontend
```

Запрещаем:

- импорт чужого repository;
- импорт чужого внутреннего service;
- импорт чужих внутренних DTO, если DTO не объявлен публичным контрактом;
- импорт Prisma-типов как внешний контракт модуля;
- вызов side effects соседнего модуля напрямую, если есть event/port.

Исключения должны быть записаны явно: auth decorators, Nest guards, shared utils, domain events, Prisma service как infrastructure.

## 7. Backend: коммерческая модель

Нужная целевая модель:

```text
Product = карточка товара, SEO, описание, картинки, категории.
ProductVariant = продаваемая единица: цена, остаток, артикул, attributes, sale unit.
Default variant = техническая продаваемая единица для simple product.
Product.price = legacy/display mirror, не источник истины.
Sellable projection = единый ответ: цена, доступность, variantId, причина недоступности.
Inventory = складская правда, если включен internal inventory.
Integration = внешний источник данных, пишет через ownership policy.
```

Инварианты:

- У каждого активного товара должна быть хотя бы одна не удаленная variant.
- Simple product имеет hidden default variant.
- Matrix product имеет явные варианты; default variant не должен утекать как обычная вариация.
- `stock = null`: остаток не отслеживается, можно добавлять без лимита.
- `stock = 0`: нет в наличии.
- `stock > 0`: конечный остаток.
- `price = null`: цена неизвестна, на витрине не показываем цену, в корзине показываем `?`.
- `price = 0`: цена известна и равна нулю. Это редкий, но валидный кейс, если бизнес его разрешает.
- Product status должен пересчитываться от variants/sellable state.

## 8. Backend: интеграции

МойСклад уже движется к правильной схеме: full sync, stock sync, webhook stock, order export, queues, sync runs. Следующий уровень надежности:

- Full sync и webhook delta должны применять остатки через один apply path.
- Интеграция не должна напрямую решать, как чинить product; она вызывает `ProductExternalSyncPort`.
- Остатки должны идти через `InventoryExternalStockPort` или product variant stock path в зависимости от inventory mode.
- Для каждого external field нужен ownership:
  - `price`: external/internal/manual.
  - `stock`: external/internal/manual.
  - `name/images/description/categories`: отдельная политика.
- Нельзя скрывать или удалять товар при частичном external snapshot.
- Любой skipped должен иметь причину: `capability_disabled`, `internal_inventory`, `missing_mapping`, `snapshot_incomplete`, `price_unknown`, `stock_not_tracked`.
- Webhook не должен запускать full sync. Он должен обрабатывать только reportUrl/delta и создавать `IntegrationSyncRun` с trigger `WEBHOOK`.

## 9. Backend: inventory/cart/order

Cart и Order должны стать самым строгим местом системы, потому что там деньги и обязательства перед покупателем.

Целевое правило:

- Cart добавляет не product, а sellable item.
- Если товар simple, backend сам выбирает default variant.
- Если товар matrix и variant не выбран, backend возвращает понятную ошибку выбора вариации.
- Cart pricing берет цену только из sellable projection.
- Cart не читает `Product.price` напрямую.
- Checkout пишет snapshot:
  - productId;
  - variantId;
  - name;
  - variant label;
  - price;
  - quantity;
  - sale unit;
  - external links;
  - selected attributes.
- Order больше не зависит от текущего состояния product после создания.
- Internal inventory reserve/release/consume работает только по variantId.

## 10. Backend: domain events

Events уже есть, но их нужно сделать основным способом побочных эффектов.

Правильные handlers:

- `ProductChanged` -> cache invalidation, search/SEO projection, analytics.
- `VariantPriceChanged` -> cache invalidation, cart warning/reprice policy, analytics.
- `VariantStockChanged` -> availability projection, cache invalidation.
- `OrderCreated` / `OrderCompleted` -> inventory reservation/consume, export queue, audit.
- `IntegrationSyncCompleted` -> diagnostics, admin notification, projection refresh.
- `CatalogCapabilitiesChanged` -> cache invalidation, maybe repair diagnostics.

Важно: handlers должны быть идемпотентными. Event не должен ломать систему при повторной доставке.

## 11. Frontend: карта приложений

В workspace есть два UI-приложения:

- `../frontend`: storefront/catalog frontend. Это основной покупательский и catalog manager UI.
- `../dashboard`: отдельный admin dashboard. Он использует admin/auth generated API и сейчас выглядит тоньше.

Этот документ глубоко анализирует `../frontend`, а dashboard отмечает как отдельный клиент, который нужно держать на тех же API contract правилах.

## 12. Storefront frontend: карта модулей

В `../frontend` около 225 test/spec файлов. Основные зоны:

| Зона                                 | Роль                                                                             | Состояние                              | Главный риск                             | Что сделать                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `app`                                | Next routes, layouts, storefront pages, drawer routes, auth, revalidate API      | Тонкий route слой                      | Route может начать держать бизнес-логику | Держать только composition/data loading                        |
| `core/catalog-runtime`               | Runtime расширения каталога, slots, checkout config, product card runtime        | Очень хорошая архитектурная точка      | Contracts могут разрастись без тестов    | Описать plugin contract и покрыть restaurant/wholesale/default |
| `core/modules/browser`               | Состояние браузера каталога, query, scroll/intersection                          | Небольшой модуль                       | Тесная связь с layout/widgets            | Оставить чистым model module                                   |
| `core/modules/cart`                  | Cart context, mutations, SSE, optimistic state, variant selection, cart UI atoms | Большой core-модуль                    | Может дублировать backend sellable rules | Держать бизнес-решения в model helpers и сверять с backend DTO |
| `core/modules/category`              | Category card/model                                                              | Тонкий                                 | Может вырасти через product imports      | Держать как category presentation                              |
| `core/modules/integration`           | UI helpers для sync progress                                                     | Тонкий                                 | Может получить слишком много provider UI | Разделять provider model и widget drawer                       |
| `core/modules/product`               | Product card, drawer model, editor, variants, sale units, product actions        | Самый большой frontend-модуль          | Create/edit/editor дублируют правила     | Разбить editor на slices и единый product form model           |
| `core/widgets/cart-drawer`           | Полный drawer корзины и checkout                                                 | Большой widget                         | Может дублировать cart module model      | UI-only + hooks из cart module                                 |
| `core/widgets/create-product-drawer` | Создание товара                                                                  | Большой widget                         | Дублирование edit/product editor         | Постепенно заменить на общий product editor                    |
| `core/widgets/edit-product-drawer`   | Редактирование товара                                                            | Большой widget                         | Расхождение с create                     | Общий editor model и payload builders                          |
| `core/widgets/edit-catalog-drawer`   | Настройки каталога, интеграции, inventory, domains, sessions                     | Большой admin widget внутри storefront | Смешение catalog settings и provider UI  | Разделить tabs/features на submodules                          |
| `core/widgets/product-drawer`        | Карточка товара, варианты, purchase selection                                    | Важная покупательская зона             | Может расходиться с cart add rules       | Использовать один selection model с cart                       |
| `shared/api`                         | API client, generated API, server helpers                                        | Сильный контрактный слой               | Generated churn без CI gate              | Export OpenAPI -> generate -> diff check                       |
| `shared/capabilities`                | Frontend effective capability helpers                                            | Важный shared слой                     | Расхождение с backend capability         | Автотесты на backend DTO examples                              |
| `shared/ui`                          | UI primitives                                                                    | Хорошая база                           | Попадание domain logic в UI              | UI primitives держать domain-free                              |
| `sandbox`                            | Эксперименты plugin/runtime                                                      | Полезная лаборатория                   | Случайный импорт в production            | Boundary test уже запрещает                                    |

## 13. Storefront frontend: границы

Сейчас уже есть хороший тест `core/architecture-boundaries.test.ts`, который запрещает:

- `shared -> core`;
- `core/modules -> core/widgets`;
- `core/modules -> core/views`;
- production source -> `sandbox`;
- generated API -> app/core/sandbox.

Следующий уровень правил:

```text
app -> widgets/runtime/modules/shared
views -> widgets/modules/shared
widgets -> modules/shared
modules -> shared/generated API
shared -> no core/app/widgets
sandbox -> anything, but production -> no sandbox
```

Для `core/modules/product` и `core/modules/cart` нужно ввести публичные entrypoints:

- `core/modules/product/model`;
- `core/modules/product/editor/model`;
- `core/modules/cart/model`;
- `core/modules/cart/ui`.

Widgets должны импортировать только эти entrypoints, а не отдельные внутренние файлы глубоко внутри модуля.

## 14. Dashboard

`../dashboard` сейчас отдельное Next-приложение с:

- `features/auth`;
- `features/catalog`;
- `shared/api/generated`;
- `shared/ui`;
- `shared/lib`;
- admin/auth endpoints из backend.

Dashboard важен, потому что через него будут feature entitlements, каталоги, оплаты, diagnostics, repair и outbox. Его лучше не сливать архитектурно со storefront. Правильная роль dashboard:

- admin-only UI;
- generated API only;
- no direct копия storefront business logic;
- read-only diagnostics first;
- dangerous mutations through explicit confirmation and audit.

Отдельная задача: добавить dashboard boundary test:

```text
features -> shared
app -> features/shared
shared -> no features/app
generated -> no features/app
```

## 15. Сквозные инварианты

Эти правила должны быть записаны и проверяться тестами:

### Цена

- Внешняя цена может быть `null`.
- Карточка товара с `price = null` не показывает цену.
- Корзина с неизвестной ценой показывает `?`.
- Товар с вариациями показывает цену от выбранной/первой доступной вариации или price range.
- Фильтр цены должен работать по sellable projection, а не только по `Product.price`.

### Остаток

- `stock = null`: не отслеживается, доступен без лимита.
- `stock = 0`: нет в наличии.
- `stock > 0`: доступен с лимитом.
- Internal inventory mode не должен перезаписываться внешним webhook без явной reconciliation policy.

### Вариации

- Simple product всегда имеет hidden default variant.
- Matrix product требует выбор variant.
- Hidden default не показывается как обычная вариация.
- `product.variants=false` скрывает matrix UI, но не ломает default variant.

### Capabilities

- Capability выключает доступ и UI.
- Capability не удаляет данные.
- API response не должен отдавать beta-данные наружу, если фича выключена.
- При повторном включении capability данные должны быть восстановимы.

### Интеграции

- External links не удаляются без explicit cleanup.
- Full sync и webhook должны сходиться в один результат.
- Ошибки sync должны быть диагностируемы.

## 16. Рекомендуемая целевая архитектура backend

```text
src/modules/product
  contracts.ts
  public.ts
  application/
  domain/
  infrastructure/
  presentation/

src/modules/cart
  contracts.ts
  public.ts
  application/
  domain/
  infrastructure/
  presentation/
```

Не обязательно сразу физически переносить все файлы. Важно логически разделить:

- `presentation`: controllers/dto.
- `application`: use cases/services.
- `domain`: чистые правила, builders, policies.
- `infrastructure`: repositories, prisma, external adapters.
- `contracts.ts`: наружные ports и DTO.
- `public.ts`: единственный публичный barrel модуля.

## 17. Рекомендуемая целевая архитектура frontend

```text
app/
  routes only

core/catalog-runtime/
  contracts
  registry
  slots
  extensions

core/modules/
  product/
    model
    editor/model
    ui atoms
    public entrypoints
  cart/
    model
    ui atoms
    public entrypoints

core/widgets/
  composition only

shared/
  api
  ui
  lib
  capabilities
  providers
```

Правило: widgets собирают сценарии, modules держат предметную UI-логику, shared не знает о домене.

## 18. Roadmap до сильного прода

### Phase 0. Зафиксировать инварианты

Срок: 1-2 дня.

- Создать `docs/domain-invariants.md`.
- Описать price/stock/variant/capability/integration ownership.
- Добавить короткие examples для simple product, matrix product, external product, internal inventory.
- Обновить frontend docs, чтобы UI не гадал.

### Phase 1. Module boundaries

Срок: 2-4 дня.

- Backend architecture boundary test уже добавлен.
- Cross-module imports внутренних файлов уже запрещаются для `src/modules`.
- `src/core` уже защищен от глубоких импортов в `src/modules`: разрешены `contracts.ts` и `public.ts`.
- Выбранные public barrels и Nest module exports уже защищены от повторного экспорта implementation services.
- Выбранные public barrels уже защищены от повторного экспорта внутренних helper-файлов; product read mapper/utils и `product-variant-card-projection` закрыты внутри product-модуля.
- Все module `contracts.ts` уже защищены от imports из repository implementation-типов; DTO-free rule включен для `auth`, `inventory`, `product`, `product-type`.
- Дальше расширять `public.ts` у оставшихся модулей по мере появления внешних потребителей.
- Перестать экспортировать concrete services наружу, где есть ports.
- Добавить CI-команду `npm test -- architecture`.

### Phase 2. Sellable Core hardening

Срок: 3-5 дней.

- Все чтение цены/остатка/доступности перевести на `ProductSellableReader`.
- Product list, product drawer, cart add, checkout, order snapshot должны использовать одну модель.
- Price filter перевести на variant/sellable projection.
- Product.price оставить как mirror и диагностировать mismatch.
- Добавить тесты для `null`, `0`, positive price/stock.

### Phase 3. Inventory/Cart/Order

Срок: 3-6 дней.

- Убедиться, что все складские операции идут по `variantId`.
- Cart line всегда хранит variantId.
- Checkout всегда пишет snapshot.
- Internal inventory включает strict reserve/release/consume.
- External stock не перезаписывает internal balances.
- Добавить e2e: product -> cart -> checkout -> inventory movement.

### Phase 4. Integration reliability

Срок: 4-7 дней.

- Full sync/webhook stock delta привести к одному apply path.
- Добавить field ownership metadata.
- Не скрывать товары при неполном snapshot.
- Добавить skipped reasons и diagnostics.
- Добавить repair/report по orphan external links.
- Покрыть МойСклад сценарии: product без модификаций, product с модификациями, webhook stock, token rotation.

### Phase 5. Frontend modularity

Срок: 4-7 дней.

- Ввести public entrypoints у product/cart modules.
- Убрать глубокие импорты из widgets.
- Свести create/edit product к общему editor model.
- Capability-aware UI сделать через единые adapters.
- Product drawer и cart variant drawer должны использовать одну selection model.
- Добавить dashboard boundary test.

### Phase 6. Repair and diagnostics

Срок: 3-5 дней.

- Разделить repair на:
  - passive audit;
  - safe auto-repair;
  - manual repair scripts;
  - admin diagnostics.
- Проверки:
  - нет default variant;
  - несколько default variants;
  - price mismatch;
  - orphan cart item;
  - orphan integration link;
  - invalid stock/price;
  - hidden default leaks;
  - category position gaps.
- Dashboard должен сначала показывать read-only diagnostics.

### Phase 7. Prod quality gate

Срок: 1-2 дня на сборку gate, потом постоянно.

Обязательные команды перед prod:

```bash
npm run prod:check
```

Для storefront:

```bash
npm run api:gen
npm run lint
npm run build
npm run test:run
```

Для dashboard:

```bash
npm run api:gen
npm run lint
npm run build
```

Плюс data gate:

```bash
bun db:audit-default-variants
```

На production apply-скрипты запускать только после dry-run/audit и backup.

## 19. Конкретный backlog

### Backend: boundaries

- Добавить `src/architecture-boundaries.spec.ts`.
- Сканировать `src/modules/**/*.ts`, исключая spec.
- Находить импорты `@/modules/<module>/...`.
- Если target module отличается от source module, разрешать только:
  - `@/modules/<module>/contracts`;
  - `@/modules/<module>/public`;
  - whitelist auth decorators/guards/types;
  - shared/core/prisma infra.
- Сначала запустить в report-only режиме, затем включить как test.

### Backend: product

- Разделить `ProductRepository` на read/write/diagnostics части или хотя бы внутренние sections.
- Сделать `ProductExternalSyncPort`.
- Сделать `ProductRepairPort` только для maintenance/admin, не для обычных use cases.
- Зафиксировать `Product.price` как mirror.
- Добавить diagnostics endpoint/script для price mismatch.

### Backend: cart

- Cart module должен зависеть от:
  - `ProductSellableReader`;
  - `InventoryReservationPort`;
  - `OrderExportPort`;
  - `CapabilityReaderPort`.
- Убрать прямую бизнес-зависимость от concrete product/inventory/integration services.
- Добавить тест: matrix product без variantId -> ошибка выбора вариации.
- Добавить тест: simple product без variantId -> default variant.
- Добавить тест: stock null -> unlimited.

### Backend: inventory

- Добавить `InventoryExternalStockPort`.
- Явно разделить external stock и internal balance.
- Добавить reconciliation diagnostics.
- Уточнить поведение при mode `NONE`, `EXTERNAL`, `INTERNAL`.

### Backend: integration

- Добавить ownership policy.
- Добавить skipped reasons в sync run details.
- Все product writes через product external sync port.
- Все stock writes через inventory/product external stock port.
- Не удалять товары по partial snapshot.
- Token rotation: при смене токена проверить/восстановить webhookstock.

### Backend: catalog/capability

- Catalog feature changes публикуют `CatalogCapabilitiesChanged`.
- Capability response должен быть единственным источником для frontend.
- Не отдавать beta-поля наружу при выключенной capability.
- Сохраненные beta-данные не удалять.

### Backend: events

- Cache invalidation перевести на event handlers.
- SEO sync перевести на event handlers.
- Integration sync completed -> diagnostics handler.
- Добавить idempotency key для handlers.

### Frontend: product/cart

- Вынести общую variant selection model:
  - product drawer;
  - plus button on card;
  - cart add;
  - cart variant drawer.
- Product card price брать из product card view/sellable DTO.
- Если есть вариации, не показывать legacy base price как главную цену.
- Create/edit product должны использовать один payload builder.
- Stock input: пусто -> `null`, `0` -> нет в наличии.
- Price input: кроме торговых баз целые числа без дробной части.

### Frontend: capabilities

- Сделать adapters:
  - `canShowVariants`;
  - `canShowSaleUnits`;
  - `canShowMoySklad`;
  - `canUseInternalInventory`.
- UI не должен сам решать по сырым полям, если capability выключена.
- Скрытые beta-данные не должны попадать в форму как активные значения.

### Frontend: generated API

- `backend openapi:export` должен быть источником для storefront/dashboard.
- Orval generation должна работать локально без поднятого backend через `runtime/openapi.json`.
- В CI добавить diff check generated files.

### Dashboard

- Добавить architecture boundary test.
- Сгенерировать API после изменения backend OpenAPI.
- Добавить diagnostics pages только read-only на первом шаге.
- Dangerous actions: confirmation + audit + clear result.

## 20. Definition of done для архитектурного укрепления

Считаем систему готовой к следующему большому продовому шагу, когда:

- Backend boundary test проходит.
- Frontend boundary test проходит.
- Dashboard boundary test проходит.
- Все core-модули общаются через ports/public contracts.
- Cart/Order не читают `Product.price` напрямую.
- Product list/card/drawer/cart используют одну sellable semantics.
- Full sync и webhook stock sync используют общий apply path.
- Capability выключает видимость/доступ, но не удаляет данные.
- Repair audit показывает 0 blocking issues.
- OpenAPI экспортируется и генерируется во frontend/dashboard.
- Backend build/test проходят.
- Frontend/dashboard build/lint проходят.

## 21. Самый правильный следующий шаг

Следующий шаг должен быть не новый большой feature, а технический предохранитель:

1. Сделать backend architecture boundary test в report-only стиле.
2. Сохранить текущие нарушения как понятный список.
3. Закрыть 3-5 самых опасных связей:
   - `cart -> product concrete service`;
   - `cart -> inventory concrete service`;
   - `integration -> product internals`;
   - `category -> product DTO/module`;
   - убрать concrete service exports там, где уже есть ports.
4. После этого включить boundary test как обязательный.

Это даст эффект сразу: новые изменения перестанут случайно ломать соседние модули, а старые связи можно будет разбирать по одной без остановки разработки.

## 22. Короткий вывод

Фундамент сильный. Проект уже не выглядит как хаотичный CRUD, а как платформа, которая может выдержать SMB-сценарии: каталог, вариации, корзина, склад, заказы, интеграции, админка, диагностика и repair. Самое важное сейчас - не ускоряться за счет новых неявных связей. Нужно поставить архитектурные перила: contracts, ports, domain events, generated API gate, repair diagnostics. Тогда дальнейший рост будет не хрупким, а управляемым.
