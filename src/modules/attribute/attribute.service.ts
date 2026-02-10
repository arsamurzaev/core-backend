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

import {
	CATALOG_CURRENT_CACHE_TTL_SEC,
	CATALOG_TYPE_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { CacheService } from '@/shared/cache/cache.service'

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
		return this.repo.findByType(typeId, true)
	}

	async getById(id: string) {
		const attribute = await this.repo.findById(id, true)
		if (!attribute) throw new NotFoundException('Атрибут не найден')
		return attribute
	}

	async create(dto: CreateAttributeDtoReq) {
		this.ensureVariantRules(dto.dataType, dto.isVariantAttribute)

		const key = dto.key
			? normalizeKey(dto.key)
			: await this.generateAttributeKey(dto.typeId, dto.displayName)

		const data: AttributeCreateInput = {
			key,
			displayName: normalizeLabel(dto.displayName),
			dataType: dto.dataType,
			isRequired: dto.isRequired ?? false,
			isVariantAttribute: dto.isVariantAttribute ?? false,
			isFilterable: dto.isFilterable ?? false,
			displayOrder: dto.displayOrder ?? 0,
			type: { connect: { id: dto.typeId } }
		}

		const attribute = await this.repo.create(data)
		await this.invalidateTypeCache(attribute.typeId)
		return attribute
	}

	async update(id: string, dto: UpdateAttributeDtoReq) {
		const data: AttributeUpdateInput = {}

		if (dto.key !== undefined) {
			data.key = normalizeKey(dto.key)
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

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('Нет полей для обновления')
		}

		if (dto.dataType !== undefined || dto.isVariantAttribute !== undefined) {
			const current = await this.repo.findById(id)
			if (!current) throw new NotFoundException('Атрибут не найден')

			const nextType = dto.dataType ?? current.dataType
			const nextVariant = dto.isVariantAttribute ?? current.isVariantAttribute

			this.ensureVariantRules(nextType, nextVariant)
		}

		const attribute = await this.repo.update(id, data)
		if (!attribute) throw new NotFoundException('Атрибут не найден')

		await this.invalidateTypeCache(attribute.typeId)
		return attribute
	}

	async remove(id: string) {
		const attribute = await this.repo.softDelete(id)
		if (!attribute) throw new NotFoundException('Атрибут не найден')

		await this.invalidateTypeCache(attribute.typeId)
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
			attribute: { connect: { id: attributeId } }
		}

		const enumValue = await this.repo.createEnumValue(data)
		await this.invalidateTypeCache(attribute.typeId)
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

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('Нет полей для обновления')
		}

		const enumValue = await this.repo.updateEnumValue(id, attributeId, data)
		if (!enumValue) throw new NotFoundException('Значение перечисления не найдено')

		await this.invalidateTypeCache(attribute.typeId)
		return enumValue
	}

	async removeEnumValue(attributeId: string, id: string) {
		const attribute = await this.requireEnumAttribute(attributeId)

		const enumValue = await this.repo.softDeleteEnumValue(id, attributeId)
		if (!enumValue) throw new NotFoundException('Значение перечисления не найдено')

		await this.invalidateTypeCache(attribute.typeId)
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

	private async invalidateTypeCache(typeId: string): Promise<void> {
		if (!this.cacheTtlSec) return
		await this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, typeId)
	}

	private async generateAttributeKey(
		typeId: string,
		displayName: string
	): Promise<string> {
		const base = buildKeyFromLabel(displayName) || ATTRIBUTE_KEY_FALLBACK
		return this.ensureUniqueKey(base, ATTRIBUTE_KEY_MAX_LENGTH, key =>
			this.repo.existsKey(typeId, key)
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

		const base = buildKeyFromLabel(label) || ENUM_VALUE_FALLBACK
		return this.ensureUniqueKey(base, ENUM_VALUE_MAX_LENGTH, value =>
			this.repo.existsEnumValue(attributeId, value)
		)
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
