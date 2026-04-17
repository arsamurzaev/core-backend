import type pg from 'pg'

import type { LegacyBusinessRow } from './source.js'

export type LegacyProductScanOptions = {
	businessIds: string[]
}

export type LegacyBrandRow = {
	sourceTable: string
	legacyBrandId: string
	businessId: string
	typeId: string | null
	name: string | null
	createdAt: Date
	updatedAt: Date
}

export type LegacyCategoryRow = {
	sourceTable: string
	legacyCategoryId: string
	businessId: string
	typeId: string | null
	name: string | null
	position: number | null
	imageUrl: string | null
	descriptor: string | null
	createdAt: Date
	updatedAt: Date
}

export type LegacyProductRow = {
	sourceTable: string
	legacyProductId: string
	businessId: string
	typeId: string | null
	msUuid: string | null
	name: string | null
	price: string | null
	subtitle: string | null
	imagesUrl: string[]
	brandId: string | null
	description: string | null
	discount: number | null
	discountedPrice: string | null
	discountStart: Date | null
	discountEnd: Date | null
	isVisible: boolean
	isPopular: boolean
	createdAt: Date
	updatedAt: Date
}

export type LegacyCategoryProductLinkRow = {
	sourceTable: string
	businessId: string
	legacyCategoryId: string
	legacyProductId: string
}

export type LegacyProductsData = {
	brands: LegacyBrandRow[]
	categories: LegacyCategoryRow[]
	products: LegacyProductRow[]
	categoryProductLinks: LegacyCategoryProductLinkRow[]
}

export type LegacyProductsSummary = {
	selectedBusinesses: number
	brands: number
	categories: number
	products: number
	categoryProductLinks: number
	productsWithBrand: number
	productsWithImages: number
	productsWithMsUuid: number
	categoriesWithImages: number
	bySourceTable: Record<string, number>
	preview: Array<{
		legacyProductId: string
		sourceTable: string
		businessId: string
		name: string | null
		price: string | null
		brandId: string | null
		imagesCount: number
	}>
}

export async function loadLegacyProductsData(
	pool: pg.Pool,
	options: LegacyProductScanOptions
): Promise<LegacyProductsData> {
	if (options.businessIds.length === 0) {
		return {
			brands: [],
			categories: [],
			products: [],
			categoryProductLinks: []
		}
	}

	const businessIds = options.businessIds
	const [brands, categories, products, categoryProductLinks] = await Promise.all(
		[
			loadLegacyBrands(pool, businessIds),
			loadLegacyCategories(pool, businessIds),
			loadLegacyProducts(pool, businessIds),
			loadLegacyCategoryProductLinks(pool, businessIds)
		]
	)

	return {
		brands,
		categories,
		products,
		categoryProductLinks
	}
}

export function analyzeLegacyProductsData(
	businesses: LegacyBusinessRow[],
	data: LegacyProductsData
): LegacyProductsSummary {
	return {
		selectedBusinesses: businesses.length,
		brands: data.brands.length,
		categories: data.categories.length,
		products: data.products.length,
		categoryProductLinks: data.categoryProductLinks.length,
		productsWithBrand: data.products.filter(product => !!product.brandId).length,
		productsWithImages: data.products.filter(
			product => product.imagesUrl.length > 0
		).length,
		productsWithMsUuid: data.products.filter(product => !!product.msUuid).length,
		categoriesWithImages: data.categories.filter(category => !!category.imageUrl)
			.length,
		bySourceTable: countByKey(data.products, product => product.sourceTable),
		preview: data.products.slice(0, 10).map(product => ({
			legacyProductId: buildLegacyProductId(product),
			sourceTable: product.sourceTable,
			businessId: product.businessId,
			name: product.name,
			price: product.price,
			brandId: product.brandId,
			imagesCount: product.imagesUrl.length
		}))
	}
}

export function buildLegacyBrandId(row: {
	sourceTable: string
	legacyBrandId: string
}): string {
	return `${row.sourceTable}:${row.legacyBrandId}`
}

export function buildLegacyCategoryId(row: {
	sourceTable: string
	legacyCategoryId: string
}): string {
	return `${row.sourceTable}:${row.legacyCategoryId}`
}

export function buildLegacyProductId(row: {
	sourceTable: string
	legacyProductId: string
}): string {
	return `${row.sourceTable}:${row.legacyProductId}`
}

async function loadLegacyBrands(
	pool: pg.Pool,
	businessIds: string[]
): Promise<LegacyBrandRow[]> {
	const result = await pool.query<LegacyBrandRow>(BRANDS_QUERY, [businessIds])
	return result.rows
}

async function loadLegacyCategories(
	pool: pg.Pool,
	businessIds: string[]
): Promise<LegacyCategoryRow[]> {
	const result = await pool.query<LegacyCategoryRow>(CATEGORIES_QUERY, [
		businessIds
	])
	return result.rows
}

async function loadLegacyProducts(
	pool: pg.Pool,
	businessIds: string[]
): Promise<LegacyProductRow[]> {
	const result = await pool.query<LegacyProductRow>(PRODUCTS_QUERY, [
		businessIds
	])
	return result.rows.map(row => ({
		...row,
		imagesUrl: Array.isArray(row.imagesUrl)
			? row.imagesUrl.filter(value => typeof value === 'string' && value.trim())
			: []
	}))
}

async function loadLegacyCategoryProductLinks(
	pool: pg.Pool,
	businessIds: string[]
): Promise<LegacyCategoryProductLinkRow[]> {
	const result = await pool.query<LegacyCategoryProductLinkRow>(
		CATEGORY_PRODUCT_LINKS_QUERY,
		[businessIds]
	)
	return result.rows
}

const BRANDS_QUERY = `
	SELECT
		q."sourceTable",
		q."legacyBrandId",
		q."businessId",
		q."typeId",
		q.name,
		q."createdAt",
		q."updatedAt"
	FROM (
		SELECT
			'ClothesBrand' AS "sourceTable",
			id AS "legacyBrandId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "ClothesBrand"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'DefaultBrand' AS "sourceTable",
			id AS "legacyBrandId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "DefaultBrand"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'FlowersBrand' AS "sourceTable",
			id AS "legacyBrandId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "FlowersBrand"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'GiftBrand' AS "sourceTable",
			id AS "legacyBrandId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "GiftBrand"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'SemiFinishedProductsBrand' AS "sourceTable",
			id AS "legacyBrandId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "SemiFinishedProductsBrand"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'TechnicBrand' AS "sourceTable",
			id AS "legacyBrandId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "TechnicBrand"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'TradingBaseBrand' AS "sourceTable",
			id AS "legacyBrandId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "TradingBaseBrand"
		WHERE business_id = ANY($1::text[])
	) q
	ORDER BY q."createdAt" ASC, q."sourceTable" ASC, q."legacyBrandId" ASC
`

const CATEGORIES_QUERY = `
	SELECT
		q."sourceTable",
		q."legacyCategoryId",
		q."businessId",
		q."typeId",
		q.name,
		q.position,
		q."imageUrl",
		q.descriptor,
		q."createdAt",
		q."updatedAt"
	FROM (
		SELECT
			'ClothesCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULLIF(BTRIM(descriptor), '') AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "ClothesCategory"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'ConfectioneryCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULLIF(BTRIM(descriptor), '') AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "ConfectioneryCategory"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'DefaultCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULLIF(BTRIM(descriptor), '') AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "DefaultCategory"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'FlowersCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULLIF(BTRIM(descriptor), '') AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "FlowersCategory"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'GiftCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULLIF(BTRIM(descriptor), '') AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "GiftCategory"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'RestaurantCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULL AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "RestaurantCategory"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'SemiFinishedProductsCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULLIF(BTRIM(descriptor), '') AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "SemiFinishedProductsCategory"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'TechnicCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULLIF(BTRIM(descriptor), '') AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "TechnicCategory"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'TradingBaseCategory' AS "sourceTable",
			id AS "legacyCategoryId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(name), '') AS name,
			position,
			NULLIF(BTRIM(image_url), '') AS "imageUrl",
			NULLIF(BTRIM(descriptor), '') AS descriptor,
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "TradingBaseCategory"
		WHERE business_id = ANY($1::text[])
	) q
	ORDER BY q."createdAt" ASC, q."sourceTable" ASC, q."legacyCategoryId" ASC
`

const PRODUCTS_QUERY = `
	SELECT
		q."sourceTable",
		q."legacyProductId",
		q."businessId",
		q."typeId",
		q."msUuid",
		q.name,
		q.price,
		q.subtitle,
		q."imagesUrl",
		q."brandId",
		q.description,
		q.discount,
		q."discountedPrice",
		q."discountStart",
		q."discountEnd",
		q."isVisible",
		q."isPopular",
		q."createdAt",
		q."updatedAt"
	FROM (
		SELECT
			'ClothesProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			brand_id AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "ClothesProduct"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'ConfectioneryProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			NULL AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "ConfectioneryProduct"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'DefaultProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			brand_id AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "DefaultProduct"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'FlowersProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			brand_id AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "FlowersProduct"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'GiftProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			brand_id AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "GiftProduct"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'RestaurantProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			NULL AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "RestaurantProduct"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'SemiFinishedProductsProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			brand_id AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "SemiFinishedProductsProduct"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'TechnicProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			brand_id AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "TechnicProduct"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'TradingBaseProduct' AS "sourceTable",
			id AS "legacyProductId",
			business_id AS "businessId",
			type_id AS "typeId",
			NULLIF(BTRIM(ms_uuid), '') AS "msUuid",
			NULLIF(BTRIM(name), '') AS name,
			price::text AS price,
			NULLIF(BTRIM(sub_title), '') AS subtitle,
			COALESCE(images_url, ARRAY[]::text[]) AS "imagesUrl",
			brand_id AS "brandId",
			NULLIF(BTRIM(description), '') AS description,
			discount,
			"discountedPrice"::text AS "discountedPrice",
			discount_start AS "discountStart",
			discount_end AS "discountEnd",
			is_visible AS "isVisible",
			is_popular AS "isPopular",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "TradingBaseProduct"
		WHERE business_id = ANY($1::text[])
	) q
	ORDER BY q."createdAt" ASC, q."sourceTable" ASC, q."legacyProductId" ASC
`

const CATEGORY_PRODUCT_LINKS_QUERY = `
	SELECT DISTINCT
		q."sourceTable",
		q."businessId",
		q."legacyCategoryId",
		q."legacyProductId"
	FROM (
		SELECT
			'ClothesProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_ClothesCategoryToClothesProduct" j
		INNER JOIN "ClothesCategory" c ON c.id = j."A"
		INNER JOIN "ClothesProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id

		UNION ALL

		SELECT
			'ConfectioneryProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_ConfectioneryCategoryToConfectioneryProduct" j
		INNER JOIN "ConfectioneryCategory" c ON c.id = j."A"
		INNER JOIN "ConfectioneryProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id

		UNION ALL

		SELECT
			'DefaultProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_DefaultCategoryToDefaultProduct" j
		INNER JOIN "DefaultCategory" c ON c.id = j."A"
		INNER JOIN "DefaultProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id

		UNION ALL

		SELECT
			'FlowersProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_FlowersCategoryToFlowersProduct" j
		INNER JOIN "FlowersCategory" c ON c.id = j."A"
		INNER JOIN "FlowersProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id

		UNION ALL

		SELECT
			'GiftProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_GiftCategoryToGiftProduct" j
		INNER JOIN "GiftCategory" c ON c.id = j."A"
		INNER JOIN "GiftProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id

		UNION ALL

		SELECT
			'RestaurantProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_RestaurantCategoryToRestaurantProduct" j
		INNER JOIN "RestaurantCategory" c ON c.id = j."A"
		INNER JOIN "RestaurantProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id

		UNION ALL

		SELECT
			'SemiFinishedProductsProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_SemiFinishedProductsCategoryToSemiFinishedProductsProduct" j
		INNER JOIN "SemiFinishedProductsCategory" c ON c.id = j."A"
		INNER JOIN "SemiFinishedProductsProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id

		UNION ALL

		SELECT
			'TechnicProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_TechnicCategoryToTechnicProduct" j
		INNER JOIN "TechnicCategory" c ON c.id = j."A"
		INNER JOIN "TechnicProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id

		UNION ALL

		SELECT
			'TradingBaseProduct' AS "sourceTable",
			c.business_id AS "businessId",
			j."A" AS "legacyCategoryId",
			j."B" AS "legacyProductId"
		FROM "_TradingBaseCategoryToTradingBaseProduct" j
		INNER JOIN "TradingBaseCategory" c ON c.id = j."A"
		INNER JOIN "TradingBaseProduct" p ON p.id = j."B"
		WHERE c.business_id = ANY($1::text[]) AND p.business_id = c.business_id
	) q
	ORDER BY q."sourceTable" ASC, q."businessId" ASC, q."legacyCategoryId" ASC, q."legacyProductId" ASC
`

function countByKey<T>(
	items: T[],
	getKey: (item: T) => string
): Record<string, number> {
	return items.reduce<Record<string, number>>((acc, item) => {
		const key = getKey(item)
		acc[key] = (acc[key] ?? 0) + 1
		return acc
	}, {})
}
