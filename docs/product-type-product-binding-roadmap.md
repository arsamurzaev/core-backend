---
title: 'Backend roadmap: ProductType -> Product binding'
aliases:
 - ProductType Product Binding Roadmap
tags:
 - catalog/backend
 - catalog/product-type
 - product-variants
 - roadmap
created: 2026-05-11
source: 'docs/product-variants-inventory-integrations-checklist.md'
---

# Backend roadmap: ProductType -> Product binding

## Current state

- `ProductType` and `ProductTypeAttribute` are present in Prisma schema.
- Product type API exists for catalog-scoped types, system templates, copying from template, update and archive.
- `ProductTypeAttribute` already stores `isVariant`, `isRequired` and `displayOrder`.
- Product create/update DTOs accept nullable `productTypeId`; `null` means the product is not bound to a product type yet.
- Product list/detail responses return a `productType` summary when the product is bound.
- Product type ownership is checked on create/update: same catalog, active and not archived.
- Typed product attributes and variant attributes are validated through `ProductTypeAttribute`; products without `productTypeId` keep the legacy catalog `typeId` fallback.
- Product update keeps a strict default policy: direct `productTypeId` changes are blocked while the product has existing product attributes or variant attributes.
- Product type compatibility preview is available as `POST /product/:id/product-type/compatibility-preview`; it does not write data and reports strict-policy and schema conflicts for the UI.
- Confirmed product type change is available as `POST /product/:id/product-type/apply`; it writes only after explicit `confirm: true`, optional stale-check through `expectedCurrentProductTypeId`, explicit attribute removals and full variant matrix when variant conflicts exist.
- Infinite product reads support `productTypeId` filter for catalog/admin product lists.
- ProductType-filtered reads are covered by tests for current-catalog SQL boundary and current-catalog hydration.
- ProductType list/template `includeArchived` query parsing accepts common boolean strings and rejects invalid values with `BadRequestException`.
- Catalog-scoped product type create/update/archive invalidates product, category-product and catalog type schema cache versions.
- Edge tests cover archived/unavailable product type, duplicate ProductType variant combinations and incompatible product/variant attributes.
- Matrix schema endpoint already exists and should be used by admin UI before opening the matrix editor for a selected product type.
- Matrix schema enum values include dictionary metadata: `businessId`, `source`, `mergedIntoId`, `isArchived=false`, and active `aliases`.

## Frontend/backend contract

- Product create/update payload may include `productTypeId: string | null`.
- Product list/detail responses expose `productType` as a lightweight summary for rendering selected type state without an extra request.
- Product editor must select `productTypeId` before attribute inputs and variant matrix are enabled.
- After product type selection, frontend loads the matrix schema endpoint for that product type and builds product attributes, variant attributes and enum options from that schema.
- Frontend must block incompatible product attributes and variant combinations client-side according to the loaded schema, while backend remains the source of truth through ProductType-scoped validation.
- Changing `productTypeId` on an existing product is a guarded action: if existing attributes or variants are incompatible, frontend should require an explicit user decision before sending the update.
- Before rendering that decision, frontend should call `POST /product/:id/product-type/compatibility-preview` with `productTypeId: string | null` and display `productAttributeConflicts`, `variantAttributeConflicts`, `canChangeNow`, and `blockingReason`.
- To apply the decision, frontend calls `POST /product/:id/product-type/apply` with `confirm: true`, the target `productTypeId`, optional `expectedCurrentProductTypeId`, `removeAttributeIds` for confirmed product attribute drops, and `items` when the variant matrix must be replaced.
- Direct product update remains strict by default: do not silently drop or remap existing attributes/variants on product type change.

## Next backend slice

1. Matrix apply endpoint for replacing the full product variant matrix is implemented as `POST /product/:id/variant-matrix`.
2. ProductType cache invalidation is implemented for catalog-scoped create/update/archive mutations.
3. Compatibility preview endpoint for changing `productTypeId` without writing data is implemented.
4. Matrix schema enum metadata for dictionary UX is implemented.
5. Explicit product type apply endpoint is implemented as `POST /product/:id/product-type/apply`.
6. Decide whether public product detail should expose full product type metadata or only admin responses.

## Compatibility preview acceptance

- Endpoint is `POST /product/:id/product-type/compatibility-preview`.
- Request body is `{ "productTypeId": string | null }`; `null` previews clearing the product type.
- Endpoint never calls product update and never mutates product attributes or variants.
- Response separates `productAttributeConflicts` and `variantAttributeConflicts`.
- Response reports `canChangeNow=false` and `blockingReason=STRICT_POLICY_BLOCK` when the current strict policy would block the update.
- Clean products can preview a new product type with `canChangeNow=true` and no conflicts.

## Matrix apply acceptance

- Endpoint replaces the full variant matrix for one product in a single operation.
- Request accepts an `items` array; each item contains `attributes[]` in the same shape as `ProductVariantDtoReq`.
- Typed products validate matrix items against the selected `ProductType` schema.
- Backend rejects duplicate variant attribute combinations in the payload and in the resulting matrix.
- Products without `productTypeId` continue to use the legacy catalog `typeId` fallback.
- Validation or database errors must not partially change product variants; the operation is atomic.
- Existing `setVariants` stays as a legacy/simple endpoint for the current single `variantAttributeId` scenario.

## ProductType apply acceptance

- Endpoint is `POST /product/:id/product-type/apply`.
- Request requires `confirm: true`; missing or false confirm is rejected before writing.
- Request accepts `productTypeId: string | null`; `null` explicitly clears the product type.
- Request may include `expectedCurrentProductTypeId` to reject stale UI decisions when another admin changed the product after preview.
- Product attribute conflicts require explicit `removeAttributeIds`; compatible attributes may be updated through `attributes`.
- Variant attribute conflicts require a full replacement `items` matrix; partial variant remap is not inferred.
- Validation, conflict or database errors must not partially change product type, product attributes or variants; the operation is atomic.
- Cache invalidation follows normal product update rules and bumps catalog type cache when custom enum values are introduced.

## ProductType filter acceptance

- Filtered product reads return only products from the current catalog.
- When `productTypeId` filter is provided, products with `productTypeId = null` are excluded.
- Legacy products without `productTypeId` continue to be readable when the filter is omitted.
- Invalid or cross-catalog `productTypeId` must not leak whether products exist outside the current catalog.

## Open decisions

- `productTypeId` is nullable for the first release; do not create a default product type for every existing product/catalog.
- Direct update stays strict; explicit apply is available for confirmed removals and full matrix replacement. Fine-grained per-variant remap remains a future enhancement.
- Should public product detail expose full product type metadata or only admin responses?
