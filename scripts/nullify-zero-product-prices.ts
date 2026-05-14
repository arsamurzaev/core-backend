import 'dotenv/config'

import { Prisma } from '../prisma/generated/client.js'

import { createPrismaClient, validateDatabaseEnv } from './db-console/prisma.js'

type CliOptions = {
	apply: boolean
	help: boolean
	includeVariants: boolean
	sampleLimit: number
}

const ZERO_PRICE = new Prisma.Decimal(0)
const DEFAULT_SAMPLE_LIMIT = 20

function parseOptions(argv: string[]): CliOptions {
	const options: CliOptions = {
		apply: false,
		help: false,
		includeVariants: false,
		sampleLimit: DEFAULT_SAMPLE_LIMIT
	}

	for (const arg of argv) {
		if (arg === '--apply') {
			options.apply = true
			continue
		}
		if (arg === '--include-variants') {
			options.includeVariants = true
			continue
		}
		if (arg === '--help' || arg === '-h') {
			options.help = true
			continue
		}
		if (arg.startsWith('--sample-limit=')) {
			const value = Number(arg.slice('--sample-limit='.length))
			if (Number.isInteger(value) && value >= 0) {
				options.sampleLimit = value
			}
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	return options
}

function printHelp() {
	console.log(`
Usage:
  bun run scripts/nullify-zero-product-prices.ts [--apply] [--include-variants] [--sample-limit=20]

By default the script runs in dry-run mode and only prints how many rows match.

Options:
  --apply             Set zero prices to NULL.
  --include-variants  Also set product_variants.price = NULL where price = 0.
  --sample-limit=N    Print up to N sample rows.
`)
}

async function main() {
	const options = parseOptions(process.argv.slice(2))
	if (options.help) {
		printHelp()
		return
	}

	validateDatabaseEnv()
	const prisma = createPrismaClient()

	try {
		await prisma.$connect()

		const [productsCount, productSamples] = await Promise.all([
			prisma.product.count({ where: { price: ZERO_PRICE } }),
			options.sampleLimit > 0
				? prisma.product.findMany({
						where: { price: ZERO_PRICE },
						select: {
							id: true,
							catalogId: true,
							sku: true,
							name: true
						},
						orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
						take: options.sampleLimit
					})
				: Promise.resolve([])
		])

		const [variantsCount, variantSamples] = options.includeVariants
			? await Promise.all([
					prisma.productVariant.count({ where: { price: ZERO_PRICE } }),
					options.sampleLimit > 0
						? prisma.productVariant.findMany({
								where: { price: ZERO_PRICE },
								select: {
									id: true,
									productId: true,
									sku: true,
									variantKey: true
								},
								orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
								take: options.sampleLimit
							})
						: Promise.resolve([])
				])
			: [0, []]

		console.log(
			`Products with price=0: ${productsCount}${options.apply ? '' : ' (dry-run)'}`
		)
		if (productSamples.length) {
			console.table(productSamples)
		}

		if (options.includeVariants) {
			console.log(
				`Product variants with price=0: ${variantsCount}${options.apply ? '' : ' (dry-run)'}`
			)
			if (variantSamples.length) {
				console.table(variantSamples)
			}
		}

		if (!options.apply) {
			console.log('No changes were written. Add --apply to update rows.')
			return
		}

		const result = await prisma.$transaction(async tx => {
			const products = await tx.product.updateMany({
				where: { price: ZERO_PRICE },
				data: { price: null }
			})

			const variants = options.includeVariants
				? await tx.productVariant.updateMany({
						where: { price: ZERO_PRICE },
						data: { price: null }
					})
				: { count: 0 }

			return { products, variants }
		})

		console.log(`Updated products: ${result.products.count}`)
		if (options.includeVariants) {
			console.log(`Updated product variants: ${result.variants.count}`)
		}
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
