import Redis from 'ioredis'

import { Prisma, ProductStatus } from '../../prisma/generated/client.js'

import { colors, printJson, table } from './format.js'
import { askText, choose, pause } from './prompt.js'
import { assertCanMutate, runAudited } from './safety.js'
import { writeBackup } from './storage.js'
import type { AppContext, ModelMeta } from './types.js'

type CustomScript = {
	id: string
	name: string
	description: string
	run: (ctx: AppContext, models: ModelMeta[]) => Promise<void>
}

const ZERO_PRICE = new Prisma.Decimal(0)
const PRODUCT_VARIANT_KIND_DEFAULT = 'DEFAULT'
const PRODUCT_VARIANT_KIND_MATRIX = 'MATRIX'
const uuidRegex =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CATALOG_CACHE_SCOPES_TO_BUMP = [
	'products-v5',
	'category-products-v5',
	'categories-v2'
] as const

const CUSTOM_SCRIPTS: CustomScript[] = [
	{
		id: 'nullify-zero-prices',
		name: 'Nullify zero product prices',
		description:
			'Set Product.price = NULL where price = 0. Can also include ProductVariant.price.',
		run: runNullifyZeroPrices
	},
	{
		id: 'backfill-product-variant-kind',
		name: 'Backfill product variant kind',
		description:
			'Set ProductVariant.kind from legacy variantKey: default => DEFAULT, all others => MATRIX.',
		run: runBackfillProductVariantKind
	},
	{
		id: 'inspect-product-variant',
		name: 'Inspect product variant',
		description:
			'Show a product with catalog and selected variants by productId or variantId.',
		run: runInspectProductVariant
	},
	{
		id: 'moysklad-catalog-visibility',
		name: 'MoySklad catalog visibility',
		description:
			'Explain visible/hidden MoySklad products for a catalog, including stock/status samples.',
		run: runMoySkladCatalogVisibility
	},
	{
		id: 'moysklad-restore-zero-stock-visibility',
		name: 'Restore MoySklad zero-stock visibility',
		description:
			'Set zero-stock MoySklad-linked products back to ACTIVE after the old stock hiding behavior.',
		run: runMoySkladRestoreZeroStockVisibility
	},
	{
		id: 'moysklad-hide-zero-stock-visibility',
		name: 'Hide MoySklad zero-stock visibility',
		description:
			'Set zero-stock MoySklad-linked products to HIDDEN for storefront visibility.',
		run: runMoySkladHideZeroStockVisibility
	},
	{
		id: 'bump-catalog-cache',
		name: 'Bump catalog cache versions',
		description:
			'Increment Redis cache versions for catalog products, category products, and category list.',
		run: runBumpCatalogCache
	}
]

type ZeroPriceSummary = {
	productCount: number
	productSamples: Record<string, unknown>[]
	variantCount: number
	variantSamples: Record<string, unknown>[]
}

type VariantKindBackfillSummary = {
	defaultToFix: number
	matrixToFix: number
	samples: Record<string, unknown>[]
}

type ProductVariantInspectionRow = {
	id: string
	productId: string
	sku: string
	variantKey: string
	kind: string
	price: unknown
	stock: number | null
	status: string
	isAvailable: boolean
	deleteAt: Date | null
	updatedAt: Date
	product: {
		id: string
		catalogId: string
		name: string
		sku: string
		price: unknown
		status: string
		deleteAt: Date | null
		updatedAt: Date
		catalog: {
			id: string
			name: string
			slug: string
			domain: string | null
		}
	}
}

type MoySkladVisibilitySummaryRow = {
	check: string
	count: number
	details: string | null
}

type MoySkladVisibilitySampleRow = {
	id: string
	name: string
	sku: string
	status: string
	externalId: string | null
	externalCode: string | null
	rawStock: string | null
	archived: string | null
	totalStock: number
	variants: number
	activeVariants: number
	skippedReason: string | null
	lastStockSyncAt: Date | null
	updatedAt: Date
}

type MoySkladStatusCountRow = {
	status: string
	count: number
}

type MoySkladVariantStatusCountRow = {
	status: string
	isAvailable: boolean
	count: number
}

type MoySkladSyncRunRow = {
	id: string
	mode: string
	trigger: string
	status: string
	snapshotCompleteness: string
	totalProducts: number
	createdProducts: number
	updatedProducts: number
	deletedProducts: number
	error: string | null
	startedAt: Date | null
	finishedAt: Date | null
}

type MoySkladCategoryCoverageSummaryRow = {
	check: string
	count: number
	details: string | null
}

type MoySkladCategoryCoverageRow = {
	id: string
	name: string
	parentName: string | null
	productLinks: number
	activeProducts: number
	moySkladProducts: number
	activeMoySkladProducts: number
}

type MoySkladUncategorizedProductRow = {
	id: string
	name: string
	sku: string
	status: string
	externalId: string | null
	totalStock: number
	activeVariants: number
	updatedAt: Date
}

type MoySkladAvailabilitySummaryRow = {
	check: string
	count: number
	details: string | null
}

type MoySkladRestoreVisibilityCandidateRow = {
	id: string
	name: string
	sku: string
	status: string
	externalId: string | null
	externalCode: string | null
	rawStock: string | null
	archived: string | null
	totalStock: number
	variants: number
	activeVariants: number
	skippedReason: string | null
	updatedAt: Date
}

const productVariantInspectionSelect = {
	id: true,
	productId: true,
	sku: true,
	variantKey: true,
	kind: true,
	price: true,
	stock: true,
	status: true,
	isAvailable: true,
	deleteAt: true,
	updatedAt: true
} as const

export async function runCustomScriptsMenu(
	ctx: AppContext,
	models: ModelMeta[]
) {
	while (true) {
		const action = await choose<string>('Scripts', [
			...CUSTOM_SCRIPTS.map(script => ({
				name: script.name,
				value: script.id,
				description: script.description
			})),
			{ name: 'Back', value: 'back' }
		])

		if (action === 'back') return

		const script = CUSTOM_SCRIPTS.find(item => item.id === action)
		if (!script) continue

		await script.run(ctx, models)
	}
}

async function runBackfillProductVariantKind(
	ctx: AppContext,
	models: ModelMeta[]
) {
	const summary = await loadVariantKindBackfillSummary(ctx)
	printVariantKindBackfillSummary(summary, ctx.options.limit)

	const total = summary.defaultToFix + summary.matrixToFix
	if (!total) {
		await pause()
		return
	}

	assertCanMutate(ctx, 'custom script: backfill product variant kind')
	const confirmation = `backfill ${total} product variant kinds`
	const typed = await askText(`Type "${confirmation}" to apply`, {
		required: true
	})
	if (typed !== confirmation) {
		console.log(colors.yellow('Cancelled'))
		return
	}

	const variantModel = findModel(models, 'ProductVariant')
	const rows = await ctx.prisma.productVariant.findMany({
		where: {
			OR: [
				{ variantKey: 'default', kind: { not: PRODUCT_VARIANT_KIND_DEFAULT } },
				{
					variantKey: { not: 'default' },
					kind: { not: PRODUCT_VARIANT_KIND_MATRIX }
				}
			]
		},
		select: {
			id: true,
			productId: true,
			sku: true,
			variantKey: true,
			kind: true,
			updatedAt: true
		}
	})
	const backupPath = rows.length
		? await writeBackup(
				ctx,
				variantModel,
				'custom-backfill-product-variant-kind',
				rows,
				{
					defaultToFix: summary.defaultToFix,
					matrixToFix: summary.matrixToFix
				}
			)
		: undefined

	const result = await runAudited(
		ctx,
		{
			action: 'custom:backfillProductVariantKind',
			data: {
				backupPath,
				defaultToFix: summary.defaultToFix,
				matrixToFix: summary.matrixToFix
			},
			affectedCount: total
		},
		async () =>
			await ctx.prisma.$transaction(async tx => {
				const defaults = await tx.productVariant.updateMany({
					where: {
						variantKey: 'default',
						kind: { not: PRODUCT_VARIANT_KIND_DEFAULT }
					},
					data: { kind: PRODUCT_VARIANT_KIND_DEFAULT }
				})
				const matrix = await tx.productVariant.updateMany({
					where: {
						variantKey: { not: 'default' },
						kind: { not: PRODUCT_VARIANT_KIND_MATRIX }
					},
					data: { kind: PRODUCT_VARIANT_KIND_MATRIX }
				})

				return { defaults, matrix }
			})
	)

	console.log(colors.green(`Updated default variants: ${result.defaults.count}`))
	console.log(colors.green(`Updated matrix variants: ${result.matrix.count}`))
	await pause()
}

async function loadVariantKindBackfillSummary(
	ctx: AppContext
): Promise<VariantKindBackfillSummary> {
	const sampleLimit = Math.max(0, ctx.options.limit)
	const [defaultToFix, matrixToFix, samples] = await Promise.all([
		ctx.prisma.productVariant.count({
			where: {
				variantKey: 'default',
				kind: { not: PRODUCT_VARIANT_KIND_DEFAULT }
			}
		}),
		ctx.prisma.productVariant.count({
			where: {
				variantKey: { not: 'default' },
				kind: { not: PRODUCT_VARIANT_KIND_MATRIX }
			}
		}),
		sampleLimit
			? ctx.prisma.productVariant.findMany({
					where: {
						OR: [
							{
								variantKey: 'default',
								kind: { not: PRODUCT_VARIANT_KIND_DEFAULT }
							},
							{
								variantKey: { not: 'default' },
								kind: { not: PRODUCT_VARIANT_KIND_MATRIX }
							}
						]
					},
					select: {
						id: true,
						productId: true,
						sku: true,
						variantKey: true,
						kind: true,
						updatedAt: true
					},
					orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
					take: sampleLimit
				})
			: Promise.resolve([])
	])

	return {
		defaultToFix,
		matrixToFix,
		samples: samples as Record<string, unknown>[]
	}
}

async function runInspectProductVariant(ctx: AppContext) {
	const lookup = await askText('Product ID or Variant ID', {
		required: true
	})
	const normalized = lookup.trim()
	const [product, variantsById] = await Promise.all([
		ctx.prisma.product.findUnique({
			where: { id: normalized },
			select: {
				id: true,
				catalogId: true,
				name: true,
				sku: true,
				price: true,
				status: true,
				deleteAt: true,
				updatedAt: true,
				catalog: {
					select: {
						id: true,
						name: true,
						slug: true,
						domain: true
					}
				},
				variants: {
					where: { deleteAt: null },
					select: productVariantInspectionSelect,
					orderBy: [{ variantKey: 'asc' }, { id: 'asc' }]
				}
			}
		}),
		ctx.prisma.productVariant.findMany({
			where: {
				OR: [{ id: normalized }, { productId: normalized }]
			},
			select: {
				...productVariantInspectionSelect,
				product: {
					select: {
						id: true,
						catalogId: true,
						name: true,
						sku: true,
						price: true,
						status: true,
						deleteAt: true,
						updatedAt: true,
						catalog: {
							select: {
								id: true,
								name: true,
								slug: true,
								domain: true
							}
						}
					}
				}
			},
			orderBy: [{ variantKey: 'asc' }, { id: 'asc' }]
		})
	])

	if (product) {
		printProductInspection(product)
		await pause()
		return
	}

	if (!variantsById.length) {
		console.log(colors.yellow('Product or variant not found'))
		await pause()
		return
	}

	const first = variantsById[0] as ProductVariantInspectionRow
	printProductInspection({
		...first.product,
		variants: variantsById.map(variant => ({
			id: variant.id,
			productId: variant.productId,
			sku: variant.sku,
			variantKey: variant.variantKey,
			kind: variant.kind,
			price: variant.price,
			stock: variant.stock,
			status: variant.status,
			isAvailable: variant.isAvailable,
			deleteAt: variant.deleteAt,
			updatedAt: variant.updatedAt
		}))
	})
	await pause()
}

async function runMoySkladCatalogVisibility(ctx: AppContext) {
	const lookup = await askText('Catalog slug/name/domain/id', {
		required: true
	})
	await runMoySkladCatalogVisibilityReport(ctx, lookup)
	await pause()
}

async function runMoySkladRestoreZeroStockVisibility(ctx: AppContext) {
	const lookup = await askText('Catalog slug/name/domain/id', {
		required: true
	})
	await runMoySkladRestoreZeroStockVisibilityReport(ctx, lookup)
	await pause()
}

async function runMoySkladHideZeroStockVisibility(ctx: AppContext) {
	const lookup = await askText('Catalog slug/name/domain/id', {
		required: true
	})
	await runMoySkladHideZeroStockVisibilityReport(ctx, lookup)
	await pause()
}

async function runBumpCatalogCache(ctx: AppContext) {
	const lookup = await askText('Catalog slug/name/domain/id', {
		required: true
	})
	await runBumpCatalogCacheReport(ctx, lookup)
	await pause()
}

export async function runMoySkladCatalogVisibilityCommand(
	ctx: AppContext,
	options: Record<string, string | boolean>
) {
	const lookup = readCatalogLookupOption(options)
	if (!lookup) {
		throw new Error(
			'Catalog lookup is required. Pass --catalog, --slug, --id or --query.'
		)
	}

	await runMoySkladCatalogVisibilityReport(ctx, lookup, {
		json: Boolean(options.json)
	})
}

export async function runMoySkladRestoreZeroStockVisibilityCommand(
	ctx: AppContext,
	options: Record<string, string | boolean>
) {
	const lookup = readCatalogLookupOption(options)
	if (!lookup) {
		throw new Error(
			'Catalog lookup is required. Pass --catalog, --slug, --id or --query.'
		)
	}

	await runMoySkladRestoreZeroStockVisibilityReport(ctx, lookup, {
		apply: Boolean(options.yes),
		json: Boolean(options.json)
	})
}

export async function runMoySkladHideZeroStockVisibilityCommand(
	ctx: AppContext,
	options: Record<string, string | boolean>
) {
	const lookup = readCatalogLookupOption(options)
	if (!lookup) {
		throw new Error(
			'Catalog lookup is required. Pass --catalog, --slug, --id or --query.'
		)
	}

	await runMoySkladHideZeroStockVisibilityReport(ctx, lookup, {
		apply: Boolean(options.yes),
		json: Boolean(options.json)
	})
}

export async function runBumpCatalogCacheCommand(
	ctx: AppContext,
	options: Record<string, string | boolean>
) {
	const lookup = readCatalogLookupOption(options)
	if (!lookup) {
		throw new Error(
			'Catalog lookup is required. Pass --catalog, --slug, --id or --query.'
		)
	}

	await runBumpCatalogCacheReport(ctx, lookup, {
		json: Boolean(options.json)
	})
}

async function runMoySkladCatalogVisibilityReport(
	ctx: AppContext,
	lookup: string,
	options: { json?: boolean } = {}
) {
	const catalog = await resolveCatalogForCustomScript(ctx, lookup)
	const integration = await ctx.prisma.integration.findFirst({
		where: {
			catalogId: catalog.id,
			provider: 'MOYSKLAD',
			deleteAt: null
		},
		select: {
			id: true,
			isActive: true,
			lastSyncStatus: true,
			lastSyncAt: true,
			lastSyncError: true,
			totalProducts: true,
			createdProducts: true,
			updatedProducts: true,
			deletedProducts: true
		}
	})

	const [
		summary,
		productStatuses,
		variantStatuses,
		availabilitySummary,
		categoryCoverage,
		categorySamples,
		uncategorizedProducts,
		hiddenSamples,
		latestRuns
	] = await Promise.all([
		loadMoySkladVisibilitySummary(ctx, catalog.id),
		loadMoySkladProductStatusCounts(ctx, catalog.id),
		loadMoySkladVariantStatusCounts(ctx, catalog.id),
		loadMoySkladAvailabilitySummary(ctx, catalog.id),
		loadMoySkladCategoryCoverageSummary(ctx, catalog.id),
		loadMoySkladCategoryCoverageRows(ctx, catalog.id, ctx.options.limit),
		loadMoySkladUncategorizedProductSamples(ctx, catalog.id, ctx.options.limit),
		loadMoySkladHiddenProductSamples(ctx, catalog.id, ctx.options.limit),
		loadMoySkladLatestSyncRuns(ctx, catalog.id, ctx.options.limit)
	])

	if (ctx.options.json || options.json) {
		printJson({
			catalog,
			integration,
			summary,
			productStatuses,
			variantStatuses,
			availabilitySummary,
			categoryCoverage,
			categorySamples,
			uncategorizedProducts,
			hiddenSamples,
			latestRuns
		})
		return
	}

	console.log(colors.cyan(colors.bold(`${catalog.name} / ${catalog.slug}`)))
	console.log(colors.cyan('MoySklad integration'))
	if (integration) {
		table([integration], undefined, 1)
	} else {
		console.log(colors.yellow('MoySklad integration not found'))
	}

	console.log(colors.cyan('Visibility summary'))
	table(summary, undefined, summary.length)

	console.log(colors.cyan('Product statuses'))
	table(productStatuses, undefined, productStatuses.length)

	console.log(colors.cyan('Variant statuses'))
	table(variantStatuses, undefined, variantStatuses.length)

	console.log(colors.cyan('Availability summary'))
	table(availabilitySummary, undefined, availabilitySummary.length)

	console.log(colors.cyan('Category coverage'))
	table(categoryCoverage, undefined, categoryCoverage.length)

	console.log(colors.cyan(`Category samples (${categorySamples.length})`))
	table(categorySamples, undefined, categorySamples.length || ctx.options.limit)

	console.log(
		colors.cyan(
			`Uncategorized MoySklad products (${uncategorizedProducts.length})`
		)
	)
	table(
		uncategorizedProducts,
		undefined,
		uncategorizedProducts.length || ctx.options.limit
	)

	console.log(
		colors.cyan(`Hidden MoySklad product samples (${hiddenSamples.length})`)
	)
	table(hiddenSamples, undefined, hiddenSamples.length || ctx.options.limit)

	console.log(colors.cyan(`Latest MoySklad sync runs (${latestRuns.length})`))
	table(latestRuns, undefined, latestRuns.length || ctx.options.limit)
}

async function runMoySkladRestoreZeroStockVisibilityReport(
	ctx: AppContext,
	lookup: string,
	options: { apply?: boolean; json?: boolean } = {}
) {
	const catalog = await resolveCatalogForCustomScript(ctx, lookup)
	const candidates = await loadMoySkladRestoreVisibilityCandidates(
		ctx,
		catalog.id
	)

	if (ctx.options.json || options.json) {
		if (!options.apply) {
			printJson({
				catalog,
				matched: candidates.length,
				previewOnly: true,
				hint: 'Pass --yes to restore these products to ACTIVE.',
				candidates
			})
			return
		}
	} else {
		console.log(
			colors.cyan(
				colors.bold(`${catalog.name} / ${catalog.slug}: restore visibility`)
			)
		)
		console.log(colors.yellow(`Matched products: ${candidates.length}`))
		table(candidates, undefined, candidates.length || ctx.options.limit)
	}

	if (!candidates.length) {
		if (ctx.options.json || options.json) {
			printJson({
				catalog,
				matched: 0,
				updated: 0
			})
		}
		return
	}

	if (!options.apply) {
		console.log(
			colors.yellow('Preview only. Pass --yes to set matched products to ACTIVE.')
		)
		return
	}

	assertCanMutate(ctx, 'moyskladRestoreZeroStockVisibility')
	const backupPath = await writeBackup(
		ctx,
		{ name: 'Product' } as ModelMeta,
		'moyskladRestoreZeroStockVisibility',
		candidates as unknown as Record<string, unknown>[],
		{
			catalogId: catalog.id,
			provider: 'MOYSKLAD',
			status: ProductStatus.HIDDEN,
			totalStockLte: 0,
			activeVariants: 0,
			archivedNotTrue: true
		}
	)
	const ids = candidates.map(candidate => candidate.id)
	const result = await runAudited(
		ctx,
		{
			action: 'moyskladRestoreZeroStockVisibility',
			model: 'Product',
			where: { id: { in: ids }, catalogId: catalog.id },
			data: { status: ProductStatus.ACTIVE },
			affectedCount: candidates.length,
			backupPath
		},
		async () =>
			await ctx.prisma.product.updateMany({
				where: {
					id: { in: ids },
					catalogId: catalog.id,
					status: ProductStatus.HIDDEN,
					deleteAt: null
				},
				data: { status: ProductStatus.ACTIVE }
			})
	)
	const bumpedCacheScopes = result.count
		? await bumpCatalogRedisCacheVersions(catalog.id)
		: []

	if (ctx.options.json || options.json) {
		printJson({
			catalog,
			matched: candidates.length,
			updated: result.count,
			backupPath,
			bumpedCacheScopes
		})
	} else {
		console.log(
			colors.green(`Restored products: ${result.count}. Backup: ${backupPath}`)
		)
		if (bumpedCacheScopes.length) {
			console.log(
				colors.green(`Bumped cache scopes: ${bumpedCacheScopes.join(', ')}`)
			)
		}
	}
}

async function runMoySkladHideZeroStockVisibilityReport(
	ctx: AppContext,
	lookup: string,
	options: { apply?: boolean; json?: boolean } = {}
) {
	const catalog = await resolveCatalogForCustomScript(ctx, lookup)
	const candidates = await loadMoySkladHideVisibilityCandidates(ctx, catalog.id)

	if (ctx.options.json || options.json) {
		if (!options.apply) {
			printJson({
				catalog,
				matched: candidates.length,
				previewOnly: true,
				hint: 'Pass --yes to hide these products.',
				candidates
			})
			return
		}
	} else {
		console.log(
			colors.cyan(
				colors.bold(`${catalog.name} / ${catalog.slug}: hide zero stock`)
			)
		)
		console.log(colors.yellow(`Matched products: ${candidates.length}`))
		table(candidates, undefined, candidates.length || ctx.options.limit)
	}

	if (!candidates.length) {
		if (ctx.options.json || options.json) {
			printJson({ catalog, matched: 0, updated: 0 })
		}
		return
	}

	if (!options.apply) {
		console.log(
			colors.yellow('Preview only. Pass --yes to set matched products to HIDDEN.')
		)
		return
	}

	assertCanMutate(ctx, 'moyskladHideZeroStockVisibility')
	const backupPath = await writeBackup(
		ctx,
		{ name: 'Product' } as ModelMeta,
		'moyskladHideZeroStockVisibility',
		candidates as unknown as Record<string, unknown>[],
		{
			catalogId: catalog.id,
			provider: 'MOYSKLAD',
			status: ProductStatus.ACTIVE,
			totalStockLte: 0,
			activeVariants: 0,
			archivedNotTrue: true
		}
	)
	const ids = candidates.map(candidate => candidate.id)
	const result = await runAudited(
		ctx,
		{
			action: 'moyskladHideZeroStockVisibility',
			model: 'Product',
			where: { id: { in: ids }, catalogId: catalog.id },
			data: { status: ProductStatus.HIDDEN },
			affectedCount: candidates.length,
			backupPath
		},
		async () =>
			await ctx.prisma.product.updateMany({
				where: {
					id: { in: ids },
					catalogId: catalog.id,
					status: ProductStatus.ACTIVE,
					deleteAt: null
				},
				data: { status: ProductStatus.HIDDEN }
			})
	)
	const bumpedCacheScopes = result.count
		? await bumpCatalogRedisCacheVersions(catalog.id)
		: []

	if (ctx.options.json || options.json) {
		printJson({
			catalog,
			matched: candidates.length,
			updated: result.count,
			backupPath,
			bumpedCacheScopes
		})
	} else {
		console.log(
			colors.green(`Hidden products: ${result.count}. Backup: ${backupPath}`)
		)
		if (bumpedCacheScopes.length) {
			console.log(
				colors.green(`Bumped cache scopes: ${bumpedCacheScopes.join(', ')}`)
			)
		}
	}
}

async function runBumpCatalogCacheReport(
	ctx: AppContext,
	lookup: string,
	options: { json?: boolean } = {}
) {
	const catalog = await resolveCatalogForCustomScript(ctx, lookup)
	const bumpedCacheScopes = await bumpCatalogRedisCacheVersions(catalog.id)

	if (ctx.options.json || options.json) {
		printJson({ catalog, bumpedCacheScopes })
		return
	}

	if (bumpedCacheScopes.length) {
		console.log(
			colors.green(`Bumped cache scopes: ${bumpedCacheScopes.join(', ')}`)
		)
	} else {
		console.log(colors.yellow('No cache scopes were bumped.'))
	}
}

function readCatalogLookupOption(
	options: Record<string, string | boolean>
): string | null {
	for (const key of ['catalog', 'slug', 'id', 'query']) {
		const value = options[key]
		if (typeof value === 'string' && value.trim()) return value.trim()
	}

	return null
}

async function resolveCatalogForCustomScript(ctx: AppContext, lookup: string) {
	const normalized = lookup.trim()
	const isUuid = uuidRegex.test(normalized)
	const identity: Record<string, unknown>[] = isUuid ? [{ id: normalized }] : []
	const catalog = await ctx.prisma.catalog.findFirst({
		where: {
			OR: [
				...identity,
				{ slug: normalized },
				{ domain: normalized },
				{ name: { equals: normalized, mode: 'insensitive' } },
				{ slug: { contains: normalized, mode: 'insensitive' } },
				{ domain: { contains: normalized, mode: 'insensitive' } },
				{ name: { contains: normalized, mode: 'insensitive' } }
			]
		},
		orderBy: { updatedAt: 'desc' },
		select: {
			id: true,
			name: true,
			slug: true,
			domain: true,
			deleteAt: true,
			updatedAt: true
		}
	})

	if (!catalog) throw new Error(`Catalog not found: ${normalized}`)
	return catalog as {
		id: string
		name: string
		slug: string
		domain: string | null
		deleteAt: Date | null
		updatedAt: Date
	}
}

async function loadMoySkladVisibilitySummary(
	ctx: AppContext,
	catalogId: string
): Promise<MoySkladVisibilitySummaryRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladVisibilitySummaryRow[]>(`
		with product_stock as (
			select
				p.id,
				p.status::text as status,
				count(v.id)::int as variants,
				count(v.id) filter (
					where v.status::text = 'ACTIVE'
						and v.is_available = true
				)::int as active_variants,
				coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0)::int as total_stock
			from products p
			left join product_variants v
				on v.product_id = p.id
				and v.delete_at is null
			where p.catalog_id = '${catalogId}'::uuid
				and p.delete_at is null
			group by p.id, p.status
		),
		moysklad_products as (
			select
				ps.*,
				link.id as link_id,
				link.raw_meta,
				link.last_stock_sync_at
			from product_stock ps
			left join integration_product_links link
				on link.product_id = ps.id
			left join integrations integration
				on integration.id = link.integration_id
				and integration.provider::text = 'MOYSKLAD'
				and integration.catalog_id = '${catalogId}'::uuid
				and integration.delete_at is null
		)
		select 'all products' as check, count(*)::int as count, null::text as details
		from product_stock
		union all
		select 'client-visible products', count(*)::int, 'Product.status = ACTIVE'
		from product_stock
		where status = 'ACTIVE'
		union all
		select 'hidden products', count(*)::int, 'Product.status = HIDDEN'
		from product_stock
		where status = 'HIDDEN'
		union all
		select 'MoySklad linked products', count(*)::int, 'integration_product_links'
		from moysklad_products
		where link_id is not null
		union all
		select 'visible MoySklad linked products', count(*)::int, 'linked + ACTIVE'
		from moysklad_products
		where link_id is not null and status = 'ACTIVE'
		union all
		select 'hidden MoySklad linked products', count(*)::int, 'linked + HIDDEN'
		from moysklad_products
		where link_id is not null and status = 'HIDDEN'
		union all
		select 'hidden linked with zero total stock', count(*)::int, 'status HIDDEN and sum(variant.stock) <= 0'
		from moysklad_products
		where link_id is not null
			and status = 'HIDDEN'
			and total_stock <= 0
		union all
		select 'hidden linked without active variants', count(*)::int, 'status HIDDEN and no ACTIVE/isAvailable variants'
		from moysklad_products
		where link_id is not null
			and status = 'HIDDEN'
			and active_variants = 0
		union all
		select 'hidden linked archived in MoySklad', count(*)::int, 'raw_meta.archived = true'
		from moysklad_products
		where link_id is not null
			and status = 'HIDDEN'
			and raw_meta ->> 'archived' = 'true'
		union all
		select 'linked without stock sync timestamp', count(*)::int, 'last_stock_sync_at is null'
		from moysklad_products
		where link_id is not null
			and last_stock_sync_at is null
	`)
}

async function loadMoySkladProductStatusCounts(
	ctx: AppContext,
	catalogId: string
): Promise<MoySkladStatusCountRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladStatusCountRow[]>(`
		select p.status::text as status, count(*)::int as count
		from products p
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
		group by p.status
		order by count desc, status asc
	`)
}

async function loadMoySkladVariantStatusCounts(
	ctx: AppContext,
	catalogId: string
): Promise<MoySkladVariantStatusCountRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladVariantStatusCountRow[]>(`
		select
			v.status::text as status,
			v.is_available as "isAvailable",
			count(*)::int as count
		from product_variants v
		join products p on p.id = v.product_id
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and v.delete_at is null
		group by v.status, v.is_available
		order by count desc, status asc, v.is_available desc
	`)
}

async function loadMoySkladHiddenProductSamples(
	ctx: AppContext,
	catalogId: string,
	limit: number
): Promise<MoySkladVisibilitySampleRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladVisibilitySampleRow[]>(`
		select
			p.id::text,
			p.name,
			p.sku,
			p.status::text as status,
			link.external_id as "externalId",
			link.external_code as "externalCode",
			link.raw_meta ->> 'stock' as "rawStock",
			link.raw_meta ->> 'archived' as archived,
			coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0)::int as "totalStock",
			count(v.id)::int as variants,
			count(v.id) filter (
				where v.status::text = 'ACTIVE'
					and v.is_available = true
			)::int as "activeVariants",
			link.skipped_reason as "skippedReason",
			link.last_stock_sync_at as "lastStockSyncAt",
			p.updated_at as "updatedAt"
		from products p
		join integration_product_links link on link.product_id = p.id
		join integrations integration
			on integration.id = link.integration_id
			and integration.provider::text = 'MOYSKLAD'
			and integration.catalog_id = p.catalog_id
			and integration.delete_at is null
		left join product_variants v
			on v.product_id = p.id
			and v.delete_at is null
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and p.status::text = 'HIDDEN'
		group by
			p.id,
			p.name,
			p.sku,
			p.status,
			link.external_id,
			link.external_code,
			link.raw_meta,
			link.skipped_reason,
			link.last_stock_sync_at,
			p.updated_at
		order by "totalStock" asc, p.updated_at desc, p.id asc
		limit ${Math.max(1, Math.trunc(limit))}
	`)
}

async function loadMoySkladLatestSyncRuns(
	ctx: AppContext,
	catalogId: string,
	limit: number
): Promise<MoySkladSyncRunRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladSyncRunRow[]>(`
		select
			run.id::text,
			run.mode::text as mode,
			run.trigger::text as trigger,
			run.status::text as status,
			run.snapshot_completeness::text as "snapshotCompleteness",
			run.total_products as "totalProducts",
			run.created_products as "createdProducts",
			run.updated_products as "updatedProducts",
			run.deleted_products as "deletedProducts",
			run.error,
			run.started_at as "startedAt",
			run.finished_at as "finishedAt"
		from integration_sync_runs run
		where run.catalog_id = '${catalogId}'::uuid
			and run.provider::text = 'MOYSKLAD'
		order by run.requested_at desc
		limit ${Math.max(1, Math.trunc(limit))}
	`)
}

async function loadMoySkladAvailabilitySummary(
	ctx: AppContext,
	catalogId: string
): Promise<MoySkladAvailabilitySummaryRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladAvailabilitySummaryRow[]>(`
		with product_variants as (
			select
				p.id,
				p.status::text as status,
				count(v.id) filter (
					where v.status::text <> 'DISABLED'
				)::int as enabled_variants,
				count(v.id) filter (
					where v.status::text = 'ACTIVE'
						and v.is_available = true
				)::int as active_available_variants,
				coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0)::int as total_stock
			from products p
			join integration_product_links link on link.product_id = p.id
			join integrations integration
				on integration.id = link.integration_id
				and integration.provider::text = 'MOYSKLAD'
				and integration.catalog_id = p.catalog_id
				and integration.delete_at is null
			left join product_variants v
				on v.product_id = p.id
				and v.delete_at is null
			where p.catalog_id = '${catalogId}'::uuid
				and p.delete_at is null
			group by p.id, p.status
		)
		select 'products with purchasable variant' as check, count(*)::int as count, 'active/isAvailable variant exists' as details
		from product_variants
		where status = 'ACTIVE' and active_available_variants > 0
		union all
		select 'active products without purchasable variant', count(*)::int, 'Product ACTIVE but no active/isAvailable variant'
		from product_variants
		where status = 'ACTIVE' and active_available_variants = 0
		union all
		select 'active products with zero total stock', count(*)::int, 'Product ACTIVE and summed variant stock = 0'
		from product_variants
		where status = 'ACTIVE' and total_stock <= 0
		union all
		select 'active products with stock > 0', count(*)::int, 'Product ACTIVE and summed variant stock > 0'
		from product_variants
		where status = 'ACTIVE' and total_stock > 0
	`)
}

async function loadMoySkladCategoryCoverageSummary(
	ctx: AppContext,
	catalogId: string
): Promise<MoySkladCategoryCoverageSummaryRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladCategoryCoverageSummaryRow[]>(`
		with moysklad_products as (
			select p.id, p.status::text as status
			from products p
			join integration_product_links link on link.product_id = p.id
			join integrations integration
				on integration.id = link.integration_id
				and integration.provider::text = 'MOYSKLAD'
				and integration.catalog_id = p.catalog_id
				and integration.delete_at is null
			where p.catalog_id = '${catalogId}'::uuid
				and p.delete_at is null
		),
		product_category_links as (
			select
				p.id,
				p.status,
				count(cp.category_id) filter (
					where c.id is not null
				)::int as category_links
			from moysklad_products p
			left join category_products cp on cp.product_id = p.id
			left join categories c
				on c.id = cp.category_id
				and c.catalog_id = '${catalogId}'::uuid
				and c.delete_at is null
			group by p.id, p.status
		),
		category_counts as (
			select
				c.id,
				count(cp.product_id) filter (
					where p.delete_at is null and p.status::text = 'ACTIVE'
				)::int as active_products
			from categories c
			left join category_products cp on cp.category_id = c.id
			left join products p on p.id = cp.product_id
			where c.catalog_id = '${catalogId}'::uuid
				and c.delete_at is null
			group by c.id
		)
		select 'categories total' as check, count(*)::int as count, 'non-deleted categories' as details
		from category_counts
		union all
		select 'categories with active products', count(*)::int, 'category has Product.status ACTIVE'
		from category_counts
		where active_products > 0
		union all
		select 'MoySklad products with category', count(*)::int, 'linked to at least one non-deleted category'
		from product_category_links
		where category_links > 0
		union all
		select 'MoySklad products without category', count(*)::int, 'no category_products link to non-deleted category'
		from product_category_links
		where category_links = 0
		union all
		select 'active MoySklad products without category', count(*)::int, 'ACTIVE but uncategorized'
		from product_category_links
		where status = 'ACTIVE' and category_links = 0
	`)
}

async function loadMoySkladCategoryCoverageRows(
	ctx: AppContext,
	catalogId: string,
	limit: number
): Promise<MoySkladCategoryCoverageRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladCategoryCoverageRow[]>(`
		select
			c.id::text,
			c.name,
			parent.name as "parentName",
			count(cp.product_id)::int as "productLinks",
			count(cp.product_id) filter (
				where p.delete_at is null and p.status::text = 'ACTIVE'
			)::int as "activeProducts",
			count(cp.product_id) filter (
				where link.id is not null
			)::int as "moySkladProducts",
			count(cp.product_id) filter (
				where link.id is not null
					and p.delete_at is null
					and p.status::text = 'ACTIVE'
			)::int as "activeMoySkladProducts"
		from categories c
		left join categories parent on parent.id = c.parent_id
		left join category_products cp on cp.category_id = c.id
		left join products p on p.id = cp.product_id
		left join integration_product_links link on link.product_id = p.id
		left join integrations integration
			on integration.id = link.integration_id
			and integration.provider::text = 'MOYSKLAD'
			and integration.catalog_id = c.catalog_id
			and integration.delete_at is null
		where c.catalog_id = '${catalogId}'::uuid
			and c.delete_at is null
		group by c.id, c.name, parent.name
		order by "activeMoySkladProducts" desc, "activeProducts" desc, c.name asc
		limit ${Math.max(1, Math.trunc(limit))}
	`)
}

async function loadMoySkladUncategorizedProductSamples(
	ctx: AppContext,
	catalogId: string,
	limit: number
): Promise<MoySkladUncategorizedProductRow[]> {
	return ctx.prisma.$queryRawUnsafe<MoySkladUncategorizedProductRow[]>(`
		select
			p.id::text,
			p.name,
			p.sku,
			p.status::text as status,
			link.external_id as "externalId",
			coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0)::int as "totalStock",
			count(v.id) filter (
				where v.status::text = 'ACTIVE'
					and v.is_available = true
			)::int as "activeVariants",
			p.updated_at as "updatedAt"
		from products p
		join integration_product_links link on link.product_id = p.id
		join integrations integration
			on integration.id = link.integration_id
			and integration.provider::text = 'MOYSKLAD'
			and integration.catalog_id = p.catalog_id
			and integration.delete_at is null
		left join product_variants v
			on v.product_id = p.id
			and v.delete_at is null
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and not exists (
				select 1
				from category_products cp
				join categories c
					on c.id = cp.category_id
					and c.catalog_id = p.catalog_id
					and c.delete_at is null
				where cp.product_id = p.id
			)
		group by p.id, p.name, p.sku, p.status, link.external_id, p.updated_at
		order by p.updated_at desc, p.id asc
		limit ${Math.max(1, Math.trunc(limit))}
	`)
}

async function loadMoySkladRestoreVisibilityCandidates(
	ctx: AppContext,
	catalogId: string,
	limit?: number
): Promise<MoySkladRestoreVisibilityCandidateRow[]> {
	const limitClause =
		typeof limit === 'number' ? `limit ${Math.max(1, Math.trunc(limit))}` : ''

	return ctx.prisma.$queryRawUnsafe<MoySkladRestoreVisibilityCandidateRow[]>(`
		select
			p.id::text,
			p.name,
			p.sku,
			p.status::text as status,
			link.external_id as "externalId",
			link.external_code as "externalCode",
			link.raw_meta ->> 'stock' as "rawStock",
			link.raw_meta ->> 'archived' as archived,
			coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0)::int as "totalStock",
			count(v.id)::int as variants,
			count(v.id) filter (
				where v.status::text = 'ACTIVE'
					and v.is_available = true
			)::int as "activeVariants",
			link.skipped_reason as "skippedReason",
			p.updated_at as "updatedAt"
		from products p
		join integration_product_links link on link.product_id = p.id
		join integrations integration
			on integration.id = link.integration_id
			and integration.provider::text = 'MOYSKLAD'
			and integration.catalog_id = p.catalog_id
			and integration.delete_at is null
		left join product_variants v
			on v.product_id = p.id
			and v.delete_at is null
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and p.status::text = 'HIDDEN'
			and coalesce(link.raw_meta ->> 'archived', 'false') <> 'true'
			and coalesce(link.skipped_reason, '') not in (
				'hidden_after_missing_confirmations',
				'missing_from_complete_snapshot'
			)
		group by
			p.id,
			p.name,
			p.sku,
			p.status,
			link.external_id,
			link.external_code,
			link.raw_meta,
			link.skipped_reason,
			p.updated_at
		having
			coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0) <= 0
			and count(v.id) filter (
				where v.status::text = 'ACTIVE'
					and v.is_available = true
			) = 0
		order by p.updated_at desc, p.id asc
		${limitClause}
	`)
}

async function loadMoySkladHideVisibilityCandidates(
	ctx: AppContext,
	catalogId: string,
	limit?: number
): Promise<MoySkladRestoreVisibilityCandidateRow[]> {
	const limitClause =
		typeof limit === 'number' ? `limit ${Math.max(1, Math.trunc(limit))}` : ''

	return ctx.prisma.$queryRawUnsafe<MoySkladRestoreVisibilityCandidateRow[]>(`
		select
			p.id::text,
			p.name,
			p.sku,
			p.status::text as status,
			link.external_id as "externalId",
			link.external_code as "externalCode",
			link.raw_meta ->> 'stock' as "rawStock",
			link.raw_meta ->> 'archived' as archived,
			coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0)::int as "totalStock",
			count(v.id)::int as variants,
			count(v.id) filter (
				where v.status::text = 'ACTIVE'
					and v.is_available = true
			)::int as "activeVariants",
			link.skipped_reason as "skippedReason",
			p.updated_at as "updatedAt"
		from products p
		join integration_product_links link on link.product_id = p.id
		join integrations integration
			on integration.id = link.integration_id
			and integration.provider::text = 'MOYSKLAD'
			and integration.catalog_id = p.catalog_id
			and integration.delete_at is null
		left join product_variants v
			on v.product_id = p.id
			and v.delete_at is null
		where p.catalog_id = '${catalogId}'::uuid
			and p.delete_at is null
			and p.status::text = 'ACTIVE'
			and coalesce(link.raw_meta ->> 'type', 'product') <> 'service'
			and coalesce(link.raw_meta ->> 'archived', 'false') <> 'true'
			and coalesce(link.skipped_reason, '') not in (
				'hidden_after_missing_confirmations',
				'missing_from_complete_snapshot'
			)
		group by
			p.id,
			p.name,
			p.sku,
			p.status,
			link.external_id,
			link.external_code,
			link.raw_meta,
			link.skipped_reason,
			p.updated_at
		having
			coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0) <= 0
			and count(v.id) filter (
				where v.status::text = 'ACTIVE'
					and v.is_available = true
			) = 0
		order by p.updated_at desc, p.id asc
		${limitClause}
	`)
}

async function bumpCatalogRedisCacheVersions(catalogId: string) {
	if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
		console.log(
			colors.yellow('Redis env is not configured; cache versions were not bumped.')
		)
		return [] as string[]
	}

	const redis = new Redis({
		username: process.env.REDIS_USER || undefined,
		password: process.env.REDIS_PASSWORD || undefined,
		host: process.env.REDIS_HOST,
		port: Number.parseInt(process.env.REDIS_PORT, 10),
		commandTimeout: 5000,
		connectTimeout: 5000,
		enableOfflineQueue: false,
		lazyConnect: true,
		maxRetriesPerRequest: 1
	})

	try {
		await redis.connect()
		await Promise.all(
			CATALOG_CACHE_SCOPES_TO_BUMP.map(scope =>
				redis.incr(`cache:version:${scope}:${catalogId}`)
			)
		)
		return [...CATALOG_CACHE_SCOPES_TO_BUMP]
	} catch (error) {
		console.log(
			colors.yellow(
				`Could not bump Redis cache versions: ${
					error instanceof Error ? error.message : String(error)
				}`
			)
		)
		return [] as string[]
	} finally {
		redis.disconnect()
	}
}

function printProductInspection(product: {
	id: string
	catalogId: string
	name: string
	sku: string
	price: unknown
	status: string
	deleteAt: Date | null
	updatedAt: Date
	catalog: {
		id: string
		name: string
		slug: string
		domain: string | null
	}
	variants: Array<{
		id: string
		productId: string
		sku: string
		variantKey: string
		kind: string
		price: unknown
		stock: number | null
		status: string
		isAvailable: boolean
		deleteAt: Date | null
		updatedAt: Date
	}>
}) {
	console.log(colors.cyan('Product'))
	table(
		[
			{
				id: product.id,
				name: product.name,
				sku: product.sku,
				price: product.price,
				status: product.status,
				deleteAt: product.deleteAt,
				updatedAt: product.updatedAt
			}
		],
		undefined,
		1
	)

	console.log(colors.cyan('Catalog'))
	table([product.catalog], undefined, 1)

	console.log(colors.cyan(`Variants (${product.variants.length})`))
	if (product.variants.length) {
		table(product.variants, undefined, product.variants.length)
	} else {
		console.log(colors.yellow('Пусто'))
	}
}

function printVariantKindBackfillSummary(
	summary: VariantKindBackfillSummary,
	limit: number
) {
	console.log(colors.cyan('Dry-run: product variant kind backfill'))
	console.log(`Default variants to fix: ${summary.defaultToFix}`)
	console.log(`Matrix variants to fix: ${summary.matrixToFix}`)
	if (summary.samples.length) {
		table(summary.samples, undefined, limit)
	}
}

async function runNullifyZeroPrices(ctx: AppContext, models: ModelMeta[]) {
	while (true) {
		const summary = await loadZeroPriceSummary(ctx)
		printZeroPriceSummary(summary, ctx.options.limit)

		const action = await choose<string>('Zero price cleanup', [
			{ name: 'Refresh dry-run', value: 'refresh' },
			{
				name: 'Apply: products only',
				value: 'applyProducts',
				disabled:
					ctx.mode === 'readonly'
						? 'readonly mode'
						: summary.productCount
							? false
							: 'no product rows'
			},
			{
				name: 'Apply: products and variants',
				value: 'applyProductsAndVariants',
				disabled:
					ctx.mode === 'readonly'
						? 'readonly mode'
						: summary.productCount || summary.variantCount
							? false
							: 'no rows'
			},
			{ name: 'Back', value: 'back' }
		])

		if (action === 'back') return
		if (action === 'refresh') continue

		const includeVariants = action === 'applyProductsAndVariants'
		await applyNullifyZeroPrices(ctx, models, summary, includeVariants)
		await pause()
		return
	}
}

async function loadZeroPriceSummary(
	ctx: AppContext
): Promise<ZeroPriceSummary> {
	const sampleLimit = Math.max(0, ctx.options.limit)
	const [productCount, productSamples, variantCount, variantSamples] =
		await Promise.all([
			ctx.prisma.product.count({ where: { price: ZERO_PRICE } }),
			sampleLimit
				? ctx.prisma.product.findMany({
						where: { price: ZERO_PRICE },
						select: {
							id: true,
							catalogId: true,
							sku: true,
							name: true,
							price: true,
							updatedAt: true
						},
						orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
						take: sampleLimit
					})
				: Promise.resolve([]),
			ctx.prisma.productVariant.count({ where: { price: ZERO_PRICE } }),
			sampleLimit
				? ctx.prisma.productVariant.findMany({
						where: { price: ZERO_PRICE },
						select: {
							id: true,
							productId: true,
							sku: true,
							variantKey: true,
							price: true,
							updatedAt: true
						},
						orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
						take: sampleLimit
					})
				: Promise.resolve([])
		])

	return {
		productCount,
		productSamples: productSamples as Record<string, unknown>[],
		variantCount,
		variantSamples: variantSamples as Record<string, unknown>[]
	}
}

function printZeroPriceSummary(summary: ZeroPriceSummary, limit: number) {
	console.log(colors.cyan('Dry-run: zero prices found'))
	console.log(`Products: ${summary.productCount}`)
	if (summary.productSamples.length) {
		table(summary.productSamples, undefined, limit)
	}

	console.log(`Product variants: ${summary.variantCount}`)
	if (summary.variantSamples.length) {
		table(summary.variantSamples, undefined, limit)
	}
}

async function applyNullifyZeroPrices(
	ctx: AppContext,
	models: ModelMeta[],
	summary: ZeroPriceSummary,
	includeVariants: boolean
) {
	assertCanMutate(ctx, 'custom script: nullify zero prices')

	const productRows = summary.productCount
		? await ctx.prisma.product.findMany({
				where: { price: ZERO_PRICE },
				select: {
					id: true,
					catalogId: true,
					sku: true,
					name: true,
					price: true,
					updatedAt: true
				}
			})
		: []
	const variantRows =
		includeVariants && summary.variantCount
			? await ctx.prisma.productVariant.findMany({
					where: { price: ZERO_PRICE },
					select: {
						id: true,
						productId: true,
						sku: true,
						variantKey: true,
						price: true,
						updatedAt: true
					}
				})
			: []

	const confirmation = includeVariants
		? `nullify ${summary.productCount} products and ${summary.variantCount} variants`
		: `nullify ${summary.productCount} products`
	const typed = await askText(`Type "${confirmation}" to apply`, {
		required: true
	})
	if (typed !== confirmation) {
		console.log(colors.yellow('Cancelled'))
		return
	}

	const productModel = findModel(models, 'Product')
	const variantModel = findModel(models, 'ProductVariant')
	const productBackupPath = productRows.length
		? await writeBackup(
				ctx,
				productModel,
				'custom-nullify-zero-prices',
				productRows,
				{ price: ZERO_PRICE }
			)
		: undefined
	const variantBackupPath = variantRows.length
		? await writeBackup(
				ctx,
				variantModel,
				'custom-nullify-zero-prices',
				variantRows,
				{ price: ZERO_PRICE }
			)
		: undefined

	const result = await runAudited(
		ctx,
		{
			action: 'custom:nullifyZeroPrices',
			data: {
				includeVariants,
				productBackupPath,
				variantBackupPath
			},
			affectedCount:
				summary.productCount + (includeVariants ? summary.variantCount : 0)
		},
		async () =>
			await ctx.prisma.$transaction(async tx => {
				const products = await tx.product.updateMany({
					where: { price: ZERO_PRICE },
					data: { price: null }
				})
				const variants = includeVariants
					? await tx.productVariant.updateMany({
							where: { price: ZERO_PRICE },
							data: { price: null }
						})
					: { count: 0 }

				return { products, variants }
			})
	)

	console.log(colors.green(`Updated products: ${result.products.count}`))
	if (includeVariants) {
		console.log(
			colors.green(`Updated product variants: ${result.variants.count}`)
		)
	}
}

function findModel(models: ModelMeta[], name: string): ModelMeta {
	const model = models.find(item => item.name === name)
	if (!model) throw new Error(`Model ${name} not found`)
	return model
}
