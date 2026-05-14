import { DataType } from '@generated/enums'
import {
	AttributeCreateInput,
	AttributeEnumValueCreateInput,
	AttributeEnumValueUpdateInput,
	AttributeUpdateInput
} from '@generated/models'
import { BadRequestException } from '@nestjs/common'
import slugify from 'slugify'

import { CreateAttributeEnumAliasDtoReq } from './dto/requests/create-attribute-enum-alias.dto.req'
import { CreateAttributeEnumDtoReq } from './dto/requests/create-attribute-enum.dto.req'
import { CreateAttributeDtoReq } from './dto/requests/create-attribute.dto.req'
import { UpdateAttributeEnumDtoReq } from './dto/requests/update-attribute-enum.dto.req'
import { UpdateAttributeDtoReq } from './dto/requests/update-attribute.dto.req'

export const ATTRIBUTE_KEY_MAX_LENGTH = 100
export const ENUM_VALUE_MAX_LENGTH = 255
const ATTRIBUTE_KEY_FALLBACK = 'attr'
const ENUM_VALUE_FALLBACK = 'value'

export function normalizeAttributeDictionaryText(value: string): string {
	return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function normalizeAttributeKey(value: string): string {
	return normalizeAttributeDictionaryText(value).toLowerCase()
}

export function normalizeAttributeLabel(value: string): string {
	return normalizeAttributeDictionaryText(value)
}

export function normalizeAttributeEnumValue(value: string): string {
	return normalizeAttributeDictionaryText(value).toLowerCase()
}

export function ensureVariantAttributeRules(
	dataType: DataType,
	isVariantAttribute?: boolean
): void {
	if (isVariantAttribute && dataType !== DataType.ENUM) {
		throw new BadRequestException('Вариантные атрибуты должны иметь тип ENUM')
	}
}

export function normalizeAttributeTypeIds(
	typeIds?: string[],
	typeId?: string
): string[] {
	const list = [...(typeIds ?? []), ...(typeId ? [typeId] : [])].map(value =>
		String(value).trim()
	)
	const unique = Array.from(new Set(list)).filter(Boolean)
	if (!unique.length) {
		throw new BadRequestException('Нужно указать typeIds или typeId')
	}
	return unique
}

export function buildAttributeKeyBase(displayName: string): string {
	return slugifyAttributeValue(displayName) || ATTRIBUTE_KEY_FALLBACK
}

export function buildEnumValueBase(displayName: string): string {
	return slugifyAttributeValue(displayName) || ENUM_VALUE_FALLBACK
}

export function applyAttributeSuffix(
	base: string,
	suffix: number,
	maxLength: number
): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, maxLength - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

export function buildAttributeCreateInput(
	dto: CreateAttributeDtoReq,
	typeIds: string[],
	key: string
): AttributeCreateInput {
	return {
		key,
		displayName: normalizeAttributeLabel(dto.displayName),
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
}

export function buildAttributeUpdateInput(dto: UpdateAttributeDtoReq): {
	data: AttributeUpdateInput
	nextKey?: string
	nextTypeIds?: string[]
} {
	const data: AttributeUpdateInput = {}
	const nextTypeIds =
		dto.typeIds !== undefined ? normalizeAttributeTypeIds(dto.typeIds) : undefined
	const nextKey =
		dto.key !== undefined ? normalizeAttributeKey(dto.key) : undefined

	if (nextKey !== undefined) {
		data.key = nextKey
	}
	if (dto.displayName !== undefined) {
		data.displayName = normalizeAttributeLabel(dto.displayName)
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

	return { data, nextKey, nextTypeIds }
}

export function buildAttributeEnumValueCreateInput(
	attributeId: string,
	dto: CreateAttributeEnumDtoReq,
	value: string,
	catalogId?: string | null
): AttributeEnumValueCreateInput & { source?: string } {
	return {
		value,
		displayName:
			dto.displayName === undefined
				? null
				: normalizeAttributeLabel(dto.displayName),
		displayOrder: dto.displayOrder ?? 0,
		businessId: dto.businessId?.trim() || null,
		source: dto.source ?? 'MANUAL',
		catalog: catalogId ? { connect: { id: catalogId } } : undefined,
		attribute: { connect: { id: attributeId } }
	}
}

export function buildAttributeEnumValueUpdateInput(
	dto: UpdateAttributeEnumDtoReq
): AttributeEnumValueUpdateInput & { source?: string } {
	const data: AttributeEnumValueUpdateInput & { source?: string } = {}

	if (dto.value !== undefined) {
		data.value = normalizeAttributeEnumValue(dto.value)
	}
	if (dto.displayName !== undefined) {
		data.displayName = normalizeAttributeLabel(dto.displayName)
	}
	if (dto.displayOrder !== undefined) {
		data.displayOrder = dto.displayOrder
	}
	if (dto.businessId !== undefined) {
		data.businessId = dto.businessId?.trim() || null
	}
	if (dto.source !== undefined) {
		data.source = dto.source
	}

	return data
}

export function buildAttributeEnumValueAliasCreateInput(
	attributeId: string,
	enumValueId: string,
	dto: CreateAttributeEnumAliasDtoReq,
	value: string,
	catalogId?: string | null
) {
	return {
		attributeId,
		catalogId: catalogId ?? null,
		enumValueId,
		value,
		displayName:
			dto.displayName === undefined
				? null
				: normalizeAttributeLabel(dto.displayName)
	}
}

export function getAttributeTypeIds(
	attribute?: { types?: Array<{ id: string }> } | null
): string[] {
	return attribute?.types?.map(type => type.id) ?? []
}

export function mergeUniqueTypeIds(...lists: string[][]): string[] {
	return Array.from(new Set(lists.flat().filter(Boolean)))
}

export function mapAttributeWithTypeIds<T extends { types?: { id: string }[] }>(
	attribute: T
) {
	const typeIds = getAttributeTypeIds(attribute)
	const rest = { ...attribute }
	delete (rest as { types?: { id: string }[] }).types
	return { ...rest, typeIds }
}

function slugifyAttributeValue(value: string): string {
	const slug = slugify(normalizeAttributeDictionaryText(value), {
		lower: true,
		strict: true,
		trim: true
	})
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}
