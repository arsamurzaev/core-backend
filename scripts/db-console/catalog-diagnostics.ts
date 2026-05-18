/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { colors, printJson, table } from './format.js'
import { exportRows } from './storage.js'
import type { AppContext } from './types.js'

export type CatalogLookup = {
	id?: string
	slug?: string
	query?: string
}

export type CatalogDiagnosticRow = {
	check: string
	status: 'ok' | 'warn' | 'fail'
	count: number | string
	details?: string
}

export async function resolveCatalog(ctx: AppContext, lookup: CatalogLookup) {
	const where = lookup.id
		? { id: lookup.id }
		: lookup.slug
			? { slug: lookup.slug }
			: lookup.query
				? {
						OR: [
							{ id: lookup.query },
							{ slug: { contains: lookup.query, mode: 'insensitive' } },
							{ name: { contains: lookup.query, mode: 'insensitive' } },
							{ domain: { contains: lookup.query, mode: 'insensitive' } }
						]
					}
				: {}

	const catalog = await (ctx.prisma as any).catalog.findFirst({
		where,
		orderBy: { updatedAt: 'desc' },
		select: {
			id: true,
			name: true,
			slug: true,
			domain: true,
			deleteAt: true,
			createdAt: true,
			updatedAt: true
		}
	})

	if (!catalog) throw new Error('Catalog not found')
	return catalog as {
		id: string
		name: string
		slug: string
		domain?: string | null
		deleteAt?: Date | null
	}
}

export async function runCatalogDiagnostics(
	ctx: AppContext,
	lookup: CatalogLookup,
	options: { json?: boolean; exportFormat?: 'json' | 'csv' } = {}
) {
	const catalog = await resolveCatalog(ctx, lookup)
	const rows = await collectCatalogDiagnostics(ctx, catalog.id)

	console.log(colors.cyan(colors.bold(`${catalog.name} / ${catalog.slug}`)))

	if (options.json || ctx.options.json) {
		printJson({ catalog, diagnostics: rows })
	} else {
		table(rows, undefined, rows.length)
	}

	if (options.exportFormat) {
		const filePath = await exportRows(
			ctx,
			{ name: `CatalogDiagnostics_${catalog.slug}` },
			rows as unknown as Record<string, unknown>[],
			options.exportFormat
		)
		console.log(colors.green(`Export: ${filePath}`))
	}

	return { catalog, rows }
}

export async function collectCatalogDiagnostics(
	ctx: AppContext,
	catalogId: string
) {
	const [
		products,
		deletedProducts,
		productsWithoutMedia,
		productsWithoutCategory,
		draftProducts,
		categories,
		deletedCategories,
		categoriesWithoutProducts,
		failedDomains,
		integrationErrors,
		ordersWithDeletedProducts,
		seoMissingProducts,
		seoMissingCategories,
		productPositionGaps,
		categoryPositionGaps,
		simpleProductsWithoutDefaultVariant,
		productsWithMultipleDefaultVariants,
		matrixProductsWithoutActiveVariants,
		defaultVariantPriceMismatches,
		internalCartItemsWithoutVariant,
		internalOrderItemsWithoutVariant,
		orphanIntegrationProductLinks,
		orphanIntegrationVariantLinks,
		integrationVariantLinksToDisabledVariants,
		integrationProductLinksMissingFromSnapshot,
		integrationVariantLinksMissingFromSnapshot,
		integratedSimpleProductsWithoutDefaultVariant,
		integratedProductsWithVariantLinksButNoCustomVariants
	] = await Promise.all([
		(ctx.prisma as any).product.count({
			where: { catalogId, deleteAt: null }
		}),
		(ctx.prisma as any).product.count({
			where: { catalogId, deleteAt: { not: null } }
		}),
		(ctx.prisma as any).product.count({
			where: { catalogId, deleteAt: null, media: { none: {} } }
		}),
		(ctx.prisma as any).product.count({
			where: { catalogId, deleteAt: null, categoryProducts: { none: {} } }
		}),
		(ctx.prisma as any).product.count({
			where: { catalogId, deleteAt: null, status: 'DRAFT' }
		}),
		(ctx.prisma as any).category.count({
			where: { catalogId, deleteAt: null }
		}),
		(ctx.prisma as any).category.count({
			where: { catalogId, deleteAt: { not: null } }
		}),
		(ctx.prisma as any).category.count({
			where: { catalogId, deleteAt: null, categoryProducts: { none: {} } }
		}),
		(ctx.prisma as any).catalogDomain.count({
			where: { catalogId, status: { in: ['FAILED', 'DISABLED'] } }
		}),
		(ctx.prisma as any).integration.count({
			where: {
				catalogId,
				OR: [{ lastSyncStatus: 'ERROR' }, { lastSyncError: { not: null } }]
			}
		}),
		countOrdersWithDeletedProducts(ctx, catalogId),
		countProductsWithoutSeo(ctx, catalogId),
		countCategoriesWithoutSeo(ctx, catalogId),
		countProductPositionGaps(ctx, catalogId),
		countCategoryPositionGaps(ctx, catalogId),
		countSimpleProductsWithoutDefaultVariant(ctx, catalogId),
		countProductsWithMultipleDefaultVariants(ctx, catalogId),
		countMatrixProductsWithoutActiveVariants(ctx, catalogId),
		countDefaultVariantPriceMismatches(ctx, catalogId),
		countInternalCartItemsWithoutVariant(ctx, catalogId),
		countInternalOrderItemsWithoutVariant(ctx, catalogId),
		countOrphanIntegrationProductLinks(ctx, catalogId),
		countOrphanIntegrationVariantLinks(ctx, catalogId),
		countIntegrationVariantLinksToDisabledVariants(ctx, catalogId),
		countIntegrationProductLinksMissingFromSnapshot(ctx, catalogId),
		countIntegrationVariantLinksMissingFromSnapshot(ctx, catalogId),
		countIntegratedSimpleProductsWithoutDefaultVariant(ctx, catalogId),
		countIntegratedProductsWithVariantLinksButNoCustomVariants(ctx, catalogId)
	])

	return [
		info('active products', toCount(products)),
		warn('deleted products', toCount(deletedProducts)),
		warn('products without media', toCount(productsWithoutMedia)),
		warn('products without category', toCount(productsWithoutCategory)),
		warn('draft products', toCount(draftProducts)),
		info('active categories', toCount(categories)),
		warn('deleted categories', toCount(deletedCategories)),
		warn('categories without products', toCount(categoriesWithoutProducts)),
		fail('failed/disabled domains', toCount(failedDomains)),
		fail('integration errors', toCount(integrationErrors)),
		warn(
			'orders containing deleted products',
			toCount(ordersWithDeletedProducts)
		),
		warn('products without SEO', seoMissingProducts),
		warn('categories without SEO', seoMissingCategories),
		warn('category-product position gaps', productPositionGaps),
		warn('category position gaps', categoryPositionGaps),
		warn(
			'simple products without default variant',
			simpleProductsWithoutDefaultVariant
		),
		fail(
			'products with multiple default variants',
			productsWithMultipleDefaultVariants
		),
		warn(
			'matrix products without active matrix variants',
			matrixProductsWithoutActiveVariants
		),
		warn('product/default variant price mismatch', defaultVariantPriceMismatches),
		fail(
			'internal inventory cart items without variant',
			internalCartItemsWithoutVariant
		),
		fail(
			'internal inventory order items without variant',
			internalOrderItemsWithoutVariant
		),
		fail('orphan integration product links', orphanIntegrationProductLinks),
		fail('orphan integration variant links', orphanIntegrationVariantLinks),
		warn(
			'integration variant links to disabled variants',
			integrationVariantLinksToDisabledVariants
		),
		warn(
			'integration product links missing from latest snapshots',
			integrationProductLinksMissingFromSnapshot
		),
		warn(
			'integration variant links missing from latest snapshots',
			integrationVariantLinksMissingFromSnapshot
		),
		warn(
			'integrated simple products without default variant',
			integratedSimpleProductsWithoutDefaultVariant
		),
		warn(
			'integrated products with variant links but no custom variants',
			integratedProductsWithVariantLinksButNoCustomVariants
		)
	] satisfies CatalogDiagnosticRow[]
}

function info(check: string, count: number): CatalogDiagnosticRow {
	return { check, status: 'ok', count }
}

function warn(check: string, count: number): CatalogDiagnosticRow {
	return { check, status: count > 0 ? 'warn' : 'ok', count }
}

function fail(check: string, count: number): CatalogDiagnosticRow {
	return { check, status: count > 0 ? 'fail' : 'ok', count }
}

async function countProductsWithoutSeo(ctx: AppContext, catalogId: string) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from products p
		left join seo_settings s
			on s.catalog_id = p.catalog_id
			and s.entity_type = 'PRODUCT'
			and s.entity_id = p.id::text
			and s.delete_at is null
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and s.id is null
	`)
	return rows[0]?.count ?? 0
}

async function countCategoriesWithoutSeo(ctx: AppContext, catalogId: string) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from categories c
		left join seo_settings s
			on s.catalog_id = c.catalog_id
			and s.entity_type = 'CATEGORY'
			and s.entity_id = c.id::text
			and s.delete_at is null
		where c.catalog_id = '${catalogId}'::uuid
			and c.delete_at is null
			and s.id is null
	`)
	return rows[0]?.count ?? 0
}

async function countOrdersWithDeletedProducts(
	ctx: AppContext,
	catalogId: string
) {
	const orders = (await (ctx.prisma as any).order.findMany({
		where: { catalogId, deleteAt: null },
		select: { products: true },
		take: 1000
	})) as { products: unknown }[]
	const productIds = new Set<string>()

	for (const order of orders) {
		collectProductIds(order.products, productIds)
	}

	if (!productIds.size) return 0

	const deleted = await (ctx.prisma as any).product.count({
		where: {
			id: { in: [...productIds] },
			deleteAt: { not: null }
		}
	})

	return Number(deleted)
}

function toCount(value: unknown) {
	return Number(value)
}

async function countProductPositionGaps(ctx: AppContext, catalogId: string) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		with ranked as (
			select category_id, product_id, position,
				row_number() over (partition by category_id order by position, product_id) - 1 as expected
			from category_products cp
			join categories c on c.id = cp.category_id
			where c.catalog_id = '${catalogId}'::uuid
		)
		select count(*)::int as count from ranked where position <> expected
	`)
	return rows[0]?.count ?? 0
}

async function countCategoryPositionGaps(ctx: AppContext, catalogId: string) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		with ranked as (
			select id, position,
				row_number() over (order by position, created_at, id) - 1 as expected
			from categories
			where catalog_id = '${catalogId}'::uuid and delete_at is null
		)
		select count(*)::int as count from ranked where position <> expected
	`)
	return rows[0]?.count ?? 0
}

async function countSimpleProductsWithoutDefaultVariant(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from products p
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and not exists (
				select 1
				from product_variants custom_variant
				where custom_variant.product_id = p.id
					and custom_variant.delete_at is null
					and not (custom_variant.kind::text = 'DEFAULT' or custom_variant.variant_key = 'default')
			)
			and not exists (
				select 1
				from product_variants default_variant
				where default_variant.product_id = p.id
					and default_variant.delete_at is null
					and (default_variant.kind::text = 'DEFAULT' or default_variant.variant_key = 'default')
			)
	`)
	return rows[0]?.count ?? 0
}

async function countProductsWithMultipleDefaultVariants(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		with grouped as (
			select p.id
			from products p
			join product_variants v on v.product_id = p.id
			where p.catalog_id = '${catalogId}'::uuid
				and p.delete_at is null
				and v.delete_at is null
				and (v.kind::text = 'DEFAULT' or v.variant_key = 'default')
			group by p.id
			having count(*) > 1
		)
		select count(*)::int as count from grouped
	`)
	return rows[0]?.count ?? 0
}

async function countMatrixProductsWithoutActiveVariants(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from products p
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and exists (
				select 1
				from product_variants custom_variant
				where custom_variant.product_id = p.id
					and custom_variant.delete_at is null
					and not (custom_variant.kind::text = 'DEFAULT' or custom_variant.variant_key = 'default')
			)
			and not exists (
				select 1
				from product_variants active_variant
				where active_variant.product_id = p.id
					and active_variant.delete_at is null
					and not (active_variant.kind::text = 'DEFAULT' or active_variant.variant_key = 'default')
					and active_variant.status::text = 'ACTIVE'
					and active_variant.is_available = true
			)
	`)
	return rows[0]?.count ?? 0
}

async function countDefaultVariantPriceMismatches(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from products p
		join product_variants v on v.product_id = p.id
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and v.delete_at is null
			and (v.kind::text = 'DEFAULT' or v.variant_key = 'default')
			and p.price is distinct from v.price
	`)
	return rows[0]?.count ?? 0
}

async function countInternalCartItemsWithoutVariant(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from cart_items item
		join carts cart on cart.id = item.cart_id
		join catalog_settings settings on settings.catalog_id = cart.catalog_id
		where cart.catalog_id = '${catalogId}'::uuid
			and cart.delete_at is null
			and item.delete_at is null
			and settings.inventory_mode::text = 'INTERNAL'
			and cart.status::text not in ('CONVERTED', 'CANCELLED', 'EXPIRED')
			and item.variant_id is null
	`)
	return rows[0]?.count ?? 0
}

async function countInternalOrderItemsWithoutVariant(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from orders o
		join catalog_settings settings on settings.catalog_id = o.catalog_id
		cross join lateral jsonb_array_elements(o.products::jsonb) as item(value)
		where o.catalog_id = '${catalogId}'::uuid
			and o.delete_at is null
			and settings.inventory_mode::text = 'INTERNAL'
			and nullif(item.value ->> 'variantId', '') is null
	`)
	return rows[0]?.count ?? 0
}

async function countOrphanIntegrationProductLinks(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from integration_product_links link
		join integrations integration on integration.id = link.integration_id
		left join products product
			on product.id = link.product_id
			and product.catalog_id = integration.catalog_id
			and product.delete_at is null
		where integration.catalog_id = '${catalogId}'::uuid
			and integration.delete_at is null
			and product.id is null
	`)
	return rows[0]?.count ?? 0
}

async function countOrphanIntegrationVariantLinks(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from integration_variant_links link
		join integrations integration on integration.id = link.integration_id
		left join product_variants variant
			on variant.id = link.variant_id
			and variant.delete_at is null
		left join products product
			on product.id = variant.product_id
			and product.catalog_id = integration.catalog_id
			and product.delete_at is null
		where integration.catalog_id = '${catalogId}'::uuid
			and integration.delete_at is null
			and product.id is null
	`)
	return rows[0]?.count ?? 0
}

async function countIntegrationVariantLinksToDisabledVariants(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from integration_variant_links link
		join integrations integration on integration.id = link.integration_id
		join product_variants variant on variant.id = link.variant_id
		join products product on product.id = variant.product_id
		where integration.catalog_id = '${catalogId}'::uuid
			and integration.delete_at is null
			and product.catalog_id = integration.catalog_id
			and product.delete_at is null
			and variant.delete_at is null
			and variant.status::text = 'DISABLED'
	`)
	return rows[0]?.count ?? 0
}

async function countIntegrationProductLinksMissingFromSnapshot(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from integration_product_links link
		join integrations integration on integration.id = link.integration_id
		join products product
			on product.id = link.product_id
			and product.catalog_id = integration.catalog_id
			and product.delete_at is null
		where integration.catalog_id = '${catalogId}'::uuid
			and integration.delete_at is null
			and link.missing_since is not null
	`)
	return rows[0]?.count ?? 0
}

async function countIntegrationVariantLinksMissingFromSnapshot(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from integration_variant_links link
		join integrations integration on integration.id = link.integration_id
		join product_variants variant
			on variant.id = link.variant_id
		join products product
			on product.id = variant.product_id
			and product.catalog_id = integration.catalog_id
		where integration.catalog_id = '${catalogId}'::uuid
			and integration.delete_at is null
			and product.delete_at is null
			and link.missing_since is not null
	`)
	return rows[0]?.count ?? 0
}

async function countIntegratedSimpleProductsWithoutDefaultVariant(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(*)::int as count
		from integration_product_links link
		join integrations integration on integration.id = link.integration_id
		join products product
			on product.id = link.product_id
			and product.catalog_id = integration.catalog_id
			and product.delete_at is null
		where integration.catalog_id = '${catalogId}'::uuid
			and integration.delete_at is null
			and not exists (
				select 1
				from product_variants custom_variant
				where custom_variant.product_id = product.id
					and custom_variant.delete_at is null
					and not (custom_variant.kind::text = 'DEFAULT' or custom_variant.variant_key = 'default')
			)
			and not exists (
				select 1
				from product_variants default_variant
				where default_variant.product_id = product.id
					and default_variant.delete_at is null
					and (default_variant.kind::text = 'DEFAULT' or default_variant.variant_key = 'default')
			)
	`)
	return rows[0]?.count ?? 0
}

async function countIntegratedProductsWithVariantLinksButNoCustomVariants(
	ctx: AppContext,
	catalogId: string
) {
	const rows = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(`
		select count(distinct product.id)::int as count
		from integration_product_links product_link
		join integrations integration on integration.id = product_link.integration_id
		join products product
			on product.id = product_link.product_id
			and product.catalog_id = integration.catalog_id
			and product.delete_at is null
		where integration.catalog_id = '${catalogId}'::uuid
			and integration.delete_at is null
			and exists (
				select 1
				from integration_variant_links variant_link
				join product_variants linked_variant
					on linked_variant.id = variant_link.variant_id
				where variant_link.integration_id = product_link.integration_id
					and linked_variant.product_id = product.id
			)
			and not exists (
				select 1
				from product_variants custom_variant
				where custom_variant.product_id = product.id
					and custom_variant.delete_at is null
					and not (custom_variant.kind::text = 'DEFAULT' or custom_variant.variant_key = 'default')
			)
	`)
	return rows[0]?.count ?? 0
}

function collectProductIds(value: unknown, target: Set<string>) {
	if (!value) return
	if (Array.isArray(value)) {
		value.forEach(item => collectProductIds(item, target))
		return
	}
	if (typeof value !== 'object') return

	const record = value as Record<string, unknown>
	for (const key of ['id', 'productId', 'product_id']) {
		if (typeof record[key] === 'string') target.add(record[key])
	}
	Object.values(record).forEach(item => collectProductIds(item, target))
}
