import { Prisma } from '../../prisma/generated/client.js'

import { colors, table } from './format.js'
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
