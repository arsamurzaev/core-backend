# Product Variants Migration Recovery

Scope: product variants, cart `variantId`, integration variant links, order export records, and inventory tables added for the product variants / inventory / integrations rollout.

## Required Before Apply

- Take a database backup with a restore drill target, and record the backup id in the deploy ticket.
- Record the backend git SHA, Prisma schema SHA, and generated client version used for the deploy.
- Run the default variant audit in dry-run mode:

```bash
bun run db:audit-default-variants -- --json
```

- Keep provider workers paused until schema apply and smoke tests pass when the deploy changes integration or inventory tables.
- Keep MoySklad `exportOrders` disabled by default for existing and newly created integrations unless the owner explicitly enables it and provides organization, counterparty, and store ids. The backend enforces this through `buildMoySkladMetadata`, where missing `exportOrders` is normalized to `false`.

## Rollback Strategy

- Prefer forward-compatible rollback: deploy the previous backend while leaving additive columns/tables in place. New tables are ignored by older code, and nullable `CartItem.variantId` remains compatible with legacy cart snapshots.
- Do not drop new columns/tables during an incident unless a restored backup is ready. Prisma migrations do not keep down migrations, so destructive rollback is a restore operation, not an ad-hoc schema edit.
- Pause MoySklad sync/export queues before rollback if the incident touches mapping, stock, or order export data.
- If default variant or cart item backfill caused bad data, restore from the pre-apply backup. For limited issues, use the backup as the source of truth and repair only affected rows, then rerun the audit in dry-run mode.
- If inventory balances are wrong after a migration, do not edit `InventoryMovement` rows in place. Add compensating movements or restore from backup if movement history itself is corrupt.
- If order export rows are wrong, keep local `Order` rows intact. Mark failed exports `ERROR`/`SKIPPED` or delete only duplicate pending export rows after queues are paused and idempotency keys are checked.

## Recovery Steps

1. Stop sync/export workers and application writes that touch the affected feature.
2. Restore the pre-apply backup to a staging database and compare affected row counts:

```sql
select count(*) from product_variants;
select count(*)
from cart_items ci
join carts c on c.id = ci.cart_id
where ci.variant_id is null
  and ci.delete_at is null
  and c.delete_at is null
  and c.status in ('DRAFT', 'SHARED', 'IN_PROGRESS', 'PAUSED');
select count(*) from integration_variant_links;
select count(*) from integration_order_exports;
select count(*) from inventory_stock_balances;
select count(*) from inventory_reservations;
select count(*) from inventory_movements;

select count(*)
from cart_items ci
join carts c on c.id = ci.cart_id
join product_variants pv on pv.id = ci.variant_id
where ci.delete_at is null
  and c.delete_at is null
  and c.status in ('DRAFT', 'SHARED', 'IN_PROGRESS', 'PAUSED')
  and pv.delete_at is null
  and pv.product_id <> ci.product_id;
```

3. Choose either full restore or targeted repair from the backup snapshot.
4. Apply the fixed schema/code.
5. Run dry-run audit, then apply only when the report has no blocking anomalies. `productsWithoutVariants` and open cart items without `variantId` are expected before backfill; duplicate variant keys, mismatched cart item variants, negative stock, and invalid variant prices must be fixed first because the script blocks apply on them.

```bash
bun run db:audit-default-variants -- --json
bun run db:audit-default-variants -- --apply --apply-cart-items --json
```

6. Run cart, product, and MoySklad preview regression tests.
7. Resume queues and verify integration sync/export/inventory dashboards.
