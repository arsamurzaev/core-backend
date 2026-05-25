import 'dotenv/config'

import { IntegrationProvider } from '../prisma/generated/enums.js'
import { createPrismaClient, validateDatabaseEnv } from './db-console/prisma.js'
import { IikoClient } from '../src/modules/integration/providers/iiko/iiko.client'
import {
	buildIikoExternalMenuPreview,
	normalizeIikoExternalMenu,
	type IikoExternalMenuPreview
} from '../src/modules/integration/providers/iiko/iiko.external-menu-normalizer'
import { IikoMetadataCryptoService } from '../src/modules/integration/providers/iiko/iiko.metadata'
import type {
	IikoExternalMenuResponse,
	IikoPriceCategory
} from '../src/modules/integration/providers/iiko/iiko.types'

const DEFAULT_EXTERNAL_MENU_ID = '81651'
const DEFAULT_MENU_VERSION = 4

type CliOptions = {
	apiLogin: string | null
	baseUrl: string | null
	externalMenuId: string
	organizationId: string | null
	priceCategoryId: string | null
	menuVersion: number
	fromDb: boolean
	catalogId: string | null
	integrationId: string | null
	externalMenuIdExplicit: boolean
	menuVersionExplicit: boolean
	json: boolean
	help: boolean
}

type PreviewAttempt = {
	priceCategoryId: string | null
	priceCategoryName: string | null
	revision: number | null
	preview: IikoExternalMenuPreview
}

function main() {
	void run().catch(error => {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	})
}

async function run() {
	const options = parseCliOptions(process.argv.slice(2))
	if (options.help) {
		printHelp()
		return
	}

	if (options.fromDb) {
		await applyStoredIntegrationOptions(options)
	}

	if (!options.apiLogin) {
		throw new Error(
			'IIKO_SMOKE_API_LOGIN is required. Pass it through env or --api-login.'
		)
	}

	const client = new IikoClient({
		apiLogin: options.apiLogin,
		baseUrl: options.baseUrl ?? undefined
	})

	const [organizationsResponse, menusResponse] = await Promise.all([
		client.getOrganizations(),
		client.getMenus()
	])
	const organizations = organizationsResponse.organizations ?? []
	const externalMenus = menusResponse.externalMenus ?? []
	const priceCategories = menusResponse.priceCategories ?? []
	const organization =
		(options.organizationId
			? organizations.find(item => item.id === options.organizationId)
			: null) ??
		organizations.find(item => item.isActive !== false) ??
		organizations[0]

	if (!organization) {
		throw new Error('iiko returned no organizations for this apiLogin')
	}

	const externalMenu =
		externalMenus.find(item => item.id === options.externalMenuId) ?? null
	if (!externalMenu) {
		const known = externalMenus.map(item => `${item.name} (${item.id})`).join(', ')
		throw new Error(
			`External menu ${options.externalMenuId} was not returned by /api/2/menu.${known ? ` Known menus: ${known}` : ''}`
		)
	}

	const priceCategoryCandidates = resolvePriceCategoryCandidates(
		priceCategories,
		options.priceCategoryId
	)
	const attempts: PreviewAttempt[] = []

	for (const priceCategory of priceCategoryCandidates) {
		const rawMenu = await client.getExternalMenuById({
			externalMenuId: options.externalMenuId,
			organizationIds: [organization.id],
			priceCategoryId: priceCategory?.id ?? null,
			version: options.menuVersion,
			language: 'ru',
			startRevision: 0
		})
		const preview = buildPreview({
			rawMenu,
			organizationId: organization.id,
			externalMenuId: options.externalMenuId,
			externalMenuName: externalMenu.name
		})
		attempts.push({
			priceCategoryId: priceCategory?.id ?? null,
			priceCategoryName: priceCategory?.name ?? null,
			revision: preview.revision,
			preview
		})
	}

	const result = {
		ok: true as const,
		baseUrl: options.baseUrl ?? 'https://api-ru.iiko.services',
		organization: {
			id: organization.id,
			name: organization.name,
			isActive: organization.isActive ?? null
		},
		externalMenu: {
			id: externalMenu.id,
			name: externalMenu.name
		},
		discovery: {
			organizations: organizations.length,
			externalMenus: externalMenus.length,
			priceCategories: priceCategories.length
		},
		attempts: attempts.map(attempt => ({
			priceCategoryId: attempt.priceCategoryId,
			priceCategoryName: attempt.priceCategoryName,
			revision: attempt.revision,
			stats: attempt.preview.stats,
			skipReasons: countSkipReasons(attempt.preview),
			importableSamples: attempt.preview.items
				.filter(item => item.willImport)
				.slice(0, 10)
				.map(item => ({
					id: item.id,
					name: item.name,
					variants: item.variants
				})),
			skippedSamples: attempt.preview.items
				.filter(item => !item.willImport)
				.slice(0, 10)
				.map(item => ({
					id: item.id,
					name: item.name,
					reasons: item.skipReasons
				}))
		}))
	}

	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
		return
	}

	printHumanSummary(result)
}

function buildPreview(params: {
	rawMenu: IikoExternalMenuResponse
	organizationId: string
	externalMenuId: string
	externalMenuName: string
}) {
	return buildIikoExternalMenuPreview(
		normalizeIikoExternalMenu({
			menu: params.rawMenu,
			organizationId: params.organizationId,
			externalMenuId: params.externalMenuId,
			externalMenuName: params.externalMenuName
		})
	)
}

function resolvePriceCategoryCandidates(
	priceCategories: IikoPriceCategory[],
	selectedId: string | null
): Array<IikoPriceCategory | null> {
	if (selectedId) {
		const found = priceCategories.find(item => item.id === selectedId)
		if (!found) {
			throw new Error(`Price category ${selectedId} was not returned by /api/2/menu`)
		}
		return [found]
	}

	if (!priceCategories.length) {
		return [null]
	}

	return [null, ...priceCategories]
}

function countSkipReasons(preview: IikoExternalMenuPreview) {
	return preview.items.reduce<Record<string, number>>((counts, item) => {
		for (const reason of item.skipReasons) {
			counts[reason] = (counts[reason] ?? 0) + 1
		}
		return counts
	}, {})
}

function parseCliOptions(args: string[]): CliOptions {
	const env = process.env
	const options: CliOptions = {
		apiLogin: normalizeOptionalString(
			env.IIKO_SMOKE_API_LOGIN ?? env.IIKO_API_LOGIN
		),
		baseUrl: normalizeOptionalString(env.IIKO_API_BASE_URL),
		externalMenuId:
			normalizeOptionalString(env.IIKO_SMOKE_EXTERNAL_MENU_ID) ??
			DEFAULT_EXTERNAL_MENU_ID,
		organizationId: normalizeOptionalString(env.IIKO_SMOKE_ORGANIZATION_ID),
		priceCategoryId: normalizeOptionalString(env.IIKO_SMOKE_PRICE_CATEGORY_ID),
		menuVersion: normalizeInteger(env.IIKO_SMOKE_MENU_VERSION) ?? DEFAULT_MENU_VERSION,
		fromDb: false,
		catalogId: normalizeOptionalString(env.IIKO_SMOKE_CATALOG_ID),
		integrationId: normalizeOptionalString(env.IIKO_SMOKE_INTEGRATION_ID),
		externalMenuIdExplicit: Boolean(
			normalizeOptionalString(env.IIKO_SMOKE_EXTERNAL_MENU_ID)
		),
		menuVersionExplicit: Boolean(
			normalizeOptionalString(env.IIKO_SMOKE_MENU_VERSION)
		),
		json: false,
		help: false
	}

	for (const arg of args) {
		if (arg === '--help' || arg === '-h') {
			options.help = true
			continue
		}
		if (arg === '--json') {
			options.json = true
			continue
		}
		if (arg === '--from-db') {
			options.fromDb = true
			continue
		}

		const [rawKey, ...rawValueParts] = arg.split('=')
		const value = rawValueParts.join('=').trim()
		if (!rawKey || !rawKey.startsWith('--')) continue

		switch (rawKey) {
			case '--api-login':
				options.apiLogin = normalizeOptionalString(value)
				break
			case '--base-url':
				options.baseUrl = normalizeOptionalString(value)
				break
			case '--external-menu-id':
				options.externalMenuId =
					normalizeOptionalString(value) ?? DEFAULT_EXTERNAL_MENU_ID
				options.externalMenuIdExplicit = true
				break
			case '--organization-id':
				options.organizationId = normalizeOptionalString(value)
				break
			case '--price-category-id':
				options.priceCategoryId = normalizeOptionalString(value)
				break
			case '--menu-version':
				options.menuVersion = normalizeInteger(value) ?? DEFAULT_MENU_VERSION
				options.menuVersionExplicit = true
				break
			case '--catalog-id':
				options.catalogId = normalizeOptionalString(value)
				break
			case '--integration-id':
				options.integrationId = normalizeOptionalString(value)
				break
		}
	}

	return options
}

async function applyStoredIntegrationOptions(options: CliOptions) {
	validateDatabaseEnv()
	const prisma = createPrismaClient()

	try {
		await prisma.$connect()
		const integration = await prisma.integration.findFirst({
			where: {
				provider: IntegrationProvider.IIKO,
				deleteAt: null,
				...(options.integrationId ? { id: options.integrationId } : {}),
				...(options.catalogId ? { catalogId: options.catalogId } : {})
			},
			orderBy: { updatedAt: 'desc' },
			select: {
				id: true,
				catalogId: true,
				metadata: true
			}
		})

		if (!integration) {
			throw new Error('Saved iiko integration was not found in local DB')
		}

		const metadata = createIikoMetadataCrypto().parseStoredMetadata(
			integration.metadata
		)
		options.apiLogin = options.apiLogin ?? metadata.apiLogin
		options.organizationId = options.organizationId ?? metadata.organizationId
		options.priceCategoryId = options.priceCategoryId ?? metadata.priceCategoryId
		if (!options.externalMenuIdExplicit && metadata.externalMenuId) {
			options.externalMenuId = metadata.externalMenuId
		}
		if (!options.menuVersionExplicit) {
			options.menuVersion = metadata.menuVersion
		}
	} finally {
		await prisma.$disconnect()
	}
}

function createIikoMetadataCrypto() {
	return new IikoMetadataCryptoService({
		get: (key: string) =>
			key === 'integrationCrypto'
				? {
						encryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY,
						keyVersion: process.env.INTEGRATION_ENCRYPTION_KEY_VERSION ?? 'v1'
					}
				: undefined
	} as never)
}

function normalizeOptionalString(value: unknown): string | null {
	const normalized = typeof value === 'string' ? value.trim() : ''
	return normalized || null
}

function normalizeInteger(value: unknown): number | null {
	const normalized = normalizeOptionalString(value)
	if (!normalized) return null

	const parsed = Number(normalized)
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function printHumanSummary(result: {
	ok: true
	baseUrl: string
	organization: { id: string; name: string; isActive: boolean | null }
	externalMenu: { id: string; name: string }
	discovery: {
		organizations: number
		externalMenus: number
		priceCategories: number
	}
	attempts: Array<{
		priceCategoryId: string | null
		priceCategoryName: string | null
		revision: number | null
		stats: IikoExternalMenuPreview['stats']
		skipReasons: Record<string, number>
		importableSamples: Array<{ id: string; name: string; variants: number }>
		skippedSamples: Array<{ id: string; name: string; reasons: string[] }>
	}>
}) {
	console.log('iiko external menu smoke')
	console.log(`Base URL: ${result.baseUrl}`)
	console.log(
		`Organization: ${result.organization.name} (${result.organization.id})`
	)
	console.log(`External menu: ${result.externalMenu.name} (${result.externalMenu.id})`)
	console.log(
		`Discovery: organizations=${result.discovery.organizations}, menus=${result.discovery.externalMenus}, priceCategories=${result.discovery.priceCategories}`
	)

	for (const attempt of result.attempts) {
		const priceCategory = attempt.priceCategoryId
			? `${attempt.priceCategoryName ?? 'Unnamed'} (${attempt.priceCategoryId})`
			: 'without price category'
		const stats = attempt.stats
		console.log('')
		console.log(`Price category: ${priceCategory}`)
		console.log(`Revision: ${attempt.revision ?? 'n/a'}`)
		console.log(
			`Stats: categories=${stats.categories}, items=${stats.items}, importable=${stats.visibleItems}, hidden=${stats.hiddenItems}, noPrice=${stats.itemsWithoutPrice}, combo=${stats.combos}, variants=${stats.variants}, withModifiers=${stats.itemsWithModifiers}`
		)
		console.log(`Skip reasons: ${formatCounts(attempt.skipReasons)}`)

		if (attempt.importableSamples.length) {
			console.log('Importable samples:')
			for (const item of attempt.importableSamples) {
				console.log(`- ${item.name} (${item.id}), variants=${item.variants}`)
			}
		}

		if (attempt.skippedSamples.length) {
			console.log('Skipped samples:')
			for (const item of attempt.skippedSamples) {
				console.log(`- ${item.name} (${item.id}): ${item.reasons.join(', ')}`)
			}
		}
	}
}

function formatCounts(counts: Record<string, number>) {
	const entries = Object.entries(counts)
	return entries.length
		? entries.map(([key, value]) => `${key}=${value}`).join(', ')
		: 'none'
}

function printHelp() {
	console.log(`
iiko external menu smoke

Env:
  IIKO_SMOKE_API_LOGIN       Full iiko apiLogin. Required.
  IIKO_SMOKE_EXTERNAL_MENU_ID External menu id. Default: ${DEFAULT_EXTERNAL_MENU_ID}
  IIKO_SMOKE_ORGANIZATION_ID  Optional organization id. Default: first active organization.
  IIKO_SMOKE_PRICE_CATEGORY_ID Optional price category id. If omitted, script tries null and every returned category.
  IIKO_SMOKE_MENU_VERSION     External menu version. Default: ${DEFAULT_MENU_VERSION}
  IIKO_SMOKE_CATALOG_ID       Optional catalog id for --from-db.
  IIKO_SMOKE_INTEGRATION_ID   Optional integration id for --from-db.
  IIKO_API_BASE_URL           Optional API base URL.

Usage:
  npm run iiko:smoke
  npm run iiko:smoke -- --from-db
  npm run iiko:smoke -- --external-menu-id=81651 --json
`)
}

main()
