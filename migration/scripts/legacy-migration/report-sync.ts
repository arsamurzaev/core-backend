import {
	MigrationEntityKind,
	MigrationIssueSeverity,
	Prisma,
	PrismaClient,
	Role,
	SeoEntityType
} from '../../../prisma/generated/client.js'

import { buildLegacyOrderId, type LegacyOrdersData } from './orders-source.js'
import type { LegacyFinanceData } from './payments-source.js'
import {
	buildLegacyBrandId,
	buildLegacyCategoryId,
	buildLegacyProductId,
	type LegacyProductsData
} from './products-source.js'
import type { LegacyBusinessRow } from './source.js'

type ReportIssue = {
	entity: MigrationEntityKind
	legacyId: string
	severity: MigrationIssueSeverity
	code: string
	message: string
	details?: Prisma.InputJsonValue
}

type EntityMap = {
	legacyId: string
	targetId: string
}

const CONTACT_FIELDS = [
	'phone',
	'email',
	'whatsapp',
	'max',
	'bip',
	'telegram',
	'message',
	'map'
] as const
const QUERY_IN_CHUNK_SIZE = 5000

export async function buildLegacyReconciliationReport(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	finance: LegacyFinanceData,
	orders: LegacyOrdersData,
	products: LegacyProductsData,
	source: string
): Promise<{
	summary: Record<string, unknown>
	issues: ReportIssue[]
}> {
	const issues: ReportIssue[] = []
	const mismatchCounts = new Map<string, number>()

	const legacy = buildLegacyStats(businesses, finance, orders, products)
	const mappings = await loadMappings(
		prisma,
		businesses,
		finance,
		orders,
		products,
		source
	)
	const target = await loadTargetState(
		prisma,
		Array.from(
			new Set(Array.from(mappings.business.values()).map(item => item.targetId))
		),
		Array.from(
			new Set(Array.from(mappings.users.values()).map(item => item.targetId))
		)
	)

	const preview: Array<Record<string, unknown>> = []
	let matchedBusinesses = 0
	let businessesWithDifferences = 0

	for (const business of businesses) {
		const businessLegacy =
			legacy.byBusiness.get(business.id) ?? emptyLegacyBusiness()
		const businessMap = mappings.business.get(business.id) ?? null
		const userMap = mappings.users.get(business.id) ?? null
		const catalog = businessMap
			? (target.catalogs.get(businessMap.targetId) ?? null)
			: null
		const user = userMap ? (target.users.get(userMap.targetId) ?? null) : null
		const differenceCodes: string[] = []
		const expectedParentTargetId = business.parentId
			? (mappings.business.get(business.parentId)?.targetId ?? null)
			: null

		const businessTarget = {
			mappedUsers: user ? 1 : 0,
			mappedCatalogs: catalog ? 1 : 0,
			linkedChildren:
				business.parentId &&
				expectedParentTargetId &&
				catalog?.parentId === expectedParentTargetId
					? 1
					: 0,
			contacts: catalog?.contacts ?? 0,
			regions: catalog?.regions ?? 0,
			activities: catalog?.activities ?? 0,
			metrics: catalog?.metrics ?? 0,
			integrations: catalog?.integrations ?? 0,
			promoAssignments: catalog?.promoCodeId ? 1 : 0,
			mappedSubscriptionPayments: countMapped(
				mappings.subscriptionPaymentsByBusiness,
				business.id
			),
			mappedPromoPayments: countMapped(
				mappings.promoPaymentsByBusiness,
				business.id
			),
			mappedOrders: countMapped(mappings.ordersByBusiness, business.id),
			mappedBrands: countMapped(mappings.brandsByBusiness, business.id),
			mappedCategories: countMapped(mappings.categoriesByBusiness, business.id),
			mappedProducts: countMapped(mappings.productsByBusiness, business.id),
			categoryImagesLinked: target.categoryImages.get(catalog?.id ?? '') ?? 0,
			productImagesLinked: target.productImages.get(catalog?.id ?? '') ?? 0,
			mappedMediaAssets: countMapped(mappings.mediaByBusiness, business.id),
			mediaRows: target.mediaRows.get(catalog?.id ?? '') ?? 0,
			catalogLogosLinked: catalog?.logoMediaId ? 1 : 0,
			catalogBackgroundsLinked: catalog?.bgMediaId ? 1 : 0,
			catalogSeo: target.catalogSeo.get(catalog?.id ?? '') ?? 0,
			categorySeo: target.categorySeo.get(catalog?.id ?? '') ?? 0,
			productSeo: target.productSeo.get(catalog?.id ?? '') ?? 0,
			targetCategoryCount: target.categoryTotals.get(catalog?.id ?? '') ?? 0,
			targetProductCount: target.productTotals.get(catalog?.id ?? '') ?? 0
		}

		checkStructuralIssues(
			issues,
			mismatchCounts,
			differenceCodes,
			business,
			businessMap,
			userMap,
			catalog,
			user,
			expectedParentTargetId
		)

		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.CATALOG_CONTACT,
			'CONTACT_COUNT_MISMATCH',
			businessLegacy.contacts,
			businessTarget.contacts
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.CATALOG,
			'REGION_COUNT_MISMATCH',
			businessLegacy.regions,
			businessTarget.regions
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.CATALOG,
			'ACTIVITY_COUNT_MISMATCH',
			businessLegacy.activities,
			businessTarget.activities
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.METRIC,
			'METRIC_COUNT_MISMATCH',
			businessLegacy.metrics,
			businessTarget.metrics
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.INTEGRATION,
			'INTEGRATION_COUNT_MISMATCH',
			businessLegacy.integrations,
			businessTarget.integrations
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.PROMO_CODE,
			'PROMO_ASSIGNMENT_MISMATCH',
			businessLegacy.promoAssignments,
			businessTarget.promoAssignments
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.PAYMENT,
			'SUBSCRIPTION_PAYMENT_COUNT_MISMATCH',
			businessLegacy.subscriptionPayments,
			businessTarget.mappedSubscriptionPayments
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.PAYMENT,
			'PROMO_PAYMENT_COUNT_MISMATCH',
			businessLegacy.promoPayments,
			businessTarget.mappedPromoPayments
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.ORDER,
			'ORDER_COUNT_MISMATCH',
			businessLegacy.orders,
			businessTarget.mappedOrders
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.BRAND,
			'BRAND_COUNT_MISMATCH',
			businessLegacy.brands,
			businessTarget.mappedBrands
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.CATEGORY,
			'CATEGORY_COUNT_MISMATCH',
			businessLegacy.categories,
			businessTarget.mappedCategories
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.PRODUCT,
			'PRODUCT_COUNT_MISMATCH',
			businessLegacy.products,
			businessTarget.mappedProducts
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.MEDIA,
			'CATEGORY_IMAGE_COUNT_MISMATCH',
			businessLegacy.categoryImages,
			businessTarget.categoryImagesLinked
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.MEDIA,
			'PRODUCT_IMAGE_COUNT_MISMATCH',
			businessLegacy.productImages,
			businessTarget.productImagesLinked
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.MEDIA,
			'MEDIA_ASSET_COUNT_MISMATCH',
			businessLegacy.mediaAssets,
			businessTarget.mappedMediaAssets
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.MEDIA,
			'MEDIA_ROW_COUNT_MISMATCH',
			businessLegacy.mediaAssets,
			businessTarget.mediaRows
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.MEDIA,
			'CATALOG_LOGO_LINK_MISMATCH',
			businessLegacy.catalogLogos,
			businessTarget.catalogLogosLinked
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.MEDIA,
			'CATALOG_BACKGROUND_LINK_MISMATCH',
			businessLegacy.catalogBackgrounds,
			businessTarget.catalogBackgroundsLinked
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.CATALOG,
			'CATALOG_SEO_COUNT_MISMATCH',
			businessTarget.mappedCatalogs,
			businessTarget.catalogSeo
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.CATEGORY,
			'CATEGORY_SEO_COUNT_MISMATCH',
			businessTarget.targetCategoryCount,
			businessTarget.categorySeo
		)
		compareCount(
			issues,
			mismatchCounts,
			differenceCodes,
			business.id,
			MigrationEntityKind.PRODUCT,
			'PRODUCT_SEO_COUNT_MISMATCH',
			businessTarget.targetProductCount,
			businessTarget.productSeo
		)

		if (differenceCodes.length === 0) matchedBusinesses += 1
		else businessesWithDifferences += 1

		if (preview.length < 10) {
			preview.push({
				legacyBusinessId: business.id,
				host: business.host,
				targetCatalogId: businessMap?.targetId ?? null,
				status:
					!businessMap || !catalog
						? 'MISSING'
						: differenceCodes.length
							? 'DIFF'
							: 'OK',
				differenceCodes
			})
		}
	}

	const summary = {
		selectedBusinesses: businesses.length,
		matchedBusinesses,
		businessesWithDifferences,
		totalDifferences: issues.length,
		legacyTotals: legacy.totals,
		targetTotals: {
			...buildTargetTotals(businesses, legacy, mappings, target),
			mappedPromoCodes: mappings.promoCodes.size
		},
		mismatchCounts: Object.fromEntries(mismatchCounts),
		preview
	} satisfies Record<string, unknown>

	return {
		summary,
		issues: dedupeIssues(issues)
	}
}

async function loadMappings(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	finance: LegacyFinanceData,
	orders: LegacyOrdersData,
	products: LegacyProductsData,
	source: string
) {
	const businessIds = businesses.map(business => business.id)
	const promoCodeIds = Array.from(
		new Set(
			[
				...businesses.map(business => business.promoCodeId),
				...finance.promoPayments.map(payment => payment.promoCodeId)
			].filter((value): value is string => Boolean(value))
		)
	)
	const subscriptionPaymentsByBusiness = collectIdsByBusiness(
		finance.subscriptionPayments.map(payment => [
			payment.businessId,
			buildPaymentLegacyId('subscription', payment.id)
		])
	)
	const promoPaymentsByBusiness = collectIdsByBusiness(
		finance.promoPayments.map(payment => [
			payment.businessId,
			buildPaymentLegacyId('promo', payment.id)
		])
	)
	const ordersByBusiness = collectIdsByBusiness(
		orders.orders.map(order => [order.businessId, buildLegacyOrderId(order)])
	)
	const brandsByBusiness = collectIdsByBusiness(
		products.brands.map(brand => [brand.businessId, buildLegacyBrandId(brand)])
	)
	const categoriesByBusiness = collectIdsByBusiness(
		products.categories.map(category => [
			category.businessId,
			buildLegacyCategoryId(category)
		])
	)
	const productsByBusiness = collectIdsByBusiness(
		products.products.map(product => [
			product.businessId,
			buildLegacyProductId(product)
		])
	)
	const mediaByBusiness = collectIdsByBusiness(
		buildLegacyMediaRows(businesses, products)
	)

	const [business, users, promoCodes] = await Promise.all([
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.BUSINESS,
			businessIds
		),
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.USER,
			businessIds
		),
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.PROMO_CODE,
			promoCodeIds
		)
	])
	const [
		subscriptionMaps,
		promoMaps,
		orderMaps,
		brandMaps,
		categoryMaps,
		productMaps,
		mediaMaps
	] = await Promise.all([
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.PAYMENT,
			flattenIds(subscriptionPaymentsByBusiness)
		),
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.PAYMENT,
			flattenIds(promoPaymentsByBusiness)
		),
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.ORDER,
			flattenIds(ordersByBusiness)
		),
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.BRAND,
			flattenIds(brandsByBusiness)
		),
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.CATEGORY,
			flattenIds(categoriesByBusiness)
		),
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.PRODUCT,
			flattenIds(productsByBusiness)
		),
		loadEntityMapByLegacyId(
			prisma,
			source,
			MigrationEntityKind.MEDIA,
			flattenIds(mediaByBusiness)
		)
	])

	return {
		business,
		users,
		promoCodes,
		subscriptionPaymentsByBusiness: replaceIdsWithMaps(
			subscriptionPaymentsByBusiness,
			subscriptionMaps
		),
		promoPaymentsByBusiness: replaceIdsWithMaps(
			promoPaymentsByBusiness,
			promoMaps
		),
		ordersByBusiness: replaceIdsWithMaps(ordersByBusiness, orderMaps),
		brandsByBusiness: replaceIdsWithMaps(brandsByBusiness, brandMaps),
		categoriesByBusiness: replaceIdsWithMaps(categoriesByBusiness, categoryMaps),
		productsByBusiness: replaceIdsWithMaps(productsByBusiness, productMaps),
		mediaByBusiness: replaceIdsWithMaps(mediaByBusiness, mediaMaps)
	}
}

async function loadTargetState(
	prisma: PrismaClient,
	catalogIds: string[],
	userIds: string[]
) {
	const [catalogs, users, categories, products, seoSettings, mediaRows] =
		await Promise.all([
			loadCatalogReportRows(prisma, catalogIds),
			loadUserReportRows(prisma, userIds),
			loadCategoryReportRows(prisma, catalogIds),
			loadProductReportRows(prisma, catalogIds),
			loadSeoReportRows(prisma, catalogIds),
			loadMediaReportRows(prisma, catalogIds)
		])

	const productIdToCatalogId = new Map(
		products.map(product => [product.id, product.catalogId])
	)
	const productMedia =
		products.length === 0
			? []
			: await findManyByChunks(
					products.map(product => product.id),
					ids =>
						prisma.productMedia.findMany({
							where: { productId: { in: ids } },
							select: { productId: true }
						})
				)

	const coreMediaRows = mediaRows.filter(
		media => !media.path || !media.path.startsWith('seo/')
	)

	return {
		catalogs: new Map(
			catalogs.map(catalog => [
				catalog.id,
				{
					id: catalog.id,
					userId: catalog.userId,
					parentId: catalog.parentId,
					promoCodeId: catalog.promoCodeId,
					logoMediaId: catalog.config?.logoMediaId ?? null,
					bgMediaId: catalog.config?.bgMediaId ?? null,
					contacts: catalog._count.contacts,
					regions: catalog._count.region,
					activities: catalog._count.activity,
					metrics: catalog._count.metrics,
					integrations: catalog._count.integrations,
					mediaRows: 0
				}
			])
		),
		users: new Map(
			users.map(user => [user.id, { id: user.id, role: user.role }])
		),
		categoryImages: countByKey(
			categories
				.filter(category => Boolean(category.imageMediaId))
				.map(category => category.catalogId)
		),
		categoryTotals: countByKey(categories.map(category => category.catalogId)),
		productImages: countByKey(
			productMedia
				.map(item => productIdToCatalogId.get(item.productId) ?? null)
				.filter((value): value is string => Boolean(value))
		),
		productTotals: countByKey(products.map(product => product.catalogId)),
		catalogSeo: countByKey(
			seoSettings
				.filter(setting => setting.entityType === SeoEntityType.CATALOG)
				.map(setting => setting.catalogId)
		),
		categorySeo: countByKey(
			seoSettings
				.filter(setting => setting.entityType === SeoEntityType.CATEGORY)
				.map(setting => setting.catalogId)
		),
		productSeo: countByKey(
			seoSettings
				.filter(setting => setting.entityType === SeoEntityType.PRODUCT)
				.map(setting => setting.catalogId)
		),
		mediaRows: countByKey(coreMediaRows.map(media => media.catalogId))
	}
}

async function loadCatalogReportRows(
	prisma: PrismaClient,
	catalogIds: string[]
) {
	return findManyByChunks(catalogIds, ids =>
		prisma.catalog.findMany({
			where: { id: { in: ids } },
			select: {
				id: true,
				userId: true,
				parentId: true,
				promoCodeId: true,
				config: {
					select: {
						logoMediaId: true,
						bgMediaId: true
					}
				},
				_count: {
					select: {
						contacts: true,
						region: true,
						activity: true,
						metrics: true,
						integrations: true,
						media: true
					}
				}
			}
		})
	)
}

async function loadUserReportRows(prisma: PrismaClient, userIds: string[]) {
	return findManyByChunks(userIds, ids =>
		prisma.user.findMany({
			where: { id: { in: ids } },
			select: { id: true, role: true }
		})
	)
}

async function loadCategoryReportRows(
	prisma: PrismaClient,
	catalogIds: string[]
) {
	return findManyByChunks(catalogIds, ids =>
		prisma.category.findMany({
			where: { catalogId: { in: ids }, deleteAt: null },
			select: { id: true, catalogId: true, imageMediaId: true }
		})
	)
}

async function loadProductReportRows(
	prisma: PrismaClient,
	catalogIds: string[]
) {
	return findManyByChunks(catalogIds, ids =>
		prisma.product.findMany({
			where: { catalogId: { in: ids }, deleteAt: null },
			select: { id: true, catalogId: true }
		})
	)
}

async function loadSeoReportRows(prisma: PrismaClient, catalogIds: string[]) {
	return findManyByChunks(catalogIds, ids =>
		prisma.seoSetting.findMany({
			where: {
				catalogId: { in: ids },
				deleteAt: null,
				entityType: {
					in: [SeoEntityType.CATALOG, SeoEntityType.CATEGORY, SeoEntityType.PRODUCT]
				}
			},
			select: {
				catalogId: true,
				entityType: true
			}
		})
	)
}

async function loadMediaReportRows(prisma: PrismaClient, catalogIds: string[]) {
	return findManyByChunks(catalogIds, ids =>
		prisma.media.findMany({
			where: {
				catalogId: { in: ids }
			},
			select: {
				catalogId: true,
				path: true
			}
		})
	)
}

function buildLegacyStats(
	businesses: LegacyBusinessRow[],
	finance: LegacyFinanceData,
	orders: LegacyOrdersData,
	products: LegacyProductsData
) {
	const byBusiness = new Map(
		businesses.map(business => [
			business.id,
			{
				contacts: CONTACT_FIELDS.reduce((count, field) => {
					return count + (normalizeText(business[field]) ? 1 : 0)
				}, 0),
				regions: business.regionalityCount,
				activities: business.activityName ? 1 : 0,
				metrics: countTruthy([
					business.globalYandexMetrikaId,
					business.mainYandexMetrikaId,
					business.yandexMetrikaId
				]),
				integrations: business.moySckladToken ? 1 : 0,
				promoAssignments: business.promoCodeId ? 1 : 0,
				subscriptionPayments: 0,
				promoPayments: 0,
				orders: 0,
				brands: 0,
				categories: 0,
				products: 0,
				categoryImages: 0,
				productImages: 0,
				mediaAssets: (business.logoUrl ? 1 : 0) + (business.bgUrl ? 1 : 0),
				catalogLogos: business.logoUrl ? 1 : 0,
				catalogBackgrounds: business.bgUrl ? 1 : 0,
				hasParent: business.parentId ? 1 : 0
			}
		])
	)

	for (const payment of finance.subscriptionPayments) {
		byBusiness.get(payment.businessId)!.subscriptionPayments += 1
	}
	for (const payment of finance.promoPayments) {
		byBusiness.get(payment.businessId)!.promoPayments += 1
	}
	for (const order of orders.orders) {
		byBusiness.get(order.businessId)!.orders += 1
	}
	for (const brand of products.brands) {
		byBusiness.get(brand.businessId)!.brands += 1
	}
	for (const category of products.categories) {
		const item = byBusiness.get(category.businessId)!
		item.categories += 1
		if (category.imageUrl) {
			item.categoryImages += 1
			item.mediaAssets += 1
		}
	}
	for (const product of products.products) {
		const item = byBusiness.get(product.businessId)!
		item.products += 1
		item.productImages += product.imagesUrl.length
		item.mediaAssets += product.imagesUrl.length
	}

	const totals = {
		selectedBusinesses: businesses.length,
		childBusinesses: sumByBusiness(byBusiness, 'hasParent'),
		contacts: sumByBusiness(byBusiness, 'contacts'),
		regions: sumByBusiness(byBusiness, 'regions'),
		activities: sumByBusiness(byBusiness, 'activities'),
		metrics: sumByBusiness(byBusiness, 'metrics'),
		integrations: sumByBusiness(byBusiness, 'integrations'),
		promoAssignments: sumByBusiness(byBusiness, 'promoAssignments'),
		referencedPromoCodes: Array.from(
			new Set(
				[
					...businesses.map(business => business.promoCodeId),
					...finance.promoPayments.map(payment => payment.promoCodeId)
				].filter((value): value is string => Boolean(value))
			)
		).length,
		subscriptionPayments: sumByBusiness(byBusiness, 'subscriptionPayments'),
		promoPayments: sumByBusiness(byBusiness, 'promoPayments'),
		orders: sumByBusiness(byBusiness, 'orders'),
		brands: sumByBusiness(byBusiness, 'brands'),
		categories: sumByBusiness(byBusiness, 'categories'),
		products: sumByBusiness(byBusiness, 'products'),
		categoryImages: sumByBusiness(byBusiness, 'categoryImages'),
		productImages: sumByBusiness(byBusiness, 'productImages'),
		mediaAssets: sumByBusiness(byBusiness, 'mediaAssets'),
		catalogLogos: sumByBusiness(byBusiness, 'catalogLogos'),
		catalogBackgrounds: sumByBusiness(byBusiness, 'catalogBackgrounds')
	}

	return { byBusiness, totals }
}

function buildTargetTotals(
	businesses: LegacyBusinessRow[],
	legacy: ReturnType<typeof buildLegacyStats>,
	mappings: Awaited<ReturnType<typeof loadMappings>>,
	target: Awaited<ReturnType<typeof loadTargetState>>
) {
	return businesses.reduce(
		(acc, business) => {
			const businessMap = mappings.business.get(business.id) ?? null
			const userMap = mappings.users.get(business.id) ?? null
			const catalog = businessMap
				? (target.catalogs.get(businessMap.targetId) ?? null)
				: null
			const user = userMap ? (target.users.get(userMap.targetId) ?? null) : null
			const expectedParentTargetId = business.parentId
				? (mappings.business.get(business.parentId)?.targetId ?? null)
				: null

			acc.mappedUsers += user ? 1 : 0
			acc.mappedCatalogs += catalog ? 1 : 0
			acc.linkedChildren +=
				business.parentId &&
				expectedParentTargetId &&
				catalog?.parentId === expectedParentTargetId
					? 1
					: 0
			acc.contacts += catalog?.contacts ?? 0
			acc.regions += catalog?.regions ?? 0
			acc.activities += catalog?.activities ?? 0
			acc.metrics += catalog?.metrics ?? 0
			acc.integrations += catalog?.integrations ?? 0
			acc.promoAssignments += catalog?.promoCodeId ? 1 : 0
			acc.mappedSubscriptionPayments += countMapped(
				mappings.subscriptionPaymentsByBusiness,
				business.id
			)
			acc.mappedPromoPayments += countMapped(
				mappings.promoPaymentsByBusiness,
				business.id
			)
			acc.mappedOrders += countMapped(mappings.ordersByBusiness, business.id)
			acc.mappedBrands += countMapped(mappings.brandsByBusiness, business.id)
			acc.mappedCategories += countMapped(
				mappings.categoriesByBusiness,
				business.id
			)
			acc.mappedProducts += countMapped(mappings.productsByBusiness, business.id)
			acc.categoryImagesLinked += target.categoryImages.get(catalog?.id ?? '') ?? 0
			acc.productImagesLinked += target.productImages.get(catalog?.id ?? '') ?? 0
			acc.mappedMediaAssets += countMapped(mappings.mediaByBusiness, business.id)
			acc.mediaRows += target.mediaRows.get(catalog?.id ?? '') ?? 0
			acc.catalogLogosLinked += catalog?.logoMediaId ? 1 : 0
			acc.catalogBackgroundsLinked += catalog?.bgMediaId ? 1 : 0
			void legacy
			return acc
		},
		{
			mappedUsers: 0,
			mappedCatalogs: 0,
			linkedChildren: 0,
			contacts: 0,
			regions: 0,
			activities: 0,
			metrics: 0,
			integrations: 0,
			promoAssignments: 0,
			mappedPromoCodes: 0,
			mappedSubscriptionPayments: 0,
			mappedPromoPayments: 0,
			mappedOrders: 0,
			mappedBrands: 0,
			mappedCategories: 0,
			mappedProducts: 0,
			categoryImagesLinked: 0,
			productImagesLinked: 0,
			mappedMediaAssets: 0,
			mediaRows: 0,
			catalogLogosLinked: 0,
			catalogBackgroundsLinked: 0
		}
	)
}

function checkStructuralIssues(
	issues: ReportIssue[],
	mismatchCounts: Map<string, number>,
	differenceCodes: string[],
	business: LegacyBusinessRow,
	businessMap: EntityMap | null,
	userMap: EntityMap | null,
	catalog: {
		id: string
		userId: string | null
		parentId: string | null
	} | null,
	user: { id: string; role: Role } | null,
	expectedParentTargetId: string | null
) {
	if (!businessMap) {
		pushIssue(issues, mismatchCounts, differenceCodes, {
			entity: MigrationEntityKind.CATALOG,
			legacyId: business.id,
			severity: MigrationIssueSeverity.ERROR,
			code: 'CATALOG_MAPPING_MISSING',
			message: 'Target catalog mapping is missing for legacy business.'
		})
	}

	if (businessMap && !catalog) {
		pushIssue(issues, mismatchCounts, differenceCodes, {
			entity: MigrationEntityKind.CATALOG,
			legacyId: business.id,
			severity: MigrationIssueSeverity.ERROR,
			code: 'TARGET_CATALOG_MISSING',
			message: 'Migration mapping exists, but target catalog row was not found.',
			details: {
				targetCatalogId: businessMap.targetId
			} satisfies Prisma.InputJsonValue
		})
	}

	if (!userMap) {
		pushIssue(issues, mismatchCounts, differenceCodes, {
			entity: MigrationEntityKind.USER,
			legacyId: business.id,
			severity: MigrationIssueSeverity.ERROR,
			code: 'USER_MAPPING_MISSING',
			message: 'Target user mapping is missing for legacy business.'
		})
	}

	if (userMap && !user) {
		pushIssue(issues, mismatchCounts, differenceCodes, {
			entity: MigrationEntityKind.USER,
			legacyId: business.id,
			severity: MigrationIssueSeverity.ERROR,
			code: 'TARGET_USER_MISSING',
			message: 'Migration mapping exists, but target user row was not found.',
			details: { targetUserId: userMap.targetId } satisfies Prisma.InputJsonValue
		})
	}

	if (user && user.role !== Role.CATALOG) {
		pushIssue(issues, mismatchCounts, differenceCodes, {
			entity: MigrationEntityKind.USER,
			legacyId: business.id,
			severity: MigrationIssueSeverity.WARNING,
			code: 'USER_ROLE_MISMATCH',
			message: 'Target user exists, but role is not CATALOG.',
			details: {
				targetUserId: user.id,
				actualRole: user.role
			} satisfies Prisma.InputJsonValue
		})
	}

	if (catalog && user && catalog.userId !== user.id) {
		pushIssue(issues, mismatchCounts, differenceCodes, {
			entity: MigrationEntityKind.CATALOG,
			legacyId: business.id,
			severity: MigrationIssueSeverity.WARNING,
			code: 'CATALOG_USER_LINK_MISMATCH',
			message:
				'Target catalog is linked to a different user than the migration map.',
			details: {
				targetCatalogId: catalog.id,
				expectedUserId: user.id,
				actualUserId: catalog.userId
			} satisfies Prisma.InputJsonValue
		})
	}

	if (business.parentId) {
		if (!expectedParentTargetId) {
			pushIssue(issues, mismatchCounts, differenceCodes, {
				entity: MigrationEntityKind.CATALOG,
				legacyId: business.id,
				severity: MigrationIssueSeverity.WARNING,
				code: 'PARENT_MAPPING_MISSING',
				message:
					'Legacy child business expects a parent, but the parent mapping was not found.',
				details: {
					parentLegacyId: business.parentId
				} satisfies Prisma.InputJsonValue
			})
		} else if (!catalog || catalog.parentId !== expectedParentTargetId) {
			pushIssue(issues, mismatchCounts, differenceCodes, {
				entity: MigrationEntityKind.CATALOG,
				legacyId: business.id,
				severity: MigrationIssueSeverity.WARNING,
				code: 'PARENT_LINK_MISMATCH',
				message:
					'Target child catalog is not linked to the expected parent catalog.',
				details: {
					targetCatalogId: catalog?.id ?? null,
					expectedParentId: expectedParentTargetId,
					actualParentId: catalog?.parentId ?? null
				} satisfies Prisma.InputJsonValue
			})
		}
	}
}

function compareCount(
	issues: ReportIssue[],
	mismatchCounts: Map<string, number>,
	differenceCodes: string[],
	legacyBusinessId: string,
	entity: MigrationEntityKind,
	code: string,
	expected: number,
	actual: number
) {
	if (expected === actual) return

	pushIssue(issues, mismatchCounts, differenceCodes, {
		entity,
		legacyId: legacyBusinessId,
		severity: MigrationIssueSeverity.WARNING,
		code,
		message: `Legacy/new count mismatch for ${code}.`,
		details: { expected, actual } satisfies Prisma.InputJsonValue
	})
}

async function loadEntityMapByLegacyId(
	prisma: PrismaClient,
	source: string,
	entity: MigrationEntityKind,
	legacyIds: string[]
): Promise<Map<string, EntityMap>> {
	const uniqueIds = uniqueNonEmptyIds(legacyIds)
	if (uniqueIds.length === 0) return new Map()

	const rows = await findManyByChunks(uniqueIds, ids =>
		prisma.migrationEntityMap.findMany({
			where: {
				source,
				entity,
				legacyId: { in: ids }
			},
			select: {
				legacyId: true,
				targetId: true
			}
		})
	)

	return new Map(
		rows.map(row => [
			row.legacyId,
			{ legacyId: row.legacyId, targetId: row.targetId }
		])
	)
}

async function findManyByChunks<T>(
	ids: string[],
	query: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
	const uniqueIds = uniqueNonEmptyIds(ids)
	if (uniqueIds.length === 0) return []

	const rows: T[] = []
	for (const chunk of chunkArray(uniqueIds, QUERY_IN_CHUNK_SIZE)) {
		rows.push(...(await query(chunk)))
	}
	return rows
}

function uniqueNonEmptyIds(ids: string[]): string[] {
	return Array.from(new Set(ids.filter(Boolean)))
}

function chunkArray<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}
	return chunks
}

function collectIdsByBusiness(
	rows: Array<[string, string]>
): Map<string, string[]> {
	const result = new Map<string, string[]>()
	for (const [businessId, legacyId] of rows) {
		const items = result.get(businessId)
		if (items) items.push(legacyId)
		else result.set(businessId, [legacyId])
	}
	return result
}

function flattenIds(values: Map<string, string[]>): string[] {
	return Array.from(values.values()).flatMap(items => items)
}

function replaceIdsWithMaps(
	idsByBusiness: Map<string, string[]>,
	mapsByLegacyId: Map<string, EntityMap>
): Map<string, EntityMap[]> {
	return new Map(
		Array.from(idsByBusiness.entries()).map(([businessId, ids]) => [
			businessId,
			ids
				.map(legacyId => mapsByLegacyId.get(legacyId) ?? null)
				.filter((value): value is EntityMap => Boolean(value))
		])
	)
}

function countMapped(
	mapsByBusiness: Map<string, EntityMap[]>,
	businessId: string
): number {
	return mapsByBusiness.get(businessId)?.length ?? 0
}

function buildLegacyMediaRows(
	businesses: LegacyBusinessRow[],
	products: LegacyProductsData
): Array<[string, string]> {
	const rows: Array<[string, string]> = []

	for (const business of businesses) {
		if (business.logoUrl) rows.push([business.id, `business:${business.id}:logo`])
		if (business.bgUrl) rows.push([business.id, `business:${business.id}:bg`])
	}

	for (const category of products.categories) {
		if (!category.imageUrl) continue
		rows.push([
			category.businessId,
			`category:${buildLegacyCategoryId(category)}:image`
		])
	}

	for (const product of products.products) {
		if (!product.imagesUrl.length) continue
		const legacyProductId = buildLegacyProductId(product)
		product.imagesUrl.forEach((_, index) => {
			rows.push([
				product.businessId,
				`product:${legacyProductId}:image:${index + 1}`
			])
		})
	}

	return rows
}

function countByKey(values: string[]): Map<string, number> {
	const counts = new Map<string, number>()
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1)
	}
	return counts
}

function sumByBusiness(
	byBusiness: Map<string, Record<string, number>>,
	key: string
): number {
	let total = 0
	for (const value of byBusiness.values()) {
		total += value[key] ?? 0
	}
	return total
}

function emptyLegacyBusiness(): Record<string, number> {
	return {
		contacts: 0,
		regions: 0,
		activities: 0,
		metrics: 0,
		integrations: 0,
		promoAssignments: 0,
		subscriptionPayments: 0,
		promoPayments: 0,
		orders: 0,
		brands: 0,
		categories: 0,
		products: 0,
		categoryImages: 0,
		productImages: 0,
		mediaAssets: 0,
		catalogLogos: 0,
		catalogBackgrounds: 0,
		hasParent: 0
	}
}

function buildPaymentLegacyId(
	kind: 'subscription' | 'promo',
	legacyId: string
): string {
	return `${kind}:${legacyId}`
}

function countTruthy(values: Array<string | null>): number {
	return values.reduce(
		(count, value) => count + (normalizeText(value) ? 1 : 0),
		0
	)
}

function normalizeText(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function pushIssue(
	issues: ReportIssue[],
	mismatchCounts: Map<string, number>,
	differenceCodes: string[],
	issue: ReportIssue
) {
	issues.push(issue)
	differenceCodes.push(issue.code)
	mismatchCounts.set(issue.code, (mismatchCounts.get(issue.code) ?? 0) + 1)
}

function dedupeIssues(issues: ReportIssue[]): ReportIssue[] {
	const seen = new Set<string>()
	const result: ReportIssue[] = []

	for (const issue of issues) {
		const key = JSON.stringify([
			issue.entity,
			issue.legacyId,
			issue.severity,
			issue.code,
			issue.message,
			issue.details ?? null
		])
		if (seen.has(key)) continue
		seen.add(key)
		result.push(issue)
	}

	return result
}
