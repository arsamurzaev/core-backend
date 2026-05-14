import { BadRequestException } from '@nestjs/common'
import slugify from 'slugify'

export const PRODUCT_TYPE_CODE_PATTERN = /^[a-z0-9-]+$/

const PRODUCT_TYPE_CODE_MAX_LENGTH = 100
const PRODUCT_TYPE_CODE_FALLBACK = 'product-type'

export type ProductTypeAttributeInput = {
	attributeId: string
	isVariant?: boolean
	isRequired?: boolean
	displayOrder?: number
}

export type NormalizedProductTypeAttribute = {
	attributeId: string
	isVariant: boolean
	isRequired: boolean
	displayOrder: number
}

export function normalizeProductTypeName(value: string): string {
	const normalized = String(value).trim()
	if (!normalized) throw new BadRequestException('Product type name is required')
	return normalized
}

export function normalizeProductTypeCode(value: string): string {
	const normalized = String(value).trim().toLowerCase()
	if (!normalized) throw new BadRequestException('Product type code is required')
	if (!PRODUCT_TYPE_CODE_PATTERN.test(normalized)) {
		throw new BadRequestException('Product type code must be URL-safe')
	}
	return normalized
}

export function buildProductTypeCodeBase(name: string): string {
	return slugifyProductTypeValue(name) || PRODUCT_TYPE_CODE_FALLBACK
}

export async function generateUniqueProductTypeCode(
	base: string,
	exists: (candidate: string) => Promise<boolean>
): Promise<string> {
	let candidate = applyProductTypeCodeSuffix(base, 0)
	let suffix = 1

	while (await exists(candidate)) {
		candidate = applyProductTypeCodeSuffix(base, suffix)
		suffix += 1
	}

	return candidate
}

export function normalizeProductTypeAttributes(
	attributes?: ProductTypeAttributeInput[]
): NormalizedProductTypeAttribute[] {
	if (!attributes?.length) return []

	const seen = new Set<string>()
	return attributes.map((attribute, index) => {
		const attributeId = String(attribute.attributeId ?? '').trim()
		if (!attributeId) {
			throw new BadRequestException('Product type attributeId is required')
		}
		if (seen.has(attributeId)) {
			throw new BadRequestException('Product type attributes contain duplicates')
		}
		seen.add(attributeId)

		const displayOrder = attribute.displayOrder ?? index
		if (!Number.isInteger(displayOrder) || displayOrder < 0) {
			throw new BadRequestException('Product type displayOrder must be >= 0')
		}

		return {
			attributeId,
			isVariant: attribute.isVariant === true,
			isRequired: attribute.isRequired === true,
			displayOrder
		}
	})
}

function applyProductTypeCodeSuffix(base: string, suffix: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(
		0,
		PRODUCT_TYPE_CODE_MAX_LENGTH - suffixPart.length
	)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

function slugifyProductTypeValue(value: string): string {
	const slug = slugify(value, { lower: true, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}
