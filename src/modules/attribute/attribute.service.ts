import { DataType } from '@generated/enums'
import {
	AttributeCreateInput,
	AttributeEnumValueCreateInput,
	AttributeEnumValueUpdateInput
} from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CURRENT_CACHE_TTL_SEC,
	CATALOG_TYPE_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { assertHasUpdateFields } from '@/shared/utils'

import { AttributeRepository } from './attribute.repository'
import {
	applyAttributeSuffix,
	ATTRIBUTE_KEY_MAX_LENGTH,
	buildAttributeCreateInput,
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
import { CreateAttributeEnumDtoReq } from './dto/requests/create-attribute-enum.dto.req'
import { CreateAttributeDtoReq } from './dto/requests/create-attribute.dto.req'
import { UpdateAttributeEnumDtoReq } from './dto/requests/update-attribute-enum.dto.req'
import { UpdateAttributeDtoReq } from './dto/requests/update-attribute.dto.req'

@Injectable()
export class AttributeService {
	private readonly cacheTtlSec = CATALOG_CURRENT_CACHE_TTL_SEC

	constructor(
		private readonly repo: AttributeRepository,
		private readonly cache: CacheService
	) {}

	async getByType(typeId: string) {
		const attributes = await this.repo.findByType(typeId, true)
		return attributes.map(attribute => mapAttributeWithTypeIds(attribute))
	}

	async getById(id: string) {
		const attribute = await this.requireAttribute(id, true)
		return mapAttributeWithTypeIds(attribute)
	}

	async create(dto: CreateAttributeDtoReq) {
		ensureVariantAttributeRules(dto.dataType, dto.isVariantAttribute)
		const typeIds = normalizeAttributeTypeIds(dto.typeIds, dto.typeId)
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
		return this.repo.findEnumValues(attributeId)
	}

	async createEnumValue(attributeId: string, dto: CreateAttributeEnumDtoReq) {
		const attribute = await this.requireEnumAttribute(attributeId)

		const value = dto.value
			? normalizeAttributeEnumValue(dto.value)
			: await this.generateEnumValue(attributeId, dto.displayName)

		const data: AttributeEnumValueCreateInput =
			buildAttributeEnumValueCreateInput(attributeId, dto, value)
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

		const data: AttributeEnumValueUpdateInput =
			buildAttributeEnumValueUpdateInput(dto)
		assertHasUpdateFields(data)

		const enumValue = await this.repo.updateEnumValue(id, attributeId, data)
		if (!enumValue)
			throw new NotFoundException('Значение перечисления не найдено')

		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return enumValue
	}

	async removeEnumValue(attributeId: string, id: string) {
		const attribute = await this.requireEnumAttribute(attributeId)

		const enumValue = await this.repo.softDeleteEnumValue(id, attributeId)
		if (!enumValue)
			throw new NotFoundException('Значение перечисления не найдено')

		await this.invalidateTypeCache(getAttributeTypeIds(attribute))
		return { ok: true }
	}

	private async requireEnumAttribute(attributeId: string) {
		const attribute = await this.requireAttribute(attributeId)
		if (attribute.dataType !== DataType.ENUM) {
			throw new BadRequestException('Атрибут не типа ENUM')
		}
		return attribute
	}

	private async requireAttribute(id: string, withEnums = false) {
		const attribute = await this.repo.findById(id, withEnums)
		if (!attribute) throw new NotFoundException('Атрибут не найден')
		return attribute
	}

	private async invalidateTypeCache(typeIds: string[]): Promise<void> {
		if (!this.cacheTtlSec) return
		const unique = Array.from(new Set(typeIds)).filter(Boolean)
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
		displayName?: string
	): Promise<string> {
		const label = displayName?.trim()
		if (!label) {
			throw new BadRequestException(
				'Нужно указать value или displayName для перечисления'
			)
		}

		const base = buildEnumValueBase(label)
		return this.ensureUniqueKey(base, ENUM_VALUE_MAX_LENGTH, value =>
			this.repo.existsEnumValue(attributeId, value)
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
}
