import { PrismaPg } from '@prisma/adapter-pg'
import { parse as parseEnv } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

import {
	MigrationEntityKind,
	MigrationRunStatus,
	Prisma,
	PrismaClient
} from '../../prisma/generated/client.js'

import { logLegacyEvent } from './legacy-migration/logging.js'
import { runMigrationTransaction } from './legacy-migration/migration-utils.js'
import {
	buildLegacyProductId,
	type LegacyProductRow,
	loadLegacyProductsData
} from './legacy-migration/products-source.js'

type CliOptions = {
	help: boolean
	apply: boolean
	source: string
	limit: number | null
	maxLength: number
	catalogIds: string[]
	businessIds: string[]
}

type DatabaseEnvPrefix = 'DATABASE' | 'LEGACY_DATABASE'

type BusinessMap = {
	legacyId: string
	targetId: string
}

type ProductMap = {
	legacyId: string
	targetId: string
}

type ExistingDescriptionAttribute = {
	id: string
	attributeId: string
	valueString: string | null
	deleteAt: Date | null
}

type TargetProduct = {
	id: string
	catalogId: string
	deleteAt: Date | null
	catalog: {
		typeId: string
	}
	productAttributes: ExistingDescriptionAttribute[]
}

type NormalizedDescription = {
	value: string
	sourceLength: number
	truncated: boolean
}

type DescriptionCandidate = {
	legacyId: string
	targetProductId: string
	attributeId: string
	value: string
	currentValue: string | null
	mode: 'create' | 'update'
	sourceLength: number
	truncated: boolean
}

type BackfillStats = {
	legacyBusinesses: number
	legacyProducts: number
	productsWithSourceDescription: number
	productMaps: number
	candidates: number
	wouldCreate: number
	wouldUpdate: number
	created: number
	updated: number
	unchanged: number
	truncatedSourceDescriptions: number
	skippedEmptySourceDescription: number
	skippedMissingProductMap: number
	skippedMissingTargetProduct: number
	skippedDeletedTargetProduct: number
	skippedMissingDescriptionAttribute: number
}

const DEFAULT_SOURCE_NAME = 'old-code'
const DEFAULT_MAX_DESCRIPTION_LENGTH = 3000
const PHASE = 'product-description-backfill'
const CHUNK_SIZE = 500

async function main() {
	loadMigrationEnv()
	const options = parseCliOptions(process.argv.slice(2))

	if (options.help) {
		printHelp()
		return
	}

	const targetDatabaseUrl = readRequiredEnv('DATABASE_URI', 'DATABASE_URL')
	const legacyDatabaseUrl = readRequiredEnv(
		'LEGACY_DATABASE_URI',
		'LEGACY_DATABASE_URL',
		'OLD_DATABASE_URL'
	)
	const prisma = new PrismaClient({
		adapter: new PrismaPg(
			buildDatabasePoolConfig(
				'DATABASE',
				targetDatabaseUrl,
				'legacy-product-description-backfill-target'
			)
		)
	})
	const legacyPool = new pg.Pool(
		buildDatabasePoolConfig(
			'LEGACY_DATABASE',
			legacyDatabaseUrl,
			'legacy-product-description-backfill-source'
		)
	)

	let runId: string | null = null
	try {
		await Promise.all([prisma.$connect(), legacyPool.query('SELECT 1')])
		await assertTargetDescriptionColumnCanStore(prisma, options.maxLength)

		const run = await prisma.migrationRun.create({
			data: {
				source: options.source,
				phase: PHASE,
				dryRun: !options.apply,
				options: {
					apply: options.apply,
					source: options.source,
					limit: options.limit,
					maxLength: options.maxLength,
					catalogIds: options.catalogIds,
					businessIds: options.businessIds
				}
			},
			select: { id: true }
		})
		runId = run.id

		logStep('started', {
			runId,
			mode: options.apply ? 'apply' : 'dry-run',
			source: options.source,
			limit: options.limit,
			maxLength: options.maxLength,
			catalogIds: options.catalogIds,
			businessIds: options.businessIds
		})

		const { candidates, stats } = await collectCandidates(
			prisma,
			legacyPool,
			options
		)
		logStep('candidates collected', {
			candidates: candidates.length,
			wouldCreate: stats.wouldCreate,
			wouldUpdate: stats.wouldUpdate
		})

		const summary = options.apply
			? await applyCandidates(prisma, candidates, stats)
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
			message: options.apply ? 'backfill applied' : 'dry-run completed',
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
		await Promise.allSettled([prisma.$disconnect(), legacyPool.end()])
	}
}

async function collectCandidates(
	prisma: PrismaClient,
	legacyPool: pg.Pool,
	options: CliOptions
): Promise<{ candidates: DescriptionCandidate[]; stats: BackfillStats }> {
	const businessMaps = await loadBusinessMaps(prisma, options)
	const legacyBusinessIds = businessMaps.map(map => map.legacyId)
	const legacyProductsData = await loadLegacyProductsData(legacyPool, {
		businessIds: legacyBusinessIds
	})
	const legacyProducts = legacyProductsData.products
	const stats = createEmptyStats({
		legacyBusinesses: businessMaps.length,
		legacyProducts: legacyProducts.length
	})

	const descriptionsByLegacyId = collectSourceDescriptions(
		legacyProducts,
		options.maxLength,
		stats
	)
	const legacyIds = Array.from(descriptionsByLegacyId.keys())
	const productMaps = await loadProductMaps(prisma, options.source, legacyIds)
	stats.productMaps = productMaps.length
	stats.skippedMissingProductMap = Math.max(
		0,
		legacyIds.length - productMaps.length
	)

	const targetProductsById = await loadTargetProducts(
		prisma,
		productMaps.map(map => map.targetId)
	)
	const descriptionAttributeIdByTypeId =
		await loadDescriptionAttributeIdsByTypeId(prisma, targetProductsById)

	const candidates: DescriptionCandidate[] = []
	for (const productMap of productMaps) {
		const description = descriptionsByLegacyId.get(productMap.legacyId)
		if (!description) continue

		const targetProduct = targetProductsById.get(productMap.targetId)
		if (!targetProduct) {
			stats.skippedMissingTargetProduct += 1
			continue
		}
		if (targetProduct.deleteAt) {
			stats.skippedDeletedTargetProduct += 1
			continue
		}

		const existing = pickExistingDescriptionAttribute(targetProduct)
		const attributeId =
			existing?.attributeId ??
			descriptionAttributeIdByTypeId.get(targetProduct.catalog.typeId)
		if (!attributeId) {
			stats.skippedMissingDescriptionAttribute += 1
			continue
		}

		const currentValue = existing?.valueString ?? null
		if (currentValue === description.value && !existing?.deleteAt) {
			stats.unchanged += 1
			continue
		}

		const mode = existing ? 'update' : 'create'
		if (mode === 'create') stats.wouldCreate += 1
		else stats.wouldUpdate += 1

		candidates.push({
			legacyId: productMap.legacyId,
			targetProductId: productMap.targetId,
			attributeId,
			value: description.value,
			currentValue,
			mode,
			sourceLength: description.sourceLength,
			truncated: description.truncated
		})
	}

	const limitedCandidates = candidates.slice(0, options.limit ?? undefined)
	stats.candidates = limitedCandidates.length
	stats.wouldCreate = limitedCandidates.filter(
		candidate => candidate.mode === 'create'
	).length
	stats.wouldUpdate = limitedCandidates.filter(
		candidate => candidate.mode === 'update'
	).length

	return {
		candidates: limitedCandidates,
		stats
	}
}

async function applyCandidates(
	prisma: PrismaClient,
	candidates: DescriptionCandidate[],
	baseStats: BackfillStats
): Promise<BackfillStats> {
	const stats = { ...baseStats, created: 0, updated: 0 }

	for (const candidate of candidates) {
		await runMigrationTransaction(prisma, async tx => {
			await tx.productAttribute.upsert({
				where: {
					productId_attributeId: {
						productId: candidate.targetProductId,
						attributeId: candidate.attributeId
					}
				},
				create: {
					productId: candidate.targetProductId,
					attributeId: candidate.attributeId,
					valueString: candidate.value
				},
				update: {
					enumValueId: null,
					valueString: candidate.value,
					valueInteger: null,
					valueDecimal: null,
					valueBoolean: null,
					valueDateTime: null,
					deleteAt: null
				}
			})
		})

		if (candidate.mode === 'create') stats.created += 1
		else stats.updated += 1
	}

	return stats
}

async function loadBusinessMaps(
	prisma: PrismaClient,
	options: CliOptions
): Promise<BusinessMap[]> {
	const maps = await prisma.migrationEntityMap.findMany({
		where: {
			source: options.source,
			entity: MigrationEntityKind.BUSINESS,
			...(options.catalogIds.length > 0
				? { targetId: { in: options.catalogIds } }
				: {}),
			...(options.businessIds.length > 0
				? { legacyId: { in: options.businessIds } }
				: {})
		},
		select: {
			legacyId: true,
			targetId: true
		},
		orderBy: [{ legacyId: 'asc' }]
	})

	return maps
}

async function loadProductMaps(
	prisma: PrismaClient,
	source: string,
	legacyIds: string[]
): Promise<ProductMap[]> {
	const maps: ProductMap[] = []
	for (const chunk of chunkArray(legacyIds, CHUNK_SIZE)) {
		maps.push(
			...(await prisma.migrationEntityMap.findMany({
				where: {
					source,
					entity: MigrationEntityKind.PRODUCT,
					legacyId: { in: chunk }
				},
				select: {
					legacyId: true,
					targetId: true
				}
			}))
		)
	}
	return maps
}

async function loadTargetProducts(
	prisma: PrismaClient,
	productIds: string[]
): Promise<Map<string, TargetProduct>> {
	const products: TargetProduct[] = []
	for (const chunk of chunkArray(productIds, CHUNK_SIZE)) {
		products.push(
			...(await prisma.product.findMany({
				where: { id: { in: chunk } },
				select: {
					id: true,
					catalogId: true,
					deleteAt: true,
					catalog: {
						select: { typeId: true }
					},
					productAttributes: {
						where: {
							attribute: { key: 'description' }
						},
						select: {
							id: true,
							attributeId: true,
							valueString: true,
							deleteAt: true
						},
						orderBy: [{ deleteAt: 'asc' }, { id: 'asc' }]
					}
				}
			}))
		)
	}

	return new Map(products.map(product => [product.id, product]))
}

async function loadDescriptionAttributeIdsByTypeId(
	prisma: PrismaClient,
	productsById: Map<string, TargetProduct>
): Promise<Map<string, string>> {
	const typeIds = Array.from(
		new Set(
			Array.from(productsById.values())
				.map(product => product.catalog.typeId)
				.filter(Boolean)
		)
	)
	const result = new Map<string, string>()
	if (typeIds.length === 0) return result

	const attributes = await prisma.attribute.findMany({
		where: {
			key: 'description',
			dataType: 'STRING',
			deleteAt: null,
			types: {
				some: {
					id: { in: typeIds }
				}
			}
		},
		select: {
			id: true,
			displayOrder: true,
			types: {
				where: { id: { in: typeIds } },
				select: { id: true }
			}
		},
		orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }]
	})

	for (const attribute of attributes) {
		for (const type of attribute.types) {
			if (!result.has(type.id)) {
				result.set(type.id, attribute.id)
			}
		}
	}

	return result
}

function collectSourceDescriptions(
	products: LegacyProductRow[],
	maxLength: number,
	stats: BackfillStats
): Map<string, NormalizedDescription> {
	const result = new Map<string, NormalizedDescription>()

	for (const product of products) {
		const legacyId = buildLegacyProductId(product)
		const normalized = normalizeDescription(product.description, maxLength)
		if (!normalized) {
			stats.skippedEmptySourceDescription += 1
			continue
		}
		if (normalized.truncated) {
			stats.truncatedSourceDescriptions += 1
		}

		result.set(legacyId, normalized)
	}

	stats.productsWithSourceDescription = result.size
	return result
}

function pickExistingDescriptionAttribute(
	product: TargetProduct
): ExistingDescriptionAttribute | null {
	return (
		product.productAttributes.find(attribute => !attribute.deleteAt) ??
		product.productAttributes[0] ??
		null
	)
}

function normalizeDescription(
	value: string | null | undefined,
	maxLength: number
): NormalizedDescription | null {
	if (typeof value !== 'string') return null

	const sanitized = sanitizeControlCharacters(value.trim())
		.replace(/\s+/g, ' ')
		.trim()

	if (!sanitized) return null

	const truncated = sanitized.length > maxLength
	return {
		value: truncated ? sanitized.slice(0, maxLength) : sanitized,
		sourceLength: sanitized.length,
		truncated
	}
}

function createEmptyStats(input: {
	legacyBusinesses: number
	legacyProducts: number
}): BackfillStats {
	return {
		legacyBusinesses: input.legacyBusinesses,
		legacyProducts: input.legacyProducts,
		productsWithSourceDescription: 0,
		productMaps: 0,
		candidates: 0,
		wouldCreate: 0,
		wouldUpdate: 0,
		created: 0,
		updated: 0,
		unchanged: 0,
		truncatedSourceDescriptions: 0,
		skippedEmptySourceDescription: 0,
		skippedMissingProductMap: 0,
		skippedMissingTargetProduct: 0,
		skippedDeletedTargetProduct: 0,
		skippedMissingDescriptionAttribute: 0
	}
}

async function assertTargetDescriptionColumnCanStore(
	prisma: PrismaClient,
	maxLength: number
) {
	const rows = await prisma.$queryRaw<
		Array<{
			dataType: string
			characterMaximumLength: number | null
		}>
	>(Prisma.sql`
		SELECT
			data_type AS "dataType",
			character_maximum_length AS "characterMaximumLength"
		FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'product_attributes'
			AND column_name = 'value_string'
		LIMIT 1
	`)

	const column = rows[0]
	if (!column) {
		throw new Error('Cannot inspect product_attributes.value_string column.')
	}

	if (
		column.characterMaximumLength !== null &&
		column.characterMaximumLength < maxLength
	) {
		throw new Error(
			`product_attributes.value_string is limited to ${column.characterMaximumLength}, but backfill max length is ${maxLength}. Remove the DB limit or pass --max-length=${column.characterMaximumLength}.`
		)
	}
}

function sanitizeControlCharacters(value: string): string {
	let result = ''

	for (const character of value) {
		const code = character.charCodeAt(0)
		result += isDisallowedControlCode(code) ? ' ' : character
	}

	return result
}

function isDisallowedControlCode(code: number): boolean {
	return (
		code === 0 ||
		(code >= 1 && code <= 8) ||
		code === 11 ||
		code === 12 ||
		(code >= 14 && code <= 31) ||
		code === 127
	)
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = {
		help: false,
		apply: false,
		source: DEFAULT_SOURCE_NAME,
		limit: null,
		maxLength: DEFAULT_MAX_DESCRIPTION_LENGTH,
		catalogIds: [],
		businessIds: []
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

		if (arg.startsWith('--max-length=')) {
			options.maxLength = parsePositiveIntArg(arg, '--max-length=')
			continue
		}

		if (arg.startsWith('--catalog=')) {
			options.catalogIds.push(...parseCsvArg(arg, '--catalog='))
			continue
		}

		if (arg.startsWith('--business=')) {
			options.businessIds.push(...parseCsvArg(arg, '--business='))
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	options.catalogIds = Array.from(new Set(options.catalogIds))
	options.businessIds = Array.from(new Set(options.businessIds))
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
Legacy product description backfill

Usage:
  npm run legacy:backfill-product-descriptions
  npm run legacy:backfill-product-descriptions -- --apply
  npm run legacy:backfill-product-descriptions -- --catalog=uuid1,uuid2 --apply
  npm run legacy:backfill-product-descriptions -- --business=legacyId1,legacyId2 --apply
  npm run legacy:backfill-product-descriptions -- --limit=100
  npm run legacy:backfill-product-descriptions -- --max-length=3000 --apply

What it does:
  - reads Product.description from the legacy database
  - resolves target products through migration_entity_maps entity=PRODUCT
  - updates only ProductAttribute.valueString for Attribute.key=description
  - skips products without a legacy description
  - does not touch Product, variants, categories, media, SEO or prices
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
	console.error('Legacy product description backfill failed:', error)
	process.exitCode = 1
})
