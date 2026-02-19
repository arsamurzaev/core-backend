import { DataType } from '@generated/enums'
import {
	AttributeCreateInput,
	AttributeEnumValueCreateInput,
	AttributeEnumValueUpdateInput,
	AttributeUpdateInput
} from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import slugify from 'slugify'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CURRENT_CACHE_TTL_SEC,
	CATALOG_TYPE_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'

import { AttributeRepository } from './attribute.repository'
import { CreateAttributeEnumDtoReq } from './dto/requests/create-attribute-enum.dto.req'
import { CreateAttributeDtoReq } from './dto/requests/create-attribute.dto.req'
import { UpdateAttributeEnumDtoReq } from './dto/requests/update-attribute-enum.dto.req'
import { UpdateAttributeDtoReq } from './dto/requests/update-attribute.dto.req'

function normalizeKey(value: string): string {
	return value.trim().toLowerCase()
}

function normalizeLabel(value: string): string {
	return value.trim()
}

function normalizeEnumValue(value: string): string {
	return value.trim().toLowerCase()
}

const ATTRIBUTE_KEY_MAX_LENGTH = 100
const ENUM_VALUE_MAX_LENGTH = 255
const ATTRIBUTE_KEY_FALLBACK = 'attr'
const ENUM_VALUE_FALLBACK = 'value'

function buildKeyFromLabel(value: string): string {
	const slug = slugify(value, { lower: true, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

function applySuffix(base: string, suffix: number, maxLength: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, maxLength - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

@Injectable()
export class AttributeService {
	private readonly cacheTtlSec = CATALOG_CURRENT_CACHE_TTL_SEC

	constructor(
		private readonly repo: AttributeRepository,
		private readonly cache: CacheService
	) {}

	async getByType(typeId: string) {
		const attributes = await this.repo.findByType(typeId, true)
		return attributes.map(attribute => this.mapAttribute(attribute))
	}

	async getById(id: string) {
		const attribute = await this.repo.findById(id, true)
		if (!attribute) throw new NotFoundException('Атрибут не найден')
		return this.mapAttribute(attribute)
	}

	async create(dto: CreateAttributeDtoReq) {
		this.ensureVariantRules(dto.dataType, dto.isVariantAttribute)
		const typeIds = this.normalizeTypeIds(dto.typeIds, dto.typeId)

		const key = dto.key
			? normalizeKey(dto.key)
			: await this.generateAttributeKey(typeIds, dto.displayName)
		if (dto.key) {
			const exists = await this.repo.existsKeyInTypes(typeIds, key)
			if (exists) {
				throw new BadRequestException(
					'Ключ атрибута уже используется в выбранном типе'
				)
			}
		}

		const data: AttributeCreateInput = {
			key,
			displayName: normalizeLabel(dto.displayName),
			dataType: dto.dataType,
			isRequired: dto.isRequired ?? false,
			isVariantAttribute: dto.isVariantAttribute ?? false,
			isFilterable: dto.isFilterable ?? false,
			displayOrder: dto.displayOrder ?? 0,
			isHidden: dto.isHidden ?? false,
			types: {
				connect: typeIds.map(typeId => ({ id: typeId }))
			}
		}

		const attribute = await this.repo.create(data)
		await this.invalidateTypeCache(typeIds)
		return this.mapAttribute(attribute)
	}

	async update(id: string, dto: UpdateAttributeDtoReq) {
		const data: AttributeUpdateInput = {}
		const nextTypeIds =
			dto.typeIds !== undefined ? this.normalizeTypeIds(dto.typeIds) : undefined

		const nextKey = dto.key !== undefined ? normalizeKey(dto.key) : undefined
		if (nextKey !== undefined) {
			data.key = nextKey
		}
		if (dto.displayName !== undefined) {
			data.displayName = normalizeLabel(dto.displayName)
		}
		if (dto.dataType !== undefined) {
			data.dataType = dto.dataType
		}
		if (dto.isRequired !== undefined) {
			data.isRequired = dto.isRequired
		}
		if (dto.isVariantAttribute !== undefined) {
			data.isVariantAttribute = dto.isVariantAttribute
		}
		if (dto.isFilterable !== undefined) {
			data.isFilterable = dto.isFilterable
		}
		if (dto.displayOrder !== undefined) {
			data.displayOrder = dto.displayOrder
		}
		if (dto.isHidden !== undefined) {
			data.isHidden = dto.isHidden
		}

		if (Object.keys(data).length === 0 && nextTypeIds === undefined) {
			throw new BadRequestException('Нет полей для обновления')
		}

		const current = await this.repo.findById(id)
		if (!current) throw new NotFoundException('Атрибут не найден')

		const currentTypeIds = current.types?.map(type => type.id) ?? []
		const finalTypeIds = nextTypeIds ?? currentTypeIds

		if (nextKey !== undefined || nextTypeIds !== undefined) {
			const keyToCheck = nextKey ?? current.key
			const exists = await this.repo.existsKeyInTypes(finalTypeIds, keyToCheck, id)
			if (exists) {
				throw new BadRequestException(
					'Ключ атрибута уже используется в выбранном типе'
				)
			}
		}

		if (dto.dataType !== undefined || dto.isVariantAttribute !== undefined) {
			const nextType = dto.dataType ?? current.dataType
			const nextVariant = dto.isVariantAttribute ?? current.isVariantAttribute

			this.ensureVariantRules(nextType, nextVariant)
		}

		const attribute = await this.repo.update(id, data, nextTypeIds)
		if (!attribute) throw new NotFoundException('Атрибут не найден')

		const updatedTypeIds = attribute.types?.map(type => type.id) ?? finalTypeIds
		await this.invalidateTypeCache(
			Array.from(new Set([...currentTypeIds, ...updatedTypeIds]))
		)
		return this.mapAttribute(attribute)
	}

	async remove(id: string) {
		const attribute = await this.repo.softDelete(id)
		if (!attribute) throw new NotFoundException('Атрибут не найден')

		await this.invalidateTypeCache(attribute.types?.map(type => type.id) ?? [])
		return { ok: true }
	}

	async getEnumValues(attributeId: string) {
		await this.requireEnumAttribute(attributeId)
		return this.repo.findEnumValues(attributeId)
	}

	async createEnumValue(attributeId: string, dto: CreateAttributeEnumDtoReq) {
		const attribute = await this.requireEnumAttribute(attributeId)

		const value = dto.value
			? normalizeEnumValue(dto.value)
			: await this.generateEnumValue(attributeId, dto.displayName)

		const data: AttributeEnumValueCreateInput = {
			value,
			displayName:
				dto.displayName === undefined ? null : normalizeLabel(dto.displayName),
			displayOrder: dto.displayOrder ?? 0,
			businessId: dto.businessId?.trim() || null,
			attribute: { connect: { id: attributeId } }
		}

		const enumValue = await this.repo.createEnumValue(data)
		await this.invalidateTypeCache(attribute.types?.map(type => type.id) ?? [])
		return enumValue
	}

	async updateEnumValue(
		attributeId: string,
		id: string,
		dto: UpdateAttributeEnumDtoReq
	) {
		const attribute = await this.requireEnumAttribute(attributeId)

		const data: AttributeEnumValueUpdateInput = {}

		if (dto.value !== undefined) {
			data.value = normalizeEnumValue(dto.value)
		}
		if (dto.displayName !== undefined) {
			data.displayName = normalizeLabel(dto.displayName)
		}
		if (dto.displayOrder !== undefined) {
			data.displayOrder = dto.displayOrder
		}
		if (dto.businessId !== undefined) {
			data.businessId = dto.businessId?.trim() || null
		}

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('Нет полей для обновления')
		}

		const enumValue = await this.repo.updateEnumValue(id, attributeId, data)
		if (!enumValue)
			throw new NotFoundException('Значение перечисления не найдено')

		await this.invalidateTypeCache(attribute.types?.map(type => type.id) ?? [])
		return enumValue
	}

	async removeEnumValue(attributeId: string, id: string) {
		const attribute = await this.requireEnumAttribute(attributeId)

		const enumValue = await this.repo.softDeleteEnumValue(id, attributeId)
		if (!enumValue)
			throw new NotFoundException('Значение перечисления не найдено')

		await this.invalidateTypeCache(attribute.types?.map(type => type.id) ?? [])
		return { ok: true }
	}

	private ensureVariantRules(dataType: DataType, isVariantAttribute?: boolean) {
		if (isVariantAttribute && dataType !== DataType.ENUM) {
			throw new BadRequestException('Вариантные атрибуты должны иметь тип ENUM')
		}
	}

	private async requireEnumAttribute(attributeId: string) {
		const attribute = await this.repo.findById(attributeId)
		if (!attribute) throw new NotFoundException('Атрибут не найден')
		if (attribute.dataType !== DataType.ENUM) {
			throw new BadRequestException('Атрибут не типа ENUM')
		}
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
		const base = buildKeyFromLabel(displayName) || ATTRIBUTE_KEY_FALLBACK
		return this.ensureUniqueKey(base, ATTRIBUTE_KEY_MAX_LENGTH, key =>
			this.repo.existsKeyInTypes(typeIds, key)
		)
	}

	private normalizeTypeIds(typeIds?: string[], typeId?: string): string[] {
		const list = [...(typeIds ?? []), ...(typeId ? [typeId] : [])].map(value =>
			String(value).trim()
		)
		const unique = Array.from(new Set(list)).filter(Boolean)
		if (!unique.length) {
			throw new BadRequestException('Нужно указать typeIds или typeId')
		}
		return unique
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

		const base = buildKeyFromLabel(label) || ENUM_VALUE_FALLBACK
		return this.ensureUniqueKey(base, ENUM_VALUE_MAX_LENGTH, value =>
			this.repo.existsEnumValue(attributeId, value)
		)
	}

	private mapAttribute<T extends { types?: { id: string }[] }>(attribute: T) {
		const attributeWithTypes = attribute as T & { types?: { id: string }[] }
		const typeIds = attributeWithTypes.types?.map(type => type.id) ?? []
		const rest = { ...attributeWithTypes }
		delete (rest as { types?: { id: string }[] }).types
		return { ...rest, typeIds }
	}

	private async ensureUniqueKey(
		base: string,
		maxLength: number,
		exists: (candidate: string) => Promise<boolean>
	): Promise<string> {
		const normalizedBase = base
		let candidate = applySuffix(normalizedBase, 0, maxLength)
		let suffix = 1

		while (await exists(candidate)) {
			candidate = applySuffix(normalizedBase, suffix, maxLength)
			suffix += 1
		}

		return candidate
	}
}
