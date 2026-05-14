import 'dotenv/config'
import { createHash } from 'node:crypto'

import {
	CartStatus,
	Prisma,
	type PrismaClient,
	ProductVariantStatus
} from '../prisma/generated/client.js'

import { colors, printJson, table } from './db-console/format.js'
import { createPrismaClient, validateDatabaseEnv } from './db-console/prisma.js'

const DEFAULT_VARIANT_KEY = 'default'
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_SAMPLE_LIMIT = 20
const SKU_MAX_LENGTH = 100
const ACTIVE_CART_STATUSES = [
	CartStatus.DRAFT,
	CartStatus.SHARED,
	CartStatus.IN_PROGRESS,
	CartStatus.PAUSED
] as const

type CliOptions = {
	apply: boolean
	applyCartItems: boolean
	json: boolean
	help: boolean
	batchSize: number
	sampleLimit: number
}

type ProductWithoutVariantRow = {
	id: string
	catalogId: string
	name: string
	sku: string
	price: unknown
}

type DuplicateVariantKeyRow = {
	productId: string
	variantKey: string
	count: number
}

type ProductWithMultipleVariantsRow = {
	productId: string
	count: number
}

type InvalidPriceRow = {
	id: string
	productId: string
	sku: string
	variantKey: string
	price: string
}

type CartItemVariantMismatchRow = {
	cartItemId: string
	productId: string
	variantId: string
	variantProductId: string
}

type BackfillResult = {
	created: number
	skipped: number
	samples: Array<{
		productId: string
		productSku: string
		variantSku: string
		variantKey: string
	}>
}

type CartItemBackfillResult = {
	updated: number
	skipped: number
	samples: Array<{
		cartItemId: string
		productId: string
		variantId: string
	}>
}

const productWithoutVariantsWhere = {
	deleteAt: null,
	variants: { none: { deleteAt: null } }
} satisfies Prisma.ProductWhereInput

async function main() {
	const options = parseCliOptions(process.argv.slice(2))
	if (options.help) {
		printHelp()
		return
	}

	validateDatabaseEnv()
	const prisma = createPrismaClient()

	try {
		await prisma.$connect()

		const audit = await collectAudit(prisma, options.sampleLimit)

		if (options.json) {
			const backfill = options.apply
				? await backfillDefaultVariants(prisma, options)
				: null
			const cartItemBackfill =
				options.apply && options.applyCartItems
					? await backfillOpenCartItemVariants(prisma, options)
					: null

			printJson({
				mode: options.apply ? 'apply' : 'dry-run',
				audit,
				backfill,
				cartItemBackfill
			})
			return
		}

		printAudit(audit, options)

		if (!options.apply) {
			console.log(
				colors.yellow(
					`Dry-run only. Re-run with --apply to create ${audit.summary.productsWithoutVariants} default variants.`
				)
			)
			return
		}

		assertNoBlockingAuditIssues(audit)
		const backfill = await backfillDefaultVariants(prisma, options)
		printBackfill(backfill)
		if (options.applyCartItems) {
			const cartItemBackfill = await backfillOpenCartItemVariants(prisma, options)
			printCartItemBackfill(cartItemBackfill)
		}
	} finally {
		await prisma.$disconnect()
	}
}

async function collectAudit(prisma: PrismaClient, sampleLimit: number) {
	const [
		productsWithoutVariants,
		productsWithMultipleVariants,
		activeCartItemsWithoutVariant,
		duplicateVariantKeys,
		cartItemVariantMismatches,
		variantsWithNegativeStock,
		invalidPrices,
		productsWithoutVariantsSample,
		productsWithMultipleVariantsSample,
		duplicateVariantKeySample,
		cartItemVariantMismatchSample,
		negativeStockSample,
		invalidPriceSample
	] = await Promise.all([
		prisma.product.count({ where: productWithoutVariantsWhere }),
		countProductsWithMultipleVariants(prisma),
		prisma.cartItem.count({
			where: {
				deleteAt: null,
				variantId: null,
				cart: {
					deleteAt: null,
					status: { in: [...ACTIVE_CART_STATUSES] }
				}
			}
		}),
		countDuplicateVariantKeys(prisma),
		countCartItemVariantMismatches(prisma),
		prisma.productVariant.count({
			where: { deleteAt: null, stock: { lt: 0 } }
		}),
		countInvalidVariantPrices(prisma),
		prisma.product.findMany({
			where: productWithoutVariantsWhere,
			orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
			take: sampleLimit,
			select: {
				id: true,
				catalogId: true,
				name: true,
				sku: true,
				price: true
			}
		}),
		findProductsWithMultipleVariants(prisma, sampleLimit),
		findDuplicateVariantKeys(prisma, sampleLimit),
		findCartItemVariantMismatches(prisma, sampleLimit),
		prisma.productVariant.findMany({
			where: { deleteAt: null, stock: { lt: 0 } },
			orderBy: [{ stock: 'asc' }, { id: 'asc' }],
			take: sampleLimit,
			select: {
				id: true,
				productId: true,
				sku: true,
				variantKey: true,
				stock: true
			}
		}),
		findInvalidVariantPrices(prisma, sampleLimit)
	])

	return {
		summary: {
			productsWithoutVariants,
			productsWithMultipleVariants,
			activeCartItemsWithoutVariant,
			duplicateVariantKeyGroups: duplicateVariantKeys.groups,
			duplicateVariantKeyRows: duplicateVariantKeys.rows,
			cartItemVariantMismatches,
			variantsWithNegativeStock,
			variantsWithInvalidPrice: invalidPrices
		},
		samples: {
			productsWithoutVariants: productsWithoutVariantsSample,
			productsWithMultipleVariants: productsWithMultipleVariantsSample,
			duplicateVariantKeys: duplicateVariantKeySample,
			cartItemVariantMismatches: cartItemVariantMismatchSample,
			negativeStockVariants: negativeStockSample,
			invalidPriceVariants: invalidPriceSample
		}
	}
}

async function countDuplicateVariantKeys(prisma: PrismaClient) {
	const rows = await prisma.$queryRawUnsafe<
		Array<{ groups: number; rows: number }>
	>(`
		select
			count(*)::int as groups,
			coalesce(sum(duplicate_count - 1), 0)::int as rows
		from (
			select count(*)::int as duplicate_count
			from product_variants
			where delete_at is null
			group by product_id, variant_key
			having count(*) > 1
		) duplicates
	`)

	return {
		groups: Number(rows[0]?.groups ?? 0),
		rows: Number(rows[0]?.rows ?? 0)
	}
}

async function countProductsWithMultipleVariants(
	prisma: PrismaClient
): Promise<number> {
	const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(`
		select count(*)::int as count
		from (
			select product_id
			from product_variants
			where delete_at is null
			group by product_id
			having count(*) > 1
		) products
	`)

	return Number(rows[0]?.count ?? 0)
}

async function findProductsWithMultipleVariants(
	prisma: PrismaClient,
	limit: number
): Promise<ProductWithMultipleVariantsRow[]> {
	return prisma.$queryRawUnsafe<ProductWithMultipleVariantsRow[]>(`
		select
			product_id as "productId",
			count(*)::int as count
		from product_variants
		where delete_at is null
		group by product_id
		having count(*) > 1
		order by count desc, product_id asc
		limit ${toSafeLimit(limit)}
	`)
}

async function findDuplicateVariantKeys(
	prisma: PrismaClient,
	limit: number
): Promise<DuplicateVariantKeyRow[]> {
	return prisma.$queryRawUnsafe<DuplicateVariantKeyRow[]>(`
		select
			product_id as "productId",
			variant_key as "variantKey",
			count(*)::int as count
		from product_variants
		where delete_at is null
		group by product_id, variant_key
		having count(*) > 1
		order by count desc, product_id asc, variant_key asc
		limit ${toSafeLimit(limit)}
	`)
}

async function countCartItemVariantMismatches(
	prisma: PrismaClient
): Promise<number> {
	const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(`
		select count(*)::int as count
		from cart_items ci
		join carts c on c.id = ci.cart_id
		join product_variants pv on pv.id = ci.variant_id
		where ci.delete_at is null
			and c.delete_at is null
			and c.status in ('DRAFT', 'SHARED', 'IN_PROGRESS', 'PAUSED')
			and ci.variant_id is not null
			and pv.delete_at is null
			and pv.product_id <> ci.product_id
	`)

	return Number(rows[0]?.count ?? 0)
}

async function findCartItemVariantMismatches(
	prisma: PrismaClient,
	limit: number
): Promise<CartItemVariantMismatchRow[]> {
	return prisma.$queryRawUnsafe<CartItemVariantMismatchRow[]>(`
		select
			ci.id as "cartItemId",
			ci.product_id as "productId",
			ci.variant_id as "variantId",
			pv.product_id as "variantProductId"
		from cart_items ci
		join carts c on c.id = ci.cart_id
		join product_variants pv on pv.id = ci.variant_id
		where ci.delete_at is null
			and c.delete_at is null
			and c.status in ('DRAFT', 'SHARED', 'IN_PROGRESS', 'PAUSED')
			and ci.variant_id is not null
			and pv.delete_at is null
			and pv.product_id <> ci.product_id
		order by ci.updated_at desc, ci.id asc
		limit ${toSafeLimit(limit)}
	`)
}

async function countInvalidVariantPrices(prisma: PrismaClient) {
	const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(`
		select count(*)::int as count
		from product_variants
		where delete_at is null
			and (
				price is null
				or price < 0
				or price::text = 'NaN'
			)
	`)

	return Number(rows[0]?.count ?? 0)
}

async function findInvalidVariantPrices(
	prisma: PrismaClient,
	limit: number
): Promise<InvalidPriceRow[]> {
	return prisma.$queryRawUnsafe<InvalidPriceRow[]>(`
		select
			id,
			product_id as "productId",
			sku,
			variant_key as "variantKey",
			price::text as price
		from product_variants
		where delete_at is null
			and (
				price is null
				or price < 0
				or price::text = 'NaN'
			)
		order by product_id asc, variant_key asc, id asc
		limit ${toSafeLimit(limit)}
	`)
}

async function backfillDefaultVariants(
	prisma: PrismaClient,
	options: CliOptions
): Promise<BackfillResult> {
	const result: BackfillResult = {
		created: 0,
		skipped: 0,
		samples: []
	}

	while (true) {
		const products = await prisma.product.findMany({
			where: productWithoutVariantsWhere,
			orderBy: { id: 'asc' },
			take: options.batchSize,
			select: {
				id: true,
				catalogId: true,
				name: true,
				sku: true,
				price: true
			}
		})

		if (!products.length) break

		for (const product of products) {
			const created = await createDefaultVariantIfMissing(prisma, product)

			if (!created) {
				result.skipped += 1
				continue
			}

			result.created += 1
			if (result.samples.length < options.sampleLimit) {
				result.samples.push(created)
			}
		}
	}

	return result
}

async function createDefaultVariantIfMissing(
	prisma: PrismaClient,
	product: ProductWithoutVariantRow
) {
	return prisma.$transaction(async tx => {
		const existingCount = await tx.productVariant.count({
			where: { productId: product.id, deleteAt: null }
		})

		if (existingCount > 0) return null

		const sku = await resolveDefaultVariantSku(tx, product.sku, product.id)

		await tx.productVariant.create({
			data: {
				productId: product.id,
				sku,
				variantKey: DEFAULT_VARIANT_KEY,
				price: product.price as Prisma.Decimal,
				stock: 0,
				status: ProductVariantStatus.OUT_OF_STOCK,
				isAvailable: false
			}
		})

		return {
			productId: product.id,
			productSku: product.sku,
			variantSku: sku,
			variantKey: DEFAULT_VARIANT_KEY
		}
	})
}

async function backfillOpenCartItemVariants(
	prisma: PrismaClient,
	options: CliOptions
): Promise<CartItemBackfillResult> {
	const result: CartItemBackfillResult = {
		updated: 0,
		skipped: 0,
		samples: []
	}

	while (true) {
		const items = await prisma.cartItem.findMany({
			where: {
				deleteAt: null,
				variantId: null,
				cart: {
					deleteAt: null,
					status: { in: [...ACTIVE_CART_STATUSES] }
				}
			},
			orderBy: { id: 'asc' },
			take: options.batchSize,
			select: {
				id: true,
				productId: true,
				product: {
					select: {
						variants: {
							where: { deleteAt: null },
							orderBy: [{ variantKey: 'asc' }, { id: 'asc' }],
							select: { id: true, variantKey: true },
							take: 2
						}
					}
				}
			}
		})

		if (!items.length) break

		let updatedInBatch = 0
		for (const item of items) {
			const [variant] = item.product.variants
			const shouldUpdate =
				item.product.variants.length === 1 &&
				variant?.variantKey === DEFAULT_VARIANT_KEY

			if (!shouldUpdate) {
				result.skipped += 1
				continue
			}

			await prisma.cartItem.update({
				where: { id: item.id },
				data: { variantId: variant.id }
			})

			result.updated += 1
			updatedInBatch += 1
			if (result.samples.length < options.sampleLimit) {
				result.samples.push({
					cartItemId: item.id,
					productId: item.productId,
					variantId: variant.id
				})
			}
		}

		if (updatedInBatch === 0) break
	}

	return result
}

async function resolveDefaultVariantSku(
	tx: Prisma.TransactionClient,
	productSku: string,
	productId: string
) {
	const baseSku = productSku

	if (baseSku && (await isVariantSkuFree(tx, baseSku))) {
		return baseSku
	}

	const hash = createHash('sha1').update(productId).digest('hex').toUpperCase()

	for (const length of [8, 12, 16, 20, 32, 40]) {
		const suffix = `-D-${hash.slice(0, length)}`
		const head = baseSku.slice(0, SKU_MAX_LENGTH - suffix.length)
		const candidate = `${head}${suffix}`

		if (
			candidate.length <= SKU_MAX_LENGTH &&
			(await isVariantSkuFree(tx, candidate))
		) {
			return candidate
		}
	}

	throw new Error(
		`Could not allocate stable variant SKU for product ${productId}`
	)
}

async function isVariantSkuFree(
	tx: Prisma.TransactionClient,
	sku: string
): Promise<boolean> {
	const existing = await tx.productVariant.findUnique({
		where: { sku },
		select: { id: true }
	})

	return !existing
}

function printAudit(
	audit: Awaited<ReturnType<typeof collectAudit>>,
	options: CliOptions
) {
	console.log(colors.cyan(colors.bold('Default product variants audit')))
	console.log(colors.dim(`mode=${options.apply ? 'apply' : 'dry-run'}`))
	console.log(colors.dim('Scope: non-deleted products/variants and open carts'))

	table([audit.summary], undefined, 1)
	printSample('Products without variants', audit.samples.productsWithoutVariants)
	printSample(
		'Products with multiple variants',
		audit.samples.productsWithMultipleVariants
	)
	printSample('Duplicate variantKey groups', audit.samples.duplicateVariantKeys)
	printSample(
		'Cart items with mismatched variant product',
		audit.samples.cartItemVariantMismatches
	)
	printSample('Variants with stock < 0', audit.samples.negativeStockVariants)
	printSample('Variants with invalid price', audit.samples.invalidPriceVariants)
}

function assertNoBlockingAuditIssues(
	audit: Awaited<ReturnType<typeof collectAudit>>
) {
	const blockers = [
		['duplicate variantKey rows', audit.summary.duplicateVariantKeyRows],
		[
			'open cart items with mismatched variant product',
			audit.summary.cartItemVariantMismatches
		],
		['variants with stock < 0', audit.summary.variantsWithNegativeStock],
		['variants with invalid price', audit.summary.variantsWithInvalidPrice]
	].filter(([, count]) => Number(count) > 0)

	if (!blockers.length) return

	const details = blockers
		.map(([label, count]) => `${label}: ${count}`)
		.join('; ')
	throw new Error(
		`Audit has blocking data issues. Fix them before applying backfill: ${details}`
	)
}

function printSample(label: string, rows: unknown[]) {
	console.log(colors.bold(label))
	table(rows, undefined, rows.length)
}

function printBackfill(result: BackfillResult) {
	console.log(colors.green('Backfill complete'))
	table(
		[
			{
				created: result.created,
				skipped: result.skipped
			}
		],
		undefined,
		1
	)
	printSample('Created default variants sample', result.samples)
}

function printCartItemBackfill(result: CartItemBackfillResult) {
	console.log(colors.green('Open cart item variant backfill complete'))
	table(
		[
			{
				updated: result.updated,
				skipped: result.skipped
			}
		],
		undefined,
		1
	)
	printSample('Updated cart items sample', result.samples)
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = {
		apply: false,
		applyCartItems: false,
		json: false,
		help: false,
		batchSize: DEFAULT_BATCH_SIZE,
		sampleLimit: DEFAULT_SAMPLE_LIMIT
	}

	for (const arg of args) {
		if (arg === '--apply') {
			options.apply = true
			continue
		}
		if (arg === '--apply-cart-items') {
			options.applyCartItems = true
			continue
		}
		if (arg === '--json') {
			options.json = true
			continue
		}
		if (arg === '--help' || arg === '-h') {
			options.help = true
			continue
		}
		if (arg.startsWith('--batch-size=')) {
			options.batchSize = parsePositiveInt(arg, '--batch-size')
			continue
		}
		if (arg.startsWith('--sample-limit=')) {
			options.sampleLimit = parsePositiveInt(arg, '--sample-limit')
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	options.batchSize = Math.min(options.batchSize, 1000)
	options.sampleLimit = Math.min(options.sampleLimit, 200)
	if (options.applyCartItems && !options.apply) {
		throw new Error('--apply-cart-items requires --apply')
	}

	return options
}

function parsePositiveInt(arg: string, name: string) {
	const value = Number.parseInt(arg.slice(name.length + 1), 10)
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`)
	}
	return value
}

function toSafeLimit(limit: number) {
	if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_SAMPLE_LIMIT
	return Math.min(limit, 200)
}

function printHelp() {
	console.log(`Usage:
  bun run db:audit-default-variants -- [options]
  bun run scripts/audit-default-product-variants.ts [options]

Audits default product variant readiness. The script is read-only by default.

Options:
  --apply               Create missing default variants
  --apply-cart-items    Attach open cart items to their sole default variant
  --json                Print machine-readable output
  --batch-size=<n>      Apply batch size, default ${DEFAULT_BATCH_SIZE}
  --sample-limit=<n>    Max sample rows per section, default ${DEFAULT_SAMPLE_LIMIT}
  -h, --help            Show this help
`)
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
