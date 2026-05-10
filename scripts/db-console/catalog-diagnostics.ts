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
		categoryPositionGaps
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
		countCategoryPositionGaps(ctx, catalogId)
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
		warn('category position gaps', categoryPositionGaps)
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
