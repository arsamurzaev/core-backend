import { BrandCreateInput, BrandUpdateInput } from '@generated/models'
import { BadRequestException } from '@nestjs/common'

import { normalizeRequiredString } from '@/shared/utils'

export const BRAND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeBrandName(value: string): string {
	return normalizeRequiredString(value, 'name')
}

export function normalizeBrandSlug(value: string): string {
	const normalized = normalizeRequiredString(value, 'slug').toLowerCase()
	if (!BRAND_SLUG_PATTERN.test(normalized)) {
		throw new BadRequestException(
			'slug РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ С‚РѕР»СЊРєРѕ Р»Р°С‚РёРЅРёС†Сѓ РІ РЅРёР¶РЅРµРј СЂРµРіРёСЃС‚СЂРµ, С†РёС„СЂС‹ Рё РґРµС„РёСЃС‹'
		)
	}
	return normalized
}

export function buildBrandCreateInput(
	catalogId: string,
	name: string,
	slug: string
): BrandCreateInput {
	return {
		name,
		slug,
		catalog: { connect: { id: catalogId } }
	}
}

export function buildBrandUpdateInput(input: {
	name?: string
	slug?: string
}): BrandUpdateInput {
	const data: BrandUpdateInput = {}

	if (input.name !== undefined) {
		data.name = normalizeBrandName(input.name)
	}
	if (input.slug !== undefined) {
		data.slug = input.slug
	}

	return data
}
