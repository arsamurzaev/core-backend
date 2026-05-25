import { Prisma } from '@generated/client'
import {
	IntegrationProvider,
	IntegrationSyncRunMode,
	MediaStatus,
	Metric,
	MetricScope,
	PaymentKind,
	Role,
	SeoEntityType
} from '@generated/enums'
import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	Optional
} from '@nestjs/common'
import { hash } from 'argon2'
import { randomInt, randomUUID } from 'node:crypto'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import {
	CAPABILITY_CATALOG_SALE_UNITS,
	CAPABILITY_INTEGRATION_IIKO,
	CAPABILITY_INTEGRATION_MOYSKLAD,
	CAPABILITY_INVENTORY_INTERNAL,
	CAPABILITY_PRODUCT_TYPES,
	CAPABILITY_PRODUCT_VARIANTS,
	CATALOG_CAPABILITIES,
	type CatalogCapability
} from '@/modules/capability/public'
import {
	PRODUCT_MAINTENANCE_PORT,
	type ProductMaintenancePort
} from '@/modules/product/public'
import { S3Service } from '@/modules/s3/public'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CACHE_VERSION,
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'
import { buildMediaSelect } from '@/shared/media/media-select'
import { MediaUrlService } from '@/shared/media/media-url.service'

import {
	applyCatalogSlugSuffix,
	CATALOG_SLUG_FALLBACK,
	ensureCatalogSlugAllowed,
	normalizeCatalogSlug,
	slugifyCatalogValue
} from '../catalog/public'
import { renderSafeProviderErrorMessage } from '../integration/public'

import {
	type AdminCatalogSortField,
	type AdminCatalogSortOrder,
	AdminCatalogsQueryDtoReq
} from './dto/requests/admin-catalogs-query.dto.req'
import { AdminCreateActivityDtoReq } from './dto/requests/admin-create-activity.dto.req'
import { AdminCreateCatalogDtoReq } from './dto/requests/admin-create-catalog.dto.req'
import { AdminCreatePromoCodeDtoReq } from './dto/requests/admin-create-promo-code.dto.req'
import { AdminCreatePromoPaymentDtoReq } from './dto/requests/admin-create-promo-payment.dto.req'
import { AdminCreateSubscriptionPaymentDtoReq } from './dto/requests/admin-create-subscription-payment.dto.req'
import { AdminDuplicateCatalogDtoReq } from './dto/requests/admin-duplicate-catalog.dto.req'
import { AdminUpdateCatalogFeatureEntitlementDtoReq } from './dto/requests/admin-update-catalog-feature-entitlement.dto.req'
import { AdminUpdateCatalogDtoReq } from './dto/requests/admin-update-catalog.dto.req'

const mediaSelect = buildMediaSelect()
const LOGIN_SUFFIX_ALPHABET = '23456789abcdefghijkmnopqrstuvwxyz'
const DEFAULT_CATALOG_OWNER_PASSWORD = '00000000'
const GLOBAL_YANDEX_METRIKA_COUNTER_ID = '104676804'
const SOFT_DELETE_RETENTION_DAYS = Number(
	process.env.SOFT_DELETE_RETENTION_DAYS ?? 30
)
const MS_PER_DAY = 24 * 60 * 60 * 1000
const SKU_MAX_LENGTH = 100
const ALLOWED_PAYMENT_PROOF_MIME = new Set([
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/webp'
])
const DUPLICATE_CATALOG_TRANSACTION_TIMEOUT_MS = 60_000

type DuplicateCatalogMediaRecord = {
	id: string
	storage: string
	key: string
	path: string | null
	entityId: string | null
	variants: { storage: string; key: string }[]
}

type DuplicateCatalogCopiedMediaKeys = {
	key: string
	variantKeys: Array<string | null>
}

type DuplicateCatalogPreparedMediaVariant = {
	kind: string
	mimeType: string | null
	size: number | null
	width: number | null
	height: number | null
	storage: string
	key: string
}

type DuplicateCatalogPreparedMedia = {
	id: string
	originalName: string
	mimeType: string
	size: number | null
	width: number | null
	height: number | null
	path: string | null
	entityId: string | null
	storage: string
	key: string
	checksum: string | null
	status: MediaStatus
	variants: DuplicateCatalogPreparedMediaVariant[]
}

const adminCatalogSelect = {
	id: true,
	slug: true,
	domain: true,
	name: true,
	typeId: true,
	parentId: true,
	userId: true,
	promoCodeId: true,
	subscriptionEndsAt: true,
	metrics: {
		where: {
			provider: Metric.YANDEX,
			scope: MetricScope.MAIN
		},
		select: {
			counterId: true
		},
		take: 1
	},
	activity: {
		select: {
			id: true,
			name: true,
			deleteAt: true,
			createdAt: true,
			updatedAt: true
		},
		orderBy: { name: 'asc' }
	},
	payments: {
		where: {
			kind: PaymentKind.PROMOCODE,
			deleteAt: null
		},
		select: {
			promoCodeId: true
		}
	},
	deleteAt: true,
	createdAt: true,
	updatedAt: true,
	config: {
		select: {
			status: true,
			logoMedia: { select: mediaSelect }
		}
	},
	settings: {
		select: {
			inventoryMode: true
		}
	},
	featureEntitlements: {
		where: {
			feature: { in: [...CATALOG_CAPABILITIES] }
		},
		select: {
			feature: true,
			enabled: true,
			expiresAt: true
		}
	},
	type: {
		select: {
			id: true,
			code: true,
			name: true,
			deleteAt: true,
			createdAt: true,
			updatedAt: true
		}
	},
	promoCode: {
		select: {
			id: true,
			name: true,
			firstName: true,
			lastName: true,
			surName: true,
			bet: true,
			deleteAt: true,
			createdAt: true,
			updatedAt: true
		}
	},
	children: {
		select: {
			id: true,
			slug: true,
			domain: true,
			name: true,
			deleteAt: true
		},
		orderBy: { createdAt: 'desc' }
	}
} as const satisfies Prisma.CatalogSelect
const paymentSelect = {
	id: true,
	kind: true,
	catalogId: true,
	promoCodeId: true,
	paidAt: true,
	amount: true,
	licenseEndsAt: true,
	proofUrl: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true
} as const satisfies Prisma.PaymentSelect

type AdminCatalogRecord = Prisma.CatalogGetPayload<{
	select: typeof adminCatalogSelect
}>

export type UploadedPaymentProofFile = {
	buffer: Buffer
	mimetype: string
	originalname?: string
}

@Injectable()
export class AdminService {
	private readonly logger = new Logger(AdminService.name)

	constructor(
		private readonly prisma: PrismaService,
		private readonly mediaUrl: MediaUrlService,
		private readonly s3: S3Service,
		private readonly cache: CacheService,
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities: CapabilityReaderPort,
		@Inject(PRODUCT_MAINTENANCE_PORT)
		private readonly productMaintenance: ProductMaintenancePort,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	async createCatalog(dto: AdminCreateCatalogDtoReq) {
		const normalizedSlug = dto.slug ? normalizeCatalogSlug(dto.slug) : null
		if (normalizedSlug) {
			ensureCatalogSlugAllowed(normalizedSlug)
			await this.ensureSlugAvailable(normalizedSlug)
		}

		const [slug, login] = await Promise.all([
			normalizedSlug
				? Promise.resolve(normalizedSlug)
				: this.generateCatalogSlug(dto.name),
			this.generateOwnerLogin(dto.slug)
		])
		const password = DEFAULT_CATALOG_OWNER_PASSWORD
		const passwordHash = await hash(password)
		const ownerName = dto.ownerName ?? dto.name
		const status = dto.status
		const subscriptionEndsAt = dto.trialLicenseDays
			? addDays(new Date(), dto.trialLicenseDays)
			: undefined
		const metricConnections = [
			{
				where: { counterId: GLOBAL_YANDEX_METRIKA_COUNTER_ID },
				create: {
					provider: Metric.YANDEX,
					scope: MetricScope.GLOBAL,
					counterId: GLOBAL_YANDEX_METRIKA_COUNTER_ID
				}
			},
			...(dto.metricId
				? [
						{
							where: { counterId: dto.metricId },
							create: {
								provider: Metric.YANDEX,
								scope: MetricScope.MAIN,
								counterId: dto.metricId
							}
						}
					]
				: [])
		]

		const created = await this.prisma.$transaction(async tx => {
			const owner = await tx.user.create({
				data: {
					name: ownerName,
					login,
					password: passwordHash,
					role: Role.CATALOG,
					isEmailConfirmed: true
				},
				select: {
					id: true,
					name: true,
					login: true
				}
			})

			const catalog = await tx.catalog.create({
				data: {
					name: dto.name,
					slug,
					type: { connect: { id: dto.typeId } },
					...(dto.activityIds?.length
						? {
								activity: {
									connect: dto.activityIds.map(id => ({ id }))
								}
							}
						: {}),
					user: { connect: { id: owner.id } },
					...(dto.parentId ? { parent: { connect: { id: dto.parentId } } } : {}),
					...(subscriptionEndsAt ? { subscriptionEndsAt } : {}),
					config: { create: { status } },
					settings: { create: {} },
					metrics: {
						connectOrCreate: metricConnections
					}
				},
				select: adminCatalogSelect
			})

			return { owner, catalog }
		})

		return {
			catalog: this.mapAdminCatalog(created.catalog),
			owner: {
				...created.owner,
				password
			}
		}
	}

	async duplicateCatalog(
		sourceCatalogId: string,
		dto: AdminDuplicateCatalogDtoReq
	) {
		const source = await this.prisma.catalog.findUnique({
			where: { id: sourceCatalogId },
			select: {
				id: true,
				parentId: true,
				activity: { select: { id: true } },
				region: { select: { id: true } },
				config: {
					select: {
						about: true,
						description: true,
						currency: true,
						logoMediaId: true,
						bgMediaId: true,
						note: true,
						deleteAt: true
					}
				},
				settings: {
					select: {
						isActive: true,
						defaultMode: true,
						allowedModes: true,
						googleVerification: true,
						yandexVerification: true,
						deleteAt: true
					}
				},
				contacts: {
					select: {
						type: true,
						position: true,
						value: true,
						deleteAt: true
					}
				},
				media: {
					select: {
						id: true,
						originalName: true,
						mimeType: true,
						size: true,
						width: true,
						height: true,
						path: true,
						entityId: true,
						storage: true,
						key: true,
						checksum: true,
						status: true,
						variants: {
							select: {
								kind: true,
								mimeType: true,
								size: true,
								width: true,
								height: true,
								storage: true,
								key: true
							}
						}
					}
				},
				brands: {
					select: {
						id: true,
						name: true,
						slug: true,
						deleteAt: true
					}
				},
				category: {
					select: {
						id: true,
						parentId: true,
						position: true,
						name: true,
						imageMediaId: true,
						descriptor: true,
						discount: true,
						deleteAt: true
					}
				},
				products: {
					select: {
						id: true,
						brandId: true,
						sku: true,
						name: true,
						slug: true,
						price: true,
						isPopular: true,
						status: true,
						position: true,
						deleteAt: true,
						productAttributes: {
							select: {
								attributeId: true,
								enumValueId: true,
								valueString: true,
								valueInteger: true,
								valueDecimal: true,
								valueBoolean: true,
								valueDateTime: true,
								deleteAt: true
							}
						},
						variants: {
							select: {
								id: true,
								sku: true,
								variantKey: true,
								stock: true,
								price: true,
								status: true,
								isAvailable: true,
								deleteAt: true,
								attributes: {
									select: {
										attributeId: true,
										enumValueId: true,
										deleteAt: true
									}
								}
							}
						},
						media: {
							select: {
								mediaId: true,
								position: true,
								kind: true
							}
						},
						categoryProducts: {
							select: {
								categoryId: true,
								position: true
							}
						}
					}
				},
				seoSettings: {
					select: {
						entityType: true,
						entityId: true,
						urlPath: true,
						canonicalUrl: true,
						title: true,
						description: true,
						keywords: true,
						h1: true,
						seoText: true,
						robots: true,
						isIndexable: true,
						isFollowable: true,
						ogTitle: true,
						ogDescription: true,
						ogMediaId: true,
						ogType: true,
						ogUrl: true,
						ogSiteName: true,
						ogLocale: true,
						twitterCard: true,
						twitterTitle: true,
						twitterDescription: true,
						twitterMediaId: true,
						faviconMediaId: true,
						twitterSite: true,
						twitterCreator: true,
						hreflang: true,
						structuredData: true,
						extras: true,
						sitemapPriority: true,
						sitemapChangeFreq: true,
						deleteAt: true
					}
				}
			}
		})

		if (!source) throw new NotFoundException('Catalog not found')

		const slug = normalizeCatalogSlug(dto.slug)
		ensureCatalogSlugAllowed(slug)
		await this.ensureSlugAvailable(slug)

		const activityIds = source.activity.map(activity => activity.id)
		const regionIds = source.region.map(region => region.id)
		const password = DEFAULT_CATALOG_OWNER_PASSWORD
		const passwordHash = await hash(password)
		const login = await this.generateOwnerLogin(dto.slug)
		const ownerName = dto.name
		const nextCatalogId = randomUUID()
		const copiedS3Keys: string[] = []
		const mediaIdMap = new Map<string, string>()
		const duplicatedMedia: DuplicateCatalogPreparedMedia[] = []

		let created!: {
			owner: { id: string; name: string; login: string }
			catalog: AdminCatalogRecord
		}
		try {
			for (const media of source.media) {
				const nextMediaId = randomUUID()
				const copiedKeys = await this.copyDuplicatedMediaKeys(
					media,
					nextCatalogId,
					copiedS3Keys
				)
				if (!copiedKeys) continue

				const variants = media.variants.flatMap((variant, index) => {
					const key = copiedKeys.variantKeys[index]
					if (!key) return []

					return [
						{
							kind: variant.kind,
							mimeType: variant.mimeType,
							size: variant.size,
							width: variant.width,
							height: variant.height,
							storage: variant.storage,
							key
						}
					]
				})

				mediaIdMap.set(media.id, nextMediaId)
				duplicatedMedia.push({
					id: nextMediaId,
					originalName: media.originalName,
					mimeType: media.mimeType,
					size: media.size,
					width: media.width,
					height: media.height,
					path: media.path,
					entityId: media.entityId,
					storage: media.storage,
					key: copiedKeys.key,
					checksum: media.checksum,
					status: media.status,
					variants
				})
			}

			created = await this.prisma.$transaction(
				async tx => {
					const owner = await tx.user.create({
						data: {
							name: ownerName,
							login,
							password: passwordHash,
							role: Role.CATALOG,
							isEmailConfirmed: true
						},
						select: {
							id: true,
							name: true,
							login: true
						}
					})

					const catalog = await tx.catalog.create({
						data: {
							id: nextCatalogId,
							name: dto.name,
							slug,
							type: { connect: { id: dto.typeId } },
							user: { connect: { id: owner.id } },
							...(source.parentId
								? { parent: { connect: { id: source.parentId } } }
								: {}),
							...(activityIds.length
								? { activity: { connect: activityIds.map(id => ({ id })) } }
								: {}),
							...(regionIds.length
								? { region: { connect: regionIds.map(id => ({ id })) } }
								: {}),
							config: { create: { status: dto.status } },
							settings: { create: {} },
							metrics: {
								connectOrCreate: [
									{
										where: { counterId: GLOBAL_YANDEX_METRIKA_COUNTER_ID },
										create: {
											provider: Metric.YANDEX,
											scope: MetricScope.GLOBAL,
											counterId: GLOBAL_YANDEX_METRIKA_COUNTER_ID
										}
									}
								]
							}
						},
						select: { id: true }
					})

					for (const media of duplicatedMedia) {
						await tx.media.create({
							data: {
								id: media.id,
								catalogId: catalog.id,
								originalName: media.originalName,
								mimeType: media.mimeType,
								size: media.size,
								width: media.width,
								height: media.height,
								path: media.path,
								entityId: media.entityId,
								storage: media.storage,
								key: media.key,
								checksum: media.checksum,
								status: media.status
							}
						})

						if (media.variants.length) {
							await tx.mediaVariant.createMany({
								data: media.variants.map(variant => ({
									mediaId: media.id,
									...variant
								}))
							})
						}
					}

					if (source.config) {
						await tx.catalogConfig.update({
							where: { catalogId: catalog.id },
							data: {
								about: source.config.about,
								description: source.config.description,
								currency: source.config.currency,
								logoMediaId: mapNullableId(source.config.logoMediaId, mediaIdMap),
								bgMediaId: mapNullableId(source.config.bgMediaId, mediaIdMap),
								note: source.config.note,
								deleteAt: source.config.deleteAt
							}
						})
					}

					if (source.settings) {
						await tx.catalogSettings.update({
							where: { catalogId: catalog.id },
							data: {
								isActive: source.settings.isActive,
								defaultMode: source.settings.defaultMode,
								allowedModes: source.settings.allowedModes,
								googleVerification: source.settings.googleVerification,
								yandexVerification: source.settings.yandexVerification,
								deleteAt: source.settings.deleteAt
							}
						})
					}

					if (source.contacts.length) {
						await tx.catalogContact.createMany({
							data: source.contacts.map(contact => ({
								catalogId: catalog.id,
								type: contact.type,
								position: contact.position,
								value: contact.value,
								deleteAt: contact.deleteAt
							}))
						})
					}

					const brandIdMap = new Map<string, string>()
					for (const brand of source.brands) {
						const nextBrandId = randomUUID()
						brandIdMap.set(brand.id, nextBrandId)
						await tx.brand.create({
							data: {
								id: nextBrandId,
								catalogId: catalog.id,
								name: brand.name,
								slug: brand.slug,
								deleteAt: brand.deleteAt
							}
						})
					}

					const categoryIdMap = new Map<string, string>()
					const pendingCategories = [...source.category]
					while (pendingCategories.length) {
						let createdInPass = 0
						for (let index = pendingCategories.length - 1; index >= 0; index -= 1) {
							const category = pendingCategories[index]
							if (category.parentId && !categoryIdMap.has(category.parentId)) {
								continue
							}

							const nextCategoryId = randomUUID()
							categoryIdMap.set(category.id, nextCategoryId)
							await tx.category.create({
								data: {
									id: nextCategoryId,
									catalogId: catalog.id,
									parentId: category.parentId
										? categoryIdMap.get(category.parentId)
										: null,
									position: category.position,
									name: category.name,
									imageMediaId: mapNullableId(category.imageMediaId, mediaIdMap),
									descriptor: category.descriptor,
									discount: category.discount,
									deleteAt: category.deleteAt
								}
							})
							pendingCategories.splice(index, 1)
							createdInPass += 1
						}

						if (!createdInPass) {
							throw new BadRequestException('Unable to duplicate category tree')
						}
					}

					const productIdMap = new Map<string, string>()
					for (const product of source.products) {
						const nextProductId = randomUUID()
						productIdMap.set(product.id, nextProductId)
						await tx.product.create({
							data: {
								id: nextProductId,
								catalogId: catalog.id,
								brandId: product.brandId
									? (brandIdMap.get(product.brandId) ?? null)
									: null,
								sku: buildDuplicatedSku(product.sku, slug),
								name: product.name,
								slug: product.slug,
								price: product.price,
								isPopular: product.isPopular,
								status: product.status,
								position: product.position,
								deleteAt: product.deleteAt
							}
						})

						if (product.productAttributes.length) {
							await tx.productAttribute.createMany({
								data: product.productAttributes.map(attribute => ({
									productId: nextProductId,
									attributeId: attribute.attributeId,
									enumValueId: attribute.enumValueId,
									valueString: attribute.valueString,
									valueInteger: attribute.valueInteger,
									valueDecimal: attribute.valueDecimal,
									valueBoolean: attribute.valueBoolean,
									valueDateTime: attribute.valueDateTime,
									deleteAt: attribute.deleteAt
								}))
							})
						}

						for (const variant of product.variants) {
							const nextVariantId = randomUUID()
							await tx.productVariant.create({
								data: {
									id: nextVariantId,
									productId: nextProductId,
									sku: buildDuplicatedSku(variant.sku, slug),
									variantKey: variant.variantKey,
									stock: variant.stock,
									price: variant.price,
									status: variant.status,
									isAvailable: variant.isAvailable,
									deleteAt: variant.deleteAt
								}
							})

							if (variant.attributes.length) {
								await tx.variantAttribute.createMany({
									data: variant.attributes.map(attribute => ({
										variantId: nextVariantId,
										attributeId: attribute.attributeId,
										enumValueId: attribute.enumValueId,
										deleteAt: attribute.deleteAt
									}))
								})
							}
						}

						const productMedia = product.media
							.map(item => {
								const mediaId = mediaIdMap.get(item.mediaId)
								return mediaId
									? {
											productId: nextProductId,
											mediaId,
											position: item.position,
											kind: item.kind
										}
									: null
							})
							.filter((item): item is NonNullable<typeof item> => item !== null)
						if (productMedia.length) {
							await tx.productMedia.createMany({ data: productMedia })
						}

						const categoryProducts = product.categoryProducts
							.map(item => {
								const categoryId = categoryIdMap.get(item.categoryId)
								return categoryId
									? {
											productId: nextProductId,
											categoryId,
											position: item.position
										}
									: null
							})
							.filter((item): item is NonNullable<typeof item> => item !== null)
						if (categoryProducts.length) {
							await tx.categoryProduct.createMany({ data: categoryProducts })
						}
					}

					for (const setting of source.seoSettings) {
						await tx.seoSetting.create({
							data: {
								catalogId: catalog.id,
								entityType: setting.entityType,
								entityId: mapSeoEntityId(setting.entityType, setting.entityId, {
									sourceCatalogId: source.id,
									nextCatalogId: catalog.id,
									categoryIdMap,
									productIdMap,
									brandIdMap
								}),
								urlPath: setting.urlPath,
								canonicalUrl: setting.canonicalUrl,
								title: setting.title,
								description: setting.description,
								keywords: setting.keywords,
								h1: setting.h1,
								seoText: setting.seoText,
								robots: setting.robots,
								isIndexable: setting.isIndexable,
								isFollowable: setting.isFollowable,
								ogTitle: setting.ogTitle,
								ogDescription: setting.ogDescription,
								ogMediaId: mapNullableId(setting.ogMediaId, mediaIdMap),
								ogType: setting.ogType,
								ogUrl: setting.ogUrl,
								ogSiteName: setting.ogSiteName,
								ogLocale: setting.ogLocale,
								twitterCard: setting.twitterCard,
								twitterTitle: setting.twitterTitle,
								twitterDescription: setting.twitterDescription,
								twitterMediaId: mapNullableId(setting.twitterMediaId, mediaIdMap),
								faviconMediaId: mapNullableId(setting.faviconMediaId, mediaIdMap),
								twitterSite: setting.twitterSite,
								twitterCreator: setting.twitterCreator,
								hreflang: setting.hreflang ?? undefined,
								structuredData: setting.structuredData ?? undefined,
								extras: setting.extras ?? undefined,
								sitemapPriority: setting.sitemapPriority,
								sitemapChangeFreq: setting.sitemapChangeFreq,
								deleteAt: setting.deleteAt
							}
						})
					}

					const catalogWithRelations = await tx.catalog.findUniqueOrThrow({
						where: { id: catalog.id },
						select: adminCatalogSelect
					})

					return { owner, catalog: catalogWithRelations }
				},
				{
					timeout: DUPLICATE_CATALOG_TRANSACTION_TIMEOUT_MS
				}
			)
		} catch (error) {
			await this.s3.deleteObjectsByKeys(copiedS3Keys).catch(() => undefined)
			throw error
		}

		return {
			catalog: this.mapAdminCatalog(created.catalog),
			owner: {
				...created.owner,
				password
			}
		}
	}

	async updateCatalog(id: string, dto: AdminUpdateCatalogDtoReq) {
		const current = await this.prisma.catalog.findUnique({
			where: { id },
			select: {
				id: true,
				slug: true,
				typeId: true,
				userId: true,
				metrics: {
					where: {
						provider: Metric.YANDEX,
						scope: MetricScope.MAIN
					},
					select: { id: true, counterId: true }
				}
			}
		})

		if (!current) throw new NotFoundException('Catalog not found')

		const slugChanged = dto.slug !== undefined && dto.slug !== current.slug

		if (slugChanged) {
			ensureCatalogSlugAllowed(dto.slug)
			await this.ensureSlugAvailable(dto.slug, id)
		}

		const ownerLogin =
			slugChanged && current.userId
				? await this.generateOwnerLogin(dto.slug, current.userId)
				: null

		const data: Prisma.CatalogUpdateInput = {
			...(dto.name !== undefined ? { name: dto.name } : {}),
			...(dto.slug !== undefined ? { slug: dto.slug } : {}),
			...(dto.typeId ? { type: { connect: { id: dto.typeId } } } : {}),
			...(dto.activityIds !== undefined
				? {
						activity: { set: dto.activityIds.map(activityId => ({ id: activityId })) }
					}
				: {}),
			...(dto.parentId !== undefined
				? {
						parent:
							dto.parentId === null
								? { disconnect: true }
								: { connect: { id: dto.parentId } }
					}
				: {}),
			...(dto.promoCodeId !== undefined
				? {
						promoCode:
							dto.promoCodeId === null
								? { disconnect: true }
								: { connect: { id: dto.promoCodeId } }
					}
				: {}),
			...(dto.trialLicenseDays
				? { subscriptionEndsAt: addDays(new Date(), dto.trialLicenseDays) }
				: {}),
			...(dto.status !== undefined
				? {
						config: {
							upsert: {
								create: { status: dto.status },
								update: { status: dto.status }
							}
						}
					}
				: {})
		}

		const metricIdProvided = dto.metricId !== undefined

		data.metrics = {
			connectOrCreate: [
				{
					where: { counterId: GLOBAL_YANDEX_METRIKA_COUNTER_ID },
					create: {
						provider: Metric.YANDEX,
						scope: MetricScope.GLOBAL,
						counterId: GLOBAL_YANDEX_METRIKA_COUNTER_ID
					}
				},
				...(dto.metricId
					? [
							{
								where: { counterId: dto.metricId },
								create: {
									provider: Metric.YANDEX,
									scope: MetricScope.MAIN,
									counterId: dto.metricId
								}
							}
						]
					: [])
			],
			...(metricIdProvided
				? {
						disconnect: current.metrics
							.filter(
								metric => dto.metricId === null || metric.counterId !== dto.metricId
							)
							.map(metric => ({ id: metric.id }))
					}
				: {})
		}

		const catalog = await this.prisma.$transaction(async tx => {
			const updated = await tx.catalog.update({
				where: { id },
				data,
				select: adminCatalogSelect
			})

			if (ownerLogin && current.userId) {
				await tx.user.update({
					where: { id: current.userId },
					data: { login: ownerLogin }
				})
			}

			return updated
		})

		await this.invalidateCatalogCaches(id)

		if (dto.typeId && dto.typeId !== current.typeId) {
			await this.invalidateCatalogTypeCaches(id, current.typeId, dto.typeId)
		}

		return this.mapAdminCatalog(catalog)
	}

	async getCatalogFeatureEntitlements(id: string) {
		await this.ensureCatalogExists(id)
		return this.buildCatalogFeatureEntitlementDto(id)
	}

	async diagnoseCatalogDefaultVariants(catalogId: string, sampleLimit?: number) {
		await this.ensureCatalogExists(catalogId)
		return this.productMaintenance.diagnoseDefaultVariantsForCatalog(
			catalogId,
			sampleLimit
		)
	}

	async repairCatalogMissingDefaultVariants(catalogId: string) {
		await this.ensureCatalogExists(catalogId)
		return this.productMaintenance.repairMissingDefaultVariantsForCatalog(
			catalogId
		)
	}

	async repairCatalogDefaultVariantPriceMismatches(
		catalogId: string,
		options?: {
			apply?: boolean
			batchSize?: number
			sampleLimit?: number
		}
	) {
		await this.ensureCatalogExists(catalogId)
		return this.productMaintenance.repairDefaultVariantPriceMismatchesForCatalog(
			catalogId,
			options
		)
	}

	async getCatalogMoySkladStockDiagnostics(catalogId: string) {
		await this.ensureCatalogExists(catalogId)

		const integration = await this.prisma.integration.findUnique({
			where: {
				catalogId_provider: {
					catalogId,
					provider: IntegrationProvider.MOYSKLAD
				}
			},
			select: {
				id: true,
				isActive: true,
				metadata: true
			}
		})

		if (!integration) {
			return {
				catalogId,
				integrationId: null,
				hasIntegration: false,
				integrationActive: false,
				syncStockEnabled: false,
				stockFieldOwnedByMoySklad: false,
				stockWebhookEnabled: false,
				stockWebhookRegistered: false,
				lastStockSyncedAt: null,
				links: buildEmptyMoySkladStockLinkCounters(),
				latestRun: null
			}
		}

		const [
			latestRun,
			productLinks,
			variantLinks,
			productLinksWithStockSync,
			variantLinksWithStockSync,
			productLinksMissing,
			variantLinksMissing,
			productLinksWithErrors,
			variantLinksWithErrors,
			productSkippedReasonRows,
			variantSkippedReasonRows
		] = await Promise.all([
			this.prisma.integrationSyncRun.findFirst({
				where: {
					catalogId,
					provider: IntegrationProvider.MOYSKLAD,
					mode: IntegrationSyncRunMode.STOCK
				},
				orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
				select: {
					id: true,
					trigger: true,
					status: true,
					snapshotCompleteness: true,
					error: true,
					metadata: true,
					totalProducts: true,
					updatedProducts: true,
					requestedAt: true,
					startedAt: true,
					finishedAt: true
				}
			}),
			this.prisma.integrationProductLink.count({
				where: { integrationId: integration.id }
			}),
			this.prisma.integrationVariantLink.count({
				where: { integrationId: integration.id }
			}),
			this.prisma.integrationProductLink.count({
				where: { integrationId: integration.id, lastStockSyncAt: { not: null } }
			}),
			this.prisma.integrationVariantLink.count({
				where: { integrationId: integration.id, lastStockSyncAt: { not: null } }
			}),
			this.prisma.integrationProductLink.count({
				where: { integrationId: integration.id, missingSince: { not: null } }
			}),
			this.prisma.integrationVariantLink.count({
				where: { integrationId: integration.id, missingSince: { not: null } }
			}),
			this.prisma.integrationProductLink.count({
				where: { integrationId: integration.id, lastExternalError: { not: null } }
			}),
			this.prisma.integrationVariantLink.count({
				where: { integrationId: integration.id, lastExternalError: { not: null } }
			}),
			this.prisma.integrationProductLink.groupBy({
				by: ['skippedReason'],
				where: {
					integrationId: integration.id,
					skippedReason: { not: null }
				},
				_count: { skippedReason: true }
			}),
			this.prisma.integrationVariantLink.groupBy({
				by: ['skippedReason'],
				where: {
					integrationId: integration.id,
					skippedReason: { not: null }
				},
				_count: { skippedReason: true }
			})
		])

		const metadata = readJsonRecord(integration.metadata)
		const stockWebhook = readJsonRecord(metadata.stockWebhook)
		const fieldOwnership = readJsonRecord(metadata.fieldOwnership)

		return {
			catalogId,
			integrationId: integration.id,
			hasIntegration: true,
			integrationActive: integration.isActive,
			syncStockEnabled: metadata.syncStock !== false,
			stockFieldOwnedByMoySklad: fieldOwnership.stock !== 'local',
			stockWebhookEnabled: metadata.stockWebhookEnabled === true,
			stockWebhookRegistered: readNonEmptyString(stockWebhook.externalId) !== null,
			lastStockSyncedAt: readNonEmptyString(metadata.lastStockSyncedAt),
			links: {
				productLinks,
				variantLinks,
				productLinksWithStockSync,
				variantLinksWithStockSync,
				productLinksMissing,
				variantLinksMissing,
				productLinksWithErrors,
				variantLinksWithErrors,
				productSkippedReasons: mapSkippedReasonCounts(productSkippedReasonRows),
				variantSkippedReasons: mapSkippedReasonCounts(variantSkippedReasonRows)
			},
			latestRun: latestRun ? mapMoySkladStockRunDiagnostics(latestRun) : null
		}
	}

	async updateCatalogFeatureEntitlement(
		id: string,
		dto: AdminUpdateCatalogFeatureEntitlementDtoReq
	) {
		await this.ensureCatalogExists(id)
		const feature: CatalogCapability = dto.feature
		const expiresAt =
			dto.expiresAt === undefined || dto.expiresAt === null
				? null
				: new Date(dto.expiresAt)
		if (expiresAt && Number.isNaN(expiresAt.getTime())) {
			throw new BadRequestException('expiresAt must be a valid date')
		}
		const metadata = (dto.metadata ?? Prisma.JsonNull) as
			| Prisma.InputJsonValue
			| Prisma.NullableJsonNullValueInput

		await this.prisma.catalogFeatureEntitlement.upsert({
			where: {
				catalogId_feature: {
					catalogId: id,
					feature
				}
			},
			create: {
				catalogId: id,
				feature,
				enabled: dto.enabled,
				expiresAt,
				metadata
			},
			update: {
				enabled: dto.enabled,
				expiresAt,
				metadata
			},
			select: { id: true }
		})

		await this.invalidateCatalogCaches(id)
		return this.buildCatalogFeatureEntitlementDto(id)
	}

	async getCatalogs(
		query: AdminCatalogsQueryDtoReq = new AdminCatalogsQueryDtoReq()
	) {
		const typeIds = query.typeIds ?? query['typeIds[]']
		const promoCodeIds = query.promoCodeIds ?? query['promoCodeIds[]']
		const statuses = query.statuses ?? query['statuses[]']
		const where: Prisma.CatalogWhereInput = {
			...(typeIds?.length ? { typeId: { in: typeIds } } : {}),
			...(promoCodeIds?.length ? { promoCodeId: { in: promoCodeIds } } : {}),
			...(statuses?.length ? { config: { status: { in: statuses } } } : {})
		}

		const catalogs = await this.prisma.catalog.findMany({
			where,
			select: adminCatalogSelect,
			orderBy: { createdAt: 'desc' }
		})

		const mapped = catalogs.map(catalog => this.mapAdminCatalog(catalog))
		return sortAdminCatalogs(
			mapped,
			query.sortBy ?? 'createdAt',
			query.sortOrder ?? 'desc'
		)
	}

	async deleteCatalog(id: string) {
		const current = await this.prisma.catalog.findUnique({
			where: { id },
			select: adminCatalogSelect
		})

		if (!current) throw new NotFoundException('Catalog not found')
		if (current.deleteAt) return this.mapAdminCatalog(current)

		const catalog = await this.prisma.catalog.update({
			where: { id },
			data: { deleteAt: new Date() },
			select: adminCatalogSelect
		})

		await this.invalidateCatalogCaches(id)

		return this.mapAdminCatalog(catalog)
	}

	async restoreCatalog(id: string) {
		const current = await this.prisma.catalog.findUnique({
			where: { id },
			select: adminCatalogSelect
		})

		if (!current) throw new NotFoundException('Catalog not found')
		if (!current.deleteAt) return this.mapAdminCatalog(current)

		const catalog = await this.prisma.catalog.update({
			where: { id },
			data: { deleteAt: null },
			select: adminCatalogSelect
		})

		await this.invalidateCatalogCaches(id)

		return this.mapAdminCatalog(catalog)
	}

	async deleteCatalogContent(catalogId: string) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id: catalogId },
			select: { id: true }
		})

		if (!catalog) throw new NotFoundException('Catalog not found')

		const deletedAt = new Date()
		const counts = await this.prisma.$transaction(async tx => {
			const [
				productMediaLinks,
				categoryProductLinks,
				integrationProductLinks,
				integrationCategoryLinks,
				variantAttributes,
				productVariants,
				productAttributes,
				products,
				categories,
				brands,
				seoSettings
			] = await Promise.all([
				tx.productMedia.deleteMany({
					where: {
						product: { catalogId }
					}
				}),
				tx.categoryProduct.deleteMany({
					where: {
						OR: [{ category: { catalogId } }, { product: { catalogId } }]
					}
				}),
				tx.integrationProductLink.deleteMany({
					where: {
						OR: [{ integration: { catalogId } }, { product: { catalogId } }]
					}
				}),
				tx.integrationCategoryLink.deleteMany({
					where: {
						OR: [{ integration: { catalogId } }, { category: { catalogId } }]
					}
				}),
				tx.variantAttribute.updateMany({
					where: {
						deleteAt: null,
						variant: {
							product: { catalogId }
						}
					},
					data: { deleteAt: deletedAt }
				}),
				tx.productVariant.updateMany({
					where: {
						deleteAt: null,
						product: { catalogId }
					},
					data: { deleteAt: deletedAt }
				}),
				tx.productAttribute.updateMany({
					where: {
						deleteAt: null,
						product: { catalogId }
					},
					data: { deleteAt: deletedAt }
				}),
				tx.product.updateMany({
					where: { catalogId, deleteAt: null },
					data: { deleteAt: deletedAt, brandId: null }
				}),
				tx.category.updateMany({
					where: { catalogId, deleteAt: null },
					data: { deleteAt: deletedAt }
				}),
				tx.brand.updateMany({
					where: { catalogId, deleteAt: null },
					data: { deleteAt: deletedAt }
				}),
				tx.seoSetting.updateMany({
					where: {
						catalogId,
						deleteAt: null,
						entityType: { not: SeoEntityType.CATALOG }
					},
					data: { deleteAt: deletedAt }
				})
			])

			return {
				products: products.count,
				productVariants: productVariants.count,
				productAttributes: productAttributes.count,
				variantAttributes: variantAttributes.count,
				categories: categories.count,
				brands: brands.count,
				seoSettings: seoSettings.count,
				productMediaLinks: productMediaLinks.count,
				categoryProductLinks: categoryProductLinks.count,
				integrationProductLinks: integrationProductLinks.count,
				integrationCategoryLinks: integrationCategoryLinks.count
			}
		})

		await this.invalidateCatalogContentCaches(catalogId)

		return {
			ok: true,
			catalogId,
			deletedAt,
			counts
		}
	}

	async getTypes() {
		const types = await this.prisma.type.findMany({
			select: {
				id: true,
				code: true,
				name: true,
				deleteAt: true,
				createdAt: true,
				updatedAt: true,
				_count: {
					select: {
						catalogs: true
					}
				}
			},
			orderBy: { name: 'asc' }
		})

		return types.map(({ _count, ...type }) => ({
			...type,
			deleteInfo: this.buildDeleteInfo(type.deleteAt),
			catalogsCount: _count.catalogs
		}))
	}

	async getActivities(typeId?: string) {
		const activities = await this.prisma.activity.findMany({
			where: {
				...(typeId ? { type: { some: { id: typeId } } } : {})
			},
			select: {
				id: true,
				name: true,
				deleteAt: true,
				createdAt: true,
				updatedAt: true,
				type: {
					select: {
						id: true,
						code: true,
						name: true,
						deleteAt: true,
						createdAt: true,
						updatedAt: true
					},
					orderBy: { name: 'asc' }
				},
				_count: {
					select: {
						catalogs: true
					}
				}
			},
			orderBy: { name: 'asc' }
		})

		return activities.map(({ _count, type, ...activity }) => ({
			...activity,
			deleteInfo: this.buildDeleteInfo(activity.deleteAt),
			types: type.map(item => ({
				...item,
				deleteInfo: this.buildDeleteInfo(item.deleteAt)
			})),
			catalogsCount: _count.catalogs
		}))
	}

	async createActivity(dto: AdminCreateActivityDtoReq) {
		const existing = await this.prisma.activity.findFirst({
			where: {
				name: {
					equals: dto.name,
					mode: 'insensitive'
				},
				deleteAt: null,
				type: { some: { id: dto.typeId } }
			},
			select: { id: true }
		})

		if (existing) {
			throw new BadRequestException('Activity already exists')
		}

		const activity = await this.prisma.activity.create({
			data: {
				name: dto.name,
				type: { connect: { id: dto.typeId } }
			},
			select: {
				id: true,
				name: true,
				deleteAt: true,
				createdAt: true,
				updatedAt: true,
				type: {
					select: {
						id: true,
						code: true,
						name: true,
						deleteAt: true,
						createdAt: true,
						updatedAt: true
					}
				}
			}
		})

		return {
			id: activity.id,
			name: activity.name,
			deleteAt: activity.deleteAt,
			createdAt: activity.createdAt,
			updatedAt: activity.updatedAt,
			deleteInfo: this.buildDeleteInfo(activity.deleteAt),
			types: activity.type.map(item => ({
				...item,
				deleteInfo: this.buildDeleteInfo(item.deleteAt)
			})),
			catalogsCount: 0
		}
	}

	async getPromoCodes() {
		const promoCodes = await this.prisma.promoCode.findMany({
			select: {
				id: true,
				name: true,
				firstName: true,
				lastName: true,
				surName: true,
				bet: true,
				deleteAt: true,
				createdAt: true,
				updatedAt: true,
				_count: {
					select: {
						catalogs: true,
						payments: true
					}
				}
			},
			orderBy: { createdAt: 'desc' }
		})

		return promoCodes.map(({ _count, ...promoCode }) => ({
			...promoCode,
			deleteInfo: this.buildDeleteInfo(promoCode.deleteAt),
			catalogsCount: _count.catalogs,
			paymentsCount: _count.payments
		}))
	}

	async createPromoCode(dto: AdminCreatePromoCodeDtoReq) {
		const existing = await this.prisma.promoCode.findFirst({
			where: {
				name: {
					equals: dto.name,
					mode: 'insensitive'
				}
			},
			select: { id: true }
		})

		if (existing) throw new BadRequestException('Promo code already exists')

		const promoCode = await this.prisma.promoCode.create({
			data: {
				name: dto.name,
				firstName: dto.firstName,
				lastName: dto.lastName,
				surName: dto.surName,
				bet: dto.bet
			},
			select: {
				id: true,
				name: true,
				firstName: true,
				lastName: true,
				surName: true,
				bet: true,
				deleteAt: true,
				createdAt: true,
				updatedAt: true
			}
		})

		return {
			...promoCode,
			deleteInfo: this.buildDeleteInfo(promoCode.deleteAt),
			catalogsCount: 0,
			paymentsCount: 0
		}
	}

	async getCatalogPayments(catalogId: string) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id: catalogId },
			select: { id: true }
		})

		if (!catalog) throw new NotFoundException('Catalog not found')

		const payments = await this.prisma.payment.findMany({
			where: {
				catalogId
			},
			select: paymentSelect,
			orderBy: { createdAt: 'desc' }
		})

		return payments.map(payment => this.mapPayment(payment))
	}

	async getPromoCodePayments(promoCodeId: string) {
		const promoCode = await this.prisma.promoCode.findUnique({
			where: { id: promoCodeId },
			select: { id: true }
		})

		if (!promoCode) throw new NotFoundException('Promo code not found')

		const payments = await this.prisma.payment.findMany({
			where: {
				promoCodeId
			},
			select: paymentSelect,
			orderBy: { createdAt: 'desc' }
		})

		return payments.map(payment => this.mapPayment(payment))
	}

	async createCatalogPromoPayment(
		catalogId: string,
		dto: AdminCreatePromoPaymentDtoReq,
		proof?: UploadedPaymentProofFile
	) {
		const [catalog, promoCode] = await Promise.all([
			this.prisma.catalog.findUnique({
				where: { id: catalogId },
				select: { id: true }
			}),
			this.prisma.promoCode.findUnique({
				where: { id: dto.promoCodeId },
				select: { id: true }
			})
		])

		if (!catalog) throw new NotFoundException('Catalog not found')
		if (!promoCode) throw new NotFoundException('Promo code not found')

		const proofUrl = await this.uploadPaymentProof(proof)
		const payment = await this.prisma.$transaction(async tx => {
			const created = await tx.payment.create({
				data: {
					kind: PaymentKind.PROMOCODE,
					catalog: { connect: { id: catalogId } },
					promoCode: { connect: { id: dto.promoCodeId } },
					paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
					amount:
						dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : undefined,
					licenseEndsAt: dto.licenseEndsAt ? new Date(dto.licenseEndsAt) : undefined,
					proofUrl
				},
				select: {
					id: true,
					kind: true,
					catalogId: true,
					promoCodeId: true,
					paidAt: true,
					amount: true,
					licenseEndsAt: true,
					proofUrl: true,
					createdAt: true,
					updatedAt: true
				}
			})

			await tx.catalog.update({
				where: { id: catalogId },
				data: {
					promoCode: { connect: { id: dto.promoCodeId } },
					...(created.licenseEndsAt
						? { subscriptionEndsAt: created.licenseEndsAt }
						: {})
				},
				select: { id: true }
			})

			return created
		})

		return this.mapPayment(payment)
	}

	async createCatalogSubscriptionPayment(
		catalogId: string,
		dto: AdminCreateSubscriptionPaymentDtoReq,
		proof?: UploadedPaymentProofFile
	) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id: catalogId },
			select: { id: true }
		})

		if (!catalog) throw new NotFoundException('Catalog not found')

		const proofUrl = await this.uploadPaymentProof(proof)
		const payment = await this.prisma.$transaction(async tx => {
			const created = await tx.payment.create({
				data: {
					kind: PaymentKind.SUBSCRIPTION,
					catalog: { connect: { id: catalogId } },
					paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
					amount:
						dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : undefined,
					licenseEndsAt: dto.licenseEndsAt ? new Date(dto.licenseEndsAt) : undefined,
					proofUrl
				},
				select: {
					id: true,
					kind: true,
					catalogId: true,
					promoCodeId: true,
					paidAt: true,
					amount: true,
					licenseEndsAt: true,
					proofUrl: true,
					createdAt: true,
					updatedAt: true
				}
			})

			if (created.licenseEndsAt) {
				await tx.catalog.update({
					where: { id: catalogId },
					data: { subscriptionEndsAt: created.licenseEndsAt },
					select: { id: true }
				})
			}

			return created
		})

		return this.mapPayment(payment)
	}

	private async uploadPaymentProof(proof?: UploadedPaymentProofFile) {
		if (!proof?.buffer?.length) {
			throw new BadRequestException('Payment proof file is required')
		}

		if (!ALLOWED_PAYMENT_PROOF_MIME.has(proof.mimetype)) {
			throw new BadRequestException(
				'Unsupported payment proof format. Allowed: PDF, JPEG, PNG, WebP'
			)
		}

		const uploaded = await this.s3.uploadProofFile(
			proof.buffer,
			proof.mimetype,
			proof.originalname
		)

		return uploaded.url
	}

	private async copyDuplicatedMediaKeys(
		media: DuplicateCatalogMediaRecord,
		targetCatalogId: string,
		copiedS3Keys: string[]
	): Promise<DuplicateCatalogCopiedMediaKeys | null> {
		const rawKey =
			media.storage === 's3'
				? await this.copyDuplicatedS3Key(
						media.key,
						media,
						targetCatalogId,
						copiedS3Keys
					)
				: media.key

		if (!rawKey) {
			this.logger.warn(
				`Duplicated media ${media.id} raw source S3 object is missing (${media.key}); trying variants`
			)
		}

		const variantKeys: Array<string | null> = []

		for (const variant of media.variants) {
			const variantKey =
				variant.storage === 's3'
					? await this.copyDuplicatedS3Key(
							variant.key,
							media,
							targetCatalogId,
							copiedS3Keys
						)
					: variant.key
			if (!variantKey) {
				this.logger.warn(
					`Skipping duplicated media variant for media ${media.id}: source S3 object is missing (${variant.key})`
				)
			}
			variantKeys.push(variantKey)
		}

		const key = rawKey ?? variantKeys.find(Boolean) ?? null
		if (!key) {
			this.logger.warn(
				`Skipping duplicated media ${media.id}: source S3 objects are missing (${media.key})`
			)
			return null
		}

		return { key, variantKeys }
	}

	private async copyDuplicatedS3Key(
		sourceKey: string,
		media: Pick<DuplicateCatalogMediaRecord, 'path' | 'entityId'>,
		targetCatalogId: string,
		copiedS3Keys: string[]
	): Promise<string | null> {
		try {
			const result = await this.s3.copyObjectToCatalog({
				sourceKey,
				targetCatalogId,
				path: media.path,
				entityId: media.entityId
			})
			copiedS3Keys.push(result.key)
			return result.key
		} catch (error) {
			if (isMissingS3ObjectError(error)) return null
			throw error
		}
	}

	private async invalidateCatalogTypeChangeCaches(
		catalogId: string,
		previousTypeId: string,
		nextTypeId: string
	) {
		await Promise.all([
			this.invalidateCatalogCaches(catalogId),
			this.invalidateCatalogTypeCaches(catalogId, previousTypeId, nextTypeId)
		])
	}

	private async invalidateCatalogTypeCaches(
		catalogId: string,
		previousTypeId: string,
		nextTypeId: string
	) {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'catalog.cache_invalidated',
					catalogId,
					scopes: [
						{ name: 'catalog_type', key: previousTypeId },
						{ name: 'catalog_type', key: nextTypeId }
					]
				})
			)
			return
		}

		await Promise.all([
			this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, previousTypeId),
			this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, nextTypeId)
		])
	}

	private async invalidateCatalogCaches(catalogId: string) {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'catalog.cache_invalidated',
					catalogId,
					scopes: [
						{ name: 'catalog' },
						{ name: 'catalog_products' },
						{ name: 'category_products' }
					]
				})
			)
			return
		}

		await Promise.all([
			this.cache.bumpVersion(CATALOG_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
		])
	}

	private async invalidateCatalogContentCaches(catalogId: string) {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'catalog.cache_invalidated',
					catalogId,
					scopes: [
						{ name: 'catalog' },
						{ name: 'catalog_products' },
						{ name: 'category_products' },
						{ name: 'category_list' }
					]
				})
			)
			return
		}

		await Promise.all([
			this.cache.bumpVersion(CATALOG_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(CATEGORY_LIST_CACHE_VERSION, catalogId)
		])
	}

	private async ensureCatalogExists(catalogId: string): Promise<void> {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id: catalogId },
			select: { id: true }
		})
		if (!catalog) throw new NotFoundException('Catalog not found')
	}

	private async buildCatalogFeatureEntitlementDto(catalogId: string) {
		const capabilities = await this.capabilities.getCatalogCapabilities(catalogId)
		const entitlements = await this.prisma.catalogFeatureEntitlement.findMany({
			where: {
				catalogId,
				feature: { in: [...CATALOG_CAPABILITIES] }
			},
			select: {
				feature: true,
				enabled: true,
				expiresAt: true,
				metadata: true
			}
		})
		const byFeature = new Map(
			entitlements.map(entitlement => [entitlement.feature, entitlement])
		)

		return {
			catalogId,
			definitions: capabilities.definitions,
			raw: capabilities.raw,
			effective: capabilities.effective,
			items: capabilities.items,
			features: CATALOG_CAPABILITIES.map(feature => {
				const entitlement = byFeature.get(feature)
				return {
					feature,
					enabled: Boolean(
						entitlement?.enabled &&
						(!entitlement.expiresAt || entitlement.expiresAt > new Date())
					),
					expiresAt: entitlement?.expiresAt ?? null,
					metadata: entitlement?.metadata ?? null
				}
			})
		}
	}

	private mapAdminCatalog(catalog: AdminCatalogRecord) {
		const {
			activity,
			config,
			featureEntitlements,
			metrics,
			payments,
			settings,
			...rest
		} = catalog
		const promoCodePaid = Boolean(
			rest.promoCodeId &&
			payments.some(payment => payment.promoCodeId === rest.promoCodeId)
		)
		const features = this.mapCatalogFeatureFlags(featureEntitlements)

		return {
			...rest,
			activities: activity,
			metricId: metrics[0]?.counterId ?? null,
			promoCodePaid,
			subscriptionDaysLeft: buildSubscriptionDaysLeft(catalog.subscriptionEndsAt),
			deleteInfo: this.buildDeleteInfo(catalog.deleteAt),
			config: config
				? {
						status: config.status,
						inventoryMode: settings?.inventoryMode ?? 'NONE',
						...features
					}
				: null,
			logoMedia: config?.logoMedia
				? this.mediaUrl.mapMedia(config.logoMedia)
				: null,
			type: {
				...catalog.type,
				deleteInfo: this.buildDeleteInfo(catalog.type.deleteAt)
			},
			promoCode: catalog.promoCode
				? {
						...catalog.promoCode,
						deleteInfo: this.buildDeleteInfo(catalog.promoCode.deleteAt)
					}
				: null
		}
	}

	private mapCatalogFeatureFlags(
		entitlements: Array<{
			feature: string
			enabled: boolean
			expiresAt: Date | null
		}>
	) {
		const now = new Date()
		const enabledFeatures = new Set(
			entitlements
				.filter(
					entitlement =>
						entitlement.enabled &&
						(!entitlement.expiresAt || entitlement.expiresAt > now)
				)
				.map(entitlement => entitlement.feature)
		)

		return {
			canUseProductTypes: enabledFeatures.has(CAPABILITY_PRODUCT_TYPES),
			canUseProductVariants:
				enabledFeatures.has(CAPABILITY_PRODUCT_VARIANTS) &&
				enabledFeatures.has(CAPABILITY_PRODUCT_TYPES),
			canUseCatalogSaleUnits: enabledFeatures.has(CAPABILITY_CATALOG_SALE_UNITS),
			canUseInternalInventory: enabledFeatures.has(CAPABILITY_INVENTORY_INTERNAL),
			canUseMoySkladIntegration: enabledFeatures.has(
				CAPABILITY_INTEGRATION_MOYSKLAD
			),
			canUseIikoIntegration:
				enabledFeatures.has(CAPABILITY_INTEGRATION_IIKO) &&
				enabledFeatures.has(CAPABILITY_PRODUCT_TYPES) &&
				enabledFeatures.has(CAPABILITY_PRODUCT_VARIANTS)
		}
	}

	private mapPayment(payment: {
		amount: Prisma.Decimal | null
		[key: string]: unknown
	}) {
		return {
			...payment,
			amount: payment.amount === null ? null : Number(payment.amount),
			deleteInfo: this.buildDeleteInfo(payment.deleteAt as Date | null)
		}
	}

	private buildDeleteInfo(deleteAt?: Date | null) {
		if (!deleteAt) return null

		const retentionDays = Number.isFinite(SOFT_DELETE_RETENTION_DAYS)
			? Math.max(1, SOFT_DELETE_RETENTION_DAYS)
			: 30
		const purgeAt = addDays(deleteAt, retentionDays)
		const purgeInDays = Math.max(
			0,
			Math.ceil((purgeAt.getTime() - Date.now()) / MS_PER_DAY)
		)

		return {
			isDeleted: true,
			deletedAt: deleteAt,
			purgeAt,
			purgeInDays
		}
	}

	private async ensureSlugAvailable(slug: string, excludeCatalogId?: string) {
		const existing = await this.prisma.catalog.findFirst({
			where: {
				slug,
				...(excludeCatalogId ? { id: { not: excludeCatalogId } } : {})
			},
			select: { id: true }
		})
		if (existing) throw new BadRequestException('Catalog slug already exists')
	}

	private async generateCatalogSlug(name: string) {
		const base = slugifyCatalogValue(name) || CATALOG_SLUG_FALLBACK
		for (let suffix = 0; suffix < 1000; suffix += 1) {
			const candidate = applyCatalogSlugSuffix(base, suffix)
			if (suffix === 0) ensureCatalogSlugAllowed(candidate)
			const existing = await this.prisma.catalog.findUnique({
				where: { slug: candidate },
				select: { id: true }
			})
			if (!existing) return candidate
		}

		throw new BadRequestException('Unable to generate catalog slug')
	}

	private async generateOwnerLogin(name: string, excludeUserId?: string) {
		const base = slugifyCatalogValue(name) || 'catalog'
		for (let suffix = 0; suffix < 1000; suffix += 1) {
			const candidate = suffix === 0 ? base : `${base}-${randomLoginSuffix()}`
			const existing = await this.prisma.user.findFirst({
				where: {
					login: candidate,
					role: Role.CATALOG,
					...(excludeUserId ? { id: { not: excludeUserId } } : {})
				},
				select: { id: true }
			})
			if (!existing) return candidate
		}

		throw new BadRequestException('Unable to generate owner login')
	}
}

function buildEmptyMoySkladStockLinkCounters() {
	return {
		productLinks: 0,
		variantLinks: 0,
		productLinksWithStockSync: 0,
		variantLinksWithStockSync: 0,
		productLinksMissing: 0,
		variantLinksMissing: 0,
		productLinksWithErrors: 0,
		variantLinksWithErrors: 0,
		productSkippedReasons: [],
		variantSkippedReasons: []
	}
}

function mapSkippedReasonCounts(rows: unknown) {
	if (!Array.isArray(rows)) return []

	return rows
		.flatMap(row => {
			if (!isJsonRecord(row)) return []
			const reason = readNonEmptyString(row.skippedReason)
			if (!reason) return []
			const countSource = isJsonRecord(row._count) ? row._count : {}
			const count = readNonNegativeInteger(countSource.skippedReason) ?? 0
			if (count <= 0) return []

			return [{ reason, count }]
		})
		.sort((left, right) => {
			if (left.count !== right.count) return right.count - left.count
			return left.reason.localeCompare(right.reason, 'ru')
		})
}

function mapMoySkladStockRunDiagnostics(run: {
	id: string
	trigger: unknown
	status: unknown
	snapshotCompleteness: unknown
	error: string | null
	metadata: unknown
	totalProducts: number
	updatedProducts: number
	requestedAt: Date
	startedAt: Date | null
	finishedAt: Date | null
}) {
	const metadata = readJsonRecord(run.metadata)
	const stockRows = readJsonRecord(metadata.stockRows)

	return {
		id: run.id,
		trigger: run.trigger,
		status: run.status,
		snapshotCompleteness: run.snapshotCompleteness,
		totalRows: readNonNegativeInteger(stockRows.total) ?? run.totalProducts,
		appliedRows: readNonNegativeInteger(stockRows.applied) ?? run.updatedProducts,
		skippedRows: readNonNegativeInteger(stockRows.skipped) ?? 0,
		diagnostics: normalizeMoySkladStockDiagnostics(stockRows.diagnostics),
		error: run.error ? renderSafeProviderErrorMessage(run.error) : null,
		requestedAt: run.requestedAt,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt
	}
}

function normalizeMoySkladStockDiagnostics(value: unknown) {
	if (!isJsonRecord(value)) return null

	const source = readStockApplySource(value.source)
	if (!source) return null
	const skippedReasons = readJsonRecord(value.skippedReasons)

	return {
		source,
		stockRows: readNonNegativeInteger(value.stockRows) ?? 0,
		matchedStockRows: readNonNegativeInteger(value.matchedStockRows) ?? 0,
		unmatchedStockRows: readNonNegativeInteger(value.unmatchedStockRows) ?? 0,
		productLinks: readNonNegativeInteger(value.productLinks) ?? 0,
		variantLinks: readNonNegativeInteger(value.variantLinks) ?? 0,
		ignoredVariantLinks: readNonNegativeInteger(value.ignoredVariantLinks) ?? 0,
		appliedProductLinks: readNonNegativeInteger(value.appliedProductLinks) ?? 0,
		appliedVariantLinks: readNonNegativeInteger(value.appliedVariantLinks) ?? 0,
		skippedReasons: {
			missingStock: readNonNegativeInteger(skippedReasons.missingStock) ?? 0,
			productHasVariantLinks:
				readNonNegativeInteger(skippedReasons.productHasVariantLinks) ?? 0,
			variantsCapabilityDisabled:
				readNonNegativeInteger(skippedReasons.variantsCapabilityDisabled) ?? 0,
			stockRowWithoutLocalLink:
				readNonNegativeInteger(skippedReasons.stockRowWithoutLocalLink) ?? 0
		}
	}
}

function readJsonRecord(value: unknown): Record<string, unknown> {
	return isJsonRecord(value) ? value : {}
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized || null
}

function readNonNegativeInteger(value: unknown): number | null {
	const parsed =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value)
				: Number.NaN

	if (!Number.isInteger(parsed) || parsed < 0) return null
	return parsed
}

function readStockApplySource(value: unknown): 'FULL_SYNC' | 'WEBHOOK' | null {
	if (value === 'FULL_SYNC' || value === 'WEBHOOK') return value
	return null
}

function randomLoginSuffix(length = 5) {
	let suffix = ''
	for (let index = 0; index < length; index += 1) {
		suffix += LOGIN_SUFFIX_ALPHABET[randomInt(0, LOGIN_SUFFIX_ALPHABET.length)]
	}
	return suffix
}

function addDays(date: Date, days: number) {
	const result = new Date(date)
	result.setDate(result.getDate() + days)
	return result
}

function buildSubscriptionDaysLeft(subscriptionEndsAt?: Date | null) {
	if (!subscriptionEndsAt) return null
	return Math.ceil((subscriptionEndsAt.getTime() - Date.now()) / MS_PER_DAY)
}

type AdminCatalogSortValue = string | number | Date | null | undefined

type AdminCatalogSortable = {
	slug?: string | null
	name?: string | null
	promoCode?: { name?: string | null } | null
	type?: { name?: string | null } | null
	subscriptionDaysLeft?: number | null
	config?: { status?: string | null } | null
	createdAt?: Date | string | null
}

function sortAdminCatalogs<T extends AdminCatalogSortable>(
	catalogs: T[],
	sortBy: AdminCatalogSortField,
	sortOrder: AdminCatalogSortOrder
) {
	return [...catalogs].sort((left, right) =>
		compareNullableValues(
			getAdminCatalogSortValue(left, sortBy),
			getAdminCatalogSortValue(right, sortBy),
			sortOrder
		)
	)
}

function getAdminCatalogSortValue(
	catalog: AdminCatalogSortable,
	sortBy: AdminCatalogSortField
): AdminCatalogSortValue {
	switch (sortBy) {
		case 'slug':
			return catalog.slug
		case 'name':
			return catalog.name
		case 'promoCode':
			return catalog.promoCode?.name ?? null
		case 'type':
			return catalog.type?.name ?? null
		case 'subscriptionDaysLeft':
			return catalog.subscriptionDaysLeft
		case 'status':
			return catalog.config?.status ?? null
		case 'createdAt':
		default:
			return catalog.createdAt
	}
}

function compareNullableValues(
	left: AdminCatalogSortValue,
	right: AdminCatalogSortValue,
	sortOrder: AdminCatalogSortOrder
) {
	const leftEmpty = left === null || left === undefined
	const rightEmpty = right === null || right === undefined
	if (leftEmpty && rightEmpty) return 0
	if (leftEmpty) return 1
	if (rightEmpty) return -1

	const direction = sortOrder === 'asc' ? 1 : -1
	const leftValue = normalizeSortValue(left)
	const rightValue = normalizeSortValue(right)

	if (typeof leftValue === 'number' && typeof rightValue === 'number') {
		return (leftValue - rightValue) * direction
	}

	return String(leftValue).localeCompare(String(rightValue), 'ru') * direction
}

function normalizeSortValue(value: AdminCatalogSortValue) {
	if (value instanceof Date) return value.getTime()
	if (typeof value === 'number') return value
	if (value === null || value === undefined) return ''
	return String(value).toLowerCase()
}

function mapNullableId(
	id: string | null | undefined,
	idMap: Map<string, string>
) {
	if (!id) return null
	return idMap.get(id) ?? null
}

function isMissingS3ObjectError(error: unknown) {
	if (typeof error !== 'object' || error === null) return false
	const candidate = error as {
		name?: unknown
		code?: unknown
		Code?: unknown
		$metadata?: { httpStatusCode?: unknown }
	}

	return (
		candidate.name === 'NoSuchKey' ||
		candidate.code === 'NoSuchKey' ||
		candidate.Code === 'NoSuchKey' ||
		candidate.$metadata?.httpStatusCode === 404
	)
}

function buildDuplicatedSku(value: string, catalogSlug: string) {
	const suffix = `-${catalogSlug}`
	const maxHeadLength = Math.max(1, SKU_MAX_LENGTH - suffix.length)
	const head = value.slice(0, maxHeadLength).replace(/[-_]+$/g, '')
	const normalized = `${head || 'SKU'}${suffix}`.slice(0, SKU_MAX_LENGTH)
	return normalized || `SKU-${catalogSlug}`.slice(0, SKU_MAX_LENGTH)
}

function mapSeoEntityId(
	entityType: SeoEntityType,
	entityId: string,
	options: {
		sourceCatalogId: string
		nextCatalogId: string
		categoryIdMap: Map<string, string>
		productIdMap: Map<string, string>
		brandIdMap: Map<string, string>
	}
) {
	if (
		entityType === SeoEntityType.CATALOG &&
		entityId === options.sourceCatalogId
	) {
		return options.nextCatalogId
	}

	if (entityType === SeoEntityType.CATEGORY) {
		return options.categoryIdMap.get(entityId) ?? entityId
	}

	if (entityType === SeoEntityType.PRODUCT) {
		return options.productIdMap.get(entityId) ?? entityId
	}

	if (entityType === SeoEntityType.BRAND) {
		return options.brandIdMap.get(entityId) ?? entityId
	}

	return entityId
}
