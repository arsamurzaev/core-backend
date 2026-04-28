import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { hash } from 'argon2'
import { randomInt, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pLimit from 'p-limit'
import slugify from 'slugify'

import {
	CatalogExperienceMode,
	CatalogStatus,
	ContactType,
	IntegrationProvider,
	Metric,
	MetricScope,
	MigrationEntityKind,
	MigrationIssueSeverity,
	Prisma,
	PrismaClient,
	Role
} from '../../../prisma/generated/client.js'

import {
	loadAlreadyMigratedIds,
	runMigrationTransaction,
	withRetry
} from './migration-utils.js'
import type { LegacyBusinessRow } from './source.js'

type ApplyCatalogBootstrapOptions = {
	runId: string
	source: string
	credentialsFile?: string | null
}

type CredentialsS3Config = {
	client: S3Client
	bucket: string
}

type CatalogBootstrapIssue = {
	entity: MigrationEntityKind
	legacyId: string
	severity: MigrationIssueSeverity
	code: string
	message: string
	details?: Prisma.InputJsonValue
}

type CatalogBootstrapCredential = {
	businessName: string
	host: string
	login: string
	password: string
}

type CatalogBootstrapBusinessResult = {
	legacyId: string
	catalogId: string
	userId: string
	createdUser: boolean
	createdCatalog: boolean
	createdType: boolean
	createdActivity: boolean
	createdRegions: number
	credential: CatalogBootstrapCredential | null
	issues: CatalogBootstrapIssue[]
}

type LinkParentResult = {
	linked: boolean
	issues: CatalogBootstrapIssue[]
}

type EnsureTypeResult = {
	type: ResolvedType
	issues: CatalogBootstrapIssue[]
}

type PrewarmReferenceDataResult = {
	createdTypes: number
	createdActivities: number
	createdRegions: number
}

type CatalogBootstrapSummary = {
	processedBusinesses: number
	skippedAlreadyMigrated: number
	createdUsers: number
	reusedUsers: number
	createdCatalogs: number
	reusedCatalogs: number
	createdTypes: number
	createdActivities: number
	createdRegions: number
	linkedChildren: number
	skippedParentLinks: number
	generatedCredentials: number
	credentialsFile: string | null
}

type CatalogBootstrapResult = {
	summary: CatalogBootstrapSummary
	issues: CatalogBootstrapIssue[]
}

type ExistingEntityMap = {
	id: string
	targetId: string
	payload: Prisma.JsonValue | null
}

type ResolvedType = {
	id: string
	code: string
	name: string
	created: boolean
}

type ResolvedActivity = {
	id: string
	created: boolean
} | null

type ResolvedRegions = {
	ids: string[]
	created: number
}

const LEGACY_TO_TARGET_TYPE_CODE = new Map<string, string>([
	['confectionery', 'food'],
	['clothes', 'clothes'],
	['gift', 'gifts'],
	['semi_finished_products', 'beauty'],
	['restaurant', 'restaurant'],
	['flowers', 'home'],
	['technic', 'tech'],
	['trading_base', 'wholesale']
])

const CONTACT_FIELD_MAP = [
	{ field: 'phone', type: ContactType.PHONE },
	{ field: 'email', type: ContactType.EMAIL },
	{ field: 'whatsapp', type: ContactType.WHATSAPP },
	{ field: 'max', type: ContactType.MAX },
	{ field: 'bip', type: ContactType.BIP },
	{ field: 'telegram', type: ContactType.TELEGRAM },
	{ field: 'message', type: ContactType.SMS },
	{ field: 'map', type: ContactType.MAP }
] as const

const PASSWORD_ALPHABET =
	'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
const DEFAULT_PASSWORD_LENGTH = 20
const LOGIN_LETTER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
const LOGIN_ALPHANUMERIC_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const DEFAULT_LOGIN_LENGTH = 10

export async function applyCatalogBootstrap(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	options: ApplyCatalogBootstrapOptions
): Promise<CatalogBootstrapResult> {
	const issues: CatalogBootstrapIssue[] = []
	const sortedBusinesses = sortBusinessesForBootstrap(businesses)
	const credentials: CatalogBootstrapCredential[] = []

	// Resume: skip businesses already fully migrated in a previous run
	const alreadyMigrated = await loadAlreadyMigratedIds(
		prisma,
		options.source,
		MigrationEntityKind.BUSINESS
	)
	const pendingBusinesses = sortedBusinesses.filter(
		b => !alreadyMigrated.has(b.id)
	)

	const prewarm = await prewarmTypesAndRegions(prisma, pendingBusinesses)

	let createdUsers = 0
	let reusedUsers = 0
	let createdCatalogs = 0
	let createdTypes = prewarm.createdTypes
	let createdActivities = prewarm.createdActivities
	let createdRegions = prewarm.createdRegions
	let linkedChildren = 0
	let skippedParentLinks = 0

	const limit = pLimit(10)

	// First pass: root businesses (no parentId) — must run before children
	const rootBusinesses = pendingBusinesses.filter(b => !b.parentId)
	await Promise.all(
		rootBusinesses.map(business =>
			limit(async () => {
				const result = await withRetry(() =>
					runMigrationTransaction(prisma, async tx =>
						upsertCatalogBootstrapBusiness(tx, business, options)
					)
				)
				if (result.createdUser) createdUsers += 1
				else reusedUsers += 1
				if (result.createdCatalog) createdCatalogs += 1
				if (result.createdType) createdTypes += 1
				if (result.createdActivity) createdActivities += 1
				createdRegions += result.createdRegions
				if (result.credential) credentials.push(result.credential)
				issues.push(...result.issues)
			})
		)
	)

	// Second pass: child businesses — after parents are committed
	const childBusinesses = pendingBusinesses.filter(b => !!b.parentId)
	await Promise.all(
		childBusinesses.map(business =>
			limit(async () => {
				const result = await withRetry(() =>
					runMigrationTransaction(prisma, async tx =>
						upsertCatalogBootstrapBusiness(tx, business, options)
					)
				)
				if (result.createdUser) createdUsers += 1
				else reusedUsers += 1
				if (result.createdCatalog) createdCatalogs += 1
				if (result.createdType) createdTypes += 1
				if (result.createdActivity) createdActivities += 1
				createdRegions += result.createdRegions
				if (result.credential) credentials.push(result.credential)
				issues.push(...result.issues)
			})
		)
	)

	// Parent-linking pass — all businesses with parentId (idempotent, safe to re-run)
	await Promise.all(
		sortedBusinesses
			.filter(b => !!b.parentId)
			.map(business =>
				limit(async () => {
					const result = await withRetry(() =>
						runMigrationTransaction(prisma, async tx =>
							linkCatalogParent(tx, business, options)
						)
					)
					if (result.linked) linkedChildren += 1
					else skippedParentLinks += 1
					issues.push(...result.issues)
				})
			)
	)

	const credentialsFile =
		credentials.length > 0
			? await writeCredentialsArtifact(credentials, options)
			: null

	return {
		summary: {
			processedBusinesses: pendingBusinesses.length,
			skippedAlreadyMigrated: alreadyMigrated.size,
			createdUsers,
			reusedUsers,
			createdCatalogs,
			reusedCatalogs: pendingBusinesses.length - createdCatalogs,
			createdTypes,
			createdActivities,
			createdRegions,
			linkedChildren,
			skippedParentLinks,
			generatedCredentials: credentials.length,
			credentialsFile
		},
		issues
	}
}

async function upsertCatalogBootstrapBusiness(
	tx: Prisma.TransactionClient,
	business: LegacyBusinessRow,
	options: ApplyCatalogBootstrapOptions
): Promise<CatalogBootstrapBusinessResult> {
	const txIssues: CatalogBootstrapIssue[] = []
	const { type, issues: typeIssues } = await ensureType(tx, business)
	txIssues.push(...typeIssues)
	const activity = await ensureActivity(tx, business, type.id)
	const regions = await ensureRegions(tx, business)

	const userMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.USER,
		business.id
	)
	const existingUser = userMap
		? await tx.user.findFirst({ where: { id: userMap.targetId } })
		: null

	let credential: CatalogBootstrapCredential | null = null
	let userId = existingUser?.id ?? null
	let createdUser = false

	if (!userId) {
		const resolvedLogin = await resolveUniqueUserLogin(tx)
		const password = generateStrongPassword()
		const passwordHash = await hash(password)

		const user = await tx.user.create({
			data: {
				name: resolveBusinessDisplayName(business),
				login: resolvedLogin,
				password: passwordHash,
				role: Role.CATALOG,
				isEmailConfirmed: true,
				regions: {
					connect: regions.ids.map(id => ({ id }))
				}
			}
		})

		userId = user.id
		createdUser = true
		credential = {
			businessName: resolveBusinessDisplayName(business),
			host: '',
			login: resolvedLogin,
			password
		}
		await tx.user.update({
			where: { id: userId },
			data: {
				name: resolveBusinessDisplayName(business),
				isEmailConfirmed: true,
				deleteAt: null,
				regions: {
					set: regions.ids.map(id => ({ id }))
				}
			}
		})
	}

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.USER,
		legacyId: business.id,
		targetId: userId,
		legacyParentId: business.parentId,
		payload: {
			login: createdUser
				? (credential?.login ?? null)
				: (existingUser?.login ?? null)
		}
	})

	const businessMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.BUSINESS,
		business.id
	)
	const existingCatalog = businessMap
		? await tx.catalog.findFirst({ where: { id: businessMap.targetId } })
		: null

	let createdCatalog = false
	let catalogId = existingCatalog?.id ?? null
	let assignedSlug = existingCatalog?.slug ?? null
	let assignedDomain = existingCatalog?.domain ?? null

	if (!catalogId) {
		assignedSlug = await resolveUniqueCatalogSlug(
			tx,
			business.host ?? business.id
		)
		const domainResolution = await resolveCatalogDomain(tx, business.domain)
		assignedDomain = domainResolution.domain
		if (domainResolution.warning) {
			txIssues.push({
				entity: MigrationEntityKind.CATALOG,
				legacyId: business.id,
				severity: MigrationIssueSeverity.WARNING,
				code: 'DOMAIN_SKIPPED',
				message:
					'Домен legacy business не был перенесён из-за конфликта в target базе',
				details: {
					legacyDomain: business.domain,
					resolvedSlug: assignedSlug
				} satisfies Prisma.InputJsonValue
			})
		}

		const catalog = await tx.catalog.create({
			data: {
				slug: assignedSlug,
				domain: assignedDomain,
				name: resolveBusinessDisplayName(business),
				typeId: type.id,
				userId
			}
		})

		catalogId = catalog.id
		createdCatalog = true
	} else {
		await tx.catalog.update({
			where: { id: catalogId },
			data: {
				name: resolveBusinessDisplayName(business),
				typeId: type.id,
				userId,
				deleteAt: null,
				...(existingCatalog?.domain
					? {}
					: await buildOptionalDomainUpdate(tx, business))
			}
		})
	}

	if (!catalogId) {
		throw new Error(
			`Failed to resolve target catalog for legacy business ${business.id}`
		)
	}

	await syncCatalogConfig(tx, catalogId, business)
	await syncCatalogSettings(tx, catalogId, business)
	await syncCatalogContacts(tx, catalogId, business)
	await syncCatalogMetrics(tx, catalogId, business)
	await syncCatalogIntegration(tx, catalogId, business)
	await syncCatalogRelations(tx, catalogId, activity?.id ?? null, regions.ids)

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.BUSINESS,
		legacyId: business.id,
		targetId: catalogId,
		legacyParentId: business.parentId,
		payload: {
			userId,
			typeCode: type.code,
			slug: assignedSlug,
			domain: assignedDomain,
			host: business.host,
			logoUrl: business.logoUrl,
			bgUrl: business.bgUrl
		}
	})

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.CATALOG,
		legacyId: business.id,
		targetId: catalogId,
		legacyParentId: business.parentId,
		payload: {
			userId,
			typeCode: type.code,
			slug: assignedSlug,
			domain: assignedDomain
		}
	})

	if (credential) {
		credential.host = buildCatalogHostValue(assignedSlug)
	}

	return {
		legacyId: business.id,
		catalogId,
		userId,
		createdUser,
		createdCatalog,
		createdType: type.created,
		createdActivity: activity?.created ?? false,
		createdRegions: regions.created,
		credential,
		issues: txIssues
	}
}

async function linkCatalogParent(
	tx: Prisma.TransactionClient,
	business: LegacyBusinessRow,
	options: ApplyCatalogBootstrapOptions
): Promise<LinkParentResult> {
	if (!business.parentId) return { linked: true, issues: [] }

	const currentMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.BUSINESS,
		business.id
	)
	const parentMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.BUSINESS,
		business.parentId
	)

	if (!currentMap || !parentMap) {
		return {
			linked: false,
			issues: [
				{
					entity: MigrationEntityKind.CATALOG,
					legacyId: business.id,
					severity: MigrationIssueSeverity.WARNING,
					code: 'PARENT_LINK_SKIPPED',
					message:
						'Не удалось привязать дочерний каталог к родителю: parent не найден в mapping',
					details: {
						parentLegacyId: business.parentId
					} satisfies Prisma.InputJsonValue
				}
			]
		}
	}

	await tx.catalog.update({
		where: { id: currentMap.targetId },
		data: { parentId: parentMap.targetId }
	})

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.BUSINESS,
		legacyId: business.id,
		targetId: currentMap.targetId,
		legacyParentId: business.parentId
	})

	return { linked: true, issues: [] }
}

async function prewarmTypesAndRegions(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[]
): Promise<PrewarmReferenceDataResult> {
	let createdTypes = 0
	let createdActivities = 0
	let createdRegions = 0

	const typeNameByCode = new Map<string, string>()
	for (const b of businesses) {
		const code = mapLegacyTypeCode(normalizeText(b.typeSlug) ?? 'legacy')
		if (!typeNameByCode.has(code)) {
			typeNameByCode.set(code, b.typeName ?? humanizeCode(code))
		}
	}

	for (const [code, name] of typeNameByCode) {
		const existing = await prisma.type.findUnique({
			where: { code },
			select: { id: true, deleteAt: true }
		})

		if (!existing) createdTypes += 1

		await prisma.type.upsert({
			where: { code },
			create: { code, name },
			update: {
				name,
				deleteAt: null
			}
		})
	}

	const activityNames = Array.from(
		new Set(
			businesses
				.map(b => normalizeText(b.activityName))
				.filter((value): value is string => Boolean(value))
		)
	)
	for (const name of activityNames) {
		const existing = await prisma.activity.findFirst({
			where: { name },
			orderBy: { createdAt: 'asc' },
			select: { id: true, deleteAt: true }
		})

		if (!existing) {
			await prisma.activity.create({
				data: { name }
			})
			createdActivities += 1
			continue
		}

		if (existing.deleteAt) {
			await prisma.activity.update({
				where: { id: existing.id },
				data: { deleteAt: null }
			})
		}
	}

	const regionCodes = new Set(
		businesses.flatMap(b =>
			(b.regionality ?? []).map(v => v.trim()).filter(Boolean)
		)
	)
	for (const code of regionCodes) {
		const existing = await prisma.regionality.findUnique({
			where: { code },
			select: { id: true, deleteAt: true }
		})

		if (!existing) createdRegions += 1

		await prisma.regionality.upsert({
			where: { code },
			create: { code, name: code },
			update: {
				name: code,
				deleteAt: null
			}
		})
	}

	return {
		createdTypes,
		createdActivities,
		createdRegions
	}
}

async function ensureType(
	tx: Prisma.TransactionClient,
	business: LegacyBusinessRow
): Promise<EnsureTypeResult> {
	const legacyCode = normalizeText(business.typeSlug) ?? 'legacy'
	const targetCode = mapLegacyTypeCode(legacyCode)
	const typeIssues: CatalogBootstrapIssue[] = []

	const existing = await tx.type.findFirst({
		where: { code: targetCode, deleteAt: null },
		select: { id: true, code: true, name: true }
	})

	if (!existing) {
		// Types are pre-created in prewarmTypesAndRegions before the parallel loop.
		// If we reach here it means prewarm was skipped (dry-run) or something went wrong.
		throw new Error(`Type not found after prewarm: ${targetCode}`)
	}

	return { type: { ...existing, created: false }, issues: typeIssues }
}

async function ensureActivity(
	tx: Prisma.TransactionClient,
	business: LegacyBusinessRow,
	typeId: string
): Promise<ResolvedActivity> {
	const name = normalizeText(business.activityName)
	if (!name) return null

	const existing = await tx.activity.findFirst({
		where: { name },
		orderBy: { createdAt: 'asc' },
		select: { id: true, deleteAt: true }
	})

	if (!existing) {
		throw new Error(`Activity not found after prewarm: ${name}`)
	}

	if (existing.deleteAt) {
		await tx.activity.update({
			where: { id: existing.id },
			data: { deleteAt: null }
		})
	}

	await tx.type.update({
		where: { id: typeId },
		data: {
			activities: {
				connect: [{ id: existing.id }]
			}
		}
	})

	return {
		id: existing.id,
		created: false
	}
}

async function ensureRegions(
	tx: Prisma.TransactionClient,
	business: LegacyBusinessRow
): Promise<ResolvedRegions> {
	const values = Array.from(
		new Set(
			(business.regionality ?? []).map(value => value.trim()).filter(Boolean)
		)
	)

	if (!values.length) {
		return { ids: [], created: 0 }
	}

	const ids: string[] = []

	for (const value of values) {
		const existing = await tx.regionality.findFirst({
			where: { code: value, deleteAt: null },
			select: { id: true }
		})

		if (!existing) {
			// Regions are pre-created in prewarmTypesAndRegions before the parallel loop.
			throw new Error(`Region not found after prewarm: ${value}`)
		}

		ids.push(existing.id)
	}

	return { ids, created: 0 }
}

async function syncCatalogConfig(
	tx: Prisma.TransactionClient,
	catalogId: string,
	business: LegacyBusinessRow
) {
	const status = resolveCatalogStatus(business.status, business.isActive)
	await tx.catalogConfig.upsert({
		where: { catalogId },
		create: {
			catalogId,
			about: business.about ?? '',
			description: business.description,
			currency: business.currency ?? '₽',
			status,
			note: business.note
		},
		update: {
			about: business.about ?? '',
			description: business.description,
			currency: business.currency ?? '₽',
			status,
			note: business.note,
			deleteAt: null
		}
	})
}

async function syncCatalogSettings(
	tx: Prisma.TransactionClient,
	catalogId: string,
	business: LegacyBusinessRow
) {
	const defaultMode = resolveCatalogDefaultMode()
	await tx.catalogSettings.upsert({
		where: { catalogId },
		create: {
			catalogId,
			isActive: business.isActive,
			defaultMode,
			allowedModes: [defaultMode]
		},
		update: {
			isActive: business.isActive,
			defaultMode,
			allowedModes: [defaultMode],
			deleteAt: null
		}
	})
}

async function syncCatalogContacts(
	tx: Prisma.TransactionClient,
	catalogId: string,
	business: LegacyBusinessRow
) {
	const contacts = buildCatalogContacts(business)
	await tx.catalogContact.deleteMany({
		where: { catalogId }
	})

	if (!contacts.length) return

	await tx.catalogContact.createMany({
		data: contacts.map(contact => ({
			catalogId,
			type: contact.type,
			position: contact.position,
			value: contact.value
		}))
	})
}

async function syncCatalogMetrics(
	tx: Prisma.TransactionClient,
	catalogId: string,
	business: LegacyBusinessRow
) {
	const desired = buildMetricRows(business)
	const catalog = await tx.catalog.findUnique({
		where: { id: catalogId },
		select: {
			metrics: {
				where: { provider: Metric.YANDEX },
				select: { id: true, scope: true, counterId: true }
			}
		}
	})
	const existing = catalog?.metrics ?? []

	const desiredByScope = new Map(desired.map(item => [item.scope, item]))
	const existingByScope = new Map(existing.map(item => [item.scope, item]))

	for (const [scope, metric] of desiredByScope) {
		const current = existingByScope.get(scope)
		if (current?.counterId === metric.counterId) {
			await tx.metrics.update({
				where: { id: current.id },
				data: { deleteAt: null }
			})
			continue
		}

		if (current) {
			await tx.catalog.update({
				where: { id: catalogId },
				data: { metrics: { disconnect: { id: current.id } } }
			})
		}

		await tx.catalog.update({
			where: { id: catalogId },
			data: {
				metrics: {
					connectOrCreate: {
						where: { counterId: metric.counterId },
						create: {
							provider: Metric.YANDEX,
							scope,
							counterId: metric.counterId
						}
					}
				}
			}
		})
	}

	const redundantMetricIds = existing
		.filter(item => !desiredByScope.has(item.scope))
		.map(item => ({ id: item.id }))

	if (redundantMetricIds.length > 0) {
		await tx.catalog.update({
			where: { id: catalogId },
			data: {
				metrics: {
					disconnect: redundantMetricIds
				}
			}
		})
	}
}

async function syncCatalogIntegration(
	tx: Prisma.TransactionClient,
	catalogId: string,
	business: LegacyBusinessRow
) {
	const token = normalizeText(business.moySckladToken)
	if (!token) return

	const metadata = {
		token,
		priceTypeName: 'Цена продажи',
		importImages: true,
		syncStock: true,
		scheduleEnabled: false,
		schedulePattern: null,
		scheduleTimezone: 'Europe/Moscow'
	} satisfies Prisma.InputJsonValue

	const existing = await tx.integration.findFirst({
		where: {
			catalogId,
			provider: IntegrationProvider.MOYSKLAD
		},
		select: { id: true }
	})

	if (existing) {
		await tx.integration.update({
			where: { id: existing.id },
			data: {
				metadata,
				isActive: true,
				deleteAt: null
			}
		})
		return
	}

	await tx.integration.create({
		data: {
			catalogId,
			provider: IntegrationProvider.MOYSKLAD,
			metadata,
			isActive: true
		}
	})
}

async function syncCatalogRelations(
	tx: Prisma.TransactionClient,
	catalogId: string,
	activityId: string | null,
	regionIds: string[]
) {
	await tx.catalog.update({
		where: { id: catalogId },
		data: {
			activity: {
				set: activityId ? [{ id: activityId }] : []
			},
			region: {
				set: regionIds.map(id => ({ id }))
			}
		}
	})
}

async function buildOptionalDomainUpdate(
	tx: Prisma.TransactionClient,
	business: LegacyBusinessRow
): Promise<{ domain?: string | null }> {
	const normalizedDomain = normalizeText(business.domain)
	if (!normalizedDomain) return {}

	const resolution = await resolveCatalogDomain(tx, normalizedDomain)
	return resolution.domain ? { domain: resolution.domain } : {}
}

async function resolveUniqueUserLogin(
	tx: Prisma.TransactionClient
): Promise<string> {
	for (;;) {
		const candidate = generateRandomLogin(DEFAULT_LOGIN_LENGTH)
		if (!(await isCatalogLoginTaken(tx, candidate))) {
			return candidate
		}
	}
}

async function resolveUniqueCatalogSlug(
	tx: Prisma.TransactionClient,
	hostSeed: string
): Promise<string> {
	const base = normalizeSlug(hostSeed) || `catalog-${hostSeed.slice(0, 8)}`
	if (!(await isCatalogSlugTaken(tx, base))) {
		return base
	}

	let suffix = 2
	for (;;) {
		const candidate = truncateValue(`${base}-${suffix}`, 255)
		if (!(await isCatalogSlugTaken(tx, candidate))) {
			return candidate
		}
		suffix += 1
	}
}

async function resolveCatalogDomain(
	tx: Prisma.TransactionClient,
	domain: string | null
): Promise<{ domain: string | null; warning: boolean }> {
	const normalizedDomain = normalizeText(domain)
	if (!normalizedDomain) {
		return { domain: null, warning: false }
	}

	const existing = await tx.catalog.findFirst({
		where: { domain: normalizedDomain },
		select: { id: true }
	})

	if (existing) {
		return { domain: null, warning: true }
	}

	return { domain: normalizedDomain, warning: false }
}

async function isCatalogLoginTaken(
	tx: Prisma.TransactionClient,
	login: string
): Promise<boolean> {
	const existing = await tx.user.findFirst({
		where: {
			login,
			role: Role.CATALOG
		},
		select: { id: true }
	})
	return Boolean(existing)
}

function generateRandomLogin(length = DEFAULT_LOGIN_LENGTH): string {
	const normalizedLength = Math.max(2, length)
	let result = LOGIN_LETTER_ALPHABET[randomInt(0, LOGIN_LETTER_ALPHABET.length)]
	for (let index = 1; index < normalizedLength; index += 1) {
		result +=
			LOGIN_ALPHANUMERIC_ALPHABET[randomInt(0, LOGIN_ALPHANUMERIC_ALPHABET.length)]
	}
	return result
}

function buildCatalogHostValue(slug: string | null): string {
	const normalizedSlug = normalizeText(slug)
	if (!normalizedSlug) return ''
	return `${normalizedSlug}.myctlg.ru`
}

async function isCatalogSlugTaken(
	tx: Prisma.TransactionClient,
	slug: string
): Promise<boolean> {
	const existing = await tx.catalog.findFirst({
		where: { slug },
		select: { id: true }
	})
	return Boolean(existing)
}

async function findEntityMap(
	tx: Prisma.TransactionClient,
	source: string,
	entity: MigrationEntityKind,
	legacyId: string
): Promise<ExistingEntityMap | null> {
	return tx.migrationEntityMap.findFirst({
		where: {
			source,
			entity,
			legacyId
		},
		select: {
			id: true,
			targetId: true,
			payload: true
		}
	})
}

async function upsertEntityMap(
	tx: Prisma.TransactionClient,
	input: {
		runId: string
		source: string
		entity: MigrationEntityKind
		legacyId: string
		targetId: string
		legacyParentId?: string | null
		payload?: Prisma.InputJsonValue
	}
) {
	const existing = await findEntityMap(
		tx,
		input.source,
		input.entity,
		input.legacyId
	)

	if (existing) {
		await tx.migrationEntityMap.update({
			where: { id: existing.id },
			data: {
				runId: input.runId,
				targetId: input.targetId,
				legacyParentId: input.legacyParentId ?? null,
				...(input.payload ? { payload: input.payload } : {})
			}
		})
		return
	}

	await tx.migrationEntityMap.create({
		data: {
			runId: input.runId,
			source: input.source,
			entity: input.entity,
			legacyId: input.legacyId,
			targetId: input.targetId,
			legacyParentId: input.legacyParentId ?? null,
			...(input.payload ? { payload: input.payload } : {})
		}
	})
}

async function writeCredentialsArtifact(
	credentials: CatalogBootstrapCredential[],
	options: ApplyCatalogBootstrapOptions
): Promise<string> {
	const content = buildCredentialsCsv(credentials)
	const s3 = createCredentialsS3ConfigFromEnv()

	if (s3) {
		const key = buildCredentialsS3Key(options.runId)
		try {
			await uploadCredentialsArtifactToS3(s3, key, content)
			return `s3://${s3.bucket}/${key}`
		} catch (error) {
			console.warn(
				`[legacy-migration] Failed to upload credentials CSV to S3, falling back to local file: ${summarizeError(error)}`
			)
		}
	}

	return writeCredentialsLocalArtifact(content, options)
}

function buildCredentialsCsv(
	credentials: CatalogBootstrapCredential[]
): string {
	const lines = [
		['businessName', 'host', 'login', 'password'].join(','),
		...credentials.map(credential =>
			[
				credential.businessName,
				credential.host,
				credential.login,
				credential.password
			]
				.map(csvEscape)
				.join(',')
		)
	]

	return `${lines.join('\n')}\n`
}

async function writeCredentialsLocalArtifact(
	content: string,
	options: ApplyCatalogBootstrapOptions
): Promise<string> {
	const relativePath =
		options.credentialsFile?.trim() ||
		path.join(
			'migration',
			'runtime',
			`legacy-bootstrap-credentials-${options.runId}.csv`
		)
	const absolutePath = path.resolve(process.cwd(), relativePath)

	await mkdir(path.dirname(absolutePath), { recursive: true })
	await writeFile(absolutePath, content, 'utf8')
	return relativePath
}

async function uploadCredentialsArtifactToS3(
	s3: CredentialsS3Config,
	key: string,
	content: string
) {
	await s3.client.send(
		new PutObjectCommand({
			Bucket: s3.bucket,
			Key: key,
			Body: Buffer.from(content, 'utf8'),
			ContentType: 'text/csv; charset=utf-8',
			CacheControl: 'private, max-age=0, no-store'
		})
	)
}

function createCredentialsS3ConfigFromEnv(): CredentialsS3Config | null {
	if (!parseBoolean(process.env.S3_ENABLED)) return null

	const region = process.env.S3_REGION?.trim()
	const bucket = process.env.S3_BUCKET?.trim()
	const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim()
	const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim()
	const endpoint = process.env.S3_ENDPOINT?.trim() || undefined
	const forcePathStyle = parseBoolean(process.env.S3_FORCE_PATH_STYLE)

	if (!region || !bucket || !accessKeyId || !secretAccessKey) {
		return null
	}

	return {
		client: new S3Client({
			region,
			endpoint,
			forcePathStyle,
			credentials: {
				accessKeyId,
				secretAccessKey
			}
		}),
		bucket
	}
}

function buildCredentialsS3Key(runId: string): string {
	return [
		'migration',
		'runtime',
		`legacy-bootstrap-credentials-${runId}-${randomUUID()}.csv`
	].join('/')
}

function buildCatalogContacts(business: LegacyBusinessRow) {
	const contacts: Array<{ type: ContactType; position: number; value: string }> =
		[]
	let position = 0

	for (const mapping of CONTACT_FIELD_MAP) {
		const rawValue = business[mapping.field]
		const value = normalizeText(typeof rawValue === 'string' ? rawValue : null)
		if (!value) continue

		contacts.push({
			type: mapping.type,
			position,
			value
		})
		position += 1
	}

	return contacts
}

function buildMetricRows(business: LegacyBusinessRow) {
	const metrics = [
		{
			scope: MetricScope.GLOBAL,
			counterId: normalizeText(business.globalYandexMetrikaId)
		},
		{
			scope: MetricScope.MAIN,
			counterId: normalizeText(business.mainYandexMetrikaId)
		},
		{
			scope: MetricScope.CATALOG,
			counterId: normalizeText(business.yandexMetrikaId)
		}
	]

	return metrics.filter(
		(metric): metric is { scope: MetricScope; counterId: string } =>
			Boolean(metric.counterId)
	)
}

function sortBusinessesForBootstrap(
	rows: LegacyBusinessRow[]
): LegacyBusinessRow[] {
	return [...rows].sort((left, right) => {
		const leftWeight = left.parentId ? 1 : 0
		const rightWeight = right.parentId ? 1 : 0

		if (leftWeight !== rightWeight) return leftWeight - rightWeight

		return left.createdAt.getTime() - right.createdAt.getTime()
	})
}

function mapLegacyTypeCode(legacyCode: string): string {
	return LEGACY_TO_TARGET_TYPE_CODE.get(legacyCode) ?? legacyCode
}

function resolveBusinessDisplayName(business: LegacyBusinessRow): string {
	return (
		normalizeText(business.name) ??
		normalizeText(business.host) ??
		`Legacy business ${business.id}`
	)
}

function resolveCatalogStatus(
	status: string | null,
	isActive: boolean
): CatalogStatus {
	const upper = (status ?? '').toUpperCase()
	return (Object.values(CatalogStatus) as string[]).includes(upper)
		? (upper as CatalogStatus)
		: isActive
			? CatalogStatus.OPERATIONAL
			: CatalogStatus.PROPOSAL
}

function resolveCatalogDefaultMode(): CatalogExperienceMode {
	return CatalogExperienceMode.DELIVERY
}

function normalizeText(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeSlug(value: string): string {
	return slugify(value, {
		lower: true,
		strict: true,
		trim: true
	})
}

function normalizeLogin(value: string): string {
	const normalized = value.trim().toLowerCase()
	if (!normalized) return ''
	return truncateValue(normalized.replace(/\s+/g, '-'), 191)
}

function truncateValue(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function humanizeCode(code: string): string {
	return code
		.split(/[_-]+/g)
		.filter(Boolean)
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

function generateStrongPassword(length = DEFAULT_PASSWORD_LENGTH): string {
	let result = ''
	for (let index = 0; index < length; index += 1) {
		result += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)]
	}
	return result
}

function csvEscape(value: string): string {
	if (/[",\n\r]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`
	}
	return value
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
	if (value === undefined) return fallback
	const normalized = value.trim().toLowerCase()
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false
	return fallback
}

function summarizeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
