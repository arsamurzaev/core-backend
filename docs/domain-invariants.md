# Доменные инварианты backend

Дата: 2026-05-17

Этот файл фиксирует правила, которые должны оставаться стабильными при развитии backend. Если код, DTO, синхронизация или frontend-форма противоречат этим правилам, исправлять нужно реализацию, а не инвариант.

## Product и ProductVariant

- `Product` - карточка товара: название, описание, SEO, изображения, категории, статус витрины.
- `ProductVariant` - продаваемая единица: цена, остаток, SKU, признаки вариации, единицы продажи.
- У каждого не удаленного товара должна быть хотя бы одна не удаленная вариация.
- Simple-товар использует hidden default variant.
- Matrix-товар использует пользовательские вариации и требует выбор вариации при покупке.
- Hidden default variant не должен отображаться как обычная вариация.

## Цена

- `ProductVariant.price` - основной источник коммерческой цены.
- `Product.price` - legacy/display mirror, а не источник истины для корзины и заказа.
- `price = null` значит цена неизвестна.
- `price = 0` значит цена известна и равна нулю.
- Карточка товара без цены не показывает поле цены.
- Корзина для товара с неизвестной ценой показывает `?`.
- Товар с вариациями показывает цену из sellable projection: выбранная вариация, первая доступная вариация или диапазон.

## Остаток

- `stock = null` значит остаток не отслеживается, товар можно добавлять без лимита.
- `stock = 0` значит товара нет в наличии.
- `stock > 0` значит доступен конечный остаток.
- `InventoryMode.INTERNAL` делает внутренний склад источником истины.
- External stock sync не должен перезаписывать internal inventory balances.

## Cart и Order

- Cart добавляет sellable item, а не абстрактный product.
- Simple product без `variantId` выбирает hidden default variant.
- Matrix product без `variantId` возвращает ошибку выбора вариации.
- Cart pricing использует `ProductSellableReader`.
- Checkout сохраняет snapshot: productId, variantId, название, variant label, цену, quantity, sale unit и external links.
- Order не должен пересчитывать историческую цену по текущему состоянию product.

## Capability

- Capability управляет доступом, UI и публичной выдачей API.
- Capability не удаляет данные.
- При выключенной beta-функции связанные данные не должны утекать наружу в storefront/admin DTO.
- При повторном включении capability существующие данные должны быть восстановимы.

## Integration

- Интеграция пишет product/inventory state через публичные ports.
- Full sync и webhook delta должны использовать общий apply path для остатков.
- Неполный external snapshot не должен скрывать или удалять товары.
- Любой skipped sync должен иметь диагностируемую причину.
- Для external fields нужна ownership policy: `external`, `manual` или `internal`.

## Domain Events

- Побочные эффекты должны уходить в event handlers: cache invalidation, SEO sync, diagnostics, analytics.
- Event handlers должны быть идемпотентными по `eventId`.
- Повторная доставка события не должна менять результат или ломать данные.
