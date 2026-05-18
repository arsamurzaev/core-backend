import { PrismaPg } from '@prisma/adapter-pg'
import { parse as parseEnv } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

import {
	MigrationRunStatus,
	PrismaClient,
	SeoEntityType
} from '../../prisma/generated/client.js'

import { logLegacyEvent } from './legacy-migration/logging.js'
import {
	loadTargetCatalogs,
	loadTargetProducts,
	type TargetCatalog,
	type TargetProduct,
	upsertProductSeo
} from './legacy-migration/seo-sync.js'

type CliOptions = {
	help: boolean
	apply: boolean
	source: string
	limit: number | null
	catalogIds: string[]
	productIds: string[]
}

type DatabaseEnvPrefix = 'DATABASE'

type ProductSeoStats = {
	catalogs: number
	products: number
	existingProductSeo: number
	missingProductSeo: number
	candidates: number
	wouldCreate: number
	wouldUpdate: number
	created: number
	updated: number
	skippedMissingCatalog: number
}

const DEFAULT_SOURCE_NAME = 'product-seo-rebuild'
const PHASE = 'product-seo-rebuild'
const CHUNK_SIZE = 500

async function main() {
	loadMigrationEnv()
	const options = parseCliOptions(process.argv.slice(2))

	if (options.help) {
		printHelp()
		return
	}

	const targetDatabaseUrl = readRequiredEnv('DATABASE_URI', 'DATABASE_URL')
	const prisma = new PrismaClient({
		adapter: new PrismaPg(
			buildDatabasePoolConfig('DATABASE', targetDatabaseUrl, PHASE)
		)
	})

	let runId: string | null = null
	try {
		await prisma.$connect()

		const run = await prisma.migrationRun.create({
			data: {
				source: options.source,
				phase: PHASE,
				dryRun: !options.apply,
				options: {
					apply: options.apply,
					source: options.source,
					limit: options.limit,
					catalogIds: options.catalogIds,
					productIds: options.productIds
				}
			},
			select: { id: true }
		})
		runId = run.id

		logStep('started', {
			runId,
			mode: options.apply ? 'apply' : 'dry-run',
			limit: options.limit,
			catalogIds: options.catalogIds,
			productIds: options.productIds
		})

		const catalogIds = await resolveCatalogIds(prisma, options)
		const [catalogs, products] = await Promise.all([
			loadTargetCatalogs(prisma, catalogIds),
			loadTargetProducts(prisma, catalogIds, options.productIds)
		])
		const candidates = products.slice(0, options.limit ?? undefined)
		const catalogById = new Map(catalogs.map(catalog => [catalog.id, catalog]))
		const existingSeoProductIds = await loadExistingProductSeoIds(
			prisma,
			candidates.map(product => product.id)
		)
		const stats = createDryRunStats({
			catalogs: catalogs.length,
			products: products.length,
			candidates,
			existingSeoProductIds,
			catalogById
		})

		logStep('candidates collected', {
			catalogs: stats.catalogs,
			products: stats.products,
			candidates: stats.candidates,
			wouldCreate: stats.wouldCreate,
			wouldUpdate: stats.wouldUpdate
		})

		const summary = options.apply
			? await applyRebuild(candidates, catalogById, prisma, stats)
			: stats

		await prisma.migrationRun.update({
			where: { id: runId },
			data: {
				status: MigrationRunStatus.COMPLETED,
				finishedAt: new Date(),
				summary
			}
		})

		logLegacyEvent({
			channel: 'result',
			phase: PHASE,
			message: options.apply
				? 'product SEO rebuild applied'
				: 'product SEO rebuild dry-run completed',
			details: summary
		})
	} catch (error) {
		if (runId) {
			await prisma.migrationRun.update({
				where: { id: runId },
				data: {
					status: MigrationRunStatus.FAILED,
					finishedAt: new Date(),
					error: error instanceof Error ? error.message : String(error)
				}
			})
		}
		throw error
	} finally {
		await prisma.$disconnect()
	}
}

async function resolveCatalogIds(
	prisma: PrismaClient,
	options: CliOptions
): Promise<string[]> {
	if (options.catalogIds.length > 0) return options.catalogIds

	if (options.productIds.length > 0) {
		const products = await prisma.product.findMany({
			where: {
				id: { in: options.productIds },
				deleteAt: null
			},
			select: { catalogId: true }
		})
		return Array.from(new Set(products.map(product => product.catalogId)))
	}

	const catalogs = await prisma.catalog.findMany({
		where: { deleteAt: null },
		select: { id: true },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
	})
	return catalogs.map(catalog => catalog.id)
}

async function loadExistingProductSeoIds(
	prisma: PrismaClient,
	productIds: string[]
): Promise<Set<string>> {
	const result = new Set<string>()
	for (const chunk of chunkArray(productIds, CHUNK_SIZE)) {
		const rows = await prisma.seoSetting.findMany({
			where: {
				entityType: SeoEntityType.PRODUCT,
				entityId: { in: chunk }
			},
			select: { entityId: true }
		})
		for (const row of rows) {
			result.add(row.entityId)
		}
	}
	return result
}

function createDryRunStats(input: {
	catalogs: number
	products: number
	candidates: TargetProduct[]
	existingSeoProductIds: Set<string>
	catalogById: Map<string, TargetCatalog>
}): ProductSeoStats {
	const actionable = input.candidates.filter(product =>
		input.catalogById.has(product.catalogId)
	)
	const existingProductSeo = actionable.filter(product =>
		input.existingSeoProductIds.has(product.id)
	).length
	const missingProductSeo = actionable.length - existingProductSeo

	return {
		catalogs: input.catalogs,
		products: input.products,
		existingProductSeo,
		missingProductSeo,
		candidates: actionable.length,
		wouldCreate: missingProductSeo,
		wouldUpdate: existingProductSeo,
		created: 0,
		updated: 0,
		skippedMissingCatalog: input.candidates.length - actionable.length
	}
}

async function applyRebuild(
	products: TargetProduct[],
	catalogById: Map<string, TargetCatalog>,
	prisma: PrismaClient,
	baseStats: ProductSeoStats
): Promise<ProductSeoStats> {
	const stats = { ...baseStats, created: 0, updated: 0 }

	for (const product of products) {
		const catalog = catalogById.get(product.catalogId)
		if (!catalog) continue

		const existed = await upsertProductSeo(prisma, catalog, product)
		if (existed) stats.updated += 1
		else stats.created += 1
	}

	return stats
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = {
		help: false,
		apply: false,
		source: DEFAULT_SOURCE_NAME,
		limit: null,
		catalogIds: [],
		productIds: []
	}

	for (const arg of args) {
		if (arg === '--help' || arg === '-h') {
			options.help = true
			continue
		}

		if (arg === '--apply') {
			options.apply = true
			continue
		}

		if (arg.startsWith('--source=')) {
			options.source = readStringValue(arg, '--source=') || DEFAULT_SOURCE_NAME
			continue
		}

		if (arg.startsWith('--limit=')) {
			options.limit = parsePositiveIntArg(arg, '--limit=')
			continue
		}

		if (arg.startsWith('--catalog=')) {
			options.catalogIds.push(...parseCsvArg(arg, '--catalog='))
			continue
		}

		if (arg.startsWith('--product=')) {
			options.productIds.push(...parseCsvArg(arg, '--product='))
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	options.catalogIds = Array.from(new Set(options.catalogIds))
	options.productIds = Array.from(new Set(options.productIds))
	return options
}

function parsePositiveIntArg(arg: string, prefix: string): number {
	const raw = readStringValue(arg, prefix)
	const parsed = Number.parseInt(raw, 10)
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error(`Invalid ${prefix}${raw}`)
	}
	return parsed
}

function parseCsvArg(arg: string, prefix: string): string[] {
	return readStringValue(arg, prefix)
		.split(',')
		.map(value => value.trim())
		.filter(Boolean)
}

function readRequiredEnv(...names: string[]): string {
	for (const name of names) {
		const value = process.env[name]?.trim()
		if (value) return value
	}

	throw new Error(
		`Missing required environment variable. Expected one of: ${names.join(', ')}`
	)
}

function readStringValue(arg: string, prefix: string): string {
	return arg.slice(prefix.length).trim()
}

function chunkArray<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}
	return chunks
}

function printHelp() {
	console.log(
		`
Product SEO rebuild

Usage:
  npm run legacy:rebuild-product-seo
  npm run legacy:rebuild-product-seo -- --apply
  npm run legacy:rebuild-product-seo -- --catalog=uuid1,uuid2 --apply
  npm run legacy:rebuild-product-seo -- --product=uuid1,uuid2 --apply
  npm run legacy:rebuild-product-seo -- --limit=100

What it does:
  - rebuilds only SeoSetting rows where entityType=PRODUCT
  - uses the current UTF-8 product SEO generator
  - overwrites generated product SEO fields with clean Russian text
  - does not touch catalog/category SEO, products, variants, categories or media
  - dry-run by default; pass --apply to write changes
	`.trim()
	)
}

function loadMigrationEnv() {
	const customEnvFile = process.env.LEGACY_MIGRATION_ENV_FILE?.trim() || null
	const protectedKeys = new Set(Object.keys(process.env))
	const envFiles = dedupeEnvFiles([
		'.env',
		path.join('migration', '.env'),
		path.join('migration', '.env.local'),
		customEnvFile
	])

	for (const envFile of envFiles) {
		const absolutePath = path.resolve(process.cwd(), envFile)
		if (!existsSync(absolutePath)) continue

		const parsed = parseEnv(readFileSync(absolutePath))
		for (const [key, value] of Object.entries(parsed)) {
			if (protectedKeys.has(key) && process.env[key] !== undefined) {
				continue
			}

			process.env[key] = value
		}
	}
}

function dedupeEnvFiles(files: Array<string | null>): string[] {
	return Array.from(
		new Set(files.map(file => file?.trim() ?? '').filter(file => file.length > 0))
	)
}

function buildDatabasePoolConfig(
	prefix: DatabaseEnvPrefix,
	connectionString: string,
	applicationName: string
): pg.PoolConfig {
	const ssl = resolveSslOptions(prefix)
	const resolvedConnectionString = ssl
		? sanitizeConnectionStringForExplicitSsl(connectionString)
		: connectionString

	return {
		connectionString: resolvedConnectionString,
		application_name: applicationName,
		...(ssl ? { ssl } : {})
	}
}

function resolveSslOptions(
	prefix: DatabaseEnvPrefix
): pg.PoolConfig['ssl'] | undefined {
	const mode = readEnv(`${prefix}_SSL_MODE`)?.toLowerCase() ?? null
	const enabled = readBooleanEnv(`${prefix}_SSL`)
	const rejectUnauthorized = readBooleanEnv(`${prefix}_SSL_REJECT_UNAUTHORIZED`)

	const shouldUseSsl =
		enabled ?? (mode ? !['disable', 'false', 'off'].includes(mode) : undefined)

	if (!shouldUseSsl) return undefined

	return {
		rejectUnauthorized:
			rejectUnauthorized ??
			(mode ? !['no-verify', 'require', 'prefer', 'allow'].includes(mode) : true)
	}
}

function readEnv(name: string): string | null {
	const value = process.env[name]?.trim()
	return value ? value : null
}

function readBooleanEnv(name: string): boolean | undefined {
	const value = readEnv(name)
	if (!value) return undefined

	switch (value.toLowerCase()) {
		case '1':
		case 'true':
		case 'yes':
		case 'on':
			return true
		case '0':
		case 'false':
		case 'no':
		case 'off':
			return false
		default:
			throw new Error(`Invalid boolean env value for ${name}: ${value}`)
	}
}

function sanitizeConnectionStringForExplicitSsl(
	connectionString: string
): string {
	try {
		const url = new URL(connectionString)
		for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
			url.searchParams.delete(key)
		}
		return url.toString()
	} catch {
		return connectionString
	}
}

function logStep(message: string, details?: Record<string, unknown>) {
	logLegacyEvent({
		channel: 'phase',
		phase: PHASE,
		scope: 'step',
		message,
		details
	})
}

main().catch(error => {
	console.error('Product SEO rebuild failed:', error)
	process.exitCode = 1
})
