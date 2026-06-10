import { AttributeEnumValueSource, DataType } from '@generated/enums'
import {
	AttributeCreateInput,
	AttributeEnumValueCreateInput,
	AttributeEnumValueUpdateInput
} from '@generated/models'
import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException,
	Optional
} from '@nestjs/common'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CURRENT_CACHE_TTL_SEC,
	CATALOG_TYPE_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'
import { RequestContext } from '@/shared/tenancy/request-context'
import { assertHasUpdateFields } from '@/shared/utils'

import { AttributeRepository } from './attribute.repository'
import {
	applyAttributeSuffix,
	ATTRIBUTE_KEY_MAX_LENGTH,
	buildAttributeCreateInput,
	buildAttributeEnumValueAliasCreateInput,
	buildAttributeEnumValueCreateInput,
	buildAttributeEnumValueUpdateInput,
	buildAttributeKeyBase,
	buildAttributeUpdateInput,
	buildEnumValueBase,
	ensureVariantAttributeRules,
	ENUM_VALUE_MAX_LENGTH,
	getAttributeTypeIds,
	mapAttributeWithTypeIds,
	mergeUniqueTypeIds,
	normalizeAttributeEnumValue,
	normalizeAttributeKey,
	normalizeAttributeTypeIds
} from './attribute.utils'
import { CreateAttributeEnumAliasDtoReq } from './dto/requests/create-attribute-enum-alias.dto.req'
import { CreateAttributeEnumDtoReq } from './dto/requests/create-attribute-enum.dto.req'
import { CreateAttributeDtoReq } from './dto/requests/create-attribute.dto.req'
import { MergeAttributeEnumValuesDtoReq } from './dto/requests/merge-attribute-enum-values.dto.req'
import { UpdateAttributeEnumDtoReq } from './dto/requests/update-attribute-enum.dto.req'
import { UpdateAttributeDtoReq } from './dto/requests/update-attribute.dto.req'

@Injectable()
export class AttributeService {
	private readonly cacheTtlSec = CATALOG_CURRENT_CACHE_TTL_SEC

	constructor(
		private readonly repo: AttributeRepository,
		private readonly cache: CacheService,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	async getByType(typeId: string) {
		const attributes = await this.repo.findByType(
			typeId,
			true,
			this.currentCatalogId()
		)
		return attributes.map(attribute => mapAttributeWithTypeIds(attribute))
	}

	async getById(id: string) {
		const attribute = await this.requireAttribute(id, true)
		return mapAttributeWithTypeIds(attribute)
	}

	async create(dto: CreateAttributeDtoReq) {
		ensureVariantAttributeRules(dto.dataType, dto.isVariantAttribute)
		const typeIds = normalizeAttributeTypeIds(dto.typeIds, dto.typeId)
		await this.ensureAttributeTypesExist(typeIds)
		const key = dto.key
			? normalizeAttributeKey(dto.key)
			: await this.generateAttributeKey(typeIds, dto.displayName)
		if (dto.key) await this.ensureAttributeKeyAvailable(typeIds, key)

		const data: AttributeCreateInput = buildAttributeCreateInput(
			dto,
			typeIds,
			key
		)
		const attribute = await this.repo.create(data)
		await this.invalidateTypeCache(typeIds)
		return mapAttributeWithTypeIds(attribute)
	}

	async update(id: string, dto: UpdateAttributeDtoReq) {
		const { data, nextKey, nextTypeIds } = buildAttributeUpdateInput(dto)

		if (nextTypeIds === undefined) {
			assertHasUpdateFields(data)
		}

		const current = await this.requireAttribute(id)
		const currentTypeIds = getAttributeTypeIds(current)
		const finalTypeIds = nextTypeIds ?? currentTypeIds

		if (nextKey !== undefined || nextTypeIds !== undefined) {
			const keyToCheck = nextKey ?? current.key
			await this.ensureAttributeKeyAvailable(finalTypeIds, keyToCheck, id)
		}

		if (dto.dataType !== undefined || dto.isVariantAttribute !== undefined) {
			const nextType = dto.dataType ?? current.dataType
			const nextVariant = dto.isVariantAttribute ?? current.isVariantAttribute

			ensureVariantAttributeRules(nextType, nextVariant)
		}

		const attribute = await this.repo.update(id, data, nextTypeIds)
		if (!attribute) throw new NotFoundException('Атрибут не найден')

		const updatedTypeIds = getAttributeTypeIds(attribute)
		await this.invalidateTypeCache(
			mergeUniqueTypeIds(
				currentTypeIds,
				updatedTypeIds.length ? updatedTypeIds : finalTypeIds
			)
		)
		return mapAttributeWithTypeIds(attribute)
	}

	async remove(id: string) {
		const attribute = await this.repo.softDelete(id)
		if (!attribute) throw new NotFoundException('Атрибут не найден')

		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return { ok: true }
	}

	async getEnumValues(attributeId: string) {
		await this.requireEnumAttribute(attributeId)
		return this.repo.findEnumValues(attributeId, this.currentCatalogId())
	}

	async createEnumValue(attributeId: string, dto: CreateAttributeEnumDtoReq) {
		const attribute = await this.requireEnumAttribute(attributeId)
		const catalogId = this.currentCatalogId()

		const value = dto.value
			? normalizeAttributeEnumValue(dto.value)
			: await this.generateEnumValue(attributeId, dto.displayName, catalogId)
		await this.ensureEnumValueAvailable(attributeId, value, undefined, catalogId)

		const data: AttributeEnumValueCreateInput =
			buildAttributeEnumValueCreateInput(attributeId, dto, value, catalogId)
		const enumValue = await this.repo.createEnumValue(data)
		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return enumValue
	}

	async updateEnumValue(
		attributeId: string,
		id: string,
		dto: UpdateAttributeEnumDtoReq
	) {
		const attribute = await this.requireEnumAttribute(attributeId)
		const catalogId = this.currentCatalogId()

		const data: AttributeEnumValueUpdateInput =
			buildAttributeEnumValueUpdateInput(dto)
		assertHasUpdateFields(data)
		const currentEnumValue = await this.requireEnumValue(attributeId, id)
		this.assertImportedEnumValueUpdateAllowed(currentEnumValue, dto)
		if (dto.value !== undefined) {
			await this.ensureEnumValueAvailable(
				attributeId,
				normalizeAttributeEnumValue(dto.value),
				id,
				catalogId
			)
		}

		const enumValue = await this.repo.updateEnumValue(
			id,
			attributeId,
			data,
			catalogId
		)
		if (!enumValue)
			throw new NotFoundException('Значение перечисления не найдено')

		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return enumValue
	}

	async removeEnumValue(attributeId: string, id: string) {
		const attribute = await this.requireEnumAttribute(attributeId)
		const currentEnumValue = await this.requireEnumValue(attributeId, id)
		this.assertEnumValueIsNotImported(currentEnumValue)

		const enumValue = await this.repo.softDeleteEnumValue(
			id,
			attributeId,
			this.currentCatalogId()
		)
		if (!enumValue)
			throw new NotFoundException('Значение перечисления не найдено')

		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return { ok: true }
	}

	async getEnumValueAliases(attributeId: string, id: string) {
		await this.requireEnumAttribute(attributeId)
		await this.requireEnumValue(attributeId, id)
		return this.repo.findEnumValueAliases(
			attributeId,
			id,
			this.currentCatalogId()
		)
	}

	async createEnumValueAlias(
		attributeId: string,
		id: string,
		dto: CreateAttributeEnumAliasDtoReq
	) {
		const attribute = await this.requireEnumAttribute(attributeId)
		const currentEnumValue = await this.requireEnumValue(attributeId, id)
		this.assertEnumValueIsNotImported(currentEnumValue)
		const catalogId = this.currentCatalogId()

		const value = normalizeAttributeEnumValue(dto.value)
		await this.ensureEnumValueAvailable(attributeId, value, undefined, catalogId)

		const alias = await this.repo.createEnumValueAlias(
			buildAttributeEnumValueAliasCreateInput(
				attributeId,
				id,
				dto,
				value,
				catalogId
			)
		)
		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return alias
	}

	async removeEnumValueAlias(attributeId: string, id: string, aliasId: string) {
		const attribute = await this.requireEnumAttribute(attributeId)
		const currentEnumValue = await this.requireEnumValue(attributeId, id)
		this.assertEnumValueIsNotImported(currentEnumValue)

		const alias = await this.repo.softDeleteEnumValueAlias(
			attributeId,
			id,
			aliasId,
			this.currentCatalogId()
		)
		if (!alias) throw new NotFoundException('Alias not found')

		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return { ok: true }
	}

	async mergeEnumValues(
		attributeId: string,
		sourceId: string,
		dto: MergeAttributeEnumValuesDtoReq
	) {
		const attribute = await this.requireEnumAttribute(attributeId)
		if (sourceId === dto.targetId) {
			throw new BadRequestException('Source and target enum values must differ')
		}
		const sourceEnumValue = await this.requireEnumValue(attributeId, sourceId)
		const targetEnumValue = await this.requireEnumValue(attributeId, dto.targetId)
		this.assertEnumValueIsNotImported(sourceEnumValue)
		this.assertEnumValueIsNotImported(targetEnumValue)

		const enumValue = await this.repo.mergeEnumValues(
			attributeId,
			sourceId,
			dto.targetId,
			this.currentCatalogId()
		)
		if (!enumValue) {
			throw new NotFoundException('Enum value not found')
		}

		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return enumValue
	}

	private async requireEnumAttribute(attributeId: string) {
		const attribute = await this.requireAttribute(attributeId)
		if (attribute.dataType !== DataType.ENUM) {
			throw new BadRequestException('Атрибут не типа ENUM')
		}
		return attribute
	}

	private async requireAttribute(id: string, withEnums = false) {
		const attribute = await this.repo.findById(
			id,
			withEnums,
			this.currentCatalogId()
		)
		if (!attribute) throw new NotFoundException('Атрибут не найден')
		return attribute
	}

	private async requireEnumValue(attributeId: string, id: string) {
		const enumValue = await this.repo.findEnumValue(
			attributeId,
			id,
			this.currentCatalogId()
		)
		if (!enumValue) throw new NotFoundException('Enum value not found')
		return enumValue
	}

	private assertImportedEnumValueUpdateAllowed(
		enumValue: { source?: AttributeEnumValueSource | null },
		dto: UpdateAttributeEnumDtoReq
	): void {
		if (enumValue.source !== AttributeEnumValueSource.IMPORTED) return

		const forbiddenFields = [
			dto.value !== undefined ? 'value' : null,
			dto.businessId !== undefined ? 'businessId' : null,
			dto.source !== undefined ? 'source' : null
		].filter((field): field is string => field !== null)

		if (!forbiddenFields.length) return

		throw new BadRequestException(
			`Imported enum values are managed by integration; only displayName and displayOrder can be changed manually (${forbiddenFields.join(', ')})`
		)
	}

	private assertEnumValueIsNotImported(enumValue: {
		source?: AttributeEnumValueSource | null
	}): void {
		if (enumValue.source !== AttributeEnumValueSource.IMPORTED) return

		throw new BadRequestException(
			'Imported enum values are managed by integration; only displayName and displayOrder can be changed manually'
		)
	}

	private async invalidateTypeCache(typeIds: string[]): Promise<void> {
		if (!this.cacheTtlSec) return
		const unique = Array.from(new Set(typeIds)).filter(Boolean)
		if (this.events && unique.length) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'catalog.cache_invalidated',
					catalogId: this.currentCatalogId(),
					scopes: unique.map(typeId => ({
						name: 'catalog_type' as const,
						key: typeId
					}))
				})
			)
			return
		}

		await Promise.all(
			unique.map(typeId =>
				this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, typeId)
			)
		)
	}

	private async generateAttributeKey(
		typeIds: string[],
		displayName: string
	): Promise<string> {
		const base = buildAttributeKeyBase(displayName)
		return this.ensureUniqueKey(base, ATTRIBUTE_KEY_MAX_LENGTH, key =>
			this.repo.existsKeyInTypes(typeIds, key)
		)
	}

	private async generateEnumValue(
		attributeId: string,
		displayName?: string,
		catalogId?: string | null
	): Promise<string> {
		const label = displayName?.trim()
		if (!label) {
			throw new BadRequestException(
				'Нужно указать value или displayName для перечисления'
			)
		}

		const base = buildEnumValueBase(label)
		await this.ensureEnumValueAvailable(attributeId, base, undefined, catalogId)
		return this.ensureUniqueKey(base, ENUM_VALUE_MAX_LENGTH, value =>
			this.repo.existsEnumValue(attributeId, value, catalogId)
		)
	}

	private async ensureUniqueKey(
		base: string,
		maxLength: number,
		exists: (candidate: string) => Promise<boolean>
	): Promise<string> {
		let candidate = applyAttributeSuffix(base, 0, maxLength)
		let suffix = 1

		while (await exists(candidate)) {
			candidate = applyAttributeSuffix(base, suffix, maxLength)
			suffix += 1
		}

		return candidate
	}

	private async ensureAttributeKeyAvailable(
		typeIds: string[],
		key: string,
		excludeId?: string
	): Promise<void> {
		const exists = await this.repo.existsKeyInTypes(typeIds, key, excludeId)
		if (exists) {
			throw new BadRequestException(
				'Ключ атрибута уже используется в выбранном типе'
			)
		}
	}

	private async ensureAttributeTypesExist(typeIds: string[]): Promise<void> {
		const existingTypeIds = await this.repo.findExistingTypeIds(typeIds)
		const existing = new Set(existingTypeIds)
		const missing = typeIds.filter(typeId => !existing.has(typeId))
		if (!missing.length) return

		throw new BadRequestException({
			message:
				'Тип каталога для свойства не найден. Обновите страницу и попробуйте снова.',
			typeIds: missing
		})
	}

	private async ensureEnumValueAvailable(
		attributeId: string,
		value: string,
		excludeId?: string,
		catalogId?: string | null
	): Promise<void> {
		const duplicate = await this.repo.findEnumValueDuplicate(
			attributeId,
			value,
			excludeId,
			catalogId
		)
		if (!duplicate) return

		throw new BadRequestException({
			message: 'Enum value already exists or is used as alias',
			duplicate
		})
	}

	private currentCatalogId(): string | null {
		return RequestContext.get()?.catalogId ?? null
	}
}
