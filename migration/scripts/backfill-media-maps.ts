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

type CliOptions = {
	help: boolean
	apply: boolean
	source: string
	limit: number | null
	catalogIds: string[]
}

type DatabaseEnvPrefix = 'DATABASE'

type MediaMapCandidate = {
	legacyId: string
	targetId: string
	payload: Prisma.InputJsonValue
}

type BackfillStats = {
	candidates: number
	created: number
	updatedMissingTarget: number
	skippedExisting: number
	skippedConflict: number
	skippedMissingMedia: number
}

const DEFAULT_SOURCE_NAME = 'old-code'
const PHASE = 'media-map-backfill'

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
			buildDatabasePoolConfig(
				'DATABASE',
				targetDatabaseUrl,
				'legacy-media-map-backfill'
			)
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
					catalogIds: options.catalogIds
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
			catalogIds: options.catalogIds
		})

		const candidates = await collectCandidates(prisma, options)
		logStep('candidates collected', { candidates: candidates.length })

		const stats = options.apply
			? await applyCandidates(prisma, runId, options.source, candidates)
			: await analyzeCandidates(prisma, options.source, candidates)

		await prisma.migrationRun.update({
			where: { id: runId },
			data: {
				status: MigrationRunStatus.COMPLETED,
				finishedAt: new Date(),
				summary: stats
			}
		})

		logLegacyEvent({
			channel: 'result',
			phase: PHASE,
			message: options.apply ? 'backfill applied' : 'dry-run completed',
			details: stats
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

async function collectCandidates(
	prisma: PrismaClient,
	options: CliOptions
): Promise<MediaMapCandidate[]> {
	const catalogWhere =
		options.catalogIds.length > 0
			? {
					targetId: { in: options.catalogIds }
				}
			: {}

	const [businessMaps, categoryMaps, productMaps] = await Promise.all([
		prisma.migrationEntityMap.findMany({
			where: {
				source: options.source,
				entity: MigrationEntityKind.BUSINESS,
				...catalogWhere
			},
			select: { legacyId: true, targetId: true }
		}),
		prisma.migrationEntityMap.findMany({
			where: {
				source: options.source,
				entity: MigrationEntityKind.CATEGORY
			},
			select: { legacyId: true, targetId: true }
		}),
		prisma.migrationEntityMap.findMany({
			where: {
				source: options.source,
				entity: MigrationEntityKind.PRODUCT
			},
			select: { legacyId: true, targetId: true }
		})
	])

	const allowedCatalogIds =
		options.catalogIds.length > 0 ? new Set(options.catalogIds) : null

	const candidates: MediaMapCandidate[] = [
		...(await collectCatalogConfigCandidates(prisma, businessMaps)),
		...(await collectCategoryCandidates(prisma, categoryMaps, allowedCatalogIds)),
		...(await collectProductCandidates(prisma, productMaps, allowedCatalogIds))
	]

	return dedupeCandidates(candidates).slice(0, options.limit ?? undefined)
}

async function collectCatalogConfigCandidates(
	prisma: PrismaClient,
	businessMaps: Array<{ legacyId: string; targetId: string }>
): Promise<MediaMapCandidate[]> {
	if (businessMaps.length === 0) return []

	const legacyBusinessIdByCatalogId = new Map(
		businessMaps.map(map => [map.targetId, map.legacyId])
	)
	const configs = await prisma.catalogConfig.findMany({
		where: {
			catalogId: { in: Array.from(legacyBusinessIdByCatalogId.keys()) },
			OR: [{ logoMediaId: { not: null } }, { bgMediaId: { not: null } }]
		},
		select: {
			catalogId: true,
			logoMediaId: true,
			bgMediaId: true
		}
	})

	const candidates: MediaMapCandidate[] = []
	for (const config of configs) {
		const legacyBusinessId = legacyBusinessIdByCatalogId.get(config.catalogId)
		if (!legacyBusinessId) continue

		if (config.logoMediaId) {
			candidates.push({
				legacyId: `business:${legacyBusinessId}:logo`,
				targetId: config.logoMediaId,
				payload: {
					kind: 'catalog-logo',
					targetEntityId: config.catalogId,
					backfilled: true
				}
			})
		}

		if (config.bgMediaId) {
			candidates.push({
				legacyId: `business:${legacyBusinessId}:bg`,
				targetId: config.bgMediaId,
				payload: {
					kind: 'catalog-background',
					targetEntityId: config.catalogId,
					backfilled: true
				}
			})
		}
	}

	return candidates
}

async function collectCategoryCandidates(
	prisma: PrismaClient,
	categoryMaps: Array<{ legacyId: string; targetId: string }>,
	allowedCatalogIds: Set<string> | null
): Promise<MediaMapCandidate[]> {
	if (categoryMaps.length === 0) return []

	const legacyCategoryIdByCategoryId = new Map(
		categoryMaps.map(map => [map.targetId, map.legacyId])
	)
	const categories = await prisma.category.findMany({
		where: {
			id: { in: Array.from(legacyCategoryIdByCategoryId.keys()) },
			imageMediaId: { not: null },
			...(allowedCatalogIds ? { catalogId: { in: Array.from(allowedCatalogIds) } } : {})
		},
		select: {
			id: true,
			catalogId: true,
			imageMediaId: true
		}
	})

	return categories.flatMap(category => {
		if (!category.imageMediaId) return []
		const legacyCategoryId = legacyCategoryIdByCategoryId.get(category.id)
		if (!legacyCategoryId) return []

		return [
			{
				legacyId: `category:${legacyCategoryId}:image`,
				targetId: category.imageMediaId,
				payload: {
					kind: 'category-image',
					targetEntityId: category.id,
					catalogId: category.catalogId,
					backfilled: true
				}
			}
		]
	})
}

async function collectProductCandidates(
	prisma: PrismaClient,
	productMaps: Array<{ legacyId: string; targetId: string }>,
	allowedCatalogIds: Set<string> | null
): Promise<MediaMapCandidate[]> {
	if (productMaps.length === 0) return []

	const legacyProductIdByProductId = new Map(
		productMaps.map(map => [map.targetId, map.legacyId])
	)
	const productMedia = await prisma.productMedia.findMany({
		where: {
			productId: { in: Array.from(legacyProductIdByProductId.keys()) },
			...(allowedCatalogIds
				? { product: { catalogId: { in: Array.from(allowedCatalogIds) } } }
				: {})
		},
		select: {
			productId: true,
			mediaId: true,
			position: true,
			product: {
				select: { catalogId: true }
			}
		},
		orderBy: [{ productId: 'asc' }, { position: 'asc' }]
	})

	return productMedia.flatMap(item => {
		const legacyProductId = legacyProductIdByProductId.get(item.productId)
		if (!legacyProductId) return []

		return [
			{
				legacyId: `product:${legacyProductId}:image:${item.position + 1}`,
				targetId: item.mediaId,
				payload: {
					kind: 'product-image',
					targetEntityId: item.productId,
					catalogId: item.product.catalogId,
					position: item.position,
					backfilled: true
				}
			}
		]
	})
}

async function analyzeCandidates(
	prisma: PrismaClient,
	source: string,
	candidates: MediaMapCandidate[]
): Promise<BackfillStats> {
	const stats = createEmptyStats(candidates.length)
	for (const candidate of candidates) {
		const outcome = await resolveCandidateOutcome(prisma, source, candidate)
		incrementStats(stats, outcome)
	}
	return stats
}

async function applyCandidates(
	prisma: PrismaClient,
	runId: string,
	source: string,
	candidates: MediaMapCandidate[]
): Promise<BackfillStats> {
	const stats = createEmptyStats(candidates.length)

	for (const candidate of candidates) {
		await runMigrationTransaction(prisma, async tx => {
			const outcome = await resolveCandidateOutcome(tx, source, candidate)
			incrementStats(stats, outcome)

			if (outcome === 'create') {
				await tx.migrationEntityMap.create({
					data: {
						runId,
						source,
						entity: MigrationEntityKind.MEDIA,
						legacyId: candidate.legacyId,
						targetId: candidate.targetId,
						payload: candidate.payload
					}
				})
				return
			}

			if (outcome === 'update-missing-target') {
				await tx.migrationEntityMap.updateMany({
					where: {
						source,
						entity: MigrationEntityKind.MEDIA,
						legacyId: candidate.legacyId
					},
					data: {
						runId,
						targetId: candidate.targetId,
						payload: candidate.payload
					}
				})
			}
		})
	}

	return stats
}

async function resolveCandidateOutcome(
	db: Pick<PrismaClient, 'media' | 'migrationEntityMap'> | Prisma.TransactionClient,
	source: string,
	candidate: MediaMapCandidate
): Promise<
	| 'create'
	| 'update-missing-target'
	| 'skip-existing'
	| 'skip-conflict'
	| 'skip-missing-media'
> {
	const targetMedia = await db.media.findFirst({
		where: { id: candidate.targetId },
		select: { id: true }
	})
	if (!targetMedia) return 'skip-missing-media'

	const existingMap = await db.migrationEntityMap.findFirst({
		where: {
			source,
			entity: MigrationEntityKind.MEDIA,
			legacyId: candidate.legacyId
		},
		select: { targetId: true }
	})

	if (!existingMap) return 'create'
	if (existingMap.targetId === candidate.targetId) return 'skip-existing'

	const existingMedia = await db.media.findFirst({
		where: { id: existingMap.targetId },
		select: { id: true }
	})

	return existingMedia ? 'skip-conflict' : 'update-missing-target'
}

function incrementStats(
	stats: BackfillStats,
	outcome:
		| 'create'
		| 'update-missing-target'
		| 'skip-existing'
		| 'skip-conflict'
		| 'skip-missing-media'
) {
	switch (outcome) {
		case 'create':
			stats.created += 1
			return
		case 'update-missing-target':
			stats.updatedMissingTarget += 1
			return
		case 'skip-existing':
			stats.skippedExisting += 1
			return
		case 'skip-conflict':
			stats.skippedConflict += 1
			return
		case 'skip-missing-media':
			stats.skippedMissingMedia += 1
			return
	}
}

function createEmptyStats(candidates: number): BackfillStats {
	return {
		candidates,
		created: 0,
		updatedMissingTarget: 0,
		skippedExisting: 0,
		skippedConflict: 0,
		skippedMissingMedia: 0
	}
}

function dedupeCandidates(candidates: MediaMapCandidate[]): MediaMapCandidate[] {
	const seen = new Set<string>()
	const result: MediaMapCandidate[] = []

	for (const candidate of candidates) {
		if (seen.has(candidate.legacyId)) continue
		seen.add(candidate.legacyId)
		result.push(candidate)
	}

	return result
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = {
		help: false,
		apply: false,
		source: DEFAULT_SOURCE_NAME,
		limit: null,
		catalogIds: []
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
			const raw = readStringValue(arg, '--limit=')
			const parsed = Number.parseInt(raw, 10)
			if (!Number.isFinite(parsed) || parsed < 1) {
				throw new Error(`Invalid --limit value: ${raw}`)
			}
			options.limit = parsed
			continue
		}

		if (arg.startsWith('--catalog=')) {
			options.catalogIds.push(
				...readStringValue(arg, '--catalog=')
					.split(',')
					.map(value => value.trim())
					.filter(Boolean)
			)
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	options.catalogIds = Array.from(new Set(options.catalogIds))
	return options
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

function printHelp() {
	console.log(
		`
Legacy media map backfill

Usage:
  npm run legacy:backfill-media-maps
  npm run legacy:backfill-media-maps -- --apply
  npm run legacy:backfill-media-maps -- --catalog=uuid1,uuid2 --apply
  npm run legacy:backfill-media-maps -- --limit=100

What it does:
  - creates missing migration_entity_maps rows for entity=MEDIA
  - never downloads or uploads images
  - product images are matched by existing ProductMedia.position
  - category images are matched by Category.imageMediaId
  - catalog logo/background are matched by CatalogConfig.logoMediaId/bgMediaId
  - existing valid MEDIA mappings are kept as-is
  - conflicting MEDIA mappings are skipped, not overwritten
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
	console.error('Legacy media map backfill failed:', error)
	process.exitCode = 1
})
