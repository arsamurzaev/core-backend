import { createHash } from 'node:crypto'
import pLimit from 'p-limit'
import slugify from 'slugify'

import {
	DataType,
	IntegrationProvider,
	MigrationEntityKind,
	MigrationIssueSeverity,
	Prisma,
	PrismaClient,
	ProductStatus
} from '../../../prisma/generated/client.js'

import { runMigrationTransaction, withRetry } from './migration-utils.js'
import {gacyBrandId,
	buildLegacyCategoryId,
	buildLegacyProductId,
	type LegacyBrandRow,
	type LegacyCategoryProductLinkRow,
	type LegacyCategoryRow,
	type LegacyProductRow,
	type LegacyProductsData
} from './products-source.js'
import { upsertProductSeo.js'
import { upsertProductSeoById } from './seo-syncById } from './seo-sync.js'
import type { LegacyBusinessRow } from './source.js'

type ApplyLegacyProductsOptions = {
	runId: string
	source: string
}

type LegacyProductIssue = {
	entity: MigrationEntityKind
	legacyId: string
	severity: MigrationIssueSeverity
	code: string
	message: string
	details?: Prisma.InputJsonValue
}

type ApplyLegacyProductsSummary = {
	processedBusinesses: number
	totalBrands: number
	createdBrands: number
	reusedBrands: number
	totalCategories: number
	createdCategories: number
	reusedCategories: number
	totalProducts: number
	createdProducts: number
	reusedProducts: number
	productsWithBrand: number
	productsWithImages: number
	productsWithMsUuid: number
	categoriesWithImages: number
	createdCategoryLinks: number
	reusedCategoryLinks: number
	createdIntegrationLinks: number
	reusedIntegrationLinks: number
	skippedProducts: number
	skippedCategoryLinks: number
}

type ApplyLegacyProductsResult = {
	summary: ApplyLegacyProductsSummary
	issues: LegacyProductIssue[]
}

type ExistingEntityMap = {
	id: string
	legacyId: string
	targetId: string
	payload: Prisma.JsonValue | null
}

type CatalogContext = {
	legacyBusinessId: string
	catalogId: string
	typeId: string
	integrationId: string | null
}

type CommonAttributeDefinition = {
	key:
		| 'subtitle'
		| 'description'
		| 'discount'
		| 'discountedPrice'
		| 'discountStartAt'
		| 'discountEndAt'
	displayName: string
	dataType: DataType
	displayOrder: number
}

type CommonAttributeContext = Record<CommonAttributeDefinition['key'], string>

type BusinessProductsGroup = {
	brands: LegacyBrandRow[]
	categories: LegacyCategoryRow[]
	products: LegacyProductRow[]
	categoryProductLinks: LegacyCategoryProductLinkRow[]
}

type UpsertBrandResult = {
	targetBrandId: string
	created: boolean
}

type UpsertCategoryResult = {
	targetCategoryId: string
	created: boolean
}

type UpsertProductResult = {
	targetProductId: string
	created: boolean
	integrationLinked: boolean
	integrationLinkCreated: boolean
}

type UpsertCategoryProductLinkResult = {
	created: boolean
}

const COMMON_PRODUCT_ATTRIBUTES: CommonAttributeDefinition[] = [
	{
		key: 'subtitle',
		displayName: 'Подзаголовок',
		dataType: DataType.STRING,
		displayOrder: 80
	},
	{
		key: 'description',
		displayName: 'Описание',
		dataType: DataType.STRING,
		displayOrder: 82
	},
	{
		key: 'discount',
		displayName: 'Скидка',
		dataType: DataType.INTEGER,
		displayOrder: 83
	},
	{
		key: 'discountedPrice',
		displayName: 'Цена со скидкой',
		dataType: DataType.DECIMAL,
		displayOrder: 84
	},
	{
		key: 'discountStartAt',
		displayName: 'Начало скидки',
		dataType: DataType.DATETIME,
		displayOrder: 85
	},
	{
		key: 'discountEndAt',
		displayName: 'Конец скидки',
		dataType: DataType.DATETIME,
		displayOrder: 86
	}
]

const PRODUCT_TO_BRAND_SOURCE_TABLE: Partial<Record<string, string>> = {
	ClothesProduct: 'ClothesBrand',
	DefaultProduct: 'DefaultBrand',
	FlowersProduct: 'FlowersBrand',
	GiftProduct: 'GiftBrand',
	SemiFinishedProductsProduct: 'SemiFinishedProductsBrand',
	TechnicProduct: 'TechnicBrand',
	TradingBaseProduct: 'TradingBaseBrand'
}

const PRODUCT_TO_CATEGORY_SOURCE_TABLE: Record<string, string> = {
	ClothesProduct: 'ClothesCategory',
	ConfectioneryProduct: 'ConfectioneryCategory',
	DefaultProduct: 'DefaultCategory',
	FlowersProduct: 'FlowersCategory',
	GiftProduct: 'GiftCategory',
	RestaurantProduct: 'RestaurantCategory',
	SemiFinishedProductsProduct: 'SemiFinishedProductsCategory',
	TechnicProduct: 'TechnicCategory',
	TradingBaseProduct: 'TradingBaseCategory'
}

const PRODUCT_NAME_MAX_LENGTH = 255
const BRAND_NAME_MAX_LENGTH = 255
const CATEGORY_NAME_MAX_LENGTH = 255
const BRAND_SLUG_MAX_LENGTH = 255
const PRODUCT_SLUG_MAX_LENGTH = 255
const PRODUCT_SKU_MAX_LENGTH = 100
const PRODUCT_ATTRIBUTE_STRING_MAX_LENGTH = 500

export async function collectLegacyProductIssues(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	data: LegacyProductsData,
	source: string
): Promise<LegacyProductIssue[]> {
	const issues: LegacyProductIssue[] = []
	const relevantBusinessIds = collectRelevantBusinessIds(data)
	const mappedBusinessIds = await loadMappedLegacyIds(
		prisma,
		source,
		MigrationEntityKind.BUSINESS,
		relevantBusinessIds
	)
	const businessById = new Map(
		businesses.map(business => [business.id, business])
	)
	const availableBrandIds = new Set(
		data.brands.map(row => buildLegacyBrandId(row))
	)
	const availableCategoryIds = new Set(
		data.categories.map(row => buildLegacyCategoryId(row))
	)
	const availableProductIds = new Set(
		data.products.map(row => buildLegacyProductId(row))
	)

	for (const businessId of relevantBusinessIds) {
		if (mappedBusinessIds.has(businessId)) continue

		issues.push({
			entity: MigrationEntityKind.PRODUCT,
			legacyId: businessId,
			severity: MigrationIssueSeverity.ERROR,
			code: 'CATALOG_MAPPING_MISSING',
			message:
				'Для legacy business с товарами не найден mapping в target Catalog. Сначала выполните фазу catalog-bootstrap.',
			details: {
				legacyBusinessId: businessId
			} satisfies Prisma.InputJsonValue
		})
	}

	for (const brand of data.brands) {
		if (normalizeText(brand.name)) continue

		issues.push({
			entity: MigrationEntityKind.BRAND,
			legacyId: buildLegacyBrandId(brand),
			severity: MigrationIssueSeverity.WARNING,
			code: 'BRAND_NAME_EMPTY',
			message:
				'Legacy brand имеет пустое имя. В target будет создано fallback-имя.',
			details: {
				legacyBusinessId: brand.businessId,
				sourceTable: brand.sourceTable
			} satisfies Prisma.InputJsonValue
		})
	}

	for (const category of data.categories) {
		if (normalizeText(category.name)) continue

		issues.push({
			entity: MigrationEntityKind.CATEGORY,
			legacyId: buildLegacyCategoryId(category),
			severity: MigrationIssueSeverity.WARNING,
			code: 'CATEGORY_NAME_EMPTY',
			message:
				'Legacy category имеет пустое имя. В target будет создано fallback-имя.',
			details: {
				legacyBusinessId: category.businessId,
				sourceTable: category.sourceTable
			} satisfies Prisma.InputJsonValue
		})
	}

	for (const product of data.products) {
		const legacyId = buildLegacyProductId(product)
		const business = businessById.get(product.businessId)

		if (!normalizeText(product.name)) {
			issues.push({
				entity: MigrationEntityKind.PRODUCT,
				legacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'PRODUCT_NAME_EMPTY',
				message:
					'Legacy product имеет пустое имя. В target будет создано fallback-имя.',
				details: {
					legacyBusinessId: product.businessId,
					sourceTable: product.sourceTable
				} satisfies Prisma.InputJsonValue
			})
		}

		if (parseDecimal(product.price) === null) {
			issues.push({
				entity: MigrationEntityKind.PRODUCT,
				legacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'PRODUCT_PRICE_INVALID',
				message:
					'Legacy price не удалось распарсить в Decimal. В target будет записан 0.',
				details: {
					rawPrice: product.price
				} satisfies Prisma.InputJsonValue
			})
		}

		const brandLegacyId = buildLegacyBrandReferenceId(product)
		if (brandLegacyId && !availableBrandIds.has(brandLegacyId)) {
			issues.push({
				entity: MigrationEntityKind.PRODUCT,
				legacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'PRODUCT_BRAND_REFERENCE_MISSING',
				message:
					'У legacy product есть ссылка на бренд, но соответствующий legacy brand не был найден.',
				details: {
					legacyBrandId: brandLegacyId,
					rawLegacyBrandRowId: product.brandId
				} satisfies Prisma.InputJsonValue
			})
		}

		if (product.msUuid && !normalizeText(business?.moySckladToken ?? null)) {
			issues.push({
				entity: MigrationEntityKind.PRODUCT,
				legacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'PRODUCT_MOYSKLAD_SKIPPED_NO_INTEGRATION',
				message:
					'У legacy product есть msUuid, но для бизнеса не найден MoySklad token. IntegrationProductLink создан не будет.',
				details: {
					msUuid: product.msUuid
				} satisfies Prisma.InputJsonValue
			})
		}
	}

	for (const link of data.categoryProductLinks) {
		const legacyProductId = buildLegacyProductId({
			sourceTable: link.sourceTable,
			legacyProductId: link.legacyProductId
		})
		const legacyCategoryId = buildLegacyCategoryReferenceId(link)

		if (!availableProductIds.has(legacyProductId)) {
			issues.push({
				entity: MigrationEntityKind.CATEGORY,
				legacyId: legacyProductId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'CATEGORY_LINK_PRODUCT_MISSING',
				message:
					'Связь category-product будет пропущена: legacy product не найден в выбранной выборке.',
				details: {
					sourceTable: link.sourceTable,
					legacyBusinessId: link.businessId
				} satisfies Prisma.InputJsonValue
			})
		}

		if (!legacyCategoryId || !availableCategoryIds.has(legacyCategoryId)) {
			issues.push({
				entity: MigrationEntityKind.CATEGORY,
				legacyId:
					legacyCategoryId ?? `${link.sourceTable}:${link.legacyCategoryId}`,
				severity: MigrationIssueSeverity.WARNING,
				code: 'CATEGORY_LINK_CATEGORY_MISSING',
				message:
					'Связь category-product будет пропущена: legacy category не найдена в выбранной выборке.',
				details: {
					sourceTable: link.sourceTable,
					legacyBusinessId: link.businessId
				} satisfies Prisma.InputJsonValue
			})
		}
	}

	return dedupeIssues(issues)
}

export async function applyLegacyProducts(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	data: LegacyProductsData,
	options: ApplyLegacyProductsOptions
): Promise<ApplyLegacyProductsResult> {
	const issues: LegacyProductIssue[] = []
	const relevantBusinessIds = Array.from(
		new Set(businesses.map(business => business.id))
	)
	const catalogContexts = await loadCatalogContexts(
		prisma,
		options.source,
		relevantBusinessIds
	)
	const commonAttributes = await ensureCommonAttributesForTypes(
		prisma,
		Array.from(
			new Set(Array.from(catalogContexts.values()).map(ctx => ctx.typeId))
		)
	)
	const grouped = groupProductsDataByBusiness(data)

	let createdBrands = 0
	let reusedBrands = 0
	let createdCategories = 0
	let reusedCategories = 0
	let createdProducts = 0
	let reusedProducts = 0
	let createdCategoryLinks = 0
	let reusedCategoryLinks = 0
	let createdIntegrationLinks = 0
	let reusedIntegrationLinks = 0
	let skippedProducts = 0
	let skippedCategoryLinks = 0

	const limit = pLimit(10)

	await Promise.all(
		businesses.map(business =>
			limit(async () => {
				const group = grouped.get(business.id) ?? emptyBusinessProductsGroup()
				if (
					group.brands.length === 0 &&
					group.categories.length === 0 &&
					group.products.length === 0 &&
					group.categoryProductLinks.length === 0
				) {
					return
				}

				const context = catalogContexts.get(business.id)
				if (!context) {
					skippedProducts += group.products.length
					skippedCategoryLinks += group.categoryProductLinks.length
					issues.push({
						entity: MigrationEntityKind.PRODUCT,
						legacyId: business.id,
						severity: MigrationIssueSeverity.ERROR,
						code: 'PRODUCTS_SKIPPED_NO_CATALOG',
						message:
							'Товарная миграция для business пропущена: target catalog mapping не найден.',
						details: {
							legacyBusinessId: business.id
						} satisfies Prisma.InputJsonValue
					})
					return
				}

				const result = await withRetry(() =>
					runMigrationTransaction(prisma, async tx =>
						syncBusinessProducts(tx, context, group, commonAttributes, options)
					)
				)

				for (const productId of result.allProductIds) {
					await upsertProductSeoById(prisma, context.catalogId, productId)
				}

				createdBrands += result.createdBrands
				reusedBrands += result.reusedBrands
				createdCategories += result.createdCategories
				reusedCategories += result.reusedCategories
				createdProducts += result.createdProducts
				reusedProducts += result.reusedProducts
				createdCategoryLinks += result.createdCategoryLinks
				reusedCategoryLinks += result.reusedCategoryLinks
				createdIntegrationLinks += result.createdIntegrationLinks
				reusedIntegrationLinks += result.reusedIntegrationLinks
				skippedProducts += result.skippedProducts
				skippedCategoryLinks += result.skippedCategoryLinks
				issues.push(...result.issues)
			})
		)
	)

	return {
		summary: {
			processedBusinesses: businesses.length,
			totalBrands: data.brands.length,
			createdBrands,
			reusedBrands,
			totalCategories: data.categories.length,
			createdCategories,
			reusedCategories,
			totalProducts: data.products.length,
			createdProducts,
			reusedProducts,
			productsWithBrand: data.products.filter(product => !!product.brandId).length,
			productsWithImages: data.products.filter(
				product => product.imagesUrl.length > 0
			).length,
			productsWithMsUuid: data.products.filter(product => !!product.msUuid).length,
			categoriesWithImages: data.categories.filter(category => !!category.imageUrl)
				.length,
			createdCategoryLinks,
			reusedCategoryLinks,
			createdIntegrationLinks,
			reusedIntegrationLinks,
			skippedProducts,
			skippedCategoryLinks
		},
		issues: dedupeIssues(issues)
	}
}

async function syncBusinessProducts(
	tx: Prisma.TransactionClient,
	context: CatalogContext,
	group: BusinessProductsGroup,
	commonAttributes: CommonAttributeContext,
	options: ApplyLegacyProductsOptions
) {
	const issues: LegacyProductIssue[] = []
	const brandTargetIdByLegacyId = new Map<string, string>()
	const categoryTargetIdByLegacyId = new Map<string, string>()
	const productTargetIdByLegacyId = new Map<string, string>()
	const productPositionByLegacyId = new Map<string, number>()

	group.products.forEach((product, index) => {
		productPositionByLegacyId.set(buildLegacyProductId(product), index)
	})

	const allProductIds: string[] = []
	let createdBrands = 0
	let reusedBrands = 0
	let createdCategories = 0
	let reusedCategories = 0
	let createdProducts = 0
	let reusedProducts = 0
	let createdCategoryLinks = 0
	let reusedCategoryLinks = 0
	let createdIntegrationLinks = 0
	let reusedIntegrationLinks = 0
	const skippedProducts = 0
	let skippedCategoryLinks = 0

	for (const brand of group.brands) {
		const result = await upsertLegacyBrand(tx, context.catalogId, brand, options)
		brandTargetIdByLegacyId.set(buildLegacyBrandId(brand), result.targetBrandId)
		if (result.created) createdBrands += 1
		else reusedBrands += 1
	}

	for (const [index, category] of group.categories.entries()) {
		const result = await upsertLegacyCategory(
			tx,
			context.catalogId,
			category,
			index,
			options
		)
		categoryTargetIdByLegacyId.set(
			buildLegacyCategoryId(category),
			result.targetCategoryId
		)
		if (result.created) createdCategories += 1
		else reusedCategories += 1
	}

	for (const [index, product] of group.products.entries()) {
		const brandLegacyId = buildLegacyBrandReferenceId(product)
		const brandId = brandLegacyId
			? (brandTargetIdByLegacyId.get(brandLegacyId) ?? null)
			: null

		if (brandLegacyId && !brandId) {
			issues.push({
				entity: MigrationEntityKind.PRODUCT,
				legacyId: buildLegacyProductId(product),
				severity: MigrationIssueSeverity.WARNING,
				code: 'PRODUCT_BRAND_NOT_MIGRATED',
				message:
					'Продукт перенесён без brandId, потому что legacy brand не был разрешён в target.',
				details: {
					legacyBrandId: brandLegacyId
				} satisfies Prisma.InputJsonValue
			})
		}

		const result = await upsertLegacyProduct(
			tx,
			context,
			product,
			index,
			brandId,
			commonAttributes,
			options
		)
		productTargetIdByLegacyId.set(
			buildLegacyProductId(product),
			result.targetProductId
		)
		allProductIds.push(result.targetProductId)
		if (result.created) createdProducts += 1
		else reusedProducts += 1
		if (result.integrationLinked) {
			if (result.integrationLinkCreated) createdIntegrationLinks += 1
			else reusedIntegrationLinks += 1
		}
	}

	for (const link of group.categoryProductLinks) {
		const categoryLegacyId = buildLegacyCategoryReferenceId(link)
		const productLegacyId = buildLegacyProductId({
			sourceTable: link.sourceTable,
			legacyProductId: link.legacyProductId
		})
		const categoryId = categoryLegacyId
			? (categoryTargetIdByLegacyId.get(categoryLegacyId) ?? null)
			: null
		const productId = productTargetIdByLegacyId.get(productLegacyId) ?? null

		if (!categoryId || !productId) {
			skippedCategoryLinks += 1
			issues.push({
				entity: MigrationEntityKind.CATEGORY,
				legacyId: categoryLegacyId ?? productLegacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'CATEGORY_PRODUCT_LINK_SKIPPED',
				message:
					'Связь category-product пропущена, потому что одна из сущностей не была разрешена в target.',
				details: {
					categoryLegacyId,
					productLegacyId
				} satisfies Prisma.InputJsonValue
			})
			continue
		}

		const result = await upsertCategoryProductLink(tx, {
			categoryId,
			productId,
			position: productPositionByLegacyId.get(productLegacyId) ?? 0
		})

		if (result.created) createdCategoryLinks += 1
		else reusedCategoryLinks += 1
	}

	return {
		allProductIds,
		createdBrands,
		reusedBrands,
		createdCategories,
		reusedCategories,
		createdProducts,
		reusedProducts,
		createdCategoryLinks,
		reusedCategoryLinks,
		createdIntegrationLinks,
		reusedIntegrationLinks,
		skippedProducts,
		skippedCategoryLinks,
		issues
	}
}

async function upsertLegacyBrand(
	tx: Prisma.TransactionClient,
	catalogId: string,
	brand: LegacyBrandRow,
	options: ApplyLegacyProductsOptions
): Promise<UpsertBrandResult> {
	const legacyId = buildLegacyBrandId(brand)
	const existingMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.BRAND,
		legacyId
	)
	const existingByMap = existingMap
		? await tx.brand.findFirst({
				where: { id: existingMap.targetId },
				select: { id: true, slug: true }
			})
		: null
	const name = resolveBrandName(brand)
	const slug =
		existingByMap?.slug ??
		(await resolveUniqueBrandSlug(tx, catalogId, name, existingByMap?.id ?? null))
	const existingBySlug = existingByMap
		? null
		: await tx.brand.findFirst({
				where: { catalogId, slug },
				select: { id: true, slug: true }
			})
	const existingBrand = existingByMap ?? existingBySlug

	if (existingBrand) {
		await tx.brand.update({
			where: { id: existingBrand.id },
			data: {
				name,
				slug,
				deleteAt: null
			}
		})

		await upsertEntityMap(tx, {
			runId: options.runId,
			source: options.source,
			entity: MigrationEntityKind.BRAND,
			legacyId,
			targetId: existingBrand.id,
			payload: {
				sourceTable: brand.sourceTable,
				legacyBusinessId: brand.businessId,
				name,
				slug
			}
		})

		return {
			targetBrandId: existingBrand.id,
			created: false
		}
	}

	const createdBrand = await tx.brand.create({
		data: {
			catalogId,
			name,
			slug,
			createdAt: brand.createdAt
		},
		select: { id: true }
	})

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.BRAND,
		legacyId,
		targetId: createdBrand.id,
		payload: {
			sourceTable: brand.sourceTable,
			legacyBusinessId: brand.businessId,
			name,
			slug
		}
	})

	return {
		targetBrandId: createdBrand.id,
		created: true
	}
}

async function upsertLegacyCategory(
	tx: Prisma.TransactionClient,
	catalogId: string,
	category: LegacyCategoryRow,
	index: number,
	options: ApplyLegacyProductsOptions
): Promise<UpsertCategoryResult> {
	const legacyId = buildLegacyCategoryId(category)
	const existingMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.CATEGORY,
		legacyId
	)
	const existingByMap = existingMap
		? await tx.category.findFirst({
				where: { id: existingMap.targetId },
				select: { id: true }
			})
		: null
	const name = resolveCategoryName(category)
	const position = category.position ?? index
	const descriptor = normalizeText(category.descriptor)
	const existingByFingerprint = existingByMap
		? null
		: await tx.category.findFirst({
				where: {
					catalogId,
					name,
					position,
					descriptor,
					parentId: null
				},
				select: { id: true }
			})
	const existingCategory = existingByMap ?? existingByFingerprint

	if (existingCategory) {
		await tx.category.update({
			where: { id: existingCategory.id },
			data: {
				name,
				position,
				descriptor,
				deleteAt: null
			}
		})

		await upsertEntityMap(tx, {
			runId: options.runId,
			source: options.source,
			entity: MigrationEntityKind.CATEGORY,
			legacyId,
			targetId: existingCategory.id,
			payload: {
				sourceTable: category.sourceTable,
				legacyBusinessId: category.businessId,
				imageUrl: normalizeText(category.imageUrl),
				descriptor
			}
		})

		return {
			targetCategoryId: existingCategory.id,
			created: false
		}
	}

	const createdCategory = await tx.category.create({
		data: {
			catalogId,
			name,
			position,
			descriptor,
			createdAt: category.createdAt
		},
		select: { id: true }
	})

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.CATEGORY,
		legacyId,
		targetId: createdCategory.id,
		payload: {
			sourceTable: category.sourceTable,
			legacyBusinessId: category.businessId,
			imageUrl: normalizeText(category.imageUrl),
			descriptor
		}
	})

	return {
		targetCategoryId: createdCategory.id,
		created: true
	}
}

async function upsertLegacyProduct(
	tx: Prisma.TransactionClient,
	context: CatalogContext,
	product: LegacyProductRow,
	index: number,
	brandId: string | null,
	commonAttributes: CommonAttributeContext,
	options: ApplyLegacyProductsOptions
): Promise<UpsertProductResult> {
	const legacyId = buildLegacyProductId(product)
	const existingMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.PRODUCT,
		legacyId
	)
	const existingByMap = existingMap
		? await tx.product.findFirst({
				where: { id: existingMap.targetId },
				select: { id: true, slug: true, sku: true }
			})
		: null
	const name = resolveProductName(product)
	const slug =
		existingByMap?.slug ??
		(await resolveUniqueProductSlug(
			tx,
			context.catalogId,
			name,
			existingByMap?.id ?? null
		))
	const sku = existingByMap?.sku ?? buildLegacyProductSku(product)
	const existingBySku = existingByMap
		? null
		: await tx.product.findFirst({
				where: { sku },
				select: { id: true, slug: true, sku: true }
			})
	const existingProduct = existingByMap ?? existingBySku
	const price = parseDecimal(product.price) ?? new Prisma.Decimal(0)
	const status = product.isVisible ? ProductStatus.ACTIVE : ProductStatus.HIDDEN
	const position = index

	const data = {
		catalogId: context.catalogId,
		brandId,
		sku,
		name,
		slug,
		price,
		isPopular: product.isPopular,
		status,
		position,
		deleteAt: null
	} satisfies Prisma.ProductUncheckedCreateInput

	let targetProductId: string
	let created: boolean

	if (existingProduct) {
		await tx.product.update({
			where: { id: existingProduct.id },
			data
		})
		targetProductId = existingProduct.id
		created = false
	} else {
		const createdProduct = await tx.product.create({
			data: {
				...data,
				createdAt: product.createdAt
			},
			select: { id: true }
		})
		targetProductId = createdProduct.id
		created = true
	}

	await syncCommonProductAttributes(
		tx,
		targetProductId,
		commonAttributes,
		product
	)

	const integrationLink = await syncIntegrationProductLink(
		tx,
		context.integrationId,
		targetProductId,
		product
	)

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.PRODUCT,
		legacyId,
		targetId: targetProductId,
		payload: {
			sourceTable: product.sourceTable,
			legacyBusinessId: product.businessId,
			msUuid: normalizeText(product.msUuid),
			imagesUrl: product.imagesUrl,
			legacyBrandId: buildLegacyBrandReferenceId(product),
			slug,
			sku
		}
	})

	return {
		targetProductId,
		created,
		integrationLinked: integrationLink.linked,
		integrationLinkCreated: integrationLink.created
	}
}

async function syncCommonProductAttributes(
	tx: Prisma.TransactionClient,
	productId: string,
	commonAttributes: CommonAttributeContext,
	product: LegacyProductRow
) {
	await tx.productAttribute.deleteMany({
		where: {
			productId,
			attributeId: {
				in: Object.values(commonAttributes)
			}
		}
	})

	const rows: Prisma.ProductAttributeCreateManyInput[] = []

	if (normalizeText(product.subtitle)) {
		rows.push({
			productId,
			attributeId: commonAttributes.subtitle,
			valueString: normalizeAttributeString(product.subtitle)
		})
	}

	if (normalizeText(product.description)) {
		rows.push({
			productId,
			attributeId: commonAttributes.description,
			valueString: normalizeAttributeString(product.description)
		})
	}

	if (Number.isInteger(product.discount)) {
		rows.push({
			productId,
			attributeId: commonAttributes.discount,
			valueInteger: product.discount
		})
	}

	const discountedPrice = parseDecimal(product.discountedPrice)
	if (discountedPrice) {
		rows.push({
			productId,
			attributeId: commonAttributes.discountedPrice,
			valueDecimal: discountedPrice
		})
	}

	if (product.discountStart) {
		rows.push({
			productId,
			attributeId: commonAttributes.discountStartAt,
			valueDateTime: product.discountStart
		})
	}

	if (product.discountEnd) {
		rows.push({
			productId,
			attributeId: commonAttributes.discountEndAt,
			valueDateTime: product.discountEnd
		})
	}

	if (rows.length > 0) {
		for (const row of rows) {
			await tx.productAttribute.create({
				data: row
			})
		}
	}
}

async function syncIntegrationProductLink(
	tx: Prisma.TransactionClient,
	integrationId: string | null,
	productId: string,
	product: LegacyProductRow
): Promise<{ linked: boolean; created: boolean }> {
	const externalId = normalizeText(product.msUuid)
	if (!integrationId || !externalId) {
		return { linked: false, created: false }
	}

	const existing = await tx.integrationProductLink.findFirst({
		where: {
			integrationId,
			OR: [{ externalId }, { productId }]
		},
		select: { id: true }
	})

	const data = {
		integrationId,
		productId,
		externalId,
		rawMeta: {
			legacySource: 'old-code',
			sourceTable: product.sourceTable,
			legacyProductId: product.legacyProductId,
			legacyBusinessId: product.businessId
		} satisfies Prisma.InputJsonValue
	} satisfies Prisma.IntegrationProductLinkUncheckedCreateInput

	if (existing) {
		await tx.integrationProductLink.update({
			where: { id: existing.id },
			data
		})
		return { linked: true, created: false }
	}

	await tx.integrationProductLink.create({
		data
	})
	return { linked: true, created: true }
}

async function upsertCategoryProductLink(
	tx: Prisma.TransactionClient,
	input: {
		categoryId: string
		productId: string
		position: number
	}
): Promise<UpsertCategoryProductLinkResult> {
	const existing = await tx.categoryProduct.findUnique({
		where: {
			categoryId_productId: {
				categoryId: input.categoryId,
				productId: input.productId
			}
		},
		select: { categoryId: true }
	})

	if (existing) {
		await tx.categoryProduct.update({
			where: {
				categoryId_productId: {
					categoryId: input.categoryId,
					productId: input.productId
				}
			},
			data: {
				position: input.position
			}
		})
		return { created: false }
	}

	await tx.categoryProduct.create({
		data: input
	})
	return { created: true }
}

async function loadCatalogContexts(
	prisma: PrismaClient,
	source: string,
	legacyBusinessIds: string[]
): Promise<Map<string, CatalogContext>> {
	if (legacyBusinessIds.length === 0) return new Map()

	const businessMaps = await prisma.migrationEntityMap.findMany({
		where: {
			source,
			entity: MigrationEntityKind.BUSINESS,
			legacyId: { in: legacyBusinessIds }
		},
		select: {
			legacyId: true,
			targetId: true
		}
	})

	const catalogs = await prisma.catalog.findMany({
		where: {
			id: {
				in: businessMaps.map(mapping => mapping.targetId)
			}
		},
		select: {
			id: true,
			typeId: true,
			integrations: {
				where: {
					provider: IntegrationProvider.MOYSKLAD,
					deleteAt: null
				},
				select: { id: true }
			}
		}
	})

	const catalogById = new Map(catalogs.map(catalog => [catalog.id, catalog]))

	return new Map(
		businessMaps.flatMap(mapping => {
			const catalog = catalogById.get(mapping.targetId)
			if (!catalog) return []

			return [
				[
					mapping.legacyId,
					{
						legacyBusinessId: mapping.legacyId,
						catalogId: catalog.id,
						typeId: catalog.typeId,
						integrationId: catalog.integrations[0]?.id ?? null
					} satisfies CatalogContext
				]
			]
		})
	)
}

async function ensureCommonAttributesForTypes(
	prisma: PrismaClient,
	typeIds: string[]
): Promise<CommonAttributeContext> {
	const keys = COMMON_PRODUCT_ATTRIBUTES.map(attribute => attribute.key)
	const existingAttributes = await prisma.attribute.findMany({
		where: {
			key: {
				in: keys
			}
		},
		select: {
			id: true,
			key: true,
			deleteAt: true
		}
	})

	const attributeIdByKey = new Map(
		existingAttributes.map(attribute => [attribute.key, attribute.id])
	)

	for (const definition of COMMON_PRODUCT_ATTRIBUTES) {
		const existingId = attributeIdByKey.get(definition.key)
		if (existingId) {
			const existing = existingAttributes.find(
				attribute => attribute.id === existingId
			)
			if (existing?.deleteAt) {
				await prisma.attribute.update({
					where: { id: existingId },
					data: { deleteAt: null }
				})
			}
			continue
		}

		const created = await prisma.attribute.create({
			data: {
				key: definition.key,
				displayName: definition.displayName,
				dataType: definition.dataType,
				isRequired: false,
				isVariantAttribute: false,
				isFilterable: false,
				displayOrder: definition.displayOrder,
				isHidden: false
			},
			select: { id: true, key: true }
		})
		attributeIdByKey.set(
			created.key as CommonAttributeDefinition['key'],
			created.id
		)
	}

	if (typeIds.length > 0) {
		const types = await prisma.type.findMany({
			where: { id: { in: typeIds } },
			select: {
				id: true,
				attributes: {
					where: {
						key: {
							in: keys
						}
					},
					select: { id: true }
				}
			}
		})

		for (const type of types) {
			const existingIds = new Set(type.attributes.map(attribute => attribute.id))
			const missingIds = keys
				.map(key => attributeIdByKey.get(key))
				.filter((id): id is string => Boolean(id))
				.filter(id => !existingIds.has(id))

			if (missingIds.length === 0) continue

			await prisma.type.update({
				where: { id: type.id },
				data: {
					attributes: {
						connect: missingIds.map(id => ({ id }))
					}
				}
			})
		}
	}

	return {
		subtitle: mustAttributeId(attributeIdByKey, 'subtitle'),
		description: mustAttributeId(attributeIdByKey, 'description'),
		discount: mustAttributeId(attributeIdByKey, 'discount'),
		discountedPrice: mustAttributeId(attributeIdByKey, 'discountedPrice'),
		discountStartAt: mustAttributeId(attributeIdByKey, 'discountStartAt'),
		discountEndAt: mustAttributeId(attributeIdByKey, 'discountEndAt')
	}
}

async function resolveUniqueBrandSlug(
	tx: Prisma.TransactionClient,
	catalogId: string,
	name: string,
	excludeId: string | null
): Promise<string> {
	const base =
		normalizeSlug(name) || `legacy-brand-${buildShortHash(name).toLowerCase()}`
	return resolveUniqueSlug(
		tx,
		'brand',
		catalogId,
		base,
		BRAND_SLUG_MAX_LENGTH,
		excludeId
	)
}

async function resolveUniqueProductSlug(
	tx: Prisma.TransactionClient,
	catalogId: string,
	name: string,
	excludeId: string | null
): Promise<string> {
	const base =
		normalizeSlug(name) || `legacy-product-${buildShortHash(name).toLowerCase()}`
	return resolveUniqueSlug(
		tx,
		'product',
		catalogId,
		base,
		PRODUCT_SLUG_MAX_LENGTH,
		excludeId
	)
}

async function resolveUniqueSlug(
	tx: Prisma.TransactionClient,
	entity: 'brand' | 'product',
	catalogId: string,
	base: string,
	maxLength: number,
	excludeId: string | null
): Promise<string> {
	const initial = truncateValue(base, maxLength)
	if (!(await isSlugTaken(tx, entity, catalogId, initial, excludeId))) {
		return initial
	}

	let suffix = 2
	for (;;) {
		const candidate = truncateValue(`${base}-${suffix}`, maxLength)
		if (!(await isSlugTaken(tx, entity, catalogId, candidate, excludeId))) {
			return candidate
		}
		suffix += 1
	}
}

async function isSlugTaken(
	tx: Prisma.TransactionClient,
	entity: 'brand' | 'product',
	catalogId: string,
	slug: string,
	excludeId: string | null
): Promise<boolean> {
	if (entity === 'brand') {
		const existing = await tx.brand.findFirst({
			where: {
				catalogId,
				slug,
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(existing)
	}

	const existing = await tx.product.findFirst({
		where: {
			catalogId,
			slug,
			...(excludeId ? { id: { not: excludeId } } : {})
		},
		select: { id: true }
	})
	return Boolean(existing)
}

function groupProductsDataByBusiness(data: LegacyProductsData) {
	const grouped = new Map<string, BusinessProductsGroup>()

	for (const brand of data.brands) {
		ensureBusinessGroup(grouped, brand.businessId).brands.push(brand)
	}

	for (const category of data.categories) {
		ensureBusinessGroup(grouped, category.businessId).categories.push(category)
	}

	for (const product of data.products) {
		ensureBusinessGroup(grouped, product.businessId).products.push(product)
	}

	for (const link of data.categoryProductLinks) {
		ensureBusinessGroup(grouped, link.businessId).categoryProductLinks.push(link)
	}

	return grouped
}

function ensureBusinessGroup(
	grouped: Map<string, BusinessProductsGroup>,
	businessId: string
) {
	const existing = grouped.get(businessId)
	if (existing) return existing

	const created = emptyBusinessProductsGroup()
	grouped.set(businessId, created)
	return created
}

function emptyBusinessProductsGroup(): BusinessProductsGroup {
	return {
		brands: [],
		categories: [],
		products: [],
		categoryProductLinks: []
	}
}

function collectRelevantBusinessIds(data: LegacyProductsData): string[] {
	const ids = new Set<string>()

	for (const brand of data.brands) ids.add(brand.businessId)
	for (const category of data.categories) ids.add(category.businessId)
	for (const product of data.products) ids.add(product.businessId)
	for (const link of data.categoryProductLinks) ids.add(link.businessId)

	return Array.from(ids)
}

function buildLegacyBrandReferenceId(product: LegacyProductRow): string | null {
	if (!product.brandId) return null
	const brandSourceTable = PRODUCT_TO_BRAND_SOURCE_TABLE[product.sourceTable]
	if (!brandSourceTable) return null

	return buildLegacyBrandId({
		sourceTable: brandSourceTable,
		legacyBrandId: product.brandId
	})
}

function buildLegacyCategoryReferenceId(
	link: LegacyCategoryProductLinkRow
): string | null {
	const categorySourceTable = PRODUCT_TO_CATEGORY_SOURCE_TABLE[link.sourceTable]
	if (!categorySourceTable) return null

	return buildLegacyCategoryId({
		sourceTable: categorySourceTable,
		legacyCategoryId: link.legacyCategoryId
	})
}

async function loadMappedLegacyIds(
	prisma: PrismaClient,
	source: string,
	entity: MigrationEntityKind,
	legacyIds: string[]
): Promise<Set<string>> {
	if (legacyIds.length === 0) return new Set()

	const mappings = await prisma.migrationEntityMap.findMany({
		where: {
			source,
			entity,
			legacyId: { in: legacyIds }
		},
		select: { legacyId: true }
	})

	return new Set(mappings.map(mapping => mapping.legacyId))
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
			legacyId: true,
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
			...(input.payload ? { payload: input.payload } : {})
		}
	})
}

function resolveBrandName(brand: LegacyBrandRow): string {
	return truncateValue(
		normalizeText(brand.name) ??
			`Legacy brand ${brand.legacyBrandId.slice(0, 8)}`,
		BRAND_NAME_MAX_LENGTH
	)
}

function resolveCategoryName(category: LegacyCategoryRow): string {
	return truncateValue(
		normalizeText(category.name) ??
			`Legacy category ${category.legacyCategoryId.slice(0, 8)}`,
		CATEGORY_NAME_MAX_LENGTH
	)
}

function resolveProductName(product: LegacyProductRow): string {
	return truncateValue(
		normalizeText(product.name) ??
			`Legacy product ${product.legacyProductId.slice(0, 8)}`,
		PRODUCT_NAME_MAX_LENGTH
	)
}

function buildLegacyProductSku(product: LegacyProductRow): string {
	const base = buildSkuBase(
		`${product.sourceTable}-${normalizeText(product.name) ?? product.legacyProductId}`
	)
	return buildHashedSku(base || 'LEGACY', buildLegacyProductId(product))
}

function buildSkuBase(value: string): string {
	const slug = slugify(value, { lower: false, strict: true, trim: true })
	return slug
		.replace(/-+/g, '-')
		.replace(/^[-_]+|[-_]+$/g, '')
		.toUpperCase()
}

function buildHashedSku(base: string, stableSeed: string): string {
	const hash = createHash('sha1')
		.update(stableSeed)
		.digest('hex')
		.slice(0, 8)
		.toUpperCase()
	const separator = base ? '-' : ''
	const maxBaseLength = PRODUCT_SKU_MAX_LENGTH - hash.length - separator.length
	const head = maxBaseLength > 0 ? base.slice(0, maxBaseLength) : ''
	return `${head}${separator}${hash}`
}

function normalizeSlug(value: string): string {
	const slug = slugify(value, {
		lower: true,
		strict: true,
		trim: true
	})
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

function buildShortHash(value: string): string {
	return createHash('sha1').update(value).digest('hex').slice(0, 8)
}

function truncateValue(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function mustAttributeId(
	attributeIdByKey: Map<string, string>,
	key: CommonAttributeDefinition['key']
): string {
	const id = attributeIdByKey.get(key)
	if (!id) {
		throw new Error(`Missing common product attribute id for key "${key}"`)
	}
	return id
}

function parseDecimal(
	value: string | number | null | undefined
): Prisma.Decimal | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? new Prisma.Decimal(value) : null
	}

	const normalized = normalizeText(value)
	if (!normalized) return null

	const sanitized = normalized.replace(/\s+/g, '').replace(',', '.')
	if (!/^[+-]?\d+(?:\.\d+)?$/.test(sanitized)) {
		return null
	}

	return new Prisma.Decimal(sanitized)
}

function normalizeText(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeAttributeString(
	value: string | null | undefined
): string | null {
	const normalized = normalizeText(value)
	if (!normalized) return null

	const sanitized = normalized
		.replace(/\u0000/g, ' ')
		.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()

	if (!sanitized) return null

	return truncateValue(sanitized, PRODUCT_ATTRIBUTE_STRING_MAX_LENGTH)
}

function dedupeIssues(issues: LegacyProductIssue[]): LegacyProductIssue[] {
	const seen = new Set<string>()
	const result: LegacyProductIssue[] = []

	for (const issue of issues) {
		const fingerprint = JSON.stringify([
			issue.entity,
			issue.legacyId,
			issue.severity,
			issue.code,
			issue.message
		])
		if (seen.has(fingerprint)) continue
		seen.add(fingerprint)
		result.push(issue)
	}

	return result
}
