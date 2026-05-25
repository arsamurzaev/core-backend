# Интеграция с iikoCloud

Документ описывает, как правильно настроить iikoCloud и как связать его с нашим каталогом так, чтобы импорт меню, цен, вариантов, картинок, стоп-листов и будущий экспорт заказов работали предсказуемо.

Актуальность проверки: 2026-05-20. Основной источник - официальный iikoCloud Swagger/OpenAPI:

- https://api-ru.iiko.services/docs
- https://api-ru.iiko.services/api-docs/docs
- https://api.iiko.ru/

## Короткий вывод

Для нашего сценария витрины нужно считать главным источником не `/api/1/nomenclature`, а внешнее меню:

```text
POST /api/2/menu
POST /api/2/menu/by_id
```

`/api/1/nomenclature` полезен как fallback и технический источник, но в настройке со скрина iiko выбран режим "Внешнее меню" и "Ценовые категории". Значит товары и цены надо брать через external menu API.

Реализация MVP после перевода на external menu:

- получает token через `/api/1/access_token` и не сохраняет его в БД;
- проверяет организации через `/api/1/organizations`;
- получает external menus и price categories через `/api/2/menu`;
- хранит `apiLogin` зашифрованным;
- хранит `organizationId`, `externalMenuId`, `priceCategoryId`, `menuVersion`, `syncSource`;
- preview и sync читают меню через `/api/2/menu/by_id`;
- `/api/1/nomenclature` оставлен как fallback/diagnostic путь, но не основной импорт.

Если подключение успешно, но preview показывает `0 товаров`, значит надо смотреть содержимое external menu, видимость позиций и цены в выбранной ценовой категории.

## Термины

| Термин | Что это | Где взять |
| --- | --- | --- |
| `apiLogin` | API ключ/login из iikoWeb/Cloud API settings | В интерфейсе iiko, показывается полностью только при создании |
| `access token` | Временный bearer token для запросов | `POST /api/1/access_token` |
| `organizationId` | Организация/ресторан в iiko | `POST /api/1/organizations` |
| `externalMenuId` | ID внешнего меню, например `81651` из URL редактирования | `POST /api/2/menu` |
| `priceCategoryId` | ID ценовой категории, например "Базовая категория" | `POST /api/2/menu` |
| `terminalGroupId` | Группа терминалов, нужна для заказов и стоп-листов | `POST /api/1/terminal_groups` |
| `paymentTypeId` | Тип оплаты для заказа | `POST /api/1/payment_types` |
| `orderTypeId` | Тип заказа для доставки/самовывоза | `POST /api/1/deliveries/order_types` |
| `sourceKey` | Маркер источника заказа | Настраивается на стороне iiko/API login |

## Правильная настройка в iiko

### 1. API login

В iiko нужно создать активный API login.

Проверить:

- интеграция активна;
- права достаточно широкие для MVP, на демо можно "Все права";
- внешнее меню выбрано;
- источник цен выбран корректно;
- если источник цен - "Ценовые категории", выбрана нужная ценовая категория;
- полный ключ сохранен сразу при создании.

Важно: маскированный ключ вида `d76******2b6` использовать нельзя. Для backend нужен полный `apiLogin`, который iiko показывает только один раз.

### 2. Внешнее меню

В iiko должен быть опубликован внешний каталог, например "Мой каталог".

Проверить:

- в меню есть категории;
- в категориях есть блюда/товары;
- позиции не скрыты;
- позиции имеют цены в выбранной ценовой категории;
- картинки добавлены, если мы хотим импортировать изображения;
- меню доступно именно этому API login.

Если URL редактирования выглядит так:

```text
/external-menu/index.html#/edit-external-menu/81651
```

то `81651` - хороший кандидат на `externalMenuId`, но его все равно нужно подтвердить через `/api/2/menu`.

### 3. Ценовые категории

Если в iiko выбран источник цен "Ценовые категории", то при чтении меню надо передавать `priceCategoryId`.

Неправильно:

```json
{
  "externalMenuId": "81651",
  "organizationIds": ["ORG_ID"],
  "priceCategoryId": null
}
```

Правильно:

```json
{
  "externalMenuId": "81651",
  "organizationIds": ["ORG_ID"],
  "priceCategoryId": "PRICE_CATEGORY_ID"
}
```

`PRICE_CATEGORY_ID` - это не название "Базовая категория", а ID из `/api/2/menu`.

## Правильный API flow для подключения

### 1. Получить token

Endpoint:

```http
POST https://api-ru.iiko.services/api/1/access_token
```

Body:

```json
{
  "apiLogin": "FULL_API_LOGIN"
}
```

Ответ:

```json
{
  "correlationId": "...",
  "token": "..."
}
```

Token живет стандартно 1 час. В базе его хранить не нужно. Backend должен кешировать token в памяти и при `401` один раз получить новый token.

### 2. Получить организации

Endpoint:

```http
POST /api/1/organizations
```

Body:

```json
{
  "returnAdditionalInfo": true,
  "includeDisabled": false
}
```

Из ответа сохраняем:

- `organizationId`;
- `organizationName`.

### 3. Получить external menus и price categories

Endpoint:

```http
POST /api/2/menu
```

Body можно отправлять пустым:

```json
{}
```

Ответ содержит:

```json
{
  "correlationId": "...",
  "externalMenus": [
    {
      "id": "81651",
      "name": "Мой каталог"
    }
  ],
  "priceCategories": [
    {
      "id": "PRICE_CATEGORY_ID",
      "name": "Базовая категория"
    }
  ]
}
```

Во фронте нужно показать два select:

- "Внешнее меню";
- "Ценовая категория".

### 4. Забрать конкретное внешнее меню

Endpoint:

```http
POST /api/2/menu/by_id
```

Body:

```json
{
  "externalMenuId": "81651",
  "organizationIds": ["ORG_ID"],
  "priceCategoryId": "PRICE_CATEGORY_ID",
  "version": 4,
  "language": "ru",
  "startRevision": 0
}
```

Обязательные поля:

- `externalMenuId`;
- `organizationIds`.

Важные поля:

- `priceCategoryId` - нужен, если цены берутся из ценовых категорий;
- `version` - версия модели ответа. Маппер должен уметь читать V2/V3/V4, потому что разные стенды могут вернуть разные формы;
- `startRevision` - можно использовать для инкрементального обновления, но первый импорт лучше делать с `0`.

## Где лежат товары в external menu

Ответ `/api/2/menu/by_id` не похож на `/api/1/nomenclature`.

Вариант V2:

```text
response.itemCategories[].items[]
```

Вариант V3/V4:

```text
response.itemGroups[].items[]
```

Поэтому код вида:

```ts
response.products.length
```

для external menu всегда даст `0`, даже если товары реально пришли.

## Mapping external menu в нашу модель

### Категории

| iiko | Наша модель |
| --- | --- |
| `category.id` | `IntegrationCategoryLink.externalId` |
| `category.name` | `Category.name` |
| `category.description` | `IntegrationCategoryLink.rawMeta.description` |
| `category.buttonImageUrl` | rawMeta, позже можно использовать для category media |
| `category.isHidden` | скрыть категорию или не импортировать как видимую |

Для V2 категории лежат в `itemCategories`, для V3/V4 - в `itemGroups`.

### Товары

| iiko V2 | iiko V3/V4 | Наша модель |
| --- | --- | --- |
| `item.itemId` | `item.id` | `IntegrationProductLink.externalId` |
| `item.sku` | `item.sku` | `Product.sku` |
| `item.name` | `item.name` | `Product.name` |
| `item.description` | `item.description` | `Product.description` |
| `item.type` | `item.type` | rawMeta/type |
| `item.isHidden` | `item.isHidden` | `Product.status` hidden/inactive |
| `item.itemSizes` | `item.itemSizes` | `ProductVariant[]` |

Импортировать в MVP:

- `type = DISH`;
- простые товары с `orderItemType = Product`;
- позиции с ценой в выбранной организации.

Осторожно:

- `type = COMBO` пока лучше сохранять в raw snapshot, но не создавать как обычный товар;
- модификаторы не создавать как товары;
- скрытые позиции не показывать на витрине;
- позиции без цены не импортировать как продаваемые.

### Варианты и размеры

External menu size:

```text
item.itemSizes[]
```

V2:

```text
size.sizeId
size.sizeName
size.isDefault
size.prices[]
size.buttonImageUrl
```

V3/V4:

```text
size.id
size.sizeName
size.isDefault
size.prices[]
size.buttonImageUrl
```

Mapping:

| iiko | Наша модель |
| --- | --- |
| `itemId/id + sizeId/id` | `IntegrationVariantLink.externalId` |
| `size.sku` | `ProductVariant.sku` |
| `size.sizeName` | attribute `iiko_size` |
| `size.prices[].price` | `ProductVariant.price` |
| `size.isHidden` | `ProductVariant.status` hidden/inactive |

External variant id:

```text
${productExternalId}:${sizeExternalId || "default"}
```

Если размер один, можно обновлять default variant. Если размеров несколько, создаем несколько `ProductVariant`.

### Цены

Цена в external menu лежит внутри размера:

```text
item.itemSizes[].prices[]
```

Элемент цены:

```json
{
  "organizations": ["ORG_ID"],
  "price": 500,
  "taxCategoryId": "..."
}
```

Правила:

- выбирать цену, где `organizations` содержит наш `organizationId`;
- если `organizations` пустой или отсутствует, считать цену общей только после проверки на реальном стенде;
- если `price = null`, позиция или размер не продается;
- если нет цены для выбранной организации, товар не импортировать как активный;
- `Product.price` считать как цену default-варианта или минимальную цену активных вариантов.

### Картинки

В external menu картинки могут быть здесь:

- `category.buttonImageUrl`;
- `category.headerImageUrl`;
- `item.buttonImageUrl`, если вернется в версии ответа;
- `size.buttonImageUrl`.

Для MVP:

- импортировать картинки только если `importImages = true`;
- ошибки загрузки картинки не должны валить весь sync;
- лучше сохранить исходный URL в `rawMeta`;
- при нескольких размерах можно брать первую доступную картинку размера.

### Модификаторы

В external menu модификаторы лежат внутри размеров:

```text
item.itemSizes[].itemModifierGroups[]
```

Для MVP:

- не создавать модификаторы как товары;
- сохранить `itemModifierGroups` в `Product.rawMeta` или `IntegrationProductLink.rawMeta`;
- отдельно спроектировать `CartItemModifier` / `OrderItemModifier` перед экспортом заказов.

Причина: iiko-модификаторы могут быть обязательными, платными, иметь min/max ограничения, вложенность и собственные цены. Если импортировать их как обычные товары, корзина и заказ сломаются на сложных блюдах.

## `/api/1/nomenclature` как fallback

Endpoint:

```http
POST /api/1/nomenclature
```

Body:

```json
{
  "organizationId": "ORG_ID",
  "startRevision": 0
}
```

Ответ содержит:

- `groups`;
- `productCategories`;
- `products`;
- `sizes`;
- `revision`.

Важно:

- первый запрос делать с `startRevision = 0`;
- последующие можно делать с прошлым `revision`;
- если `startRevision` равен текущему `revision`, iiko может вернуть пустые `groups/products/sizes`, потому что изменений нет;
- `products` содержит и товары, и модификаторы;
- для MVP импортировать только `type = dish` или `type = good`;
- `type = modifier` не импортировать как товар.

Для нашей витрины `/api/1/nomenclature` не должен быть главным источником, если клиент настроил "Внешнее меню".

## Рекомендуемый UX в нашей админке

### Шаг 1. Ввод apiLogin

Поля:

- `apiLogin`;
- переключатель `isActive`;
- `importImages`.

Кнопка:

- "Проверить подключение".

Что делает backend:

1. получает token;
2. вызывает `/api/1/organizations`;
3. вызывает `/api/2/menu`;
4. возвращает организации, external menus, price categories.

### Шаг 2. Выбор источников

Поля:

- `organizationId`;
- `externalMenuId`;
- `priceCategoryId`;
- `terminalGroupId`, позже для заказов и стоп-листов;
- `paymentTypeId`, позже для заказов;
- `orderTypeId` или `orderServiceType`, позже для заказов;
- `sourceKey`, позже для заказов.

### Шаг 3. Preview

Кнопка:

- "Загрузить preview".

Backend вызывает `/api/2/menu/by_id`, но не создает товары.

Preview должен показать:

- количество категорий;
- количество видимых товаров;
- количество скрытых товаров;
- количество товаров без цены;
- количество товаров с несколькими размерами;
- количество combo;
- количество товаров с модификаторами;
- примеры ошибок mapping.

### Шаг 4. Выбор импорта

Пользователь выбирает:

- импортировать все;
- импортировать выбранные категории;
- импортировать выбранные товары;
- импортировать картинки;
- создавать варианты по размерам;
- скрывать отсутствующие товары при полном snapshot.

### Шаг 5. Sync

Backend запускает job:

```text
iikoCloud -> full external menu snapshot -> normalized preview -> selected import -> local catalog
```

Сохранять:

- `lastMenuSyncedAt`;
- `lastRevision`;
- статистику sync;
- ошибки по товарам;
- rawMeta для категорий, товаров, вариантов.

## Metadata, которую нужно хранить

Сейчас храним:

```json
{
  "apiLoginEncrypted": "...",
  "organizationId": "...",
  "organizationName": "...",
  "importImages": true,
  "lastRevision": null,
  "lastMenuSyncedAt": null
}
```

Нужно расширить:

```json
{
  "apiLoginEncrypted": "...",
  "organizationId": "...",
  "organizationName": "...",
  "externalMenuId": "81651",
  "externalMenuName": "Мой каталог",
  "priceCategoryId": "PRICE_CATEGORY_ID",
  "priceCategoryName": "Базовая категория",
  "importImages": true,
  "importHiddenItems": false,
  "importCombos": false,
  "syncSource": "external_menu",
  "lastRevision": null,
  "lastMenuSyncedAt": null
}
```

Не хранить в БД:

- access token;
- полный `apiLogin` открытым текстом;
- `Authorization` headers в логах.

## Backend endpoints, которые нужны

Уже есть MVP endpoints:

```http
GET /integration/iiko
GET /integration/iiko/status
PUT /integration/iiko
PATCH /integration/iiko
POST /integration/iiko/test-connection
POST /integration/iiko/sync
```

Нужно добавить или расширить:

```http
POST /integration/iiko/discovery
POST /integration/iiko/import-preview
POST /integration/iiko/sync
GET /integration/iiko/sync-runs
```

### `POST /integration/iiko/discovery`

Input:

```json
{
  "apiLogin": "FULL_API_LOGIN"
}
```

Output:

```json
{
  "ok": true,
  "organizations": [],
  "externalMenus": [],
  "priceCategories": []
}
```

### `POST /integration/iiko/import-preview`

Input:

```json
{
  "externalMenuId": "81651",
  "organizationId": "ORG_ID",
  "priceCategoryId": "PRICE_CATEGORY_ID",
  "version": 4
}
```

Output:

```json
{
  "ok": true,
  "source": "external_menu",
  "revision": 123,
  "stats": {
    "categories": 10,
    "items": 120,
    "visibleItems": 110,
    "hiddenItems": 10,
    "itemsWithoutPrice": 4,
    "itemsWithModifiers": 35,
    "combos": 3
  },
  "categories": [],
  "items": []
}
```

### `POST /integration/iiko/sync`

Input для полного импорта:

```json
{
  "mode": "full",
  "source": "external_menu"
}
```

Input для выбранного импорта:

```json
{
  "mode": "selected",
  "categoryIds": ["..."],
  "productIds": ["..."],
  "importImages": true
}
```

## Capabilities

Текущее MVP:

```ts
{
  productImport: true,
  variantImport: true,
  stockImport: false,
  imageImport: true,
  orderExport: false,
  reservation: false,
  webhook: false
}
```

После external menu sync и stop-lists:

```ts
{
  productImport: true,
  variantImport: true,
  stockImport: true,
  imageImport: true,
  orderExport: false,
  reservation: false,
  webhook: false
}
```

После экспорта заказов:

```ts
{
  productImport: true,
  variantImport: true,
  stockImport: true,
  imageImport: true,
  orderExport: false,
  reservation: false,
  webhook: false
}
```

Webhook можно включать только после отдельного проектирования событий и безопасности.

## Stop-lists

Endpoint:

```http
POST /api/1/stop_lists
```

Body:

```json
{
  "organizationIds": ["ORG_ID"],
  "terminalGroupIds": ["TERMINAL_GROUP_ID"],
  "returnSize": true
}
```

Ответ содержит:

```text
terminalGroupStopLists[].items[]
```

Item:

```json
{
  "balance": 0,
  "productId": "PRODUCT_ID",
  "sizeId": "SIZE_ID",
  "sku": "...",
  "dateAdd": "..."
}
```

Mapping:

```text
productId + sizeId -> IntegrationVariantLink.externalId -> ProductVariant
```

Если `sizeId = null`, применять к default variant товара.

Реализованное поведение:

- если позиция в stop-list и `balance <= 0`, ставим связанному `ProductVariant` `stock = 0`, `status = OUT_OF_STOCK`, `isAvailable = false`;
- если позиция исчезла из stop-list, возвращаем варианту `stock = null`, `status = ACTIVE`, `isAvailable = true`;
- если у товара не осталось активных вариантов, `Product` переходит в `HIDDEN`, поэтому пропадает с клиентской витрины;
- в админке товар не удаляется и остается доступен через inactive/admin-режим;
- ручной `DISABLED` у варианта не перезаписывается.

## Экспорт заказов

Для доставки:

```http
POST /api/1/deliveries/create
```

Минимальные справочники перед экспортом:

```http
POST /api/1/terminal_groups
POST /api/1/payment_types
POST /api/1/deliveries/order_types
```

Минимальный payload:

```json
{
  "organizationId": "ORG_ID",
  "terminalGroupId": "TERMINAL_GROUP_ID",
  "createOrderSettings": {
    "checkStopList": true,
    "transportToFrontTimeout": 8
  },
  "order": {
    "externalNumber": "ORD-123",
    "phone": "+79990000000",
    "orderServiceType": "DeliveryByCourier",
    "priceCategoryId": "PRICE_CATEGORY_ID",
    "menuId": "81651",
    "customer": {
      "type": "one-time",
      "name": "Иван"
    },
    "items": [
      {
        "type": "Product",
        "productId": "IIKO_PRODUCT_ID",
        "amount": 1,
        "price": 500
      }
    ],
    "sourceKey": "catalog"
  }
}
```

После создания заказа iiko возвращает `correlationId`. Это не финальный успех кассы. Нужно проверять:

```http
POST /api/1/commands/status
```

Body:

```json
{
  "organizationId": "ORG_ID",
  "correlationId": "CORRELATION_ID"
}
```

Состояния:

- `InProgress`;
- `Success`;
- `Error`.

Реализованное поведение в backend:

- экспорт запускается только после завершения заказа администратором, через общий `ORDER_EXPORT_PORT` в `OrderCheckoutService.complete()`;
- `ORDER_EXPORT_PORT` теперь диспетчеризует событие в MoySklad и iiko, чтобы у заказа была одна точка публикации во внешние системы;
- iiko использует отдельную очередь `iiko-order-export`, чтобы worker не перехватывал задания MoySklad;
- флаг `exportOrders` хранится в iiko metadata и по умолчанию выключен;
- для экспорта обязательны `organizationId`, `terminalGroupId`, телефон клиента и mapping товаров/вариантов из iiko import;
- `IntegrationVariantLink.externalId = productId:sizeId`; для default size `productSizeId` в заказ iiko не отправляется;
- в `IntegrationOrderExport.payload` сохраняется отправленный payload, в `response` - ответ iiko с `correlationId` и `orderInfo`;
- если iiko сразу вернул `creationStatus = Error`, export помечается как `SKIPPED` с безопасной ошибкой.

## Диагностика проблемы "0 товаров"

Проверять по шагам.

### 1. Подключение

Если `/api/1/access_token` работает и `/api/1/organizations` возвращает организации, значит `apiLogin` валиден. Но это еще не доказывает, что меню читается правильно.

### 2. External menu доступно?

Вызвать:

```http
POST /api/2/menu
```

Проверить:

- есть ли `externalMenus`;
- есть ли меню "Мой каталог";
- совпадает ли ID с `81651`;
- есть ли `priceCategories`;
- есть ли "Базовая категория".

### 3. Конкретное меню возвращает items?

Вызвать:

```http
POST /api/2/menu/by_id
```

Проверить:

- `itemCategories[].items[]` для V2;
- `itemGroups[].items[]` для V3/V4;
- `isHidden`;
- `itemSizes`;
- `prices`;
- `price != null`.

### 4. Код читает правильную структуру?

Если backend ищет:

```ts
menu.products
```

а ответ пришел из `/api/2/menu/by_id`, то будет `0`.

Нужно читать:

```ts
const groups = menu.itemGroups ?? menu.itemCategories ?? []
const items = groups.flatMap(group => group.items ?? [])
```

### 5. Ценовая категория передана?

Если в iiko выбран источник цен "Ценовые категории", а `priceCategoryId` не передан, товары могут вернуться без нужных цен или не как продаваемые.

### 6. Товары не скрыты?

Проверить:

- category `isHidden`;
- item `isHidden`;
- size `isHidden`;
- price `null`;
- combo вместо dish/product.

## Чеклист "должно работать как часы"

На стороне iiko:

- API login активен.
- Полный `apiLogin` сохранен.
- У API login есть права на нужную организацию.
- Выбран правильный внешний каталог.
- Выбрана правильная ценовая категория.
- Во внешнем меню есть видимые категории.
- В категориях есть видимые блюда/товары.
- У товаров есть цены в выбранной ценовой категории.
- Терминальная группа активна, если нужны stop-lists или заказы.
- Типы оплаты и типы заказов настроены, если нужен экспорт заказов.

На стороне backend:

- `INTEGRATION_ENCRYPTION_KEY` задан и декодируется в 32 байта.
- `IIKO_API_BASE_URL=https://api-ru.iiko.services`, если не нужен другой стенд.
- `apiLogin` хранится только зашифрованно.
- token не хранится в БД.
- discovery вызывает и organizations, и external menus.
- metadata хранит `organizationId`, `externalMenuId`, `priceCategoryId`.
- sync читает `/api/2/menu/by_id`.
- mapper поддерживает V2/V3/V4.
- preview показывает реальные counts до импорта.
- import не валится из-за одной картинки.
- отсутствующие товары скрываются только после полного snapshot и не с первой случайной ошибки.
- все external IDs сохраняются в `Integration*Link`.

## Минимальные curl-проверки

### Локальный smoke-test без UI

Если iiko уже сохранен в локальной БД, можно проверить весь external menu flow без повторного ввода полного `apiLogin`:

```bash
npm run iiko:smoke -- --from-db
```

Скрипт:

- берет сохраненную iiko-интеграцию из БД;
- расшифровывает `apiLogin` через `INTEGRATION_ENCRYPTION_KEY`;
- вызывает `/api/1/organizations`, `/api/2/menu`, `/api/2/menu/by_id`;
- показывает counts, примеры импортируемых товаров и причины пропуска.

Если интеграция еще не сохранена, передайте ключ через env:

```powershell
$env:IIKO_SMOKE_API_LOGIN="FULL_API_LOGIN"
npm run iiko:smoke -- --external-menu-id=81651
```

Если `priceCategoryId` не передан, smoke проверит вариант без ценовой категории и все категории, которые вернул `/api/2/menu`.

### Локальный одноразовый sync

После успешного smoke можно запустить импорт из сохраненной iiko-интеграции:

```bash
npm run iiko:sync-once
```

Скрипт использует тот же sync-service, что и API/queue, и меняет локальный каталог: категории, товары, варианты, цены, картинки и integration links.

### Token

```bash
curl -X POST https://api-ru.iiko.services/api/1/access_token \
  -H "Content-Type: application/json" \
  -d '{"apiLogin":"FULL_API_LOGIN"}'
```

### Organizations

```bash
curl -X POST https://api-ru.iiko.services/api/1/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"returnAdditionalInfo":true,"includeDisabled":false}'
```

### External menus and price categories

```bash
curl -X POST https://api-ru.iiko.services/api/2/menu \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{}'
```

### External menu by ID

```bash
curl -X POST https://api-ru.iiko.services/api/2/menu/by_id \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "externalMenuId": "81651",
    "organizationIds": ["ORG_ID"],
    "priceCategoryId": "PRICE_CATEGORY_ID",
    "version": 4,
    "language": "ru",
    "startRevision": 0
  }'
```

### Nomenclature fallback

```bash
curl -X POST https://api-ru.iiko.services/api/1/nomenclature \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"organizationId":"ORG_ID","startRevision":0}'
```

## Чеклист реализации External Menu MVP

- [x] Расширить iiko metadata: `externalMenuId`, `externalMenuName`, `priceCategoryId`, `priceCategoryName`, `menuVersion`, `syncSource`.
- [x] Обновить `PUT/PATCH /integration/iiko`, `GET /integration/iiko` и `/status`.
- [x] Расширить `test-connection`: организации, external menus, price categories.
- [x] Добавить `IikoClient.getMenus() -> /api/2/menu`.
- [x] Добавить `IikoClient.getExternalMenuById() -> /api/2/menu/by_id`.
- [x] Добавить типы external menu V2/V3/V4.
- [x] Добавить normalizer `itemCategories/itemGroups` -> категории, товары, размеры, цены.
- [x] Добавить `POST /integration/iiko/import-preview` и endpoint в advanced settings.
- [x] Перевести основной iiko sync на `/api/2/menu/by_id`.
- [x] Импортировать только видимые `DISH` / `Product` items с валидной ценой.
- [x] `COMBO` и модификаторы не создавать как товары, сохранять в `rawMeta`.
- [x] Варианты создавать по `itemSizes`, external id = `productId:sizeId || default`.
- [x] Картинки брать из `buttonImageUrl`; ошибки картинок не должны валить sync.
- [x] `/api/1/nomenclature` оставить как fallback/diagnostic путь.
- [x] Обновить OpenAPI и generated frontend API client.
- [x] Обновить iiko drawer: организация, внешнее меню, ценовая категория, preview, status/capabilities.
- [x] Добавить preview-диагностику: `willImport` и причины пропуска (`hidden`, `no_price`, `combo`, `modifier`, `unsupported_type`).
- [x] Добавить focused backend tests: client, metadata, normalizer, sync, controller/service.
- [x] Добавить локальные scripts: `iiko:smoke` и `iiko:sync-once`.
- [x] Провести smoke на сохраненной demo iiko-интеграции: `externalMenuId = 81651`, 3 категории, 6 импортируемых товаров, 10 ценовых вариантов, причин пропуска нет.
- [x] Провести одноразовый sync demo iiko: 6 товаров обновлены, 6 картинок импортированы, revision `1779270093`.
- [ ] Добавить отдельные frontend tests для iiko drawer.

Следующий этап после MVP:

- [ ] `getTerminalGroups()` и stop-lists.
- [ ] Экспорт заказов: `createDelivery()`, `getCommandStatus()`, payment/order types.
- [ ] Модель модификаторов/опций в корзине и заказе.
- [ ] Инкрементальная синхронизация по `revision`.

## Решение по архитектуре

Лучший поток для MVP:

```text
iikoCloud external menu
  -> full snapshot
  -> normalized preview
  -> выбранные категории/товары
  -> local Product / ProductVariant
  -> Integration*Link для стабильного обновления
```

Наша база не должна быть прямой копией iiko. Она должна быть read model для витрины. iiko остается внешним источником каталога и цен, а наша модель отвечает за быстрый storefront, SEO, локальные override-поля и стабильную корзину.

Главное изменение относительно текущего состояния: перестать считать успешный `/api/1/organizations` полноценной проверкой меню. Настоящая проверка подключения для витрины должна заканчиваться успешным `/api/2/menu/by_id` и preview с ненулевым количеством видимых продаваемых items.
