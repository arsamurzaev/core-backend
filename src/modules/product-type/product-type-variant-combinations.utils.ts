import { DataType } from '@generated/enums'
import { BadRequestException } from '@nestjs/common'

export type ProductTypeVariantCombinationProductType = {
	attributes?: ProductTypeVariantAttributeDefinition[]
}

export type ProductTypeVariantAttributeDefinition = {
	attributeId?: string | null
	isVariant?: boolean | null
	isRequired?: boolean | null
	displayOrder?: number | null
	attribute?: {
		id?: string | null
		key?: string | null
		dataType?: DataType | null
	} | null
}

export type ProductTypeVariantCombinationInput = {
	attributes?: ProductTypeVariantCombinationAttributeInput[] | null
}

export type ProductTypeVariantCombinationAttributeInput = {
	attributeId?: string | null
	enumValueId?: string | null
	value?: string | null
}

type VariantAttribute = {
	id: string
	label: string
	dataType?: DataType | null
	isRequired: boolean
	displayOrder: number
}

const EMPTY_COMBINATION_KEY = '__empty__'

export function assertProductTypeVariantCombinations(
	productType: ProductTypeVariantCombinationProductType,
	combinations?: ProductTypeVariantCombinationInput[]
): void {
	const variantAttributes = getVariantAttributes(productType)
	assertEnumVariantAttributes(variantAttributes)

	const inputs = combinations ?? []
	if (!inputs.length) return

	if (!variantAttributes.length) {
		throw new BadRequestException('Product type has no variant attributes')
	}

	const variantAttributeById = new Map(
		variantAttributes.map(attribute => [attribute.id, attribute])
	)
	const requiredVariantAttributes = variantAttributes.filter(
		attribute => attribute.isRequired
	)
	const seenCombinationKeys = new Map<string, number>()

	inputs.forEach((combination, index) => {
		const valuesByAttributeId = getCombinationValues(
			combination,
			index,
			variantAttributeById
		)
		assertRequiredVariantAttributes(
			valuesByAttributeId,
			requiredVariantAttributes
		)

		const key = buildCombinationKey(variantAttributes, valuesByAttributeId)
		const duplicateIndex = seenCombinationKeys.get(key)
		if (duplicateIndex !== undefined) {
			throw new BadRequestException(
				`Duplicate variant attribute combination: #${index + 1} duplicates #${
					duplicateIndex + 1
				}`
			)
		}
		seenCombinationKeys.set(key, index)
	})
}

function getVariantAttributes(
	productType: ProductTypeVariantCombinationProductType
): VariantAttribute[] {
	return (productType.attributes ?? [])
		.flatMap(attribute => {
			if (attribute.isVariant !== true) return []

			const id = readString(attribute.attributeId ?? attribute.attribute?.id)
			if (!id) {
				throw new BadRequestException(
					'Product type variant attributeId is required'
				)
			}

			return [
				{
					id,
					label: readString(attribute.attribute?.key) ?? id,
					dataType: attribute.attribute?.dataType,
					isRequired: attribute.isRequired === true,
					displayOrder: Number.isInteger(attribute.displayOrder)
						? (attribute.displayOrder ?? 0)
						: 0
				}
			]
		})
		.sort((left, right) => {
			if (left.displayOrder !== right.displayOrder) {
				return left.displayOrder - right.displayOrder
			}
			return left.label.localeCompare(right.label)
		})
}

function assertEnumVariantAttributes(attributes: VariantAttribute[]): void {
	const invalid = attributes.filter(
		attribute => attribute.dataType !== DataType.ENUM
	)
	if (!invalid.length) return

	throw new BadRequestException(
		`Variant product type attributes must use ENUM data type: ${invalid
			.map(attribute => attribute.label)
			.join(', ')}`
	)
}

function getCombinationValues(
	combination: ProductTypeVariantCombinationInput,
	index: number,
	variantAttributeById: Map<string, VariantAttribute>
): Map<string, string> {
	const valuesByAttributeId = new Map<string, string>()

	for (const attribute of combination.attributes ?? []) {
		const attributeId = readString(attribute.attributeId)
		const variantAttribute = attributeId
			? variantAttributeById.get(attributeId)
			: undefined

		if (!attributeId) {
			throw new BadRequestException(
				`Variant combination #${index + 1} requires attributeId`
			)
		}
		if (!variantAttribute) {
			throw new BadRequestException(
				`Attribute ${attributeId} is not a variant attribute for this product type`
			)
		}
		if (valuesByAttributeId.has(attributeId)) {
			throw new BadRequestException(
				`Duplicate variant attribute ${variantAttribute.label} in combination #${
					index + 1
				}`
			)
		}

		valuesByAttributeId.set(
			attributeId,
			readCombinationValue(attribute, variantAttribute, index)
		)
	}

	return valuesByAttributeId
}

function readCombinationValue(
	attribute: ProductTypeVariantCombinationAttributeInput,
	variantAttribute: VariantAttribute,
	index: number
): string {
	const enumValueId = readString(attribute.enumValueId)
	const value = readString(attribute.value)

	if (enumValueId && value) {
		throw new BadRequestException(
			`Variant combination #${index + 1} cannot use enumValueId and value for ${
				variantAttribute.label
			}`
		)
	}
	if (enumValueId) return `enum:${enumValueId}`
	if (value) return `value:${normalizeVariantValue(value)}`

	throw new BadRequestException(
		`Variant combination #${index + 1} requires value for ${
			variantAttribute.label
		}`
	)
}

function assertRequiredVariantAttributes(
	valuesByAttributeId: Map<string, string>,
	requiredVariantAttributes: VariantAttribute[]
): void {
	const missing = requiredVariantAttributes.filter(
		attribute => !valuesByAttributeId.has(attribute.id)
	)
	if (!missing.length) return

	throw new BadRequestException(
		`Missing required variant attributes: ${missing
			.map(attribute => attribute.label)
			.join(', ')}`
	)
}

function buildCombinationKey(
	variantAttributes: VariantAttribute[],
	valuesByAttributeId: Map<string, string>
): string {
	const parts = variantAttributes.flatMap(attribute => {
		const value = valuesByAttributeId.get(attribute.id)
		return value ? [`${attribute.id}=${value}`] : []
	})

	return parts.length ? parts.join(';') : EMPTY_COMBINATION_KEY
}

function normalizeVariantValue(value: string): string {
	return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

function readString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length ? normalized : null
}
