import type { Prisma } from '@generated/client'
import { ProductStatus, ProductVariantStatus } from '@generated/enums'
import {
	BadGatewayException,
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	Optional
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'
import slugify from 'slugify'

import { AllInterfaces } from '@/core/config'
import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import {
	PRODUCT_EXTERNAL_SYNC_PORT,
	type ProductExternalSyncPort,
	type ProductExternalSyncProductRecord
} from '@/modules/product/public'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'

import {
	type CategorySyncRecord,
	type IikoStopListAvailabilityItem,
	type IikoStopListAvailabilityResult,
	type IntegrationProductLinkRecord,
	type IntegrationRecord,
	IntegrationRepository
} from '../../integration.repository'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import { IikoClient } from './iiko.client'
import {
	buildIikoExternalMenuPreview,
	type IikoExternalMenuPreview,
	normalizeIikoExternalMenu
} from './iiko.external-menu-normalizer'
import { IikoImageImportService } from './iiko.image-import.service'
import { IikoMetadataCryptoService } from './iiko.metadata'
import type {
	IikoMetadata,
	IikoNomenclatureSize,
	IikoStopListItem,
	IikoSyncCategory,
	IikoSyncMenu,
	IikoSyncProduct,
	IikoSyncSizePrice,
	IikoTerminalGroup,
	IikoTerminalGroupStopList,
	IikoTerminalGroupStopListItemsGroup
} from './iiko.types'

const SYNC_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const PRODUCT_SLUG_FALLBACK = 'iiko-product'
const PRODUCT_SKU_FALLBACK = 'IIKO'
const PRODUCT_NAME_FALLBACK = 'iiko product'
const PRODUCT_SLUG_MAX_LENGTH = 255
const PRODUCT_SKU_MAX_LENGTH = 100
const DEFAULT_SIZE_EXTERNAL_ID = 'default'
const DEFAULT_VARIANT_STOCK = 0

export type IikoCatalogSyncResult = {
	ok: true
	totalProducts: number
	createdProducts: number
	updatedProducts: number
	deletedProducts: number
	createdVariants: number
	updatedVariants: number
	deletedVariants: number
	skippedProducts: number
	skippedVariants: number
	imagesImported: number
	revision: number | null
	stock: IikoStopListSyncResult | null
	durationMs: number
	syncedAt: Date
}

export type IikoStopListSyncResult = {
	ok: true
	totalStopListItems: number
	stoppedStopListItems: number
	matchedStopListItems: number
	unmatchedStopListItems: number
	totalVariants: number
	stoppedVariants: number
	restoredVariants: number
	changedVariants: number
	changedProducts: number
	terminalGroupIds: string[]
	durationMs: number
	syncedAt: Date
}

type IikoSyncOptions = {
	runId?: string | null
}

export type IikoProductSyncResult = {
	ok: true
	productId: string
	externalId: string
	created: boolean
	updated: boolean
	imagesImported: number
	totalVariants: number
	createdVariants: number
	updatedVariants: number
	deletedVariants: number
	skippedVariants: number
	revision: number | null
	durationMs: number
	syncedAt: Date
}

type IikoProductSyncStats = {
	productId: string
	externalId: string
	created: boolean
	updated: boolean
	imagesImported: number
	createdVariants: number
	updatedVariants: number
	deletedVariants: number
	skippedVariants: number
}

type IikoPriceOption = {
	sizeId: string
	sizeName: string
	isDefault: boolean
	price: number | null
	raw: IikoSyncSizePrice
}

type IikoCategoryMap = Map<string, CategorySyncRecord>

@Injectable()
export class IikoSyncService {
	private readonly logger = new Logger(IikoSyncService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly metadataCrypto: IikoMetadataCryptoService,
		private readonly images: IikoImageImportService,
		@Inject(PRODUCT_EXTERNAL_SYNC_PORT)
		private readonly products: ProductExternalSyncPort,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureAssertions: CapabilityAssertPort,
		private readonly configService: ConfigService<AllInterfaces>,
		@Optional()
		private readonly cache?: CacheService,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	async syncCatalog(
		catalogId: string,
		options: IikoSyncOptions = {}
	): Promise<IikoCatalogSyncResult> {
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		await this.featureAssertions.assertCanUseProductVariants(catalogId)
		const startedAt = Date.now()
		const staleBefore = new Date(Date.now() - SYNC_LOCK_TIMEOUT_MS)
		const locked = await this.repo.beginIikoSync(catalogId, staleBefore)
		if (!locked) {
			throw new ConflictException('iiko sync is already running')
		}

		try {
			const metadata = this.metadataCrypto.parseStoredMetadata(locked.metadata)
			const client = new IikoClient({
				apiLogin: metadata.apiLogin,
				baseUrl: this.resolveBaseUrl()
			})
			await this.reportProgress(options.runId, {
				phase: 'FETCHING_MENU',
				message: 'Fetching iiko external menu',
				processed: 0,
				total: null
			})

			if (!metadata.externalMenuId) {
				throw new BadRequestException('iiko external menu is not configured')
			}

			const rawMenu = await client.getExternalMenuById({
				externalMenuId: metadata.externalMenuId,
				organizationIds: [metadata.organizationId],
				priceCategoryId: metadata.priceCategoryId,
				version: metadata.menuVersion,
				language: 'ru',
				startRevision: 0
			})
			const menu = normalizeIikoExternalMenu({
				menu: rawMenu,
				organizationId: metadata.organizationId,
				externalMenuId: metadata.externalMenuId,
				externalMenuName: metadata.externalMenuName
			})
			const sizesById = new Map(menu.sizes.map(size => [size.id, size]))
			const categories = await this.syncGroups({
				catalogId,
				integration: locked,
				groups: menu.groups
			})
			const products = this.resolveSyncableProducts(menu)

			const result = await this.syncProducts({
				catalogId,
				integration: locked,
				client,
				menu,
				products,
				categories,
				sizesById,
				importImages: metadata.importImages,
				runId: options.runId
			})
			const deletedProducts = await this.archiveMissingProducts({
				catalogId,
				integration: locked,
				currentExternalIds: products.map(product => product.id)
			})
			const stock = metadata.terminalGroupId
				? await this.applyStopListAvailability({
						catalogId,
						integration: locked,
						metadata,
						client,
						runId: options.runId
					})
				: null
			const syncedAt = new Date()
			await this.repo.finishIikoSync(catalogId, {
				totalProducts: products.length,
				createdProducts: result.createdProducts,
				updatedProducts: result.updatedProducts,
				deletedProducts,
				syncedAt,
				lastRevision: normalizeRevision(menu.revision),
				lastStopListSyncedAt: stock?.syncedAt ?? null
			})
			await this.invalidateProductCaches(catalogId)

			await this.reportProgress(options.runId, {
				phase: 'COMPLETED',
				message: 'iiko menu sync completed',
				processed: products.length,
				total: products.length
			})

			return {
				ok: true,
				totalProducts: products.length,
				createdProducts: result.createdProducts,
				updatedProducts: result.updatedProducts,
				deletedProducts,
				createdVariants: result.createdVariants,
				updatedVariants: result.updatedVariants,
				deletedVariants: result.deletedVariants,
				skippedProducts: result.skippedProducts,
				skippedVariants: result.skippedVariants,
				imagesImported: result.imagesImported,
				revision: normalizeRevision(menu.revision),
				stock,
				durationMs: Date.now() - startedAt,
				syncedAt
			}
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.failIikoSync(catalogId, message)
			await this.reportProgress(options.runId, {
				phase: 'FAILED',
				message,
				processed: 0,
				total: null
			})
			throw error
		}
	}

	async syncProduct(
		catalogId: string,
		productId: string,
		options: IikoSyncOptions = {}
	): Promise<IikoProductSyncResult> {
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		await this.featureAssertions.assertCanUseProductVariants(catalogId)
		const startedAt = Date.now()
		const staleBefore = new Date(Date.now() - SYNC_LOCK_TIMEOUT_MS)
		const locked = await this.repo.beginIikoSync(catalogId, staleBefore)
		if (!locked) {
			throw new ConflictException('iiko sync is already running')
		}

		try {
			const localProduct = await this.products.findExternalProductById({
				catalogId,
				productId
			})
			if (!localProduct) {
				throw new NotFoundException('Product was not found')
			}

			const link = await this.repo.findProductLinkByProductId(locked.id, productId)
			if (!link) {
				throw new NotFoundException('Product is not linked to iiko')
			}

			const metadata = this.metadataCrypto.parseStoredMetadata(locked.metadata)
			if (!metadata.externalMenuId) {
				throw new BadRequestException('iiko external menu is not configured')
			}

			const client = new IikoClient({
				apiLogin: metadata.apiLogin,
				baseUrl: this.resolveBaseUrl()
			})
			await this.reportProgress(options.runId, {
				phase: 'FETCHING_MENU',
				message: 'Fetching iiko external menu',
				processed: 0,
				total: null
			})
			const rawMenu = await client.getExternalMenuById({
				externalMenuId: metadata.externalMenuId,
				organizationIds: [metadata.organizationId],
				priceCategoryId: metadata.priceCategoryId,
				version: metadata.menuVersion,
				language: 'ru',
				startRevision: 0
			})
			const menu = normalizeIikoExternalMenu({
				menu: rawMenu,
				organizationId: metadata.organizationId,
				externalMenuId: metadata.externalMenuId,
				externalMenuName: metadata.externalMenuName
			})
			const sizesById = new Map(menu.sizes.map(size => [size.id, size]))
			const categories = await this.syncGroups({
				catalogId,
				integration: locked,
				groups: menu.groups
			})
			const externalProduct = this.resolveSyncableProducts(menu).find(
				product => product.id === link.externalId
			)
			if (!externalProduct) {
				throw new NotFoundException(
					'iiko product was not found in selected external menu'
				)
			}

			await this.reportProgress(options.runId, {
				phase: 'SYNCING_PRODUCTS',
				message: 'Syncing iiko product',
				processed: 0,
				total: 1
			})
			const result = await this.syncMenuProduct(
				{
					catalogId,
					integration: locked,
					client,
					categories,
					sizesById,
					importImages: metadata.importImages
				},
				externalProduct
			)
			const totalVariants = Math.max(
				resolvePriceOptions(externalProduct, sizesById).length,
				1
			)
			const syncedAt = new Date()
			await this.repo.finishIikoSync(catalogId, {
				totalProducts: 1,
				createdProducts: result.created ? 1 : 0,
				updatedProducts: result.updated ? 1 : 0,
				deletedProducts: 0,
				syncedAt,
				lastRevision: normalizeRevision(menu.revision)
			})
			await this.invalidateProductCaches(catalogId)
			await this.reportProgress(options.runId, {
				phase: 'COMPLETED',
				message: 'iiko product sync completed',
				processed: 1,
				total: 1
			})

			return {
				ok: true,
				...result,
				totalVariants,
				revision: normalizeRevision(menu.revision),
				durationMs: Date.now() - startedAt,
				syncedAt
			}
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.failIikoSync(catalogId, message)
			await this.reportProgress(options.runId, {
				phase: 'FAILED',
				message,
				processed: 0,
				total: null
			})
			throw error
		}
	}

	async testConnection(apiLogin: string): Promise<{
		ok: true
		organizations: Array<{ id: string; name: string; isActive: boolean | null }>
		externalMenus: Array<{ id: string; name: string }>
		priceCategories: Array<{ id: string; name: string }>
		terminalGroups: Array<{
			id: string
			name: string
			organizationId: string | null
			isActive: boolean | null
			isAlive: boolean | null
		}>
	}> {
		const client = new IikoClient({
			apiLogin,
			baseUrl: this.resolveBaseUrl()
		})
		const [organizationsResponse, menusResponse] = await Promise.all([
			client.getOrganizations(),
			client.getMenus()
		])
		const organizationIds = organizationsResponse.organizations
			.map(organization => normalizeOptionalString(organization.id))
			.filter((id): id is string => Boolean(id))
		const terminalGroupsResponse = organizationIds.length
			? await client.getTerminalGroups(organizationIds, {
					includeDisabled: true
				})
			: { terminalGroups: [] }
		const terminalGroups = mergeTerminalGroups([
			...normalizeTerminalGroups(terminalGroupsResponse.terminalGroups, {
				isActive: true
			}),
			...normalizeTerminalGroups(terminalGroupsResponse.terminalGroupsInSleep, {
				isActive: false
			})
		])
		const terminalGroupIds = terminalGroups.map(item => item.id)
		if (organizationIds.length && terminalGroupIds.length) {
			try {
				const aliveResponse = await client.getTerminalGroupsIsAlive({
					organizationIds,
					terminalGroupIds
				})
				applyTerminalGroupAliveStatus(terminalGroups, aliveResponse.isAliveStatus)
			} catch (error) {
				this.logger.warn('Failed to fetch iiko terminal group availability', {
					error: renderSafeProviderErrorMessage(error)
				})
			}
		}

		return {
			ok: true,
			organizations: organizationsResponse.organizations.map(organization => ({
				id: organization.id,
				name: organization.name,
				isActive:
					typeof organization.isActive === 'boolean' ? organization.isActive : null
			})),
			externalMenus: normalizeNamedItems(menusResponse.externalMenus),
			priceCategories: normalizeNamedItems(menusResponse.priceCategories),
			terminalGroups
		}
	}

	async syncStopList(
		catalogId: string,
		options: IikoSyncOptions = {}
	): Promise<IikoStopListSyncResult> {
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		await this.featureAssertions.assertCanUseProductVariants(catalogId)
		const startedAt = Date.now()
		const staleBefore = new Date(Date.now() - SYNC_LOCK_TIMEOUT_MS)
		const locked = await this.repo.beginIikoSync(catalogId, staleBefore)
		if (!locked) {
			throw new ConflictException('iiko sync is already running')
		}

		try {
			const metadata = this.metadataCrypto.parseStoredMetadata(locked.metadata)
			const client = new IikoClient({
				apiLogin: metadata.apiLogin,
				baseUrl: this.resolveBaseUrl()
			})
			const result = await this.applyStopListAvailability({
				catalogId,
				integration: locked,
				metadata,
				client,
				runId: options.runId
			})
			await this.repo.finishIikoStockSync(catalogId, {
				syncedAt: result.syncedAt
			})
			return {
				...result,
				durationMs: Date.now() - startedAt
			}
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.failIikoSync(catalogId, message)
			await this.reportProgress(options.runId, {
				phase: 'FAILED',
				message,
				processed: 0,
				total: null
			})
			throw error
		}
	}

	async previewExternalMenu(params: {
		apiLogin: string
		organizationId: string
		externalMenuId: string
		externalMenuName?: string | null
		priceCategoryId?: string | null
		menuVersion?: number | null
	}): Promise<IikoExternalMenuPreview> {
		const client = new IikoClient({
			apiLogin: params.apiLogin,
			baseUrl: this.resolveBaseUrl()
		})
		const rawMenu = await client.getExternalMenuById({
			externalMenuId: params.externalMenuId,
			organizationIds: [params.organizationId],
			priceCategoryId: params.priceCategoryId,
			version: params.menuVersion ?? 4,
			language: 'ru',
			startRevision: 0
		})
		const menu = normalizeIikoExternalMenu({
			menu: rawMenu,
			organizationId: params.organizationId,
			externalMenuId: params.externalMenuId,
			externalMenuName: params.externalMenuName
		})
		return buildIikoExternalMenuPreview(menu)
	}

	private async applyStopListAvailability(params: {
		catalogId: string
		integration: IntegrationRecord
		metadata: IikoMetadata
		client: IikoClient
		runId?: string | null
	}): Promise<IikoStopListSyncResult> {
		const startedAt = Date.now()
		await this.reportProgress(params.runId, {
			phase: 'FETCHING_STOP_LIST',
			message: 'Fetching iiko stop-list',
			processed: 0,
			total: null
		})

		const terminalGroupIds = params.metadata.terminalGroupId
			? [params.metadata.terminalGroupId]
			: []
		const response = await params.client.getStopLists({
			organizationIds: [params.metadata.organizationId],
			terminalGroupIds,
			returnSize: true
		})
		const stopLists = filterStopListsByTerminalGroup(
			response.terminalGroupStopLists,
			params.metadata.terminalGroupId
		)
		const items = normalizeStopListAvailabilityItems(stopLists)
		const syncedAt = new Date()
		const result = await this.repo.applyIikoStopListAvailability({
			catalogId: params.catalogId,
			integrationId: params.integration.id,
			items,
			syncedAt
		})
		if (result.changedVariants > 0 || result.changedProducts > 0) {
			await this.invalidateProductCaches(params.catalogId)
		}

		await this.reportProgress(params.runId, {
			phase: 'SYNCING_STOP_LIST',
			message: `Applied iiko stop-list: ${result.stoppedVariants}/${result.totalVariants} stopped variants`,
			processed: result.totalVariants,
			total: result.totalVariants
		})

		return mapStopListSyncResult({
			result,
			stopLists,
			terminalGroupIds,
			syncedAt,
			durationMs: Date.now() - startedAt
		})
	}

	private async syncGroups(params: {
		catalogId: string
		integration: IntegrationRecord
		groups: IikoSyncCategory[]
	}): Promise<IikoCategoryMap> {
		const syncableGroups = params.groups.filter(isSyncableGroup)
		const groupById = new Map(syncableGroups.map(group => [group.id, group]))
		const categories: IikoCategoryMap = new Map()
		const visiting = new Set<string>()

		const ensureGroup = async (
			group: IikoSyncCategory
		): Promise<CategorySyncRecord | null> => {
			if (categories.has(group.id)) return categories.get(group.id) ?? null
			if (visiting.has(group.id)) return null
			visiting.add(group.id)

			const parentGroup = group.parentGroup
				? groupById.get(group.parentGroup)
				: null
			const parentCategory = parentGroup ? await ensureGroup(parentGroup) : null
			const existingLink = await this.repo.findCategoryLinkByExternalId(
				params.integration.id,
				group.id
			)
			let category = existingLink?.category ?? null
			if (category) {
				const shouldRename = category.name !== group.name
				const shouldReparent =
					(category.parentId ?? null) !== (parentCategory?.id ?? null)
				if (shouldRename || shouldReparent) {
					category =
						(await this.repo.updateCategory({
							categoryId: category.id,
							catalogId: params.catalogId,
							data: {
								...(shouldRename ? { name: group.name } : {}),
								...(shouldReparent ? { parentId: parentCategory?.id ?? null } : {})
							}
						})) ?? category
				}
			} else {
				category = await this.repo.createCategory(
					params.catalogId,
					group.name,
					parentCategory?.id
				)
			}

			await this.repo.upsertCategoryLink({
				integrationId: params.integration.id,
				categoryId: category.id,
				externalId: group.id,
				externalParentId: group.parentGroup ?? null,
				rawMeta: buildGroupRawMeta(group)
			})
			categories.set(group.id, category)
			visiting.delete(group.id)
			return category
		}

		for (const group of syncableGroups) {
			await ensureGroup(group)
		}

		return categories
	}

	private resolveSyncableProducts(menu: IikoSyncMenu): IikoSyncProduct[] {
		return menu.products.filter(product => {
			if (product.isDeleted || product.isHidden) return false
			const type = product.type?.toLowerCase()
			if (type !== 'dish' && type !== 'good' && type !== 'product') {
				return false
			}
			if (product.orderItemType && product.orderItemType !== 'Product') {
				return false
			}
			return resolvePriceOptions(product, new Map()).length > 0
		})
	}

	private async syncProducts(params: {
		catalogId: string
		integration: IntegrationRecord
		client: IikoClient
		menu: IikoSyncMenu
		products: IikoSyncProduct[]
		categories: IikoCategoryMap
		sizesById: Map<string, IikoNomenclatureSize>
		importImages: boolean
		runId?: string | null
	}) {
		let createdProducts = 0
		let updatedProducts = 0
		let createdVariants = 0
		let updatedVariants = 0
		let deletedVariants = 0
		let skippedProducts = 0
		let skippedVariants = 0
		let imagesImported = 0
		let processed = 0

		for (const product of params.products) {
			try {
				const result = await this.syncMenuProduct(params, product)
				if (result.created) {
					createdProducts += 1
				} else if (result.updated) {
					updatedProducts += 1
				}
				createdVariants += result.createdVariants
				updatedVariants += result.updatedVariants
				deletedVariants += result.deletedVariants
				skippedVariants += result.skippedVariants
				imagesImported += result.imagesImported
			} catch (error) {
				skippedProducts += 1
				this.logger.error('iiko product sync failed', {
					catalogId: params.catalogId,
					integrationId: params.integration.id,
					externalId: product.id,
					error: renderSafeProviderErrorMessage(error)
				})
			} finally {
				processed += 1
				await this.reportProgress(params.runId, {
					phase: 'SYNCING_PRODUCTS',
					message: `Syncing iiko products: ${processed}/${params.products.length}`,
					processed,
					total: params.products.length
				})
			}
		}

		return {
			createdProducts,
			updatedProducts,
			createdVariants,
			updatedVariants,
			deletedVariants,
			skippedProducts,
			skippedVariants,
			imagesImported
		}
	}

	private async syncMenuProduct(
		context: {
			catalogId: string
			integration: IntegrationRecord
			client: IikoClient
			categories: IikoCategoryMap
			sizesById: Map<string, IikoNomenclatureSize>
			importImages: boolean
		},
		product: IikoSyncProduct
	): Promise<IikoProductSyncStats> {
		const externalId = normalizeRequiredString(product.id, 'iiko product id')
		const priceOptions = resolvePriceOptions(product, context.sizesById)
		const basePrice = resolveProductBasePrice(priceOptions)
		const name = normalizeProductName(product.name)
		const description = normalizeOptionalString(
			product.description || product.additionalInfo
		)
		const existingLink = await this.repo.findProductLinkByExternalId(
			context.integration.id,
			externalId
		)
		let localProduct = await this.findLinkedProduct(
			context.catalogId,
			existingLink
		)
		let created = false
		let updated = false

		if (!localProduct) {
			const sku = await this.resolveUniqueProductSku(product)
			const slug = await this.resolveUniqueProductSlug(context.catalogId, name)
			localProduct = await this.products.createExternalProduct({
				catalogId: context.catalogId,
				name,
				sku,
				slug,
				price: basePrice,
				status: ProductStatus.ACTIVE
			})
			created = true
		} else {
			const data: {
				price?: number | null
				status?: string
			} = {}
			if (priceChanged(localProduct.price, basePrice)) data.price = basePrice
			if (localProduct.status !== ProductStatus.ACTIVE) {
				data.status = ProductStatus.ACTIVE
			}
			if (Object.keys(data).length > 0) {
				const result = await this.products.updateExternalProduct({
					catalogId: context.catalogId,
					productId: localProduct.id,
					data
				})
				if (result) localProduct = result
				updated = true
			}
		}

		if (created) {
			updated =
				(await this.products.syncExternalProductDescription({
					catalogId: context.catalogId,
					productId: localProduct.id,
					description
				})) || updated
		}

		const categoryIds = product.groupId
			? [context.categories.get(product.groupId)?.id].filter((id): id is string =>
					Boolean(id)
				)
			: []
		const categorySync = await this.repo.syncManagedProductCategories(
			localProduct.id,
			context.catalogId,
			context.integration.id,
			categoryIds
		)
		updated = updated || categorySync.added > 0 || categorySync.removed > 0

		let imagesImported = 0
		if (context.importImages) {
			imagesImported = await this.images.refreshProductImages({
				catalogId: context.catalogId,
				productId: localProduct.id,
				client: context.client,
				product,
				forceImages: created
			})
			updated = updated || imagesImported > 0
		}

		const variantStats = await this.syncProductVariants({
			catalogId: context.catalogId,
			integrationId: context.integration.id,
			product: localProduct,
			iikoProduct: product,
			priceOptions
		})

		await this.repo.upsertProductLink({
			integrationId: context.integration.id,
			productId: localProduct.id,
			externalId,
			externalCode: normalizeOptionalString(product.code),
			priceSynced: true,
			rawMeta: buildProductRawMeta(product, priceOptions)
		})
		await this.products.recomputeProductCommercialState({
			catalogId: context.catalogId,
			productId: localProduct.id
		})

		return {
			productId: localProduct.id,
			externalId,
			created,
			imagesImported,
			...variantStats,
			updated: created ? false : updated || variantStats.updated
		}
	}

	private async syncProductVariants(params: {
		catalogId: string
		integrationId: string
		product: ProductExternalSyncProductRecord
		iikoProduct: IikoSyncProduct
		priceOptions: IikoPriceOption[]
	}): Promise<{
		createdVariants: number
		updatedVariants: number
		deletedVariants: number
		skippedVariants: number
		updated: boolean
	}> {
		if (params.priceOptions.length <= 1) {
			const option = params.priceOptions[0] ?? null
			const ensured = await this.products.ensureDefaultVariant({
				catalogId: params.catalogId,
				productId: params.product.id,
				sku: params.product.sku,
				price: option?.price ?? null,
				stock: DEFAULT_VARIANT_STOCK,
				productStatus: ProductStatus.ACTIVE
			})
			const deletedVariants =
				await this.repo.archiveMissingIntegratedProductVariants({
					integrationId: params.integrationId,
					productId: params.product.id,
					externalIds: [],
					requiredMissingSyncs: 2
				})

			return {
				createdVariants: ensured ? 1 : 0,
				updatedVariants: ensured === false ? 0 : 0,
				deletedVariants,
				skippedVariants: 0,
				updated: Boolean(ensured) || deletedVariants > 0
			}
		}

		const attribute = await this.repo.upsertIikoSizeVariantAttribute(
			params.catalogId
		)
		await this.repo.ensureIikoSizeProductTypeForProduct({
			catalogId: params.catalogId,
			productId: params.product.id,
			attributeId: attribute.id
		})

		let createdVariants = 0
		let updatedVariants = 0
		let skippedVariants = 0
		const externalIds: string[] = []

		for (const option of params.priceOptions) {
			try {
				const externalId = buildVariantExternalId(params.iikoProduct.id, option)
				externalIds.push(externalId)
				const result = await this.repo.upsertIntegratedProductVariant({
					catalogId: params.catalogId,
					integrationId: params.integrationId,
					productId: params.product.id,
					externalId,
					externalCode: normalizeOptionalString(params.iikoProduct.code),
					rawMeta: buildVariantRawMeta(params.iikoProduct, option),
					sku: buildVariantSku(params.iikoProduct, option),
					variantKey: `iiko_size=${option.sizeId}`,
					price: option.price,
					syncPrice: true,
					syncContent: true,
					stock: DEFAULT_VARIANT_STOCK,
					status: ProductVariantStatus.ACTIVE,
					attributes: [
						{
							attributeId: attribute.id,
							value: option.sizeId,
							displayName: option.sizeName
						}
					]
				})

				if (result.created) {
					createdVariants += 1
				} else if (result.updated) {
					updatedVariants += 1
				}
			} catch (error) {
				skippedVariants += 1
				this.logger.warn(
					`Failed to sync iiko variant ${params.iikoProduct.id}: ${renderSafeProviderErrorMessage(error)}`
				)
			}
		}

		const deletedVariants =
			await this.repo.archiveMissingIntegratedProductVariants({
				integrationId: params.integrationId,
				productId: params.product.id,
				externalIds,
				requiredMissingSyncs: 2
			})

		return {
			createdVariants,
			updatedVariants,
			deletedVariants,
			skippedVariants,
			updated:
				createdVariants > 0 ||
				updatedVariants > 0 ||
				deletedVariants > 0 ||
				skippedVariants > 0
		}
	}

	private async findLinkedProduct(
		catalogId: string,
		link: IntegrationProductLinkRecord | null
	): Promise<ProductExternalSyncProductRecord | null> {
		if (!link) return null
		return this.products.findExternalProductById({
			catalogId,
			productId: link.productId
		})
	}

	private async archiveMissingProducts(params: {
		catalogId: string
		integration: IntegrationRecord
		currentExternalIds: string[]
	}): Promise<number> {
		const currentExternalIds = new Set(params.currentExternalIds)
		const links = await this.repo.findProductLinksByIntegration(
			params.integration.id
		)
		let deleted = 0

		for (const link of links) {
			if (currentExternalIds.has(link.externalId)) continue
			const marked = await this.repo.markProductLinkMissingFromSnapshot(link.id)
			if (!marked || marked.missingSyncCount < 2) continue
			if (
				await this.products.softDeleteExternalProduct({
					catalogId: params.catalogId,
					productId: link.productId
				})
			) {
				deleted += 1
			}
			await this.repo.markProductLinkHiddenAfterMissing(link.id)
		}

		return deleted
	}

	private async resolveUniqueProductSku(
		product: IikoSyncProduct
	): Promise<string> {
		const base = buildSkuBase(
			normalizeOptionalString(product.code) ||
				normalizeOptionalString(product.id) ||
				product.name ||
				PRODUCT_SKU_FALLBACK
		)
		for (let suffix = 0; suffix < 1000; suffix += 1) {
			const candidate = applySuffix(base, suffix, PRODUCT_SKU_MAX_LENGTH)
			if (!(await this.products.existsExternalProductSku({ sku: candidate }))) {
				return candidate
			}
		}
		return buildHashedCandidate(base, PRODUCT_SKU_MAX_LENGTH)
	}

	private async resolveUniqueProductSlug(
		catalogId: string,
		name: string
	): Promise<string> {
		const base = buildSlugBase(name) || PRODUCT_SLUG_FALLBACK
		for (let suffix = 0; suffix < 1000; suffix += 1) {
			const candidate = applySuffix(base, suffix, PRODUCT_SLUG_MAX_LENGTH)
			if (
				!(await this.products.existsExternalProductSlug({
					catalogId,
					slug: candidate
				}))
			) {
				return candidate
			}
		}
		return buildHashedCandidate(base, PRODUCT_SLUG_MAX_LENGTH)
	}

	private async reportProgress(
		runId: string | null | undefined,
		progress: Prisma.InputJsonValue
	): Promise<void> {
		if (!runId) return
		await this.repo.updateSyncRunProgress(runId, progress)
	}

	private resolveBaseUrl(): string {
		const config = this.configService.get('integration', { infer: true })
		return config?.iikoApiBaseUrl ?? 'https://api-ru.iiko.services'
	}

	private async invalidateProductCaches(catalogId: string): Promise<void> {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'product.changed',
					catalogId,
					productId: '*',
					changes: ['catalog_products', 'category_products', 'category_list']
				})
			)
			return
		}

		if (!this.cache) return
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
		await this.cache.bumpVersion(CATEGORY_LIST_CACHE_VERSION, catalogId)
	}
}

function isSyncableGroup(group: IikoSyncCategory): boolean {
	return Boolean(group.id && group.name && !group.isDeleted && !group.isHidden)
}

function resolvePriceOptions(
	product: IikoSyncProduct,
	sizesById: Map<string, IikoNomenclatureSize>
): IikoPriceOption[] {
	const rawPrices = Array.isArray(product.sizePrices) ? product.sizePrices : []
	const options = rawPrices
		.filter(item => item.price?.isIncludedInMenu !== false)
		.map(item => {
			const rawSizeId = normalizeOptionalString(item.sizeId)
			const size = rawSizeId ? sizesById.get(rawSizeId) : null
			const sizeId = rawSizeId || DEFAULT_SIZE_EXTERNAL_ID
			const sizeName =
				normalizeOptionalString(item.sizeName) || size?.name?.trim() || 'Default'
			return {
				sizeId,
				sizeName,
				isDefault:
					item.isDefault === true ||
					size?.isDefault === true ||
					sizeId === DEFAULT_SIZE_EXTERNAL_ID,
				price: normalizePrice(item.price?.currentPrice),
				raw: item
			}
		})
		.filter(option => option.price !== null)

	return [...new Map(options.map(option => [option.sizeId, option])).values()]
}

function resolveProductBasePrice(options: IikoPriceOption[]): number | null {
	if (!options.length) return null
	const selected =
		options.find(option => option.isDefault) ??
		[...options].sort((left, right) => (left.price ?? 0) - (right.price ?? 0))[0]
	return selected?.price ?? null
}

function buildVariantExternalId(
	productId: string,
	option: IikoPriceOption
): string {
	return `${productId}:${option.sizeId}`
}

function buildVariantSku(
	product: IikoSyncProduct,
	option: IikoPriceOption
): string {
	const base = buildSkuBase(
		[
			normalizeOptionalString(product.code) ||
				normalizeOptionalString(product.id) ||
				PRODUCT_SKU_FALLBACK,
			option.sizeName
		].join('-')
	)
	return base.slice(0, PRODUCT_SKU_MAX_LENGTH) || PRODUCT_SKU_FALLBACK
}

function buildProductRawMeta(
	product: IikoSyncProduct,
	priceOptions: IikoPriceOption[]
): Prisma.InputJsonValue {
	return toPrismaInputJson({
		provider: 'iiko',
		source: product.rawMeta ? 'external_menu' : 'nomenclature',
		type: product.type ?? null,
		groupId: product.groupId ?? null,
		productCategoryId: product.productCategoryId ?? null,
		measureUnit: product.measureUnit ?? null,
		imageLinks: product.imageLinks ?? [],
		modifiers: product.modifiers ?? [],
		groupModifiers: product.groupModifiers ?? [],
		raw: product.rawMeta ?? null,
		sizePrices: priceOptions.map(option => ({
			sizeId: option.sizeId,
			sizeName: option.sizeName,
			price: option.price
		}))
	})
}

function buildVariantRawMeta(
	product: IikoSyncProduct,
	option: IikoPriceOption
): Prisma.InputJsonValue {
	return toPrismaInputJson({
		provider: 'iiko',
		source: product.rawMeta ? 'external_menu' : 'nomenclature',
		productId: product.id,
		sizeId: option.sizeId,
		sizeName: option.sizeName,
		price: option.price,
		raw: option.raw.rawMeta ?? option.raw
	})
}

function buildGroupRawMeta(group: IikoSyncCategory): Prisma.InputJsonValue {
	return toPrismaInputJson({
		provider: 'iiko',
		source: group.rawMeta ? 'external_menu' : 'nomenclature',
		parentGroup: group.parentGroup ?? null,
		isHidden: group.isHidden ?? null,
		raw: group.rawMeta ?? null
	})
}

function toPrismaInputJson(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
}

function normalizeProductName(value: unknown): string {
	const normalized = typeof value === 'string' ? value.trim() : ''
	return normalized || PRODUCT_NAME_FALLBACK
}

function normalizeRequiredString(value: unknown, name: string): string {
	const normalized = typeof value === 'string' ? value.trim() : ''
	if (!normalized) {
		throw new BadGatewayException(`${name} is required`)
	}
	return normalized
}

function normalizeOptionalString(value: unknown): string | null {
	const normalized = typeof value === 'string' ? value.trim() : ''
	return normalized || null
}

function normalizeNamedItems(
	value?: Array<{ id?: string | null; name?: string | null }> | null
): Array<{ id: string; name: string }> {
	if (!Array.isArray(value)) return []
	return value
		.map(item => ({
			id: normalizeOptionalString(item.id),
			name: normalizeOptionalString(item.name)
		}))
		.filter((item): item is { id: string; name: string } =>
			Boolean(item.id && item.name)
		)
}

function normalizeTerminalGroups(
	value?: Array<
		{
			organizationId?: string | null
			items?: IikoTerminalGroup[] | null
		} & IikoTerminalGroup
	> | null,
	options: { isActive?: boolean | null } = {}
): Array<{
	id: string
	name: string
	organizationId: string | null
	isActive: boolean | null
	isAlive: boolean | null
}> {
	if (!Array.isArray(value)) return []

	return value
		.flatMap(group => {
			const organizationId = normalizeOptionalString(group.organizationId)
			if (Array.isArray(group.items)) {
				return group.items.map(item => ({
					...item,
					organizationId:
						normalizeOptionalString(item.organizationId) ?? organizationId
				}))
			}
			return [group]
		})
		.map(item => ({
			id: normalizeOptionalString(item.id),
			name: normalizeOptionalString(item.name),
			organizationId: normalizeOptionalString(item.organizationId),
			isActive:
				typeof item.isActive === 'boolean'
					? item.isActive
					: (options.isActive ?? null),
			isAlive: null
		}))
		.filter(
			(
				item
			): item is {
				id: string
				name: string
				organizationId: string | null
				isActive: boolean | null
				isAlive: boolean | null
			} => Boolean(item.id && item.name)
		)
}

function mergeTerminalGroups(
	items: Array<{
		id: string
		name: string
		organizationId: string | null
		isActive: boolean | null
		isAlive: boolean | null
	}>
): Array<{
	id: string
	name: string
	organizationId: string | null
	isActive: boolean | null
	isAlive: boolean | null
}> {
	const byId = new Map<string, (typeof items)[number]>()
	for (const item of items) {
		const existing = byId.get(item.id)
		if (!existing) {
			byId.set(item.id, item)
			continue
		}
		byId.set(item.id, {
			...existing,
			...item,
			isActive:
				existing.isActive === true || item.isActive === true
					? true
					: (item.isActive ?? existing.isActive),
			isAlive: item.isAlive ?? existing.isAlive
		})
	}
	return [...byId.values()]
}

function applyTerminalGroupAliveStatus(
	terminalGroups: Array<{
		id: string
		name: string
		organizationId: string | null
		isActive: boolean | null
		isAlive: boolean | null
	}>,
	value?: Array<{
		isAlive?: boolean | null
		terminalGroupId?: string | null
		organizationId?: string | null
	}> | null
): void {
	if (!Array.isArray(value)) return
	const byId = new Map(
		value
			.map(item => [
				normalizeOptionalString(item.terminalGroupId),
				typeof item.isAlive === 'boolean' ? item.isAlive : null
			])
			.filter((item): item is [string, boolean | null] => Boolean(item[0]))
	)
	for (const terminalGroup of terminalGroups) {
		if (byId.has(terminalGroup.id)) {
			terminalGroup.isAlive = byId.get(terminalGroup.id) ?? null
		}
	}
}

function filterStopListsByTerminalGroup(
	stopLists?: IikoTerminalGroupStopList[] | null,
	terminalGroupId?: string | null
): IikoTerminalGroupStopList[] {
	if (!Array.isArray(stopLists)) return []
	const normalizedTerminalGroupId = normalizeOptionalString(terminalGroupId)
	if (!normalizedTerminalGroupId) return stopLists
	return stopLists.filter(item => {
		const itemTerminalGroupId = normalizeOptionalString(item.terminalGroupId)
		return (
			!itemTerminalGroupId || itemTerminalGroupId === normalizedTerminalGroupId
		)
	})
}

function normalizeStopListAvailabilityItems(
	stopLists: IikoTerminalGroupStopList[]
): IikoStopListAvailabilityItem[] {
	return stopLists.flatMap(stopList => {
		const items = Array.isArray(stopList.items) ? stopList.items : []
		return items.flatMap(item => {
			const itemGroup = normalizeTerminalGroupStopListItemsGroup(item)
			if (itemGroup) {
				const groupItems = Array.isArray(itemGroup.items) ? itemGroup.items : []
				const nestedStopList: IikoTerminalGroupStopList = {
					organizationId: stopList.organizationId ?? null,
					terminalGroupId:
						itemGroup.terminalGroupId ?? stopList.terminalGroupId ?? null
				}
				return groupItems
					.map(groupItem =>
						normalizeStopListAvailabilityItem(nestedStopList, groupItem)
					)
					.filter((entry): entry is IikoStopListAvailabilityItem => Boolean(entry))
			}

			const normalized = normalizeStopListAvailabilityItem(
				stopList,
				item as IikoStopListItem
			)
			return normalized ? [normalized] : []
		})
	})
}

function normalizeTerminalGroupStopListItemsGroup(
	item: IikoStopListItem | IikoTerminalGroupStopListItemsGroup
): IikoTerminalGroupStopListItemsGroup | null {
	if (!item || typeof item !== 'object' || Array.isArray(item)) return null
	if (!Array.isArray((item as IikoTerminalGroupStopListItemsGroup).items)) {
		return null
	}

	return {
		terminalGroupId: normalizeOptionalString(
			(item as IikoTerminalGroupStopListItemsGroup).terminalGroupId
		),
		items: (item as IikoTerminalGroupStopListItemsGroup).items
	}
}

function normalizeStopListAvailabilityItem(
	stopList: IikoTerminalGroupStopList,
	item: IikoStopListItem
): IikoStopListAvailabilityItem | null {
	const productId = normalizeOptionalString(item.productId)
	if (!productId) return null
	return {
		productId,
		sizeId: normalizeOptionalString(item.sizeId),
		balance: normalizePrice(item.balance),
		rawMeta: toPrismaInputJson({
			organizationId: stopList.organizationId ?? null,
			terminalGroupId: stopList.terminalGroupId ?? null,
			productId,
			sizeId: item.sizeId ?? null,
			balance: item.balance ?? null,
			sku: item.sku ?? null,
			dateAdd: item.dateAdd ?? null
		})
	}
}

function mapStopListSyncResult(params: {
	result: IikoStopListAvailabilityResult
	stopLists: IikoTerminalGroupStopList[]
	terminalGroupIds?: string[]
	syncedAt: Date
	durationMs: number
}): IikoStopListSyncResult {
	const terminalGroupIds = [
		...(params.terminalGroupIds ?? []),
		...params.stopLists.flatMap(collectStopListTerminalGroupIds)
	].filter((id): id is string => Boolean(id))

	return {
		ok: true,
		totalStopListItems: params.result.totalStopListItems,
		stoppedStopListItems: params.result.stoppedStopListItems,
		matchedStopListItems: params.result.matchedStopListItems,
		unmatchedStopListItems: params.result.unmatchedStopListItems,
		totalVariants: params.result.totalVariants,
		stoppedVariants: params.result.stoppedVariants,
		restoredVariants: params.result.restoredVariants,
		changedVariants: params.result.changedVariants,
		changedProducts: params.result.changedProducts,
		terminalGroupIds: [...new Set(terminalGroupIds)],
		durationMs: params.durationMs,
		syncedAt: params.syncedAt
	}
}

function collectStopListTerminalGroupIds(
	stopList: IikoTerminalGroupStopList
): string[] {
	const ids = [normalizeOptionalString(stopList.terminalGroupId)]
	const items = Array.isArray(stopList.items) ? stopList.items : []
	for (const item of items) {
		const itemGroup = normalizeTerminalGroupStopListItemsGroup(item)
		if (itemGroup?.terminalGroupId) ids.push(itemGroup.terminalGroupId)
	}

	return ids.filter((id): id is string => Boolean(id))
}

function normalizePrice(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null
	const numberValue = Number(value)
	return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null
}

function normalizeRevision(value: unknown): number | null {
	const numberValue = Number(value)
	return Number.isInteger(numberValue) ? numberValue : null
}

function priceChanged(current: unknown, next: number | null): boolean {
	if (next === null) return current !== null
	const currentNumber = Number(current ?? 0)
	return !Number.isFinite(currentNumber) || currentNumber !== next
}

function slugifyValue(value: string, lower: boolean): string {
	const slug = slugify(value, { lower, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

function buildSlugBase(value: string): string {
	return slugifyValue(value, true)
}

function buildSkuBase(value: string): string {
	return slugifyValue(value, false).toUpperCase() || PRODUCT_SKU_FALLBACK
}

function applySuffix(base: string, suffix: number, maxLength: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, maxLength - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

function buildHashedCandidate(base: string, maxLength: number): string {
	const hash = createHash('sha1').update(base).digest('hex').slice(0, 8)
	const separator = base ? '-' : ''
	const headLength = Math.max(0, maxLength - hash.length - separator.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${separator}${hash}`
}
