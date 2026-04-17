import { PrismaPg } from '@prisma/adapter-pg'
import { parse as parseEnv } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

import {
	MigrationEntityKind,
	MigrationIssueSeverity,
	MigrationRunStatus,
	Prisma,
	PrismaClient
} from '../../prisma/generated/client.js'

import { applyCatalogBootstrap } from './legacy-migration/catalog-bootstrap.js'
import { logLegacyEvent } from './legacy-migration/logging.js'
import {
	analyzeLegacyMediaData,
	applyLegacyMedia,
	collectLegacyMediaIssues
} from './legacy-migration/media-sync.js'
import {
	applyLegacyOrders,
	collectLegacyOrderIssues
} from './legacy-migration/order-sync.js'
import {
	analyzeLegacyOrdersData,
	type LegacyOrdersData,
	loadLegacyOrdersData
} from './legacy-migration/orders-source.js'
import {
	applyLegacyPayments,
	collectLegacyPaymentIssues
} from './legacy-migration/payment-sync.js'
import {
	analyzeLegacyFinanceData,
	type LegacyFinanceData,
	loadLegacyFinanceData
} from './legacy-migration/payments-source.js'
import {
	applyLegacyProducts,
	collectLegacyProductIssues
} from './legacy-migration/product-sync.js'
import {
	analyzeLegacyProductsData,
	type LegacyProductsData,
	loadLegacyProductsData
} from './legacy-migration/products-source.js'
import { buildLegacyReconciliationReport } from './legacy-migration/report-sync.js'
import {
	analyzeLegacySeoData,
	applyLegacySeo,
	collectLegacySeoIssues
} from './legacy-migration/seo-sync.js'
import {
	analyzeLegacyBusinesses,
	collectLegacyBusinessIssues,
	type LegacyBusinessRow,
	loadLegacyBusinesses
} from './legacy-migration/source.js'

type CliOptions = {
	help: boolean
	apply: boolean
	phase: string
	limit: number | null
	businessIds: string[]
	businessHosts: string[]
	credentialsFile: string | null
}

type DatabaseEnvPrefix = 'DATABASE' | 'LEGACY_DATABASE'

type MigrationSourceSnapshot = {
	businesses?: LegacyBusinessRow[]
	finance?: LegacyFinanceData
	orders?: LegacyOrdersData
	products?: LegacyProductsData
}

const SOURCE_NAME = 'old-code'
const ALL_PHASE = 'all'
const DEFAULT_PHASE = 'catalog-bootstrap'
const ORDERS_PHASE = 'orders'
const PAYMENTS_PHASE = 'payments'
const PRODUCTS_PHASE = 'products'
const MEDIA_PHASE = 'media'
const SEO_PHASE = 'seo'
const REPORT_PHASE = 'report'
const PIPELINE_PHASES = [
	DEFAULT_PHASE,
	PAYMENTS_PHASE,
	ORDERS_PHASE,
	PRODUCTS_PHASE,
	MEDIA_PHASE,
	SEO_PHASE,
	REPORT_PHASE
] as const

async function main() {
	loadMigrationEnv()
	const options = parseCliOptions(process.argv.slice(2))

	if (options.help) {
		printHelp()
		return
	}

	if (options.phase === ALL_PHASE) {
		await runAllPhases(options)
		return
	}

	await runSinglePhase(options)
}

async function runAllPhases(options: CliOptions) {
	const startedAt = Date.now()
	const sourceSnapshot: MigrationSourceSnapshot = {}

	logPhaseStep(ALL_PHASE, 'starting full migration pipeline', {
		mode: options.apply ? 'apply' : 'dry-run',
		limit: options.limit,
		businessIds: options.businessIds,
		phases: PIPELINE_PHASES
	})

	for (const [index, phase] of PIPELINE_PHASES.entries()) {
		const phaseApply = options.apply && phase !== REPORT_PHASE
		logPhaseStep(ALL_PHASE, 'starting pipeline phase', {
			step: index + 1,
			totalSteps: PIPELINE_PHASES.length,
			targetPhase: phase,
			mode: phaseApply ? 'apply' : 'dry-run'
		})

		await runSinglePhase(
			{
				...options,
				phase,
				apply: phaseApply
			},
			sourceSnapshot
		)

		logPhaseStep(ALL_PHASE, 'pipeline phase completed', {
			step: index + 1,
			totalSteps: PIPELINE_PHASES.length,
			targetPhase: phase,
			mode: phaseApply ? 'apply' : 'dry-run'
		})
	}

	logLegacyEvent({
		channel: 'result',
		phase: ALL_PHASE,
		scope: 'summary',
		message: 'full migration pipeline completed',
		details: {
			ok: true,
			mode: options.apply ? 'apply' : 'dry-run',
			limit: options.limit,
			businessIds: options.businessIds,
			phases: PIPELINE_PHASES,
			durationMs: Date.now() - startedAt
		}
	})
}

async function runSinglePhase(
	options: CliOptions,
	sourceSnapshot?: MigrationSourceSnapshot
) {
	const targetDatabaseUrl = readRequiredEnv('DATABASE_URI', 'DATABASE_URL')
	const legacyDatabaseUrl = readRequiredEnv(
		'LEGACY_DATABASE_URI',
		'LEGACY_DATABASE_URL',
		'OLD_DATABASE_URL'
	)

	logPhaseStep(options.phase, 'start', {
		mode: options.apply ? 'apply' : 'dry-run',
		limit: options.limit,
		businessIds: options.businessIds,
		credentialsFile: options.credentialsFile
	})

	const prisma = new PrismaClient({
		adapter: new PrismaPg(
			buildDatabasePoolConfig(
				'DATABASE',
				targetDatabaseUrl,
				'legacy-migration-target'
			)
		)
	})
	const legacyPool = new pg.Pool(
		buildDatabasePoolConfig(
			'LEGACY_DATABASE',
			legacyDatabaseUrl,
			'legacy-migration-source'
		)
	)

	let runId: string | null = null

	try {
		logPhaseStep(options.phase, 'connecting databases')
		await prisma.$connect()
		await legacyPool.query('SELECT 1')
		logPhaseStep(options.phase, 'databases connected')

		const run = await prisma.migrationRun.create({
			data: {
				source: SOURCE_NAME,
				phase: options.phase,
				dryRun: !options.apply,
				options: {
					apply: options.apply,
					businessIds: options.businessIds,
					limit: options.limit,
					credentialsFile: options.credentialsFile
				}
			},
			select: { id: true }
		})

		runId = run.id
		logPhaseStep(options.phase, 'migration run created', {
			runId: run.id
		})

		const businesses = await loadPhaseBusinesses(
			legacyPool,
			options,
			sourceSnapshot
		)

		if (options.businessIds.length > 0) {
			const loadedIds = new Set(businesses.map(b => b.id))
			const missing = options.businessIds.filter(id => !loadedIds.has(id))
			if (missing.length > 0) {
				throw new Error(
					`--business IDs not found in legacy DB: ${missing.join(', ')}`
				)
			}
		}

		if (options.businessHosts.length > 0) {
			const loadedHosts = new Set(businesses.map(b => b.host).filter(Boolean))
			const missing = options.businessHosts.filter(h => !loadedHosts.has(h))
			if (missing.length > 0) {
				throw new Error(
					`--host values not found in legacy DB: ${missing.join(', ')}`
				)
			}
		}
		let summary: Record<string, unknown>
		let issues: Array<{
			entity: MigrationEntityKind
			legacyId: string
			severity: MigrationIssueSeverity
			code: string
			message: string
			details?: Prisma.InputJsonValue
		}>
		let applyPhase:
			| (() => Promise<{
					summary: Record<string, unknown>
					issues: Array<{
						entity: MigrationEntityKind
						legacyId: string
						severity: MigrationIssueSeverity
						code: string
						message: string
						details?: Prisma.InputJsonValue
					}>
			  }>)
			| null = null
		let applySummary: Record<string, unknown> | null = null
		let applyIssueCount = 0

		switch (options.phase) {
			case DEFAULT_PHASE: {
				logPhaseStep(options.phase, 'analyzing businesses')
				summary = analyzeLegacyBusinesses(businesses)
				logPhaseStep(options.phase, 'collecting business issues')
				issues = collectLegacyBusinessIssues(businesses).map(issue => ({
					entity: mapEntity(issue.entity),
					legacyId: issue.legacyId,
					severity: mapSeverity(issue.severity),
					code: issue.code,
					message: issue.message,
					...(issue.details
						? { details: issue.details as Prisma.InputJsonValue }
						: {})
				}))

				applyPhase = async () =>
					applyCatalogBootstrap(prisma, businesses, {
						runId: run.id,
						source: SOURCE_NAME,
						credentialsFile: options.credentialsFile
					})
				break
			}

			case PAYMENTS_PHASE: {
				const finance = await loadPhaseFinance(
					legacyPool,
					businesses,
					options.phase,
					sourceSnapshot
				)

				logPhaseStep(options.phase, 'analyzing finance data')
				summary = {
					...analyzeLegacyFinanceData(businesses, finance),
					businessesPreview: businesses.slice(0, 10).map(business => ({
						id: business.id,
						host: business.host,
						promoCodeId: business.promoCodeId
					}))
				}
				logPhaseStep(options.phase, 'collecting payment issues')
				issues = await collectLegacyPaymentIssues(
					prisma,
					businesses,
					finance,
					SOURCE_NAME
				)

				applyPhase = async () =>
					applyLegacyPayments(prisma, businesses, finance, {
						runId: run.id,
						source: SOURCE_NAME
					})
				break
			}

			case ORDERS_PHASE: {
				const orders = await loadPhaseOrders(
					legacyPool,
					businesses,
					options.phase,
					sourceSnapshot
				)

				logPhaseStep(options.phase, 'analyzing orders')
				summary = {
					...analyzeLegacyOrdersData(businesses, orders),
					businessesPreview: businesses.slice(0, 10).map(business => ({
						id: business.id,
						host: business.host,
						typeSlug: business.typeSlug
					}))
				}
				logPhaseStep(options.phase, 'collecting order issues')
				issues = await collectLegacyOrderIssues(
					prisma,
					businesses,
					orders,
					SOURCE_NAME
				)

				applyPhase = async () =>
					applyLegacyOrders(prisma, businesses, orders, {
						runId: run.id,
						source: SOURCE_NAME
					})
				break
			}

			case PRODUCTS_PHASE: {
				const products = await loadPhaseProducts(
					legacyPool,
					businesses,
					options.phase,
					sourceSnapshot
				)

				logPhaseStep(options.phase, 'analyzing products')
				summary = {
					...analyzeLegacyProductsData(businesses, products),
					businessesPreview: businesses.slice(0, 10).map(business => ({
						id: business.id,
						host: business.host,
						typeSlug: business.typeSlug
					}))
				}
				logPhaseStep(options.phase, 'collecting product issues')
				issues = await collectLegacyProductIssues(
					prisma,
					businesses,
					products,
					SOURCE_NAME
				)

				applyPhase = async () =>
					applyLegacyProducts(prisma, businesses, products, {
						runId: run.id,
						source: SOURCE_NAME
					})
				break
			}

			case MEDIA_PHASE: {
				const products = await loadPhaseProducts(
					legacyPool,
					businesses,
					options.phase,
					sourceSnapshot
				)

				logPhaseStep(options.phase, 'analyzing media assets')
				summary = {
					...(await analyzeLegacyMediaData(
						prisma,
						businesses,
						products,
						SOURCE_NAME
					)),
					businessesPreview: businesses.slice(0, 10).map(business => ({
						id: business.id,
						host: business.host,
						typeSlug: business.typeSlug
					}))
				}
				logPhaseStep(options.phase, 'collecting media issues')
				issues = await collectLegacyMediaIssues(
					prisma,
					businesses,
					products,
					SOURCE_NAME
				)

				applyPhase = async () =>
					applyLegacyMedia(prisma, businesses, products, {
						runId: run.id,
						source: SOURCE_NAME
					})
				break
			}

			case SEO_PHASE: {
				logPhaseStep(options.phase, 'analyzing seo targets')
				summary = {
					...(await analyzeLegacySeoData(prisma, businesses, SOURCE_NAME)),
					businessesPreview: businesses.slice(0, 10).map(business => ({
						id: business.id,
						host: business.host,
						typeSlug: business.typeSlug
					}))
				}
				logPhaseStep(options.phase, 'collecting seo issues')
				issues = await collectLegacySeoIssues(prisma, businesses, SOURCE_NAME)

				applyPhase = async () =>
					applyLegacySeo(prisma, businesses, {
						runId: run.id,
						source: SOURCE_NAME
					})
				break
			}

			case REPORT_PHASE: {
				logPhaseStep(
					options.phase,
					'loading finance, orders and products for reconciliation'
				)
				const [finance, orders, products] = await Promise.all([
					loadPhaseFinance(legacyPool, businesses, options.phase, sourceSnapshot),
					loadPhaseOrders(legacyPool, businesses, options.phase, sourceSnapshot),
					loadPhaseProducts(legacyPool, businesses, options.phase, sourceSnapshot)
				])

				logPhaseStep(options.phase, 'building reconciliation report')
				const report = await buildLegacyReconciliationReport(
					prisma,
					businesses,
					finance,
					orders,
					products,
					SOURCE_NAME
				)

				summary = report.summary
				issues = report.issues
				break
			}

			default:
				throw new Error(
					`Unsupported --phase value: ${options.phase}. Supported phases: ${ALL_PHASE}, ${DEFAULT_PHASE}, ${PAYMENTS_PHASE}, ${ORDERS_PHASE}, ${PRODUCTS_PHASE}, ${MEDIA_PHASE}, ${SEO_PHASE}, ${REPORT_PHASE}`
				)
		}

		const blockingIssueCount = issues.filter(
			issue => issue.severity === MigrationIssueSeverity.ERROR
		).length
		logPhaseStep(options.phase, 'issues collected', {
			issueCount: issues.length,
			blockingIssueCount
		})

		if (issues.length > 0) {
			logPhaseStep(options.phase, 'writing issues to migration_issues', {
				count: issues.length
			})
			await prisma.migrationIssue.createMany({
				data: issues.map(issue => ({
					runId: run.id,
					source: SOURCE_NAME,
					entity: issue.entity,
					legacyId: issue.legacyId,
					severity: issue.severity,
					code: issue.code,
					message: issue.message,
					...(issue.details ? { details: issue.details } : {})
				}))
			})
		}

		if (options.apply && blockingIssueCount > 0) {
			logPhaseStep(options.phase, 'apply blocked by errors', {
				blockingIssueCount
			})
			throw new Error(
				`Cannot run --apply while blocking legacy issues exist. Count: ${blockingIssueCount}`
			)
		}

		if (options.apply && applyPhase) {
			logPhaseStep(options.phase, 'starting apply phase')
			const applyResult = await applyPhase()

			applySummary = applyResult.summary
			applyIssueCount = applyResult.issues.length
			logPhaseStep(options.phase, 'apply phase completed', {
				applyIssueCount,
				applySummary
			})

			if (applyResult.issues.length > 0) {
				logPhaseStep(options.phase, 'writing apply issues to migration_issues', {
					count: applyResult.issues.length
				})
				await prisma.migrationIssue.createMany({
					data: applyResult.issues.map(issue =>
						mapCatalogBootstrapIssueToCreate(run.id, issue)
					)
				})
			}
		}

		const runSummary = {
			...summary,
			mode: options.apply ? 'apply' : 'dry-run',
			issueCount: issues.length + applyIssueCount,
			blockingIssueCount,
			...(applySummary ? { apply: applySummary } : {})
		} as Prisma.InputJsonValue

		logPhaseStep(options.phase, 'updating migration run summary', {
			runId: run.id
		})
		await prisma.migrationRun.update({
			where: { id: run.id },
			data: {
				status: MigrationRunStatus.COMPLETED,
				finishedAt: new Date(),
				summary: runSummary
			}
		})
		logPhaseStep(options.phase, 'completed', {
			runId: run.id,
			issueCount: issues.length + applyIssueCount
		})

		logLegacyEvent({
			channel: 'result',
			phase: options.phase,
			scope: 'summary',
			message: 'migration completed',
			details: {
				ok: true,
				mode: options.apply ? 'apply' : 'dry-run',
				runId: run.id,
				summary,
				...(applySummary ? { apply: applySummary } : {}),
				issueCount: issues.length + applyIssueCount
			}
		})
	} catch (error) {
		if (runId) {
			await prisma.migrationRun.update({
				where: { id: runId },
				data: {
					status: MigrationRunStatus.FAILED,
					finishedAt: new Date(),
					error:
						error instanceof Error ? (error.stack ?? error.message) : String(error)
				}
			})
		}

		throw error
	} finally {
		await Promise.allSettled([prisma.$disconnect(), legacyPool.end()])
	}
}

async function loadPhaseBusinesses(
	legacyPool: pg.Pool,
	options: CliOptions,
	sourceSnapshot?: MigrationSourceSnapshot
): Promise<LegacyBusinessRow[]> {
	if (sourceSnapshot?.businesses) {
		logPhaseStep(options.phase, 'using cached legacy businesses', {
			selectedBusinesses: sourceSnapshot.businesses.length,
			preview: sourceSnapshot.businesses
				.slice(0, 5)
				.map(business => business.host || business.id)
		})
		return sourceSnapshot.businesses
	}

	logPhaseStep(options.phase, 'loading legacy businesses')
	const businesses = await loadLegacyBusinesses(legacyPool, {
		businessIds: options.businessIds,
		businessHosts: options.businessHosts,
		limit: options.limit
	})
	if (sourceSnapshot) {
		sourceSnapshot.businesses = businesses
	}
	logPhaseStep(options.phase, 'legacy businesses loaded', {
		selectedBusinesses: businesses.length,
		preview: businesses.slice(0, 5).map(business => business.host || business.id)
	})
	return businesses
}

async function loadPhaseFinance(
	legacyPool: pg.Pool,
	businesses: LegacyBusinessRow[],
	phase: string,
	sourceSnapshot?: MigrationSourceSnapshot
): Promise<LegacyFinanceData> {
	if (sourceSnapshot?.finance) {
		logPhaseStep(phase, 'using cached legacy finance data', {
			promoCodes: sourceSnapshot.finance.promoCodes.length,
			subscriptionPayments: sourceSnapshot.finance.subscriptionPayments.length,
			promoPayments: sourceSnapshot.finance.promoPayments.length
		})
		return sourceSnapshot.finance
	}

	logPhaseStep(phase, 'loading legacy finance data')
	const finance = await loadLegacyFinanceData(legacyPool, {
		businessIds: businesses.map(business => business.id)
	})
	if (sourceSnapshot) {
		sourceSnapshot.finance = finance
	}
	return finance
}

async function loadPhaseOrders(
	legacyPool: pg.Pool,
	businesses: LegacyBusinessRow[],
	phase: string,
	sourceSnapshot?: MigrationSourceSnapshot
): Promise<LegacyOrdersData> {
	if (sourceSnapshot?.orders) {
		logPhaseStep(phase, 'using cached legacy orders', {
			orders: sourceSnapshot.orders.orders.length
		})
		return sourceSnapshot.orders
	}

	logPhaseStep(phase, 'loading legacy orders')
	const orders = await loadLegacyOrdersData(legacyPool, {
		businessIds: businesses.map(business => business.id)
	})
	if (sourceSnapshot) {
		sourceSnapshot.orders = orders
	}
	return orders
}

async function loadPhaseProducts(
	legacyPool: pg.Pool,
	businesses: LegacyBusinessRow[],
	phase: string,
	sourceSnapshot?: MigrationSourceSnapshot
): Promise<LegacyProductsData> {
	if (sourceSnapshot?.products) {
		logPhaseStep(phase, 'using cached legacy products', {
			brands: sourceSnapshot.products.brands.length,
			categories: sourceSnapshot.products.categories.length,
			products: sourceSnapshot.products.products.length,
			categoryProductLinks: sourceSnapshot.products.categoryProductLinks.length
		})
		return sourceSnapshot.products
	}

	logPhaseStep(phase, 'loading legacy products')
	const products = await loadLegacyProductsData(legacyPool, {
		businessIds: businesses.map(business => business.id)
	})
	if (sourceSnapshot) {
		sourceSnapshot.products = products
	}
	return products
}

function logPhaseStep(
	phase: string,
	message: string,
	details?: Record<string, unknown>
) {
	logLegacyEvent({
		channel: 'phase',
		phase,
		scope: 'step',
		message,
		details
	})
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = {
		help: false,
		apply: false,
		phase: DEFAULT_PHASE,
		limit: null,
		businessIds: [],
		businessHosts: [],
		credentialsFile: null
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

		if (arg.startsWith('--phase=')) {
			options.phase = readStringValue(arg, '--phase=')
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

		if (arg.startsWith('--business=')) {
			options.businessIds.push(
				...readStringValue(arg, '--business=')
					.split(',')
					.map(value => value.trim())
					.filter(Boolean)
			)
			continue
		}

		if (arg.startsWith('--host=')) {
			options.businessHosts.push(
				...readStringValue(arg, '--host=')
					.split(',')
					.map(value => value.trim())
					.filter(Boolean)
			)
			continue
		}

		if (arg.startsWith('--credentials-file=')) {
			options.credentialsFile = readStringValue(arg, '--credentials-file=')
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	options.businessIds = Array.from(new Set(options.businessIds))
	options.businessHosts = Array.from(new Set(options.businessHosts))
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

function mapCatalogBootstrapIssueToCreate(
	runId: string,
	issue: {
		entity: MigrationEntityKind
		legacyId: string
		severity: MigrationIssueSeverity
		code: string
		message: string
		details?: Prisma.InputJsonValue
	}
) {
	return {
		runId,
		source: SOURCE_NAME,
		entity: issue.entity,
		legacyId: issue.legacyId,
		severity: issue.severity,
		code: issue.code,
		message: issue.message,
		...(issue.details ? { details: issue.details } : {})
	}
}

function mapEntity(entity: 'BUSINESS'): MigrationEntityKind {
	if (entity === 'BUSINESS') return MigrationEntityKind.BUSINESS
	return MigrationEntityKind.BUSINESS
}

function mapSeverity(severity: 'WARNING' | 'ERROR'): MigrationIssueSeverity {
	if (severity === 'WARNING') return MigrationIssueSeverity.WARNING
	return MigrationIssueSeverity.ERROR
}

function printHelp() {
	console.log(
		`
Legacy migration runner

Usage:
  npm run legacy:migrate -- --limit=25
  npm run legacy:migrate -- --business=abc123,def456
  npm run legacy:migrate -- --host=mystore.example.com,other.com
  npm run legacy:migrate -- --apply --limit=25
  npm run legacy:migrate -- --phase=all --apply
  npm run legacy:migrate -- --phase=catalog-bootstrap
  npm run legacy:migrate -- --phase=payments --limit=25
  npm run legacy:migrate -- --phase=orders --limit=25
  npm run legacy:migrate -- --phase=products --limit=25
  npm run legacy:migrate -- --phase=media --limit=25
  npm run legacy:migrate -- --phase=seo --limit=25
  npm run legacy:migrate -- --phase=report --limit=25
  npm run legacy:migrate -- --apply --credentials-file=migration/runtime/legacy.csv

Environment:
  .env -> loaded first
  migration/.env -> loaded next and overrides .env
  migration/.env.local -> loaded last and overrides both
  LEGACY_MIGRATION_ENV_FILE -> optional custom path to an extra env file
  DATABASE_URI or DATABASE_URL
  LEGACY_DATABASE_URI or LEGACY_DATABASE_URL or OLD_DATABASE_URL
  LEGACY_DATABASE_SSL_MODE=no-verify -> useful for self-signed TLS
  LEGACY_DATABASE_SSL_REJECT_UNAUTHORIZED=false -> explicit TLS override
  LEGACY_MIGRATION_MEDIA_MAX_FILE_MB=100 -> optional larger source-file limit for phase=media
  LEGACY_MIGRATION_ALLOW_SOURCE_DRIFT=true -> media skips missing target mappings as warnings for live legacy DB changes

What it does now:
  - connects to the new and legacy PostgreSQL databases
  - creates a migration run entry in the new database
  - phase=all sequentially runs catalog-bootstrap -> payments -> orders -> products -> media -> seo -> report
  - phase=all reuses one in-memory legacy data snapshot across phases to avoid live-source drift within the run
  - phase=catalog-bootstrap scans legacy businesses
  - phase=catalog-bootstrap in --apply mode creates User + Catalog + child Catalog links
  - phase=catalog-bootstrap syncs CatalogConfig, CatalogSettings, CatalogContact, Metrics, Integration
  - phase=catalog-bootstrap writes generated credentials to migration/runtime/*.csv
  - phase=payments loads legacy PromoCode, Payment, PromoCodePayment for selected businesses
  - phase=payments links Catalog.promoCodeId, imports payments, updates subscriptionEndsAt
  - phase=orders loads legacy orders from all type-specific order tables
  - phase=orders converts legacy products payload into the new immutable products snapshot
  - phase=orders imports legacy order history with payment method, proofs, address, delivery flags
  - phase=products loads legacy brands, categories, products and category-product links
  - phase=products creates Brand, Category, Product, ProductAttribute, CategoryProduct and IntegrationProductLink
  - phase=products preserves legacy image URLs and msUuid metadata in migration_entity_maps for the future media phase
  - phase=media downloads legacy catalog/category/product images and uploads them into the current S3 pipeline
  - phase=media links CatalogConfig logo/bg, Category.imageMediaId and ProductMedia using target UUID mappings
  - phase=seo creates or refreshes SeoSetting for catalogs, categories and products after products/media
  - phase=report compares legacy counts with migrated target data and highlights mismatches per business
  - stores blocking issues and warnings in migration_issues
  - writes summary JSON into migration_runs.summary
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

main().catch(error => {
	console.error('Legacy migration bootstrap failed:', error)
	process.exitCode = 1
})
