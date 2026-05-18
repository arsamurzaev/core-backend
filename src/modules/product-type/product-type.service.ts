import { DataType } from '@generated/enums'
import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	Optional
} from '@nestjs/common'

import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'
import { mustCatalogId, mustTypeId } from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeNullableTrimmedString
} from '@/shared/utils'

import { CreateProductTypeFromTemplateDtoReq } from './dto/requests/create-product-type-from-template.dto.req'
import { CreateProductTypeDtoReq } from './dto/requests/create-product-type.dto.req'
import { UpdateProductTypeDtoReq } from './dto/requests/update-product-type.dto.req'
import { ProductTypeScope } from './product-type.constants'
import {
	ProductTypeMatrixEditorSchemaRecord,
	ProductTypeRecord,
	ProductTypeRepository,
	ProductTypeUpdateData
} from './product-type.repository'
import {
	buildProductTypeCodeBase,
	generateUniqueProductTypeCode,
	NormalizedProductTypeAttribute,
	normalizeProductTypeAttributes,
	normalizeProductTypeCode,
	normalizeProductTypeName,
	ProductTypeAttributeInput
} from './product-type.utils'

@Injectable()
export class ProductTypeService {
	constructor(
		private readonly repo: ProductTypeRepository,
		private readonly cache: CacheService,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureEntitlements: CapabilityAssertPort,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	async getAll(options: { includeArchived?: boolean } = {}) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		return this.repo.findCatalogTypes(catalogId, options.includeArchived === true)
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		return this.requireProductType(
			await this.repo.findCatalogTypeById(id, catalogId)
		)
	}

	async getMatrixEditorSchema(id: string) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		const productType = this.requireProductType(
			await this.repo.findCatalogTypeMatrixEditorSchemaById(id, catalogId)
		)

		return this.mapMatrixEditorSchema(productType)
	}

	async getSystemTemplates(options: { includeArchived?: boolean } = {}) {
		return this.repo.findSystemTemplates(options.includeArchived === true)
	}

	async getSystemTemplateById(id: string) {
		return this.requireProductType(await this.repo.findSystemTemplateById(id))
	}

	async create(dto: CreateProductTypeDtoReq) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		const name = normalizeProductTypeName(dto.name)
		const code = await this.resolveCode(
			dto.code,
			name,
			ProductTypeScope.CATALOG,
			catalogId
		)
		const attributes = await this.prepareAttributes(dto.attributes, { catalogId })

		const productType = await this.repo.create({
			catalogId,
			scope: ProductTypeScope.CATALOG,
			code,
			name,
			description: normalizeNullableTrimmedString(dto.description) ?? null,
			attributes
		})
		await this.invalidateCatalogProductTypeDependents(catalogId)
		return productType
	}

	async createSystemTemplate(dto: CreateProductTypeDtoReq) {
		const name = normalizeProductTypeName(dto.name)
		const code = await this.resolveCode(
			dto.code,
			name,
			ProductTypeScope.SYSTEM_TEMPLATE,
			null
		)
		const attributes = await this.prepareAttributes(dto.attributes)

		return this.repo.create({
			scope: ProductTypeScope.SYSTEM_TEMPLATE,
			catalogId: null,
			code,
			name,
			description: normalizeNullableTrimmedString(dto.description) ?? null,
			attributes
		})
	}

	async createFromTemplate(
		templateId: string,
		dto: CreateProductTypeFromTemplateDtoReq
	) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		const template = this.requireProductType(
			await this.repo.findSystemTemplateById(templateId)
		)
		const name =
			dto.name !== undefined ? normalizeProductTypeName(dto.name) : template.name
		const code =
			dto.code !== undefined
				? await this.resolveCode(
						dto.code,
						name,
						ProductTypeScope.CATALOG,
						catalogId
					)
				: await this.generateCodeFromBase(
						dto.name ? buildProductTypeCodeBase(name) : template.code,
						ProductTypeScope.CATALOG,
						catalogId
					)
		const description =
			dto.description !== undefined
				? (normalizeNullableTrimmedString(dto.description) ?? null)
				: template.description
		const templateAttributes = template.attributes.map(attribute => ({
			attributeId: attribute.attributeId,
			isVariant: attribute.isVariant,
			isRequired: attribute.isRequired,
			displayOrder: attribute.displayOrder
		}))
		const attributes = await this.prepareAttributes(templateAttributes, {
			catalogId
		})

		const productType = await this.repo.create({
			catalogId,
			scope: ProductTypeScope.CATALOG,
			code,
			name,
			description,
			attributes
		})
		await this.invalidateCatalogProductTypeDependents(catalogId)
		return productType
	}

	async update(id: string, dto: UpdateProductTypeDtoReq) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		const current = this.requireProductType(
			await this.repo.findCatalogTypeById(id, catalogId)
		)
		const data = await this.buildUpdateData(
			dto,
			ProductTypeScope.CATALOG,
			catalogId,
			current
		)
		const attributes =
			dto.attributes !== undefined
				? await this.prepareAttributes(dto.attributes, { catalogId })
				: undefined

		this.assertHasProductTypeUpdate(data, attributes)
		if (
			attributes !== undefined &&
			this.isProductTypeSchemaShapeChanged(current.attributes, attributes)
		) {
			await this.assertCatalogTypeSchemaCanChange(id, catalogId, attributes)
		}
		const productType = this.requireProductType(
			await this.repo.updateCatalogType(id, catalogId, data, attributes)
		)
		await this.invalidateCatalogProductTypeDependents(catalogId)
		return productType
	}

	async updateSystemTemplate(id: string, dto: UpdateProductTypeDtoReq) {
		const current = this.requireProductType(
			await this.repo.findSystemTemplateById(id)
		)
		const data = await this.buildUpdateData(
			dto,
			ProductTypeScope.SYSTEM_TEMPLATE,
			null,
			current
		)
		const attributes =
			dto.attributes !== undefined
				? await this.prepareAttributes(dto.attributes)
				: undefined

		this.assertHasProductTypeUpdate(data, attributes)
		return this.requireProductType(
			await this.repo.updateSystemTemplate(id, data, attributes)
		)
	}

	async archive(id: string) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		const archived = await this.repo.archiveCatalogType(id, catalogId)
		if (!archived) throw new NotFoundException('Product type not found')
		await this.invalidateCatalogProductTypeDependents(catalogId)
		return { ok: true }
	}

	async archiveSystemTemplate(id: string) {
		const archived = await this.repo.archiveSystemTemplate(id)
		if (!archived) throw new NotFoundException('Product type template not found')
		return { ok: true }
	}

	private async buildUpdateData(
		dto: UpdateProductTypeDtoReq,
		scope: ProductTypeScope,
		catalogId: string | null,
		current: ProductTypeRecord
	): Promise<ProductTypeUpdateData> {
		const data: ProductTypeUpdateData = {}

		if (dto.code !== undefined) {
			data.code = await this.resolveCode(
				dto.code,
				current.name,
				scope,
				catalogId,
				current.id
			)
		}
		if (dto.name !== undefined) {
			data.name = normalizeProductTypeName(dto.name)
		}
		if (dto.description !== undefined) {
			data.description = normalizeNullableTrimmedString(dto.description) ?? null
		}
		if (dto.isActive !== undefined) {
			data.isActive = dto.isActive
		}

		return data
	}

	private async resolveCode(
		code: string | undefined,
		name: string,
		scope: ProductTypeScope,
		catalogId: string | null,
		excludeId?: string
	): Promise<string> {
		if (code !== undefined) {
			const normalized = normalizeProductTypeCode(code)
			await this.ensureCodeAvailable(scope, normalized, catalogId, excludeId)
			return normalized
		}

		return this.generateCodeFromBase(
			buildProductTypeCodeBase(name),
			scope,
			catalogId,
			excludeId
		)
	}

	private generateCodeFromBase(
		base: string,
		scope: ProductTypeScope,
		catalogId: string | null,
		excludeId?: string
	): Promise<string> {
		return generateUniqueProductTypeCode(base, code =>
			this.repo.existsCode(scope, code, { catalogId, excludeId })
		)
	}

	private async ensureCodeAvailable(
		scope: ProductTypeScope,
		code: string,
		catalogId: string | null,
		excludeId?: string
	): Promise<void> {
		const exists = await this.repo.existsCode(scope, code, {
			catalogId,
			excludeId
		})
		if (exists) throw new BadRequestException('Product type code already exists')
	}

	private async prepareAttributes(
		input?: ProductTypeAttributeInput[],
		options: { catalogId?: string } = {}
	): Promise<NormalizedProductTypeAttribute[]> {
		const attributes = normalizeProductTypeAttributes(input)
		if (!attributes.length) return attributes

		const catalogTypeId = options.catalogId
			? await this.requireCatalogTypeId(options.catalogId)
			: undefined
		const records = await this.repo.findAttributesByIds(
			attributes.map(attribute => attribute.attributeId),
			catalogTypeId
		)
		const recordById = new Map(
			records.map(attribute => [attribute.id, attribute])
		)
		const missing = attributes
			.map(attribute => attribute.attributeId)
			.filter(attributeId => !recordById.has(attributeId))

		if (missing.length) {
			throw new BadRequestException({
				message: options.catalogId
					? 'Attributes are not available for this catalog type'
					: 'Attributes not found',
				attributeIds: missing
			})
		}

		for (const attribute of attributes) {
			const record = recordById.get(attribute.attributeId)
			if (attribute.isVariant && record?.dataType !== DataType.ENUM) {
				throw new BadRequestException(
					'Variant product type attributes must use ENUM data type'
				)
			}
		}

		return attributes
	}

	private async requireCatalogTypeId(catalogId: string): Promise<string> {
		const catalog = await this.repo.findCatalog(catalogId)
		if (!catalog) throw new NotFoundException('Catalog not found')
		return catalog.typeId
	}

	private assertHasProductTypeUpdate(
		data: ProductTypeUpdateData,
		attributes?: NormalizedProductTypeAttribute[]
	): void {
		if (attributes !== undefined) return
		assertHasUpdateFields(data)
	}

	private async assertCatalogTypeSchemaCanChange(
		id: string,
		catalogId: string,
		attributes: NormalizedProductTypeAttribute[]
	): Promise<void> {
		const impact = await this.repo.getCatalogTypeSchemaUpdateImpact(
			id,
			catalogId,
			attributes
		)
		if (impact.boundProductCount === 0 || impact.conflictingProductCount === 0) {
			return
		}

		throw new ConflictException({
			message:
				'Product type attributes cannot be changed because existing products use the current schema',
			...impact
		})
	}

	private isProductTypeSchemaShapeChanged(
		currentAttributes: ProductTypeRecord['attributes'],
		nextAttributes: NormalizedProductTypeAttribute[]
	): boolean {
		const currentShape = this.buildSchemaShapeKey(
			currentAttributes.map(attribute => ({
				attributeId: attribute.attributeId,
				isVariant: attribute.isVariant,
				isRequired: attribute.isRequired
			}))
		)
		const nextShape = this.buildSchemaShapeKey(
			nextAttributes.map(attribute => ({
				attributeId: attribute.attributeId,
				isVariant: attribute.isVariant,
				isRequired: attribute.isRequired
			}))
		)
		return currentShape !== nextShape
	}

	private buildSchemaShapeKey(
		attributes: Pick<
			NormalizedProductTypeAttribute,
			'attributeId' | 'isRequired' | 'isVariant'
		>[]
	): string {
		return attributes
			.map(attribute => ({
				attributeId: attribute.attributeId,
				isRequired: Boolean(attribute.isRequired),
				isVariant: Boolean(attribute.isVariant)
			}))
			.sort((left, right) => left.attributeId.localeCompare(right.attributeId))
			.map(attribute =>
				[
					attribute.attributeId,
					attribute.isVariant ? 'variant' : 'product',
					attribute.isRequired ? 'required' : 'optional'
				].join(':')
			)
			.join('|')
	}

	private async invalidateCatalogProductTypeDependents(
		catalogId: string
	): Promise<void> {
		const typeId = mustTypeId()
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'catalog.cache_invalidated',
					catalogId,
					scopes: [
						{ name: 'catalog_products' },
						{ name: 'category_products' },
						{ name: 'catalog_type', key: typeId }
					]
				})
			)
			return
		}

		await Promise.all([
			this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId),
			this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, typeId)
		])
	}

	private mapMatrixEditorSchema(
		productType: ProductTypeMatrixEditorSchemaRecord
	) {
		const attributes = productType.attributes.map(attribute => ({
			productTypeId: attribute.productTypeId,
			attributeId: attribute.attributeId,
			key: attribute.attribute.key,
			displayName: attribute.attribute.displayName,
			dataType: attribute.attribute.dataType,
			isVariant: attribute.isVariant,
			isRequired: attribute.isRequired,
			isFilterable: attribute.attribute.isFilterable,
			isHidden: attribute.attribute.isHidden,
			displayOrder: attribute.displayOrder
		}))
		const enumValues = productType.attributes.flatMap(attribute => {
			if (attribute.attribute.dataType !== DataType.ENUM) return []

			const valuesByBusinessKey = new Map<
				string,
				(typeof attribute.attribute.enumValues)[number]
			>()
			for (const value of attribute.attribute.enumValues) {
				const key = `${value.attributeId}:${value.value}`
				const existing = valuesByBusinessKey.get(key)
				if (!existing || (!existing.catalogId && value.catalogId)) {
					valuesByBusinessKey.set(key, value)
				}
			}

			return [...valuesByBusinessKey.values()].map(value => ({
				id: value.id,
				attributeId: value.attributeId,
				catalogId: value.catalogId ?? null,
				value: value.value,
				displayName: value.displayName,
				displayOrder: value.displayOrder,
				businessId: value.businessId,
				source: value.source,
				mergedIntoId: value.mergedIntoId,
				isArchived: false,
				aliases: value.aliases.map(alias => ({
					id: alias.id,
					attributeId: alias.attributeId,
					catalogId: alias.catalogId ?? null,
					enumValueId: alias.enumValueId,
					value: alias.value,
					displayName: alias.displayName
				}))
			}))
		})

		return {
			type: {
				id: productType.id,
				catalogId: productType.catalogId,
				scope: productType.scope,
				code: productType.code,
				name: productType.name,
				description: productType.description,
				isActive: productType.isActive,
				isArchived: productType.isArchived,
				archivedAt: productType.archivedAt,
				createdAt: productType.createdAt,
				updatedAt: productType.updatedAt
			},
			attributes,
			variantAttributes: attributes.filter(attribute => attribute.isVariant),
			requiredAttributes: attributes.filter(attribute => attribute.isRequired),
			enumValues
		}
	}

	private requireProductType<T>(productType: T | null): T {
		if (!productType) throw new NotFoundException('Product type not found')
		return productType
	}
}
