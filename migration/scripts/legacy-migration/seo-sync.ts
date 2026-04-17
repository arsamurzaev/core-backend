import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3'
import sharp from 'sharp'
import slugify from 'slugify'

import {
	MediaStatus,
	MigrationEntityKind,
	MigrationIssueSeverity,
	Prisma,
	PrismaClient,
	ProductStatus,
	SeoChangeFreq,
	SeoEntityType
} from '../../../prisma/generated/client.js'

import type { LegacyBusinessRow } from './source.js'

type ApplyLegacySeoOptions = {
	runId: string
	source: string
}

type LegacySeoIssue = {
	entity: MigrationEntityKind
	legacyId: string
	severity: MigrationIssueSeverity
	code: string
	message: string
	details?: Prisma.InputJsonValue
}

type ApplyLegacySeoSummary = {
	selectedBusinesses: number
	mappedCatalogs: number
	createdCatalogSeo: number
	updatedCatalogSeo: number
	createdCategorySeo: number
	updatedCategorySeo: number
	createdProductSeo: number
	updatedProductSeo: number
	createdCatalogSeoAssets: number
	reusedCatalogSeoAssets: number
}

type ApplyLegacySeoResult = {
	summary: ApplyLegacySeoSummary
	issues: LegacySeoIssue[]
}

type AnalyzeLegacySeoSummary = {
	selectedBusinesses: number
	mappedCatalogs: number
}

type TargetCatalog = {
	id: string
	name: string
	slug: string
	domain: string | null
	config: {
		about: string
		description: string | null
		currency: string
		logoMediaId: string | null
		bgMediaId: string | null
		logoMedia: TargetCatalogMedia | null
		bgMedia: TargetCatalogMedia | null
	} | null
}

type TargetCatalogMedia = {
	id: string
	mimeType: string
	storage: string
	key: string
}

type GeneratedCatalogSeoAssets = {
	favicon: GeneratedCatalogSeoAsset | null
	telegram: GeneratedCatalogSeoAsset | null
	whatsapp: GeneratedCatalogSeoAsset | null
}

type GeneratedCatalogSeoAsset = {
	mediaId: string
	key: string
	url: string
	contentType: string
	width?: number
	height?: number
	reused: boolean
}

type SeoS3Config = {
	enabled: boolean
	client: S3Client
	bucket: string
	publicRead: boolean
}

const SOCIAL_IMAGE_WIDTH = 1200
const SOCIAL_IMAGE_HEIGHT = 630
const SOCIAL_LOGO_SIZE = 448
const SOCIAL_OG_LOGO_SIZE = 420
const SOCIAL_OG_VERTICAL_GAP = 18
const SOCIAL_FALLBACK_LOGO_FONT_RATIO = 0.37
const FAVICON_SIZE = 64

type TargetCategory = {
	id: string
	catalogId: string
	name: string
	position: number
	descriptor: string | null
	imageMediaId: string | null
}

type TargetProduct = {
	id: string
	catalogId: string
	name: string
	slug: string
	sku: string
	price: Prisma.Decimal
	status: ProductStatus
	brand: { name: string } | null
	media: Array<{
		media: {
			id: string
			key: string
			storage: string
			variants: Array<{
				kind: string
				key: string
				storage: string
			}>
		}
	}>
	categoryProducts: Array<{ category: { name: string } }>
	productAttributes: Array<{
		attribute: { displayName: string; isHidden: boolean }
		enumValue: { displayName: string | null; value: string } | null
		valueString: string | null
		valueInteger: number | null
		valueDecimal: Prisma.Decimal | null
		valueBoolean: boolean | null
		valueDateTime: Date | null
	}>
	variants: Array<{
		stock: number | null
		isAvailable: boolean
		status: string
	}>
}

export async function analyzeLegacySeoData(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	source: string
): Promise<AnalyzeLegacySeoSummary> {
	const businessIds = businesses.map(business => business.id)
	const mappings = await prisma.migrationEntityMap.findMany({
		where: {
			source,
			entity: MigrationEntityKind.BUSINESS,
			legacyId: { in: businessIds }
		},
		select: { targetId: true }
	})

	return {
		selectedBusinesses: businesses.length,
		mappedCatalogs: mappings.length
	}
}

export async function collectLegacySeoIssues(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	source: string
): Promise<LegacySeoIssue[]> {
	const businessIds = businesses.map(business => business.id)
	const mappings = await prisma.migrationEntityMap.findMany({
		where: {
			source,
			entity: MigrationEntityKind.BUSINESS,
			legacyId: { in: businessIds }
		},
		select: { legacyId: true, targetId: true }
	})
	const mappedBusinessIds = new Set(mappings.map(mapping => mapping.legacyId))

	return businesses
		.filter(business => !mappedBusinessIds.has(business.id))
		.map(
			business =>
				({
					entity: MigrationEntityKind.CATALOG,
					legacyId: business.id,
					severity: MigrationIssueSeverity.WARNING,
					code: 'SEO_CATALOG_MAPPING_MISSING',
					message:
						'Skipping SEO because target catalog mapping is missing. Run catalog-bootstrap first for this business if SEO must be generated.',
					details: {
						host: business.host,
						typeSlug: business.typeSlug
					} satisfies Prisma.InputJsonValue
				}) satisfies LegacySeoIssue
		)
}

export async function applyLegacySeo(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	options: ApplyLegacySeoOptions
): Promise<ApplyLegacySeoResult> {
	const issues = await collectLegacySeoIssues(prisma, businesses, options.source)
	if (issues.some(issue => issue.severity === MigrationIssueSeverity.ERROR)) {
		return {
			summary: {
				selectedBusinesses: businesses.length,
				mappedCatalogs: 0,
				createdCatalogSeo: 0,
				updatedCatalogSeo: 0,
				createdCategorySeo: 0,
				updatedCategorySeo: 0,
				createdProductSeo: 0,
				updatedProductSeo: 0,
				createdCatalogSeoAssets: 0,
				reusedCatalogSeoAssets: 0
			},
			issues
		}
	}

	const catalogIds = await loadMappedCatalogIds(
		prisma,
		businesses,
		options.source
	)
	const [catalogs, categories, products] = await Promise.all([
		loadTargetCatalogs(prisma, catalogIds),
		loadTargetCategories(prisma, catalogIds),
		loadTargetProducts(prisma, catalogIds)
	])

	const categoriesByCatalogId = groupBy(
		categories,
		category => category.catalogId
	)
	const productsByCatalogId = groupBy(products, product => product.catalogId)

	let createdCatalogSeo = 0
	let updatedCatalogSeo = 0
	let createdCategorySeo = 0
	let updatedCategorySeo = 0
	let createdProductSeo = 0
	let updatedProductSeo = 0
	let createdCatalogSeoAssets = 0
	let reusedCatalogSeoAssets = 0

	for (const catalog of catalogs) {
		const generatedAssets = await generateCatalogSeoAssets(prisma, catalog)
		createdCatalogSeoAssets += countGeneratedAssets(generatedAssets, false)
		reusedCatalogSeoAssets += countGeneratedAssets(generatedAssets, true)

		const catalogExists = await upsertCatalogSeo(prisma, catalog, generatedAssets)
		if (catalogExists) updatedCatalogSeo += 1
		else createdCatalogSeo += 1

		const categorySlugState = new Set<string>()
		for (const category of categoriesByCatalogId.get(catalog.id) ?? []) {
			const categoryExists = await upsertCategorySeo(
				prisma,
				catalog,
				category,
				categorySlugState
			)
			if (categoryExists) updatedCategorySeo += 1
			else createdCategorySeo += 1
		}

		for (const product of productsByCatalogId.get(catalog.id) ?? []) {
			const productExists = await upsertProductSeo(prisma, catalog, product)
			if (productExists) updatedProductSeo += 1
			else createdProductSeo += 1
		}
	}

	return {
		summary: {
			selectedBusinesses: businesses.length,
			mappedCatalogs: catalogIds.length,
			createdCatalogSeo,
			updatedCatalogSeo,
			createdCategorySeo,
			updatedCategorySeo,
			createdProductSeo,
			updatedProductSeo,
			createdCatalogSeoAssets,
			reusedCatalogSeoAssets
		},
		issues
	}
}

async function loadMappedCatalogIds(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	source: string
): Promise<string[]> {
	const mappings = await prisma.migrationEntityMap.findMany({
		where: {
			source,
			entity: MigrationEntityKind.BUSINESS,
			legacyId: { in: businesses.map(business => business.id) }
		},
		select: { targetId: true }
	})

	return Array.from(new Set(mappings.map(mapping => mapping.targetId)))
}

async function loadTargetCatalogs(
	prisma: PrismaClient,
	catalogIds: string[]
): Promise<TargetCatalog[]> {
	if (catalogIds.length === 0) return []

	return prisma.catalog.findMany({
		where: { id: { in: catalogIds } },
		select: {
			id: true,
			name: true,
			slug: true,
			domain: true,
			config: {
				select: {
					about: true,
					description: true,
					currency: true,
					logoMediaId: true,
					bgMediaId: true,
					logoMedia: {
						select: {
							id: true,
							mimeType: true,
							storage: true,
							key: true
						}
					},
					bgMedia: {
						select: {
							id: true,
							mimeType: true,
							storage: true,
							key: true
						}
					}
				}
			}
		}
	})
}

async function loadTargetCategories(
	prisma: PrismaClient,
	catalogIds: string[]
): Promise<TargetCategory[]> {
	if (catalogIds.length === 0) return []

	return prisma.category.findMany({
		where: {
			catalogId: { in: catalogIds },
			deleteAt: null
		},
		select: {
			id: true,
			catalogId: true,
			name: true,
			position: true,
			descriptor: true,
			imageMediaId: true
		},
		orderBy: [{ catalogId: 'asc' }, { position: 'asc' }, { name: 'asc' }]
	})
}

async function loadTargetProducts(
	prisma: PrismaClient,
	catalogIds: string[],
	productIds?: string[]
): Promise<TargetProduct[]> {
	if (catalogIds.length === 0) return []

	return prisma.product.findMany({
		where: {
			catalogId: { in: catalogIds },
			deleteAt: null,
			...(productIds?.length ? { id: { in: productIds } } : {})
		},
		select: {
			id: true,
			catalogId: true,
			name: true,
			slug: true,
			sku: true,
			price: true,
			status: true,
			brand: { select: { name: true } },
			media: {
				select: {
					media: {
						select: {
							id: true,
							key: true,
							storage: true,
							variants: {
								select: {
									kind: true,
									key: true,
									storage: true
								}
							}
						}
					}
				},
				orderBy: { position: 'asc' },
				take: 1
			},
			categoryProducts: {
				select: {
					category: {
						select: { name: true }
					}
				},
				orderBy: { position: 'asc' },
				take: 3
			},
			productAttributes: {
				where: { deleteAt: null },
				select: {
					attribute: {
						select: { displayName: true, isHidden: true }
					},
					enumValue: {
						select: { displayName: true, value: true }
					},
					valueString: true,
					valueInteger: true,
					valueDecimal: true,
					valueBoolean: true,
					valueDateTime: true
				},
				orderBy: { attributeId: 'asc' }
			},
			variants: {
				where: { deleteAt: null },
				select: {
					stock: true,
					isAvailable: true,
					status: true
				}
			}
		},
		orderBy: [{ catalogId: 'asc' }, { position: 'asc' }, { name: 'asc' }]
	})
}

async function generateCatalogSeoAssets(
	prisma: PrismaClient,
	catalog: TargetCatalog
): Promise<GeneratedCatalogSeoAssets> {
	const s3 = createSeoS3ConfigFromEnv()
	if (!s3) {
		return {
			favicon: null,
			telegram: null,
			whatsapp: null
		}
	}

	const [background, logo] = await Promise.all([
		loadSeoSourceMediaBuffer(s3, catalog.config?.bgMedia ?? null),
		loadSeoSourceMediaBuffer(s3, catalog.config?.logoMedia ?? null)
	])

	const faviconPng = await renderCatalogFaviconPng(catalog, logo)
	const faviconIco = wrapPngAsIco(faviconPng, FAVICON_SIZE, FAVICON_SIZE)
	const socialPng = await renderCatalogSocialPng(catalog, {
		background,
		logo
	})

	const [favicon, telegram, whatsapp] = await Promise.all([
		uploadGeneratedSeoAsset(
			prisma,
			s3,
			catalog.id,
			'favicon.ico',
			'image/x-icon',
			faviconIco,
			{
				width: FAVICON_SIZE,
				height: FAVICON_SIZE
			}
		),
		uploadGeneratedSeoAsset(
			prisma,
			s3,
			catalog.id,
			'telegram.png',
			'image/png',
			socialPng.buffer,
			{
				width: socialPng.width,
				height: socialPng.height
			}
		),
		uploadGeneratedSeoAsset(
			prisma,
			s3,
			catalog.id,
			'whatsapp.png',
			'image/png',
			socialPng.buffer,
			{
				width: socialPng.width,
				height: socialPng.height
			}
		)
	])

	return {
		favicon,
		telegram,
		whatsapp
	}
}

function countGeneratedAssets(
	assets: GeneratedCatalogSeoAssets,
	reused: boolean
): number {
	return [assets.favicon, assets.telegram, assets.whatsapp].filter(
		asset => asset && asset.reused === reused
	).length
}

async function upsertCatalogSeo(
	prisma: PrismaClient,
	catalog: TargetCatalog,
	generatedAssets: GeneratedCatalogSeoAssets
): Promise<boolean> {
	const existing = await prisma.seoSetting.findUnique({
		where: {
			catalogId_entityType_entityId: {
				catalogId: catalog.id,
				entityType: SeoEntityType.CATALOG,
				entityId: catalog.id
			}
		},
		select: { id: true }
	})

	const description = truncateText(
		normalizeText(catalog.config?.description) ??
			normalizeText(catalog.config?.about) ??
			`Каталог ${catalog.name}`,
		500
	)
	const canonicalUrl = buildCatalogUrl(catalog.domain)
	const ogMediaId =
		generatedAssets.whatsapp?.mediaId ??
		catalog.config?.logoMediaId ??
		catalog.config?.bgMediaId ??
		null
	const twitterMediaId =
		generatedAssets.telegram?.mediaId ??
		catalog.config?.logoMediaId ??
		catalog.config?.bgMediaId ??
		null
	const faviconMediaId =
		generatedAssets.favicon?.mediaId ?? catalog.config?.logoMediaId ?? null
	const twitterCard =
		ogMediaId || twitterMediaId ? 'summary_large_image' : 'summary'
	const extras = JSON.stringify({
		source: 'legacy-migration-seo-v1',
		entity: 'catalog',
		generatedAssets: {
			favicon: generatedAssets.favicon
				? {
						mediaId: generatedAssets.favicon.mediaId,
						key: generatedAssets.favicon.key,
						url: generatedAssets.favicon.url
					}
				: null,
			telegram: generatedAssets.telegram
				? {
						mediaId: generatedAssets.telegram.mediaId,
						key: generatedAssets.telegram.key,
						url: generatedAssets.telegram.url
					}
				: null,
			whatsapp: generatedAssets.whatsapp
				? {
						mediaId: generatedAssets.whatsapp.mediaId,
						key: generatedAssets.whatsapp.key,
						url: generatedAssets.whatsapp.url
					}
				: null
		}
	})

	const createData = {
		catalogId: catalog.id,
		entityType: SeoEntityType.CATALOG,
		entityId: catalog.id,
		urlPath: '/',
		canonicalUrl,
		title: truncateText(catalog.name, 255),
		description,
		keywords: truncateText(`${catalog.name}, каталог, магазин`, 500),
		h1: truncateText(catalog.name, 255),
		robots: 'index,follow',
		isIndexable: true,
		isFollowable: true,
		ogTitle: truncateText(catalog.name, 255),
		ogDescription: description,
		ogMediaId,
		ogType: 'website',
		ogUrl: canonicalUrl,
		ogSiteName: truncateText(catalog.name, 255),
		ogLocale: 'ru_RU',
		twitterCard,
		twitterTitle: truncateText(catalog.name, 255),
		twitterDescription: description,
		twitterMediaId,
		faviconMediaId,
		extras,
		sitemapPriority: new Prisma.Decimal('1.00'),
		sitemapChangeFreq: SeoChangeFreq.WEEKLY,
		deleteAt: null
	} satisfies Prisma.SeoSettingUncheckedCreateInput

	const updateData = {
		urlPath: '/',
		canonicalUrl,
		title: truncateText(catalog.name, 255),
		description,
		keywords: truncateText(`${catalog.name}, каталог, магазин`, 500),
		h1: truncateText(catalog.name, 255),
		robots: 'index,follow',
		isIndexable: true,
		isFollowable: true,
		ogTitle: truncateText(catalog.name, 255),
		ogDescription: description,
		ogMediaId,
		ogType: 'website',
		ogUrl: canonicalUrl,
		ogSiteName: truncateText(catalog.name, 255),
		ogLocale: 'ru_RU',
		twitterCard,
		twitterTitle: truncateText(catalog.name, 255),
		twitterDescription: description,
		twitterMediaId,
		faviconMediaId,
		extras,
		sitemapPriority: new Prisma.Decimal('1.00'),
		sitemapChangeFreq: SeoChangeFreq.WEEKLY,
		deleteAt: null
	} satisfies Prisma.SeoSettingUncheckedUpdateInput

	await prisma.seoSetting.upsert({
		where: {
			catalogId_entityType_entityId: {
				catalogId: catalog.id,
				entityType: SeoEntityType.CATALOG,
				entityId: catalog.id
			}
		},
		create: createData,
		update: updateData
	})

	return Boolean(existing)
}

async function upsertCategorySeo(
	prisma: PrismaClient,
	catalog: TargetCatalog,
	category: TargetCategory,
	slugState: Set<string>
): Promise<boolean> {
	const existing = await prisma.seoSetting.findUnique({
		where: {
			catalogId_entityType_entityId: {
				catalogId: catalog.id,
				entityType: SeoEntityType.CATEGORY,
				entityId: category.id
			}
		},
		select: { id: true }
	})

	const categorySlug = buildUniqueSlug(
		slugState,
		`${slugifyValue(category.name)}-${Math.max(category.position, 0) + 1}`
	)
	const title = truncateText(`${category.name} | ${catalog.name}`, 255)
	const description = truncateText(
		normalizeText(category.descriptor) ?? `Раздел каталога: ${category.name}`,
		500
	)
	const canonicalUrl = buildCatalogUrl(
		catalog.domain,
		`/categories/${categorySlug}`
	)

	const createData = {
		catalogId: catalog.id,
		entityType: SeoEntityType.CATEGORY,
		entityId: category.id,
		urlPath: `/categories/${categorySlug}`,
		canonicalUrl,
		title,
		description,
		keywords: truncateText(`${category.name}, ${catalog.name}`, 500),
		h1: truncateText(category.name, 255),
		robots: 'index,follow',
		isIndexable: true,
		isFollowable: true,
		ogTitle: title,
		ogDescription: description,
		ogMediaId: category.imageMediaId,
		ogType: 'website',
		ogUrl: canonicalUrl,
		ogSiteName: truncateText(catalog.name, 255),
		ogLocale: 'ru_RU',
		twitterCard: category.imageMediaId ? 'summary_large_image' : 'summary',
		twitterTitle: title,
		twitterDescription: description,
		twitterMediaId: category.imageMediaId,
		extras: JSON.stringify({
			source: 'legacy-migration-seo-v1',
			entity: 'category',
			categorySlug,
			position: category.position
		}),
		sitemapPriority: new Prisma.Decimal('0.70'),
		sitemapChangeFreq: SeoChangeFreq.WEEKLY,
		deleteAt: null
	} satisfies Prisma.SeoSettingUncheckedCreateInput

	const updateData = {
		urlPath: `/categories/${categorySlug}`,
		canonicalUrl,
		title,
		description,
		keywords: truncateText(`${category.name}, ${catalog.name}`, 500),
		h1: truncateText(category.name, 255),
		robots: 'index,follow',
		isIndexable: true,
		isFollowable: true,
		ogTitle: title,
		ogDescription: description,
		ogMediaId: category.imageMediaId,
		ogType: 'website',
		ogUrl: canonicalUrl,
		ogSiteName: truncateText(catalog.name, 255),
		ogLocale: 'ru_RU',
		twitterCard: category.imageMediaId ? 'summary_large_image' : 'summary',
		twitterTitle: title,
		twitterDescription: description,
		twitterMediaId: category.imageMediaId,
		extras: JSON.stringify({
			source: 'legacy-migration-seo-v1',
			entity: 'category',
			categorySlug,
			position: category.position
		}),
		sitemapPriority: new Prisma.Decimal('0.70'),
		sitemapChangeFreq: SeoChangeFreq.WEEKLY,
		deleteAt: null
	} satisfies Prisma.SeoSettingUncheckedUpdateInput

	await prisma.seoSetting.upsert({
		where: {
			catalogId_entityType_entityId: {
				catalogId: catalog.id,
				entityType: SeoEntityType.CATEGORY,
				entityId: category.id
			}
		},
		create: createData,
		update: updateData
	})

	return Boolean(existing)
}

function buildMediaUrl(storage: string, key: string): string | null {
	if (storage === 'url') return key
	const publicUrl = process.env.S3_PUBLIC_URL?.trim()
	if (publicUrl) return `${publicUrl.replace(/\/+$/, '')}/${key}`
	const endpoint = process.env.S3_ENDPOINT?.trim()
	const bucket = process.env.S3_BUCKET?.trim()
	if (endpoint && bucket) {
		const url = new URL(endpoint)
		if (parseBoolean(process.env.S3_FORCE_PATH_STYLE)) {
			return `${url.origin}/${bucket}/${key}`
		}
		return `${url.protocol}//${bucket}.${url.host}/${key}`
	}
	const region = process.env.S3_REGION?.trim() || 'us-east-1'
	if (bucket) return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
	return null
}

function buildPrimaryProductMediaUrl(
	media: TargetProduct['media'][number]['media'] | null
): string | null {
	if (!media) return null

	const preferredVariant =
		media.variants.find(variant => isPreferredProductSeoVariant(variant.kind)) ??
		media.variants[0] ??
		null

	if (preferredVariant) {
		return buildMediaUrl(preferredVariant.storage, preferredVariant.key)
	}

	return buildMediaUrl(media.storage, media.key)
}

function isPreferredProductSeoVariant(kind: string): boolean {
	const normalized = kind.trim().toLowerCase()
	return normalized.startsWith('detail') || normalized.startsWith('xl')
}

function extractProductAttributeValue(
	pa: TargetProduct['productAttributes'][number]
): string | null {
	if (pa.enumValue?.displayName) return pa.enumValue.displayName
	if (pa.enumValue?.value) return pa.enumValue.value
	if (pa.valueString) return pa.valueString
	if (pa.valueInteger !== null && pa.valueInteger !== undefined)
		return String(pa.valueInteger)
	if (pa.valueDecimal !== null && pa.valueDecimal !== undefined)
		return pa.valueDecimal.toDecimalPlaces(2).toString()
	if (pa.valueBoolean !== null && pa.valueBoolean !== undefined)
		return pa.valueBoolean ? 'да' : 'нет'
	if (pa.valueDateTime)
		return new Date(pa.valueDateTime).toISOString().slice(0, 10)
	return null
}

function buildProductAttributeSummary(product: TargetProduct): string | null {
	const parts = product.productAttributes
		.filter(pa => !pa.attribute.isHidden)
		.map(pa => {
			const value = extractProductAttributeValue(pa)
			if (!value) return null
			return `${pa.attribute.displayName}: ${value}`
		})
		.filter((v): v is string => Boolean(v))
		.slice(0, 3)

	if (!parts.length) return null
	const joined = parts.join(', ')
	return joined.length <= 220 ? joined : joined.slice(0, 220)
}

function resolveProductAvailability(product: TargetProduct): string {
	if (product.status !== ProductStatus.ACTIVE) {
		return 'https://schema.org/OutOfStock'
	}
	if (!product.variants.length) {
		return 'https://schema.org/InStock'
	}
	const hasAvailable = product.variants.some(
		v =>
			v.isAvailable &&
			v.status === 'ACTIVE' &&
			typeof v.stock === 'number' &&
			v.stock > 0
	)
	return hasAvailable
		? 'https://schema.org/InStock'
		: 'https://schema.org/OutOfStock'
}

async function upsertProductSeo(
	prisma: PrismaClient,
	catalog: TargetCatalog,
	product: TargetProduct
): Promise<boolean> {
	const existing = await prisma.seoSetting.findUnique({
		where: {
			catalogId_entityType_entityId: {
				catalogId: catalog.id,
				entityType: SeoEntityType.PRODUCT,
				entityId: product.id
			}
		},
		select: { id: true }
	})

	const primaryMedia = product.media[0]?.media ?? null
	const primaryMediaId = primaryMedia?.id ?? null
	const primaryMediaUrl = buildPrimaryProductMediaUrl(primaryMedia)
	const categoryNames = product.categoryProducts.map(item => item.category.name)
	const attributeSummary = buildProductAttributeSummary(product)
	const currency = catalog.config?.currency?.trim() || 'RUB'
	const title = truncateText(
		[
			product.name,
			product.brand?.name ?? null,
			categoryNames[0] ?? null,
			catalog.name
		]
			.filter(Boolean)
			.join(' | '),
		255
	)
	const description = truncateText(
		[
			`Купить ${product.name}${product.brand?.name ? ` ${product.brand.name}` : ''}.`,
			categoryNames.length
				? `Категория: ${categoryNames.slice(0, 2).join(', ')}.`
				: null,
			`Цена: ${formatPrice(product.price)} ${catalog.config?.currency?.trim() || 'RUB'}.`,
			attributeSummary ? `Характеристики: ${attributeSummary}.` : null
		]
			.filter(Boolean)
			.join(' '),
		500
	)
	const seoText = [
		`${product.name} доступен в каталоге ${catalog.name}.`,
		product.brand?.name ? `Бренд: ${product.brand.name}.` : null,
		categoryNames.length
			? `Разделы: ${categoryNames.slice(0, 3).join(', ')}.`
			: null,
		attributeSummary ? `Основные характеристики: ${attributeSummary}.` : null,
		`Артикул: ${product.sku}.`
	]
		.filter(Boolean)
		.join(' ')
	const isIndexable = product.status === ProductStatus.ACTIVE
	const robots = isIndexable ? 'index,follow' : 'noindex,nofollow'
	const canonicalUrl = buildCatalogUrl(
		catalog.domain,
		`/product/${product.slug}`
	)
	const twitterCard = primaryMediaId ? 'summary_large_image' : 'summary'
	const availability = resolveProductAvailability(product)

	const keywordParts: string[] = [
		product.name,
		product.brand?.name ?? null,
		product.sku,
		...categoryNames,
		...product.productAttributes
			.slice(0, 4)
			.flatMap(pa => [pa.attribute.displayName, extractProductAttributeValue(pa)])
	].filter((v): v is string => Boolean(v))
	const seenKeywords = new Set<string>()
	const uniqueKeywords: string[] = []
	for (const part of keywordParts) {
		const key = part.toLowerCase().trim()
		if (!key || seenKeywords.has(key)) continue
		seenKeywords.add(key)
		uniqueKeywords.push(part)
	}
	const keywords = truncateText(uniqueKeywords.join(', '), 500)
	const productDescription = truncateText(
		[
			`Купить ${product.name}${product.brand?.name ? ` ${product.brand.name}` : ''}.`,
			categoryNames.length
				? `Категория: ${categoryNames.slice(0, 2).join(', ')}.`
				: null,
			`Цена: ${formatPrice(product.price)} ${currency}.`,
			attributeSummary ? `Характеристики: ${attributeSummary}.` : null
		]
			.filter(Boolean)
			.join(' '),
		500
	)
	const productSeoText = [
		`${product.name} доступен в каталоге с актуальной ценой ${formatPrice(product.price)} ${currency}.`,
		product.brand?.name ? `Бренд: ${product.brand.name}.` : null,
		categoryNames.length
			? `Разделы: ${categoryNames.slice(0, 3).join(', ')}.`
			: null,
		attributeSummary ? `Основные характеристики: ${attributeSummary}.` : null
	]
		.filter(Boolean)
		.join(' ')
	const productKeywords = uniqueKeywords.length
		? truncateText(uniqueKeywords.join(', '), 500)
		: null
	const productStructuredData = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'Product',
		name: product.name,
		description: productDescription,
		sku: product.sku,
		...(primaryMediaUrl ? { image: [primaryMediaUrl] } : {}),
		...(product.brand?.name
			? { brand: { '@type': 'Brand', name: product.brand.name } }
			: {}),
		...(categoryNames.length ? { category: categoryNames.join(' / ') } : {}),
		...(canonicalUrl ? { url: canonicalUrl } : {}),
		offers: {
			'@type': 'Offer',
			priceCurrency: currency,
			price: formatPrice(product.price),
			availability,
			itemCondition: 'https://schema.org/NewCondition',
			...(canonicalUrl ? { url: canonicalUrl } : {})
		}
	})
	const productSeoExtras = JSON.stringify({
		source: 'product-seo-sync-v1',
		sku: product.sku,
		brand: product.brand?.name ?? null,
		primaryCategory: categoryNames[0] ?? null,
		primaryMediaId,
		status: product.status
	})

	const createData = {
		catalogId: catalog.id,
		entityType: SeoEntityType.PRODUCT,
		entityId: product.id,
		urlPath: `/product/${product.slug}`,
		canonicalUrl,
		title,
		description: productDescription,
		keywords: productKeywords,
		h1: truncateText(product.name, 255),
		seoText: productSeoText,
		robots,
		isIndexable,
		isFollowable: isIndexable,
		ogTitle: title,
		ogDescription: productDescription,
		ogMediaId: primaryMediaId,
		ogType: 'product',
		ogUrl: canonicalUrl,
		ogSiteName: catalog.name,
		ogLocale: 'ru_RU',
		twitterCard,
		twitterTitle: title,
		twitterDescription: productDescription,
		twitterMediaId: primaryMediaId,
		structuredData: productStructuredData,
		extras: productSeoExtras,
		sitemapPriority: new Prisma.Decimal(isIndexable ? '0.80' : '0.20'),
		sitemapChangeFreq: SeoChangeFreq.WEEKLY,
		deleteAt: null
	} satisfies Prisma.SeoSettingUncheckedCreateInput

	const updateData = {
		urlPath: `/product/${product.slug}`,
		canonicalUrl,
		title,
		description: productDescription,
		keywords: productKeywords,
		h1: truncateText(product.name, 255),
		seoText: productSeoText,
		robots,
		isIndexable,
		isFollowable: isIndexable,
		ogTitle: title,
		ogDescription: productDescription,
		ogMediaId: primaryMediaId,
		ogType: 'product',
		ogUrl: canonicalUrl,
		ogSiteName: catalog.name,
		ogLocale: 'ru_RU',
		twitterCard,
		twitterTitle: title,
		twitterDescription: productDescription,
		twitterMediaId: primaryMediaId,
		structuredData: productStructuredData,
		extras: productSeoExtras,
		sitemapPriority: new Prisma.Decimal(isIndexable ? '0.80' : '0.20'),
		sitemapChangeFreq: SeoChangeFreq.WEEKLY,
		deleteAt: null
	} satisfies Prisma.SeoSettingUncheckedUpdateInput

	await prisma.seoSetting.upsert({
		where: {
			catalogId_entityType_entityId: {
				catalogId: catalog.id,
				entityType: SeoEntityType.PRODUCT,
				entityId: product.id
			}
		},
		create: createData,
		update: updateData
	})

	return Boolean(existing)
}

export async function upsertProductSeoById(
	prisma: PrismaClient,
	catalogId: string,
	productId: string
): Promise<void> {
	const [catalogs, products] = await Promise.all([
		loadTargetCatalogs(prisma, [catalogId]),
		loadTargetProducts(prisma, [catalogId], [productId])
	])
	const catalog = catalogs[0]
	const product = products[0]
	if (!catalog || !product) return
	await upsertProductSeo(prisma, catalog, product)
}

function createSeoS3ConfigFromEnv(): SeoS3Config | null {
	if (!parseBoolean(process.env.S3_ENABLED)) return null

	const region = process.env.S3_REGION?.trim()
	const bucket = process.env.S3_BUCKET?.trim()
	const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim()
	const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim()
	const endpoint = process.env.S3_ENDPOINT?.trim() || undefined
	const forcePathStyle = parseBoolean(process.env.S3_FORCE_PATH_STYLE)
	const publicRead = parseBoolean(process.env.S3_PUBLIC_READ)

	if (!region || !bucket || !accessKeyId || !secretAccessKey) {
		return null
	}

	return {
		enabled: true,
		client: new S3Client({
			region,
			endpoint,
			forcePathStyle,
			credentials: {
				accessKeyId,
				secretAccessKey
			}
		}),
		bucket,
		publicRead
	}
}

async function loadSeoSourceMediaBuffer(
	s3: SeoS3Config,
	media: TargetCatalogMedia | null
): Promise<Buffer | null> {
	if (!media?.key || media.storage !== 's3') return null

	const response = await s3.client.send(
		new GetObjectCommand({
			Bucket: s3.bucket,
			Key: media.key
		})
	)

	if (!response.Body) return null
	const bytes = await response.Body.transformToByteArray()
	return Buffer.from(bytes)
}

async function renderCatalogFaviconPng(
	catalog: TargetCatalog,
	logo: Buffer | null
): Promise<Buffer> {
	const palette = resolvePalette(catalog.slug || catalog.name)
	const initials = buildInitials(catalog.name)
	const svg = `
		<svg width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stop-color="${palette.primary}" />
					<stop offset="100%" stop-color="${palette.secondary}" />
				</linearGradient>
			</defs>
			<rect width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" fill="url(#bg)" />
			${
				logo
					? ''
					: `<text x="32" y="39" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${escapeSvgText(initials)}</text>`
			}
		</svg>
	`

	const circleMask = Buffer.from(
		`<svg width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}" xmlns="http://www.w3.org/2000/svg"><circle cx="${FAVICON_SIZE / 2}" cy="${FAVICON_SIZE / 2}" r="${FAVICON_SIZE / 2}" fill="#ffffff"/></svg>`
	)

	if (logo) {
		const resized = await sharp(logo)
			.resize({ width: FAVICON_SIZE, height: FAVICON_SIZE, fit: 'cover' })
			.png()
			.toBuffer()

		const rendered = await sharp(resized)
			.composite([{ input: circleMask, blend: 'dest-in' }])
			.png()
			.toBuffer({ resolveWithObject: true })

		return rendered.data
	}

	const flat = await sharp(Buffer.from(svg)).png().toBuffer()
	const rendered = await sharp(flat)
		.composite([{ input: circleMask, blend: 'dest-in' }])
		.png()
		.toBuffer({ resolveWithObject: true })

	return rendered.data
}

async function renderCatalogSocialPng(
	catalog: TargetCatalog,
	visuals: { background: Buffer | null; logo: Buffer | null }
): Promise<{ buffer: Buffer; width: number; height: number }> {
	const palette = resolvePalette(catalog.slug || catalog.name)
	const titleLines = wrapText(catalog.name, 20, 2)
	const initials = buildInitials(catalog.name)
	const background = await renderCatalogSocialBackground(
		visuals.background,
		palette
	)

	const logoTop = SOCIAL_OG_VERTICAL_GAP
	const logoLeft = Math.round((SOCIAL_IMAGE_WIDTH - SOCIAL_OG_LOGO_SIZE) / 2)
	const titleTop = logoTop + SOCIAL_OG_LOGO_SIZE + SOCIAL_OG_VERTICAL_GAP
	const titleBottom = SOCIAL_IMAGE_HEIGHT - SOCIAL_OG_VERTICAL_GAP
	const titleBlockHeight = Math.max(0, titleBottom - titleTop)
	const titleLineCount = Math.max(titleLines.length, 1)
	const titleLineHeight = Math.floor(titleBlockHeight / titleLineCount)
	const titleFontSize = titleLineHeight
	const titleShadeTop = Math.max(0, titleTop - SOCIAL_OG_VERTICAL_GAP * 2)

	const overlaySvg = `
		<svg width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" viewBox="0 0 ${SOCIAL_IMAGE_WIDTH} ${SOCIAL_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="screenShade" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#030712" stop-opacity="0.06" />
					<stop offset="50%" stop-color="#030712" stop-opacity="0.16" />
					<stop offset="100%" stop-color="#030712" stop-opacity="0.55" />
				</linearGradient>
				<linearGradient id="titleShade" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#040816" stop-opacity="0" />
					<stop offset="55%" stop-color="#040816" stop-opacity="0.72" />
					<stop offset="100%" stop-color="#040816" stop-opacity="0.88" />
				</linearGradient>
			</defs>
			<rect width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" fill="url(#screenShade)" />
			<rect x="0" y="${titleShadeTop}" width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT - titleShadeTop}" fill="url(#titleShade)" />
			<rect x="${logoLeft}" y="${logoTop}" width="${SOCIAL_OG_LOGO_SIZE}" height="${SOCIAL_OG_LOGO_SIZE}" rx="${SOCIAL_OG_LOGO_SIZE / 2}" fill="#06101d" fill-opacity="0.64" />
			<rect x="${logoLeft}" y="${logoTop}" width="${SOCIAL_OG_LOGO_SIZE}" height="${SOCIAL_OG_LOGO_SIZE}" rx="${SOCIAL_OG_LOGO_SIZE / 2}" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1" />
			${
				visuals.logo
					? ''
					: `<text x="${SOCIAL_IMAGE_WIDTH / 2}" y="${SOCIAL_IMAGE_HEIGHT / 2 + SOCIAL_OG_LOGO_SIZE * 0.14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(SOCIAL_OG_LOGO_SIZE * SOCIAL_FALLBACK_LOGO_FONT_RATIO)}" font-weight="700" fill="#ffffff">${escapeSvgText(initials)}</text>`
			}
			${renderSvgTextLines(titleLines, {
				x: SOCIAL_IMAGE_WIDTH / 2,
				y: titleTop,
				lineHeight: titleLineHeight,
				fontSize: titleFontSize,
				fontWeight: 700,
				fill: '#ffffff',
				textAnchor: 'middle',
				dominantBaseline: 'hanging'
			})}
		</svg>
	`

	const composite: sharp.OverlayOptions[] = [
		{ input: Buffer.from(overlaySvg), left: 0, top: 0 }
	]

	if (visuals.logo) {
		const logoResized = await sharp(visuals.logo)
			.resize({
				width: SOCIAL_OG_LOGO_SIZE,
				height: SOCIAL_OG_LOGO_SIZE,
				fit: 'cover'
			})
			.png()
			.toBuffer()
		composite.push({
			input: logoResized,
			left: logoLeft,
			top: logoTop
		})
	}

	const rendered = await sharp(background).composite(composite).png().toBuffer({
		resolveWithObject: true
	})

	return {
		buffer: rendered.data,
		width: rendered.info.width,
		height: rendered.info.height
	}
}

async function renderCatalogSocialBackground(
	background: Buffer | null,
	palette: { primary: string; secondary: string; accent: string }
): Promise<Buffer> {
	if (background) {
		return sharp(background)
			.rotate()
			.resize({
				width: SOCIAL_IMAGE_WIDTH,
				height: SOCIAL_IMAGE_HEIGHT,
				fit: 'cover'
			})
			.modulate({
				brightness: 0.9,
				saturation: 1.05
			})
			.png()
			.toBuffer()
	}

	const svg = `
		<svg width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" viewBox="0 0 ${SOCIAL_IMAGE_WIDTH} ${SOCIAL_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stop-color="${palette.primary}" />
					<stop offset="58%" stop-color="${palette.secondary}" />
					<stop offset="100%" stop-color="#08111d" />
				</linearGradient>
			</defs>
			<rect width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" fill="url(#bg)" />
			<circle cx="920" cy="110" r="220" fill="${palette.accent}" fill-opacity="0.16" />
			<circle cx="1040" cy="540" r="260" fill="#ffffff" fill-opacity="0.05" />
		</svg>
	`

	return sharp(Buffer.from(svg)).png().toBuffer()
}

async function uploadGeneratedSeoAsset(
	prisma: PrismaClient,
	s3: SeoS3Config,
	catalogId: string,
	filename: string,
	contentType: string,
	buffer: Buffer,
	size: { width?: number; height?: number }
): Promise<GeneratedCatalogSeoAsset> {
	const key = buildGeneratedSeoKey(catalogId, filename)

	await s3.client.send(
		new PutObjectCommand({
			Bucket: s3.bucket,
			Key: key,
			Body: buffer,
			ContentType: contentType,
			CacheControl: 'public, max-age=0, must-revalidate',
			...(s3.publicRead ? { ACL: 'public-read' } : {})
		})
	)

	const existing = await prisma.media.findFirst({
		where: {
			catalogId,
			key
		},
		select: { id: true }
	})

	const media = await prisma.media.upsert({
		where: {
			catalogId_key: {
				catalogId,
				key
			}
		},
		create: {
			catalogId,
			originalName: filename,
			mimeType: contentType,
			size: buffer.length,
			width: size.width,
			height: size.height,
			path: 'seo/catalog',
			entityId: catalogId,
			storage: 's3',
			key,
			status: MediaStatus.READY
		},
		update: {
			originalName: filename,
			mimeType: contentType,
			size: buffer.length,
			width: size.width,
			height: size.height,
			path: 'seo/catalog',
			entityId: catalogId,
			storage: 's3',
			status: MediaStatus.READY
		},
		select: { id: true }
	})

	return {
		mediaId: media.id,
		key,
		url: buildPublicSeoUrl(s3, key),
		contentType,
		width: size.width,
		height: size.height,
		reused: Boolean(existing)
	}
}

function buildGeneratedSeoKey(catalogId: string, filename: string): string {
	return `catalogs/${catalogId}/seo/catalog/${catalogId}/${filename}`
}

function buildPublicSeoUrl(s3: SeoS3Config, key: string): string {
	const endpoint = process.env.S3_PUBLIC_BASE_URL?.trim()
	if (endpoint) {
		return `${endpoint.replace(/\/+$/, '')}/${key}`
	}

	const rawEndpoint = process.env.S3_ENDPOINT?.trim()
	if (rawEndpoint) {
		return `${rawEndpoint.replace(/\/+$/, '')}/${s3.bucket}/${key}`
	}

	return key
}

function renderSvgTextLines(
	lines: string[],
	options: {
		x: number
		y: number
		lineHeight: number
		fontSize: number
		fontWeight: number
		fill: string
		fillOpacity?: number
		textAnchor?: string
		dominantBaseline?: string
	}
): string {
	const anchor = options.textAnchor ? ` text-anchor="${options.textAnchor}"` : ''
	const dominantBaseline = options.dominantBaseline
		? ` dominant-baseline="${options.dominantBaseline}"`
		: ''
	return lines
		.map((line, index) => {
			const fillOpacity =
				options.fillOpacity !== undefined
					? ` fill-opacity="${options.fillOpacity}"`
					: ''

			return `<text x="${options.x}" y="${options.y + index * options.lineHeight}" font-family="Arial, sans-serif" font-size="${options.fontSize}" font-weight="${options.fontWeight}" fill="${options.fill}"${fillOpacity}${anchor}${dominantBaseline}>${escapeSvgText(line)}</text>`
		})
		.join('')
}

function wrapPngAsIco(buffer: Buffer, width: number, height: number): Buffer {
	const header = Buffer.alloc(22)
	header.writeUInt16LE(0, 0)
	header.writeUInt16LE(1, 2)
	header.writeUInt16LE(1, 4)
	header.writeUInt8(width >= 256 ? 0 : width, 6)
	header.writeUInt8(height >= 256 ? 0 : height, 7)
	header.writeUInt8(0, 8)
	header.writeUInt8(0, 9)
	header.writeUInt16LE(1, 10)
	header.writeUInt16LE(32, 12)
	header.writeUInt32LE(buffer.length, 14)
	header.writeUInt32LE(22, 18)

	return Buffer.concat([header, buffer])
}

function buildInitials(name: string): string {
	const words = name
		.split(/\s+/)
		.map(word => word.trim())
		.filter(Boolean)

	if (!words.length) return 'CT'

	return words
		.slice(0, 2)
		.map(word => Array.from(word)[0] ?? '')
		.join('')
		.toUpperCase()
}

function wrapText(
	value: string | null | undefined,
	maxChars: number,
	maxLines: number
): string[] {
	const normalized = normalizeText(value)?.replace(/\s+/g, ' ')
	if (!normalized) return []

	const words = normalized.split(' ')
	const lines: string[] = []
	let current = ''

	for (let index = 0; index < words.length; index += 1) {
		const word = words[index]
		const candidate = current ? `${current} ${word}` : word
		if (candidate.length <= maxChars) {
			current = candidate
			continue
		}

		if (!current) {
			lines.push(truncateStrict(word, maxChars))
		} else {
			lines.push(current)
			current = word
		}

		if (lines.length === maxLines - 1) {
			const remainder = [current, ...words.slice(index + 1)]
				.filter(Boolean)
				.join(' ')
			if (remainder) {
				lines.push(truncateStrict(remainder, maxChars))
			}
			return lines.slice(0, maxLines)
		}
	}

	if (current) lines.push(truncateStrict(current, maxChars))
	return lines.slice(0, maxLines)
}

function truncateStrict(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value
	if (maxChars <= 1) return value.slice(0, maxChars)
	return `${value.slice(0, maxChars - 1).trimEnd()}?`
}

function resolvePalette(seed: string): {
	primary: string
	secondary: string
	accent: string
} {
	let hash = 0
	for (const char of seed) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0
	}

	const hue = hash % 360
	return {
		primary: `hsl(${hue} 68% 46%)`,
		secondary: `hsl(${(hue + 42) % 360} 55% 32%)`,
		accent: `hsl(${(hue + 180) % 360} 78% 78%)`
	}
}

function escapeSvgText(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
	if (value === undefined) return fallback
	const normalized = value.trim().toLowerCase()
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false
	return fallback
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
	const grouped = new Map<string, T[]>()
	for (const item of items) {
		const key = getKey(item)
		const bucket = grouped.get(key)
		if (bucket) bucket.push(item)
		else grouped.set(key, [item])
	}
	return grouped
}

function buildCatalogUrl(domain: string | null, path = ''): string | null {
	const normalizedDomain = normalizeText(domain)
	if (!normalizedDomain) return null
	return `https://${normalizedDomain}${path}`
}

function normalizeText(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized ? normalized : null
}

function truncateText(value: string | null, maxLength: number): string | null {
	if (!value) return null
	return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function slugifyValue(value: string): string {
	const slug = slugify(value, {
		lower: true,
		strict: true,
		trim: true
	})
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'category'
}

function buildUniqueSlug(slugState: Set<string>, baseSlug: string): string {
	let candidate = baseSlug
	let suffix = 2
	while (slugState.has(candidate)) {
		candidate = `${baseSlug}-${suffix}`
		suffix += 1
	}
	slugState.add(candidate)
	return candidate
}

function formatPrice(value: Prisma.Decimal): string {
	return value.toDecimalPlaces(2).toString()
}
