import type { Prisma } from '@generated/client'
import { CatalogPriceListPriceTarget } from '@generated/enums'
import {
	BadRequestException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import slugify from 'slugify'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { mustCatalogId } from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeNullableTrimmedString
} from '@/shared/utils'

import {
	CatalogPriceListCreateData,
	CatalogPriceListPriceRecord,
	CatalogPriceListRecord,
	CatalogPriceListRepository,
	CatalogPriceListUpdateData
} from './catalog-price-list.repository'
import { BulkUpsertCatalogPriceListPricesDtoReq } from './dto/requests/catalog-price-list-price.dto.req'
import {
	CreateCatalogPriceListDtoReq,
	UpdateCatalogPriceListDtoReq
} from './dto/requests/catalog-price-list.dto.req'
import { SetActivePriceListDtoReq } from './dto/requests/set-active-price-list.dto.req'
import {
	ActiveCatalogPriceListDto,
	CatalogPriceListDto,
	CatalogPriceListPriceDto
} from './dto/responses/catalog-price-list.dto.res'

const CODE_FALLBACK = 'price-list'
const CODE_MAX_LENGTH = 100

type CatalogScope = {
	catalogId: string
	ownerCatalogId: string
	isChild: boolean
}

type NormalizedPriceInput = {
	target: CatalogPriceListPriceTarget
	targetId: string
	productId: string
	variantId: string | null
	saleUnitId: string | null
	price: number | null
}

type SaleUnitIdentity = {
	id: string
	variantId: string
	catalogSaleUnitId: string | null
	code: string | null
	name: string | null
	baseQuantity: unknown
	variant: { productId: string; variantKey: string | null }
}

function normalizeName(value: string | undefined, fieldName: string): string {
	const name = value?.trim()
	if (!name) {
		throw new BadRequestException(
			fieldName === 'code' ? 'Код обязателен' : 'Название обязательно'
		)
	}
	return name
}

function buildCodeBase(value: string): string {
	return (
		slugify(value, { lower: true, strict: true, trim: true })
			.replace(/-+/g, '-')
			.replace(/^[-_]+|[-_]+$/g, '')
			.slice(0, CODE_MAX_LENGTH) || CODE_FALLBACK
	)
}

function toDecimalString(value: unknown): string {
	if (typeof value === 'number') return value.toFixed(2)
	if (typeof value === 'bigint') return Number(value).toFixed(2)
	if (typeof value === 'string') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed.toFixed(2) : value
	}
	if (value && typeof value === 'object') {
		const candidate = value as {
			toNumber?: () => unknown
			toString?: () => string
		}
		if (typeof candidate.toNumber === 'function') {
			try {
				const parsed = candidate.toNumber()
				if (typeof parsed === 'number' && Number.isFinite(parsed)) {
					return parsed.toFixed(2)
				}
			} catch {
				// Fall back to a custom toString implementation below.
			}
		}
		if (
			typeof candidate.toString === 'function' &&
			candidate.toString !== Object.prototype.toString
		) {
			const normalized = candidate.toString()
			const parsed = Number(normalized)
			return Number.isFinite(parsed) ? parsed.toFixed(2) : normalized
		}
	}
	return '0.00'
}

@Injectable()
export class CatalogPriceListService {
	constructor(
		private readonly repo: CatalogPriceListRepository,
		private readonly prisma: PrismaService,
		private readonly cache: CacheService,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly capabilities: CapabilityAssertPort
	) {}

	async getAll(options: {
		includeArchived?: boolean
		includeInactive?: boolean
	}): Promise<CatalogPriceListDto[]> {
		const scope = await this.resolveScope()
		await this.capabilities.assertCanUseCatalogPriceLists(scope.catalogId)
		return (await this.repo.findAll(scope.ownerCatalogId, options)).map(
			priceList => this.mapPriceList(priceList)
		)
	}

	async create(dto: CreateCatalogPriceListDtoReq): Promise<CatalogPriceListDto> {
		const scope = await this.resolveScope()
		this.assertMainCatalog(scope)
		await this.capabilities.assertCanUseCatalogPriceLists(scope.catalogId)
		const name = normalizeName(dto.name, 'name')
		const explicitCode = normalizeNullableTrimmedString(dto.code)
		const code = explicitCode ? buildCodeBase(explicitCode) : buildCodeBase(name)
		const existing = await this.repo.findByCode(scope.ownerCatalogId, code)

		if (existing) {
			if (!existing.deleteAt) {
				throw new BadRequestException('Код прайс-листа уже используется')
			}
			return this.mapPriceList(
				this.requireUpdatedPriceList(
					await this.repo.update(existing.id, scope.ownerCatalogId, {
						name,
						description: dto.description ?? existing.description,
						isActive: dto.isActive ?? true,
						displayOrder: dto.displayOrder ?? existing.displayOrder,
						deleteAt: null
					})
				)
			)
		}

		return this.mapPriceList(
			await this.repo.create({
				catalogId: scope.ownerCatalogId,
				code,
				name,
				description: dto.description ?? null,
				isActive: dto.isActive ?? true,
				displayOrder: dto.displayOrder ?? 0
			} satisfies CatalogPriceListCreateData)
		)
	}

	async update(
		id: string,
		dto: UpdateCatalogPriceListDtoReq
	): Promise<CatalogPriceListDto> {
		const scope = await this.resolveScope()
		this.assertMainCatalog(scope)
		await this.capabilities.assertCanUseCatalogPriceLists(scope.catalogId)
		this.requirePriceList(
			await this.repo.findById(id, scope.ownerCatalogId, true)
		)
		const data: CatalogPriceListUpdateData = {}

		if (dto.name !== undefined) data.name = normalizeName(dto.name, 'name')
		if (dto.code !== undefined) {
			const code = buildCodeBase(normalizeName(dto.code, 'code'))
			if (await this.repo.existsCode(scope.ownerCatalogId, code, id)) {
				throw new BadRequestException('Код прайс-листа уже используется')
			}
			data.code = code
		}
		if (dto.description !== undefined) data.description = dto.description
		if (dto.isActive !== undefined) {
			data.isActive = dto.isActive
			if (dto.isActive) data.deleteAt = null
		}
		if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder

		assertHasUpdateFields(data)
		const updated = this.requireUpdatedPriceList(
			await this.repo.update(id, scope.ownerCatalogId, data)
		)
		await this.invalidateProductReadCaches(scope.ownerCatalogId)
		return this.mapPriceList(updated)
	}

	async archive(id: string) {
		const scope = await this.resolveScope()
		this.assertMainCatalog(scope)
		await this.capabilities.assertCanUseCatalogPriceLists(scope.catalogId)
		const archived = this.requireUpdatedPriceList(
			await this.repo.update(id, scope.ownerCatalogId, {
				deleteAt: new Date(),
				isActive: false
			})
		)
		await this.invalidateProductReadCaches(scope.ownerCatalogId)
		return { ok: Boolean(archived) }
	}

	async getPrices(
		id: string,
		includeArchived = false
	): Promise<CatalogPriceListPriceDto[]> {
		const scope = await this.resolveScope()
		await this.capabilities.assertCanUseCatalogPriceLists(scope.catalogId)
		this.requirePriceList(
			await this.repo.findById(id, scope.ownerCatalogId, includeArchived)
		)
		return (await this.repo.findPrices(id, includeArchived)).map(price =>
			this.mapPrice(price)
		)
	}

	async bulkUpsertPrices(
		id: string,
		dto: BulkUpsertCatalogPriceListPricesDtoReq
	): Promise<CatalogPriceListPriceDto[]> {
		const scope = await this.resolveScope()
		this.assertMainCatalog(scope)
		await this.capabilities.assertCanUseCatalogPriceLists(scope.catalogId)
		await this.assertCanUsePriceTargets(scope.catalogId, dto)
		this.requirePriceList(await this.repo.findById(id, scope.ownerCatalogId))
		const prices = await this.normalizePrices(scope.ownerCatalogId, dto)

		await this.prisma.$transaction(async tx => {
			const now = new Date()
			for (const price of prices) {
				if (price.price === null) {
					await tx.catalogPriceListPrice.updateMany({
						where: {
							priceListId: id,
							target: price.target,
							targetId: price.targetId
						},
						data: { deleteAt: now }
					})
					continue
				}

				await this.archiveConflictingVariantTargetPrices(tx, id, price, now)

				await tx.catalogPriceListPrice.upsert({
					where: {
						priceListId_target_targetId: {
							priceListId: id,
							target: price.target,
							targetId: price.targetId
						}
					},
					update: {
						productId: price.productId,
						variantId: price.variantId,
						saleUnitId: price.saleUnitId,
						price: price.price,
						deleteAt: null
					},
					create: {
						priceListId: id,
						target: price.target,
						targetId: price.targetId,
						productId: price.productId,
						variantId: price.variantId,
						saleUnitId: price.saleUnitId,
						price: price.price
					}
				})
			}
		})

		await this.invalidateProductReadCaches(scope.ownerCatalogId)
		return this.getPrices(id)
	}

	private async archiveConflictingVariantTargetPrices(
		tx: Prisma.TransactionClient,
		priceListId: string,
		price: NormalizedPriceInput,
		deleteAt: Date
	): Promise<void> {
		if (!price.variantId) return

		if (price.target === CatalogPriceListPriceTarget.VARIANT) {
			await tx.catalogPriceListPrice.updateMany({
				where: {
					priceListId,
					variantId: price.variantId,
					target: CatalogPriceListPriceTarget.SALE_UNIT,
					deleteAt: null
				},
				data: { deleteAt }
			})
			return
		}

		if (price.target === CatalogPriceListPriceTarget.SALE_UNIT) {
			await tx.catalogPriceListPrice.updateMany({
				where: {
					priceListId,
					variantId: price.variantId,
					target: CatalogPriceListPriceTarget.VARIANT,
					deleteAt: null
				},
				data: { deleteAt }
			})
		}
	}

	private async assertCanUsePriceTargets(
		catalogId: string,
		dto: BulkUpsertCatalogPriceListPricesDtoReq
	): Promise<void> {
		const prices = dto.prices ?? []
		if (
			prices.some(price => price.target === CatalogPriceListPriceTarget.VARIANT)
		) {
			await this.capabilities.assertCanUseProductVariants(catalogId)
		}
		if (
			prices.some(price => price.target === CatalogPriceListPriceTarget.SALE_UNIT)
		) {
			await this.capabilities.assertCanUseCatalogSaleUnits(catalogId)
		}
	}

	async setActivePriceList(
		dto: SetActivePriceListDtoReq
	): Promise<ActiveCatalogPriceListDto> {
		const scope = await this.resolveScope()
		await this.capabilities.assertCanUseCatalogPriceLists(scope.catalogId)
		const activePriceListId =
			normalizeNullableTrimmedString(dto.activePriceListId) ?? null

		if (activePriceListId) {
			const priceList = await this.repo.findById(
				activePriceListId,
				scope.ownerCatalogId
			)
			if (!priceList?.isActive || priceList.deleteAt) {
				throw new BadRequestException(
					'Прайс-лист недоступен для выбранного каталога'
				)
			}
		}

		await this.prisma.catalogSettings.upsert({
			where: { catalogId: scope.catalogId },
			update: { activePriceListId },
			create: { catalogId: scope.catalogId, activePriceListId }
		})
		await this.invalidateCurrentCatalogAndProductReadCaches(scope.catalogId)
		return { activePriceListId }
	}

	private async normalizePrices(
		catalogId: string,
		dto: BulkUpsertCatalogPriceListPricesDtoReq
	): Promise<NormalizedPriceInput[]> {
		const input = dto.prices ?? []
		const seen = new Set<string>()
		const productTargetIds: string[] = []
		const variantTargetIds: string[] = []
		const saleUnitTargetIds: string[] = []

		for (const item of input) {
			const targetId = item.targetId?.trim()
			if (!targetId) {
				throw new BadRequestException('Не указан идентификатор цены')
			}
			const key = `${item.target}:${targetId}`
			if (seen.has(key)) {
				throw new BadRequestException('Целевая цена дублируется')
			}
			seen.add(key)

			if (item.target === CatalogPriceListPriceTarget.PRODUCT) {
				productTargetIds.push(targetId)
			}
			if (item.target === CatalogPriceListPriceTarget.VARIANT) {
				variantTargetIds.push(targetId)
			}
			if (item.target === CatalogPriceListPriceTarget.SALE_UNIT) {
				saleUnitTargetIds.push(targetId)
			}
		}

		const [products, variants, saleUnits] = await Promise.all([
			this.prisma.product.findMany({
				where: {
					id: { in: productTargetIds },
					catalogId,
					deleteAt: null
				},
				select: { id: true }
			}),
			this.prisma.productVariant.findMany({
				where: {
					id: { in: variantTargetIds },
					deleteAt: null,
					product: { catalogId, deleteAt: null }
				},
				select: { id: true, productId: true }
			}),
			this.prisma.productVariantSaleUnit.findMany({
				where: {
					id: { in: saleUnitTargetIds },
					deleteAt: null,
					variant: { product: { catalogId, deleteAt: null } }
				},
				select: this.saleUnitIdentitySelect()
			})
		])

		const productsById = new Map(products.map(product => [product.id, product]))
		const variantsById = new Map(variants.map(variant => [variant.id, variant]))
		const saleUnitsById = new Map(
			saleUnits.map(saleUnit => [saleUnit.id, saleUnit])
		)
		await this.mapDetachedSaleUnitTargetsToCurrentUnits(
			catalogId,
			saleUnitTargetIds,
			saleUnitsById
		)

		return input.map(item => {
			const targetId = item.targetId.trim()
			const price = this.normalizePrice(item.price)

			if (item.target === CatalogPriceListPriceTarget.PRODUCT) {
				const product = productsById.get(targetId)
				if (!product) {
					throw new BadRequestException('Товар не принадлежит каталогу')
				}
				return {
					target: item.target,
					targetId,
					productId: product.id,
					variantId: null,
					saleUnitId: null,
					price
				}
			}

			if (item.target === CatalogPriceListPriceTarget.VARIANT) {
				const variant = variantsById.get(targetId)
				if (!variant) {
					throw new BadRequestException('Вариация не принадлежит каталогу')
				}
				return {
					target: item.target,
					targetId,
					productId: variant.productId,
					variantId: variant.id,
					saleUnitId: null,
					price
				}
			}

			const saleUnit = saleUnitsById.get(targetId)
			if (!saleUnit) {
				throw new BadRequestException('Единица продажи не принадлежит каталогу')
			}
			return {
				target: item.target,
				targetId: saleUnit.id,
				productId: saleUnit.variant.productId,
				variantId: saleUnit.variantId,
				saleUnitId: saleUnit.id,
				price
			}
		})
	}

	private async mapDetachedSaleUnitTargetsToCurrentUnits(
		catalogId: string,
		targetIds: string[],
		saleUnitsById: Map<string, SaleUnitIdentity>
	): Promise<void> {
		const missingIds = [...new Set(targetIds)].filter(
			id => !saleUnitsById.has(id)
		)
		if (!missingIds.length) return

		const detachedSaleUnits = await this.prisma.productVariantSaleUnit.findMany({
			where: {
				id: { in: missingIds },
				variant: { product: { catalogId, deleteAt: null } }
			},
			select: this.saleUnitIdentitySelect()
		})
		if (!detachedSaleUnits.length) return

		const currentSaleUnits = await this.prisma.productVariantSaleUnit.findMany({
			where: {
				deleteAt: null,
				variant: {
					productId: {
						in: [...new Set(detachedSaleUnits.map(unit => unit.variant.productId))]
					},
					deleteAt: null,
					product: { catalogId, deleteAt: null }
				}
			},
			select: this.saleUnitIdentitySelect()
		})
		const currentByIdentity = this.buildSaleUnitIdentityMap(currentSaleUnits)

		for (const detachedSaleUnit of detachedSaleUnits) {
			for (const key of this.buildSaleUnitIdentityKeys(detachedSaleUnit)) {
				const current = currentByIdentity.get(key)
				if (!current) continue
				saleUnitsById.set(detachedSaleUnit.id, current)
				break
			}
		}
	}

	private saleUnitIdentitySelect(): Prisma.ProductVariantSaleUnitSelect {
		return {
			id: true,
			variantId: true,
			catalogSaleUnitId: true,
			code: true,
			name: true,
			baseQuantity: true,
			variant: { select: { productId: true, variantKey: true } }
		}
	}

	private buildSaleUnitIdentityMap<T extends SaleUnitIdentity>(
		saleUnits: T[]
	): Map<string, T> {
		const map = new Map<string, T>()
		for (const saleUnit of saleUnits) {
			for (const key of this.buildSaleUnitIdentityKeys(saleUnit)) {
				if (!map.has(key)) map.set(key, saleUnit)
			}
		}
		return map
	}

	private buildSaleUnitIdentityKeys(saleUnit: SaleUnitIdentity): string[] {
		const keys = [`id:${saleUnit.id}`]
		const variantId = saleUnit.variantId
		const productId = saleUnit.variant.productId
		const variantKey = this.normalizeIdentityValue(saleUnit.variant.variantKey)
		const code = this.normalizeIdentityValue(saleUnit.code)
		const name = this.normalizeIdentityValue(saleUnit.name)
		const quantity = this.normalizeQuantityKey(saleUnit.baseQuantity)

		if (saleUnit.catalogSaleUnitId) {
			keys.push(`catalog:${variantId}:${saleUnit.catalogSaleUnitId}`)
			if (variantKey) {
				keys.push(
					`catalog-key:${productId}:${variantKey}:${saleUnit.catalogSaleUnitId}`
				)
			}
		}
		if (code) {
			keys.push(`code:${variantId}:${code}`)
			if (variantKey) {
				keys.push(`code-key:${productId}:${variantKey}:${code}`)
			}
		}
		if (name && quantity) {
			keys.push(`name:${variantId}:${name}:${quantity}`)
			if (variantKey) {
				keys.push(`name-key:${productId}:${variantKey}:${name}:${quantity}`)
			}
		}

		return keys
	}

	private normalizeIdentityValue(value: unknown): string {
		return this.stringifyIdentityValue(value).trim().toLowerCase()
	}

	private normalizeQuantityKey(value: unknown): string {
		const parsed = this.readFiniteIdentityNumber(value)
		return Number.isFinite(parsed)
			? parsed.toFixed(4)
			: this.normalizeIdentityValue(value)
	}

	private readFiniteIdentityNumber(value: unknown): number {
		const parsed = Number(this.stringifyIdentityValue(value).trim())
		return Number.isFinite(parsed) ? parsed : Number.NaN
	}

	private stringifyIdentityValue(value: unknown): string {
		if (value === null || value === undefined) return ''
		if (typeof value === 'string') return value
		if (
			typeof value === 'number' ||
			typeof value === 'boolean' ||
			typeof value === 'bigint'
		) {
			return String(value)
		}
		if (value instanceof Date) return value.toISOString()
		if (typeof value === 'object') {
			const candidate = value as { toString?: () => string }
			if (
				typeof candidate.toString === 'function' &&
				candidate.toString !== Object.prototype.toString
			) {
				return candidate.toString()
			}
		}
		return ''
	}

	private normalizePrice(value: unknown): number | null {
		if (value === null || value === undefined || value === '') return null
		const parsed = Number(value)
		if (!Number.isFinite(parsed) || parsed < 0) {
			throw new BadRequestException('Цена должна быть больше или равна 0')
		}
		return Number(parsed.toFixed(2))
	}

	private async resolveScope(): Promise<CatalogScope> {
		const catalogId = mustCatalogId()
		const catalog = await this.repo.findCatalogContext(catalogId)
		if (!catalog) throw new NotFoundException('Каталог не найден')
		return {
			catalogId: catalog.id,
			ownerCatalogId: catalog.parentId ?? catalog.id,
			isChild: Boolean(catalog.parentId)
		}
	}

	private assertMainCatalog(scope: CatalogScope): void {
		if (!scope.isChild) return
		throw new ForbiddenException(
			'Управлять прайс-листами может только родительский каталог'
		)
	}

	private async invalidateProductReadCaches(catalogId: string): Promise<void> {
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
	}

	private async invalidateCurrentCatalogAndProductReadCaches(
		catalogId: string
	): Promise<void> {
		await Promise.all([
			this.cache.bumpVersion(CATALOG_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
		])
	}

	private mapPriceList(priceList: CatalogPriceListRecord): CatalogPriceListDto {
		return {
			id: priceList.id,
			catalogId: priceList.catalogId,
			code: priceList.code,
			name: priceList.name,
			description: priceList.description,
			isActive: priceList.isActive,
			displayOrder: priceList.displayOrder,
			deleteAt: priceList.deleteAt?.toISOString() ?? null
		}
	}

	private mapPrice(
		price: CatalogPriceListPriceRecord
	): CatalogPriceListPriceDto {
		return {
			id: price.id,
			priceListId: price.priceListId,
			target: price.target,
			targetId: price.targetId,
			productId: price.productId,
			variantId: price.variantId,
			saleUnitId: price.saleUnitId,
			price: toDecimalString(price.price),
			deleteAt: price.deleteAt?.toISOString() ?? null
		}
	}

	private requirePriceList(
		priceList: CatalogPriceListRecord | null
	): CatalogPriceListRecord {
		if (!priceList) throw new NotFoundException('Прайс-лист не найден')
		return priceList
	}

	private requireUpdatedPriceList(
		records: CatalogPriceListRecord[]
	): CatalogPriceListRecord {
		return this.requirePriceList(records[0] ?? null)
	}
}
