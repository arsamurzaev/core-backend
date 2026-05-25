# Единицы продажи: API-контракт

## Модель

`CatalogSaleUnit` — глобальная единица в справочнике каталога. Название не имеет системного смысла: менеджер сам создает `шт`, `ящик`, `упаковка`, `палет` или любые другие названия.

`ProductVariantSaleUnit` — локальная привязка единицы к конкретному товару или вариации. В ней хранится реальная цена покупки и абсолютный коэффициент `baseQuantity`.

Для simple-товара привязки живут на hidden default variant. Клиент не видит эту вариацию как выбор, но видит `saleUnits` на уровне товара.

## 1. Создать глобальную единицу

`POST /catalog-sale-unit`

В расширенных настройках тот же сценарий доступен как:

`POST /catalog/current/advanced-settings/sale-units`

```json
{
  "name": "Ящик",
  "code": "box",
  "defaultBaseQuantity": 12,
  "barcode": null,
  "displayOrder": 10
}
```

Важное:

- `defaultBaseQuantity` — только подсказка справочника.
- Конкретный товар все равно хранит свой `baseQuantity` в привязке.
- Повтор активного `code` вернет ошибку.
- Повтор архивного `code` восстановит архивную единицу.

## 2. Получить справочник

Только активные неархивные:

`GET /catalog-sale-unit`

или в расширенных настройках:

`GET /catalog/current/advanced-settings/sale-units`

С выключенными, но не архивными:

`GET /catalog-sale-unit?includeInactive=true`

`GET /catalog/current/advanced-settings/sale-units?includeInactive=true`

Со всеми, включая архив:

`GET /catalog-sale-unit?includeArchived=true`

`GET /catalog/current/advanced-settings/sale-units?includeArchived=true`

## 3. Выключить или восстановить единицу

Выключить без удаления:

`PATCH /catalog-sale-unit/{id}`

или:

`PATCH /catalog/current/advanced-settings/sale-units/{id}`

```json
{
  "isActive": false
}
```

Восстановить:

```json
{
  "isActive": true
}
```

Архивировать:

`DELETE /catalog-sale-unit/{id}`

или:

`DELETE /catalog/current/advanced-settings/sale-units/{id}`

Данные в товарах не удаляются. При выключенной capability `catalog.sale_units` данные скрываются из публичной выдачи, но остаются в базе.

## 4. Привязать единицу к simple-товару

У simple-товара передается одна техническая вариация без attributes. Backend сохранит ее как hidden default variant.

```json
{
  "name": "Молоко",
  "price": null,
  "variants": [
    {
      "price": null,
      "stock": 120,
      "saleUnits": [
        {
          "catalogSaleUnitId": "catalog-sale-unit-piece-id",
          "baseQuantity": 1,
          "price": 100,
          "barcode": null,
          "isDefault": true,
          "displayOrder": 0
        },
        {
          "catalogSaleUnitId": "catalog-sale-unit-box-id",
          "baseQuantity": 12,
          "price": 1000,
          "barcode": null,
          "isDefault": false,
          "displayOrder": 10
        }
      ]
    }
  ]
}
```

Правила:

- `catalogSaleUnitId` обязателен.
- Backend не создает `CatalogSaleUnit` из payload товара.
- `CatalogSaleUnit` должен принадлежать текущему каталогу, быть active и не archived.
- В одной вариации нельзя два раза привязать одну глобальную единицу.
- Если у вариации есть `saleUnits`, ровно одна должна быть default. Если default не передан, backend сделает первой единицей default.

## 5. Привязать единицу к matrix-вариации

```json
{
  "items": [
    {
      "price": null,
      "stock": 48,
      "attributes": [
        {
          "attributeId": "size-attribute-id",
          "enumValueId": "size-s-id"
        }
      ],
      "saleUnits": [
        {
          "catalogSaleUnitId": "catalog-sale-unit-box-id",
          "baseQuantity": 12,
          "price": 1000,
          "isDefault": true,
          "displayOrder": 0
        }
      ]
    }
  ]
}
```

Для matrix-товара `saleUnits` приходят внутри каждой видимой вариации.

## 6. Публичное чтение товара

Simple:

```json
{
  "id": "product-id",
  "displayPrice": "100.00",
  "saleUnits": [
    {
      "id": "product-sale-unit-piece-id",
      "catalogSaleUnitId": "catalog-sale-unit-piece-id",
      "name": "Штука",
      "baseQuantity": "1.0000",
      "price": "100.00",
      "isDefault": true
    }
  ],
  "variants": []
}
```

Matrix:

```json
{
  "id": "product-id",
  "displayPrice": "1000.00",
  "variantPickerOptions": [
    {
      "id": "variant-id",
      "saleUnitId": "product-sale-unit-box-id",
      "saleUnitPrice": "1000.00",
      "maxQuantity": 4
    }
  ],
  "variants": [
    {
      "id": "variant-id",
      "saleUnits": []
    }
  ]
}
```

`displayPrice`, `minPrice`, `maxPrice` используют приоритет:

1. цена default active sale unit;
2. `ProductVariant.price`;
3. legacy `Product.price` только для simple fallback.

## 7. Корзина

Без выбора единицы:

`POST /cart/current/items`

```json
{
  "productId": "product-id",
  "quantity": 2
}
```

Если у resolved variant есть active sale units, backend выберет default sale unit.

С явным выбором:

```json
{
  "productId": "product-id",
  "variantId": "variant-id",
  "saleUnitId": "product-sale-unit-box-id",
  "quantity": 2
}
```

Backend хранит:

- `quantity` — количество выбранных пользовательских единиц;
- `baseQuantity = quantity * ProductVariantSaleUnit.baseQuantity`;
- `unitPriceSnapshot = ProductVariantSaleUnit.price`;
- ключ строки корзины: `productId + variantId + saleUnitId`.

Если `saleUnitId` не принадлежит resolved `variantId`, backend возвращает ошибку.
